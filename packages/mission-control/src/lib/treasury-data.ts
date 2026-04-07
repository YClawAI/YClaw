import { getDb } from '@/lib/mongodb';
import { getRedis, redisScan } from '@/lib/redis';
import { getWalletBalances, getTotalPortfolioValue, type WalletBalance } from '@/lib/wallets';
import { AGENTS } from '@/lib/agents';
import { getBudgetConfig, type BudgetConfig } from '@/lib/actions/budget-config';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BankAccount {
  id: string;
  name: string;
  institution: string;
  type: 'checking' | 'credit_card' | 'savings' | 'other';
  availableBalance: number;
  ledgerBalance: number;
  currency: string;
  lastUpdated: string;
}

export interface CryptoHolding {
  chain: 'solana' | 'ethereum' | 'arbitrum' | 'base' | 'optimism' | 'polygon';
  address: string;
  label: string;
  category: 'treasury' | 'fees' | 'dev' | 'program' | 'protocol' | 'other';
  nativeBalance: number;
  nativeSymbol: string;
  usdValue: number;
  tokens: Array<{ symbol: string; balance: number; usdValue: number }>;
}

export interface LlmSpendSummary {
  todaySpendCents: number;
  monthSpendCents: number;
  last30DaysSpendCents: number;
  byModel: Array<{ model: string; spendCents: number; requests: number }>;
  byAgent: Array<{ agentId: string; label: string; emoji?: string; spendCents: number; requests: number; dailySpendCents: number }>;
  dailyTrend: Array<{ date: string; spendCents: number }>;
}

export interface InfraCosts {
  aws: { totalMonthlyCents: number; byService: Array<{ service: string; costCents: number }> };
  mongoAtlas: { monthlyCents: number };
  redisCloud: { monthlyCents: number };
  totalMonthlyCents: number;
}

export interface BudgetSummary {
  config: BudgetConfig;
  fleetDailySpendCents: number;
  fleetMonthlySpendCents: number;
  agents: Array<{
    agentId: string;
    label: string;
    emoji?: string;
    dailyLimitCents: number;
    monthlyLimitCents: number;
    alertThresholdPercent: number;
    dailySpendCents: number;
    monthlySpendCents: number;
    action: string;
    hasBudget: boolean;
  }>;
}

export interface RunwayStatus {
  totalAssets: number;
  monthlyBurn: number;
  daysRemaining: number;
  status: 'healthy' | 'warning' | 'critical';
}

export interface TreasuryData {
  banking: { accounts: BankAccount[]; totalAvailable: number } | null;
  crypto: { holdings: CryptoHolding[]; totalUsd: number; byChain: Record<string, number>; wallets: WalletBalance[] } | null;
  llmSpend: LlmSpendSummary;
  infraCosts: InfraCosts | null;
  budget: BudgetSummary;
  runway: RunwayStatus;
  lastUpdated: Record<string, string>;
}

// ─── Category Detection ─────────────────────────────────────────────────────

function detectCategory(label: string): CryptoHolding['category'] {
  const l = label.toLowerCase();
  if (l.includes('treasury')) return 'treasury';
  if (l.includes('fee')) return 'fees';
  if (l.includes('dev') || l.includes('navi') || l.includes('dev_wallet')) return 'dev';
  if (l.includes('program') || l.includes('authority') || l.includes('deployer')) return 'program';
  if (l.includes('protocol_controller') || l.includes('protocol_orchestrator') || l.includes('protocol_owner')) return 'protocol';
  return 'other';
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

async function fetchBanking(db: import('mongodb').Db | null): Promise<TreasuryData['banking']> {
  if (!db) return null;
  try {
    const snap = await db.collection('treasury_snapshots').findOne({ _id: 'banking' as unknown as import('mongodb').ObjectId });
    if (!snap?.data) return null;
    const data = snap.data as { accounts?: unknown[] };
    if (!Array.isArray(data.accounts) || data.accounts.length === 0) return null;
    const accounts: BankAccount[] = data.accounts.map((a: unknown) => {
      const acc = a as Record<string, unknown>;
      return {
        id: String(acc.id ?? ''),
        name: String(acc.name ?? acc.account_name ?? ''),
        institution: String(acc.institution ?? acc.bank ?? ''),
        type: (acc.type as BankAccount['type']) ?? 'other',
        availableBalance: Number(acc.availableBalance ?? acc.available ?? 0),
        ledgerBalance: Number(acc.ledgerBalance ?? acc.ledger ?? 0),
        currency: String(acc.currency ?? 'USD'),
        lastUpdated: String(snap.updatedAt ?? ''),
      };
    });
    return {
      accounts,
      totalAvailable: accounts.reduce((s, a) => s + a.availableBalance, 0),
    };
  } catch {
    return null;
  }
}

async function fetchCrypto(db: import('mongodb').Db | null): Promise<TreasuryData['crypto']> {
  // Try snapshot first, fall back to live RPC
  if (db) {
    try {
      const snap = await db.collection('treasury_snapshots').findOne({ _id: 'crypto' as unknown as import('mongodb').ObjectId });
      if (snap?.data) {
        const data = snap.data as { holdings?: unknown[] };
        if (Array.isArray(data.holdings) && data.holdings.length > 0) {
          const holdings: CryptoHolding[] = data.holdings.map((h: unknown) => {
            const hld = h as Record<string, unknown>;
            return {
              chain: (hld.chain as CryptoHolding['chain']) ?? 'solana',
              address: String(hld.address ?? ''),
              label: String(hld.label ?? ''),
              category: detectCategory(String(hld.label ?? '')),
              nativeBalance: Number(hld.nativeBalance ?? 0),
              nativeSymbol: String(hld.nativeSymbol ?? ''),
              usdValue: Number(hld.usdValue ?? hld.totalUsdValue ?? 0),
              tokens: Array.isArray(hld.tokens)
                ? (hld.tokens as Array<Record<string, unknown>>).map(t => ({
                    symbol: String(t.symbol ?? ''),
                    balance: Number(t.balance ?? 0),
                    usdValue: Number(t.usdValue ?? 0),
                  }))
                : [],
            };
          });
          const totalUsd = holdings.reduce((s, h) => s + h.usdValue, 0);
          const byChain: Record<string, number> = {};
          for (const h of holdings) {
            byChain[h.chain] = (byChain[h.chain] ?? 0) + h.usdValue;
          }
          return { holdings, totalUsd, byChain, wallets: [] };
        }
      }
    } catch {
      // fall through to live
    }
  }

  // Fallback: live RPC wallet fetch
  try {
    const wallets = await getWalletBalances();
    if (wallets.length === 0) return null;
    const totalUsd = getTotalPortfolioValue(wallets);
    const holdings: CryptoHolding[] = wallets.map(w => ({
      chain: w.chain as CryptoHolding['chain'],
      address: w.address,
      label: w.label ?? '',
      category: detectCategory(w.label ?? ''),
      nativeBalance: w.nativeBalance,
      nativeSymbol: w.chain === 'solana' ? 'SOL' : 'ETH',
      usdValue: w.totalUsdValue,
      tokens: w.tokens.map(t => ({
        symbol: t.symbol,
        balance: t.balance,
        usdValue: t.usdValue,
      })),
    }));
    const byChain: Record<string, number> = {};
    for (const h of holdings) {
      byChain[h.chain] = (byChain[h.chain] ?? 0) + h.usdValue;
    }
    return { holdings, totalUsd, byChain, wallets };
  } catch {
    return null;
  }
}

async function fetchLlmSpend(db: import('mongodb').Db | null): Promise<LlmSpendSummary> {
  const empty: LlmSpendSummary = {
    todaySpendCents: 0,
    monthSpendCents: 0,
    last30DaysSpendCents: 0,
    byModel: [],
    byAgent: [],
    dailyTrend: [],
  };

  // Try Redis first for today/month totals
  let todaySpendCents = 0;
  let monthSpendCents = 0;
  const redis = getRedis();
  if (redis) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const month = new Date().toISOString().slice(0, 7);
      const dailyKeys = await redisScan(`cost:daily:*:${today}`);
      const monthlyKeys = await redisScan(`cost:monthly:*:${month}`);

      if (dailyKeys.length > 0) {
        const vals = await redis.mget(...dailyKeys);
        for (const v of vals) {
          if (v) todaySpendCents += parseInt(v, 10);
        }
      }
      if (monthlyKeys.length > 0) {
        const vals = await redis.mget(...monthlyKeys);
        for (const v of vals) {
          if (v) monthSpendCents += parseInt(v, 10);
        }
      }

      // Per-agent daily spend from Redis
      const agentDailyMap = new Map<string, number>();
      for (const key of dailyKeys) {
        // key format: cost:daily:{agentId}:{date}
        const parts = key.split(':');
        if (parts.length >= 4) {
          const agentId = parts[2]!;
          const val = await redis.get(key);
          if (val) {
            agentDailyMap.set(agentId, (agentDailyMap.get(agentId) ?? 0) + parseInt(val, 10));
          }
        }
      }
      empty.todaySpendCents = todaySpendCents;
      empty.monthSpendCents = monthSpendCents;

      // Build byAgent from Redis daily keys with month totals
      const agentMonthMap = new Map<string, number>();
      for (const key of monthlyKeys) {
        const parts = key.split(':');
        if (parts.length >= 4) {
          const agentId = parts[2]!;
          const val = await redis.get(key);
          if (val) {
            agentMonthMap.set(agentId, (agentMonthMap.get(agentId) ?? 0) + parseInt(val, 10));
          }
        }
      }

      const allAgentIds = new Set([...agentDailyMap.keys(), ...agentMonthMap.keys()]);
      empty.byAgent = [...allAgentIds].map(agentId => {
        const info = AGENTS.find(a => a.name === agentId);
        return {
          agentId,
          label: info?.label ?? agentId,
          emoji: info?.emoji,
          spendCents: agentMonthMap.get(agentId) ?? 0,
          requests: 0, // filled from MongoDB below
          dailySpendCents: agentDailyMap.get(agentId) ?? 0,
        };
      }).sort((a, b) => b.spendCents - a.spendCents);
    } catch {
      // continue with MongoDB fallback
    }
  }

  if (!db) return empty;

  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStr = now.toISOString().slice(0, 7);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    const col = db.collection('agent_cost_events');

    // Run all aggregations in parallel
    const [byModelAgg, last30Agg, dailyTrendAgg, byAgentAgg] = await Promise.all([
      // By model (this month)
      col.aggregate([
        { $match: { timestamp: { $gte: new Date(`${monthStr}-01`) } } },
        { $group: { _id: '$modelId', total: { $sum: '$costCents' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]).toArray(),
      // Last 30 days total
      col.aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$costCents' } } },
      ]).toArray(),
      // Daily trend (last 14 days)
      col.aggregate([
        { $match: { timestamp: { $gte: new Date(now.getTime() - 14 * 86400000) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, total: { $sum: '$costCents' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      // By agent (this month) — for request count if Redis didn't provide
      col.aggregate([
        { $match: { timestamp: { $gte: new Date(`${monthStr}-01`) } } },
        { $group: { _id: '$agentId', total: { $sum: '$costCents' }, count: { $sum: 1 }, dailyTotal: { $sum: { $cond: [{ $gte: ['$timestamp', new Date(`${todayStr}T00:00:00Z`)] }, '$costCents', 0] } } } },
        { $sort: { total: -1 } },
      ]).toArray(),
    ]);

    empty.byModel = byModelAgg.map(r => ({
      model: (r._id as string) ?? 'unknown',
      spendCents: (r.total as number) ?? 0,
      requests: (r.count as number) ?? 0,
    }));

    empty.last30DaysSpendCents = (last30Agg[0]?.total as number) ?? 0;

    empty.dailyTrend = dailyTrendAgg.map(r => ({
      date: r._id as string,
      spendCents: (r.total as number) ?? 0,
    }));

    // Merge MongoDB agent data with Redis data
    if (empty.byAgent.length === 0) {
      empty.byAgent = byAgentAgg.map(r => {
        const agentId = r._id as string;
        const info = AGENTS.find(a => a.name === agentId);
        return {
          agentId,
          label: info?.label ?? agentId,
          emoji: info?.emoji,
          spendCents: (r.total as number) ?? 0,
          requests: (r.count as number) ?? 0,
          dailySpendCents: (r.dailyTotal as number) ?? 0,
        };
      });
    } else {
      // Add request counts from MongoDB to Redis-sourced data
      const mongoAgentMap = new Map(byAgentAgg.map(r => [r._id as string, r]));
      for (const agent of empty.byAgent) {
        const mongo = mongoAgentMap.get(agent.agentId);
        if (mongo) {
          agent.requests = (mongo.count as number) ?? 0;
        }
      }
    }

    // Fall back to MongoDB for today/month if Redis was empty
    if (empty.todaySpendCents === 0) {
      const todayAgg = await col.aggregate([
        { $match: { timestamp: { $gte: new Date(`${todayStr}T00:00:00Z`) } } },
        { $group: { _id: null, total: { $sum: '$costCents' } } },
      ]).toArray();
      empty.todaySpendCents = (todayAgg[0]?.total as number) ?? 0;
    }
    if (empty.monthSpendCents === 0) {
      const monthAgg = await col.aggregate([
        { $match: { timestamp: { $gte: new Date(`${monthStr}-01`) } } },
        { $group: { _id: null, total: { $sum: '$costCents' } } },
      ]).toArray();
      empty.monthSpendCents = (monthAgg[0]?.total as number) ?? 0;
    }
  } catch {
    // return what we have from Redis
  }

  return empty;
}

async function fetchInfraCosts(db: import('mongodb').Db | null): Promise<InfraCosts | null> {
  if (!db) return null;
  try {
    const snap = await db.collection('treasury_snapshots').findOne({ _id: 'infra' as unknown as import('mongodb').ObjectId });
    if (!snap?.data) return null;
    const data = snap.data as Record<string, unknown>;

    const awsData = data.aws as Record<string, unknown> | undefined;
    const awsByService = Array.isArray(awsData?.byService)
      ? (awsData!.byService as Array<Record<string, unknown>>).map(s => ({
          service: String(s.service ?? s.name ?? ''),
          costCents: Math.round(Number(s.costCents ?? (Number(s.cost ?? 0) * 100))),
        }))
      : [];
    const awsTotal = awsByService.reduce((s, x) => s + x.costCents, 0);

    const atlasMonthly = Math.round(Number((data.mongoAtlas as Record<string, unknown>)?.monthlyCents ?? (Number((data.mongoAtlas as Record<string, unknown>)?.monthly ?? 0) * 100)));
    const redisMonthly = Math.round(Number((data.redisCloud as Record<string, unknown>)?.monthlyCents ?? (Number((data.redisCloud as Record<string, unknown>)?.monthly ?? 0) * 100)));

    return {
      aws: { totalMonthlyCents: awsTotal, byService: awsByService },
      mongoAtlas: { monthlyCents: atlasMonthly },
      redisCloud: { monthlyCents: redisMonthly },
      totalMonthlyCents: awsTotal + atlasMonthly + redisMonthly,
    };
  } catch {
    return null;
  }
}

async function fetchBudgetSummary(db: import('mongodb').Db | null): Promise<BudgetSummary> {
  const config = await getBudgetConfig();

  let fleetDailySpendCents = 0;
  let fleetMonthlySpendCents = 0;
  const agents: BudgetSummary['agents'] = [];

  if (!db) return { config, fleetDailySpendCents, fleetMonthlySpendCents, agents };

  try {
    const budgets = await db.collection('agent_budgets').find({}).toArray();
    const budgetMap = new Map(budgets.map(b => [b.agentId as string, b]));

    const todayStr = new Date().toISOString().slice(0, 10);
    const monthStr = new Date().toISOString().slice(0, 7);

    // Per-agent spend from Redis
    const redis = getRedis();
    const dailySpendMap = new Map<string, number>();
    const monthlySpendMap = new Map<string, number>();

    if (redis) {
      try {
        const dailyKeys = await redisScan(`cost:daily:*:${todayStr}`);
        for (const key of dailyKeys) {
          const parts = key.split(':');
          if (parts.length >= 4) {
            const agentId = parts[2]!;
            const val = await redis.get(key);
            if (val) dailySpendMap.set(agentId, parseInt(val, 10));
          }
        }
        const monthlyKeys = await redisScan(`cost:monthly:*:${monthStr}`);
        for (const key of monthlyKeys) {
          const parts = key.split(':');
          if (parts.length >= 4) {
            const agentId = parts[2]!;
            const val = await redis.get(key);
            if (val) monthlySpendMap.set(agentId, parseInt(val, 10));
          }
        }
      } catch {
        // fall through
      }
    }

    // Fallback to MongoDB run_records if Redis is empty
    if (dailySpendMap.size === 0) {
      try {
        const dailyAgg = await db.collection('run_records').aggregate([
          { $match: { createdAt: { $gte: `${todayStr}T00:00:00` } } },
          { $group: { _id: '$agentId', total: { $sum: '$cost.totalUsd' } } },
        ]).toArray();
        for (const r of dailyAgg) {
          dailySpendMap.set(r._id as string, Math.round(((r.total as number) ?? 0) * 100));
        }
      } catch {
        // skip
      }
    }
    if (monthlySpendMap.size === 0) {
      try {
        const monthlyAgg = await db.collection('run_records').aggregate([
          { $match: { createdAt: { $gte: `${monthStr}-01T00:00:00` } } },
          { $group: { _id: '$agentId', total: { $sum: '$cost.totalUsd' } } },
        ]).toArray();
        for (const r of monthlyAgg) {
          monthlySpendMap.set(r._id as string, Math.round(((r.total as number) ?? 0) * 100));
        }
      } catch {
        // skip
      }
    }

    // Fleet totals
    for (const v of dailySpendMap.values()) fleetDailySpendCents += v;
    for (const v of monthlySpendMap.values()) fleetMonthlySpendCents += v;

    // Build agent rows — only show budget fields for agents that have a saved budget
    const relevantIds = new Set([...budgetMap.keys(), ...dailySpendMap.keys(), ...monthlySpendMap.keys()]);
    for (const agentId of relevantIds) {
      const info = AGENTS.find(a => a.name === agentId);
      const b = budgetMap.get(agentId);
      const hasBudget = b !== undefined;

      let dailyLimitCents = 0;
      let monthlyLimitCents = 0;
      let alertThresholdPercent = 80;
      if (b?.dailyLimitCents !== undefined) {
        dailyLimitCents = b.dailyLimitCents as number;
        monthlyLimitCents = (b.monthlyLimitCents as number) ?? dailyLimitCents * 30;
        alertThresholdPercent = (b.alertThresholdPercent as number) ?? 80;
      } else if (b?.dailyLimit !== undefined) {
        dailyLimitCents = Math.round((b.dailyLimit as number) * 100);
        monthlyLimitCents = Math.round(((b.monthlyLimit as number) ?? (b.dailyLimit as number) * 30) * 100);
        alertThresholdPercent = (b.alertThreshold as number) ?? (b.alertThresholdPercent as number) ?? 80;
      }

      agents.push({
        agentId,
        label: info?.label ?? agentId,
        emoji: info?.emoji,
        dailyLimitCents,
        monthlyLimitCents,
        alertThresholdPercent,
        dailySpendCents: dailySpendMap.get(agentId) ?? 0,
        monthlySpendCents: monthlySpendMap.get(agentId) ?? 0,
        action: (b?.action as string) ?? 'alert',
        hasBudget,
      });
    }

    agents.sort((a, b) => b.monthlySpendCents - a.monthlySpendCents);
  } catch {
    // return defaults
  }

  return { config, fleetDailySpendCents, fleetMonthlySpendCents, agents };
}

function calculateRunway(
  banking: TreasuryData['banking'],
  crypto: TreasuryData['crypto'],
  llmSpend: LlmSpendSummary,
  infraCosts: InfraCosts | null,
): RunwayStatus {
  const bankingTotal = banking?.totalAvailable ?? 0;
  const cryptoTotal = crypto?.totalUsd ?? 0;
  const totalAssets = bankingTotal + cryptoTotal;

  const llmMonthly = llmSpend.last30DaysSpendCents / 100;
  const infraMonthly = infraCosts ? infraCosts.totalMonthlyCents / 100 : 0;
  const monthlyBurn = llmMonthly + infraMonthly;

  const dailyBurn = monthlyBurn / 30;
  const daysRemaining = dailyBurn > 0 ? Math.round(totalAssets / dailyBurn) : 9999;

  let status: RunwayStatus['status'] = 'healthy';
  if (daysRemaining < 180) status = 'critical';
  else if (daysRemaining < 365) status = 'warning';

  return { totalAssets, monthlyBurn, daysRemaining, status };
}

// ─── Main Fetcher ───────────────────────────────────────────────────────────

export async function getTreasuryData(): Promise<TreasuryData> {
  const db = await getDb();

  const [banking, crypto, llmSpend, infraCosts, budget] = await Promise.all([
    fetchBanking(db),
    fetchCrypto(db),
    fetchLlmSpend(db),
    fetchInfraCosts(db),
    fetchBudgetSummary(db),
  ]);

  const runway = calculateRunway(banking, crypto, llmSpend, infraCosts);

  // Collect last-updated timestamps from snapshots
  const lastUpdated: Record<string, string> = {};
  if (db) {
    try {
      const snaps = await db.collection('treasury_snapshots').find({}).toArray();
      for (const snap of snaps) {
        const id = String(snap._id);
        if (snap.updatedAt) {
          lastUpdated[id] = snap.updatedAt instanceof Date
            ? snap.updatedAt.toISOString()
            : String(snap.updatedAt);
        }
      }
    } catch {
      // skip
    }
  }
  lastUpdated.llm = new Date().toISOString(); // always fresh

  return { banking, crypto, llmSpend, infraCosts, budget, runway, lastUpdated };
}
