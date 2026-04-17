'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { TreasuryData } from '@/lib/treasury-data';
import type { AttentionItem } from '@/lib/attention-engine';
import { FinanceSettings } from '@/components/finance-settings';
import { AgentDetailDrawer } from '@/components/agent-detail-drawer';
import { BurnVelocity } from '@/components/burn-velocity';
import { SpendFlow } from '@/components/spend-flow';
import type { BudgetRow } from '@/components/budget-overview';
import { useEventStream } from '@/lib/hooks/use-event-stream';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDollars(d: number): string {
  if (d >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${d.toFixed(0)}`;
}

function runwayColor(status: TreasuryData['runway']['status']): string {
  if (status === 'critical') return 'text-mc-danger';
  if (status === 'warning') return 'text-mc-warning';
  return 'text-mc-success';
}

function severityStyle(s: AttentionItem['severity']): string {
  if (s === 'critical') return 'border-mc-danger/40 bg-mc-danger/5';
  if (s === 'warning') return 'border-mc-warning/40 bg-mc-warning/5';
  return 'border-mc-border bg-mc-surface-hover';
}

function severityDot(s: AttentionItem['severity']): string {
  if (s === 'critical') return 'bg-mc-danger';
  if (s === 'warning') return 'bg-mc-warning';
  return 'bg-mc-text-tertiary';
}

type Tab = 'all' | 'agents' | 'assets' | 'infra';

const CHAIN_COLORS: Record<string, string> = {
  solana: 'bg-mc-accent',
  ethereum: 'bg-mc-info',
  base: 'bg-mc-accent',
  arbitrum: 'bg-mc-blocked',
  optimism: 'bg-mc-danger',
  polygon: 'bg-mc-success',
};

const CHAIN_LABELS: Record<string, string> = {
  solana: 'Solana',
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  polygon: 'Polygon',
};

// ─── Main Component ─────────────────────────────────────────────────────────

export function TreasuryClient({
  data,
  attentionItems,
}: {
  data: TreasuryData;
  attentionItems: AttentionItem[];
}) {
  const [finSettingsOpen, setFinSettingsOpen] = useState(false);
  const [runwayExpanded, setRunwayExpanded] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const drawerAgent = searchParams.get('agent');
  const rawTab = searchParams.get('tab');
  const tab: Tab = (rawTab === 'agents' || rawTab === 'assets' || rawTab === 'infra') ? rawTab : 'all';
  const [fleetOnline, setFleetOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadFleetMode() {
      try {
        const res = await fetch('/api/org/fleet', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { mode?: string };
        if (!cancelled) {
          setFleetOnline(data.mode === 'active');
        }
      } catch {
        // keep last known state
      }
    }

    void loadFleetMode();

    return () => {
      cancelled = true;
    };
  }, []);

  useEventStream({
    'fleet:status': (payload) => {
      const data = payload as { status?: string };
      setFleetOnline(data.status === 'active');
    },
  });

  const setTab = useCallback((t: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (t === 'all') {
      params.delete('tab');
    } else {
      params.set('tab', t);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [searchParams, router, pathname]);


  const openAgentDetail = useCallback((agentId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('agent', agentId);
    router.push(`${pathname}?${params.toString()}`);
  }, [searchParams, router, pathname]);

  const closeAgentDrawer = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('agent');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [searchParams, router, pathname]);

  // Compute derived values
  const bankingTotal = data.banking?.totalAvailable ?? 0;
  const cryptoTotal = data.crypto?.totalUsd ?? 0;
  const llmMonthly = data.llmSpend.last30DaysSpendCents / 100;
  const infraMonthly = data.infraCosts ? data.infraCosts.totalMonthlyCents / 100 : 0;

  // Yesterday's spend for comparison
  const yesterdayCents = data.llmSpend.dailyTrend.length >= 2
    ? data.llmSpend.dailyTrend[data.llmSpend.dailyTrend.length - 2]?.spendCents ?? 0
    : 0;
  const weekAvgCents = data.llmSpend.dailyTrend.length >= 7
    ? Math.round(data.llmSpend.dailyTrend.slice(-7).reduce((s, d) => s + d.spendCents, 0) / 7)
    : data.llmSpend.todaySpendCents;

  // Budget rows for BudgetOverview compatibility
  const budgetRows: BudgetRow[] = data.budget.agents.map(a => ({
    agentId: a.agentId,
    label: a.label,
    emoji: a.emoji,
    dailyLimitCents: a.dailyLimitCents,
    monthlyLimitCents: a.monthlyLimitCents,
    alertThresholdPercent: a.alertThresholdPercent,
    dailySpend: a.dailySpendCents / 100,
    monthlySpend: a.monthlySpendCents / 100,
    action: a.action,
    hasBudget: a.hasBudget,
  }));

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-mc-text tracking-wide">Treasury</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFinSettingsOpen(true)}
            className="px-3 py-1.5 text-xs font-mono border border-mc-border rounded hover:bg-mc-surface-hover transition-colors text-mc-text-tertiary hover:text-mc-text"
          >
            Settings
          </button>
        </div>
      </div>

      {/* ── Runway Hero ── */}
      <section className="mb-6">
        <div className="bg-mc-surface-hover border border-mc-border rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-mc-text-tertiary uppercase tracking-widest mb-1">Runway</div>
              <div className={`text-4xl font-bold font-mono ${runwayColor(data.runway.status)}`}>
                {data.runway.daysRemaining > 9000 ? '∞' : data.runway.daysRemaining} <span className="text-lg">days</span>
              </div>
              <div className="text-xs text-mc-text-tertiary mt-1">
                Assets: {formatDollars(data.runway.totalAssets)} (Fiat {formatDollars(bankingTotal)} + Crypto {formatDollars(cryptoTotal)})
              </div>
              <div className="text-xs text-mc-text-tertiary">
                Burning: {formatDollars(data.runway.monthlyBurn)}/mo (LLM {formatDollars(llmMonthly)} + Infra {formatDollars(infraMonthly)})
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className={`w-4 h-4 rounded-full ${runwayColor(data.runway.status).replace('text-', 'bg-')}`} />
              <button
                onClick={() => setRunwayExpanded(!runwayExpanded)}
                className="text-[10px] text-mc-text-tertiary hover:text-mc-text"
              >
                {runwayExpanded ? 'collapse' : 'expand breakdown'}
              </button>
            </div>
          </div>

          {runwayExpanded && (
            <div className="mt-4 pt-4 border-t border-mc-border grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] text-mc-text-tertiary uppercase">Fiat (Banking)</div>
                <div className="text-sm font-mono text-mc-text">{formatDollars(bankingTotal)}</div>
              </div>
              <div>
                <div className="text-[10px] text-mc-text-tertiary uppercase">Crypto</div>
                <div className="text-sm font-mono text-mc-text">{formatDollars(cryptoTotal)}</div>
              </div>
              <div>
                <div className="text-[10px] text-mc-text-tertiary uppercase">LLM Spend (30d)</div>
                <div className="text-sm font-mono text-mc-danger">{formatDollars(llmMonthly)}</div>
              </div>
              <div>
                <div className="text-[10px] text-mc-text-tertiary uppercase">Infra (Monthly)</div>
                <div className="text-sm font-mono text-mc-danger">{formatDollars(infraMonthly)}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Needs Attention ── */}
      {attentionItems.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-mc-warning mb-3">
            Needs Attention
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {attentionItems.slice(0, 6).map(item => (
              <div key={item.id} className={`border rounded p-3 ${severityStyle(item.severity)}`}>
                <div className="flex items-start gap-2">
                  <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${severityDot(item.severity)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-mc-text truncate">{item.title}</div>
                    <div className="text-[10px] text-mc-text-tertiary mt-0.5">{item.description}</div>
                    {item.metric && (
                      <div className="text-[10px] font-mono text-mc-text-tertiary mt-1">{item.metric}</div>
                    )}
                  </div>
                  {item.action && (
                    <button
                      onClick={() => setFinSettingsOpen(true)}
                      className="text-[10px] text-mc-accent hover:underline shrink-0"
                    >
                      {item.action.label} &rarr;
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Daily Burn ── */}
      <section className="mb-6">
        <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-mc-info">Daily Burn</h3>
            <BurnVelocity initialDailySpendCents={data.llmSpend.todaySpendCents} />
          </div>
          <SpendFlow
            byModel={data.llmSpend.byModel}
            infraCosts={data.infraCosts ? {
              aws: data.infraCosts.aws.totalMonthlyCents / 30,
              mongoAtlas: data.infraCosts.mongoAtlas.monthlyCents / 30,
              redisCloud: data.infraCosts.redisCloud.monthlyCents / 30,
            } : null}
            todayCents={data.llmSpend.todaySpendCents}
            yesterdayCents={yesterdayCents}
            weekAvgCents={weekAvgCents}
          />
        </div>
      </section>

      {/* ── Tabs ── */}
      <section className="mb-6">
        <div className="flex border-b border-mc-border mb-4">
          {(['all', 'agents', 'assets', 'infra'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-mono transition-colors border-b-2 ${
                tab === t
                  ? 'border-mc-accent text-mc-accent'
                  : 'border-transparent text-mc-text-tertiary hover:text-mc-text'
              }`}
            >
              {t === 'all' ? 'All' : t === 'agents' ? 'Agents' : t === 'assets' ? 'Assets' : 'Infra'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'all' && <AllTab data={data} budgetRows={budgetRows} onAgentClick={openAgentDetail} />}
        {tab === 'agents' && <AgentsTab data={data} budgetRows={budgetRows} onBudgetClick={() => setFinSettingsOpen(true)} onAgentClick={openAgentDetail} />}
        {tab === 'assets' && <AssetsTab data={data} />}
        {tab === 'infra' && <InfraTab data={data} />}
      </section>

      {/* ── Finance Department Settings (includes Budget Controls) ── */}
      <FinanceSettings
        open={finSettingsOpen}
        onClose={() => setFinSettingsOpen(false)}
        budgetData={data.budget}
        budgetRows={budgetRows}
      />

      {/* Agent Detail Drawer */}
      <AgentDetailDrawer
        agentId={drawerAgent}
        open={!!drawerAgent}
        onClose={closeAgentDrawer}
        fleetOnline={fleetOnline}
      />
    </div>
  );
}

// ─── Tab: All ───────────────────────────────────────────────────────────────

function AllTab({ data, budgetRows, onAgentClick }: { data: TreasuryData; budgetRows: BudgetRow[]; onAgentClick: (agentId: string) => void }) {
  return (
    <div className="space-y-6">
      {/* Budget summary */}
      {data.budget.config.mode !== 'off' && (
        <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-mc-text-tertiary uppercase">Budget Status</span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              data.budget.config.mode === 'enforcing'
                ? 'bg-mc-success/10 text-mc-success'
                : 'bg-mc-warning/10 text-mc-warning'
            }`}>
              {data.budget.config.mode}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-[10px] text-mc-text-tertiary mb-1">Fleet Daily</div>
              <div className="w-full bg-mc-border rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    data.budget.fleetDailySpendCents >= data.budget.config.globalDailyLimitCents
                      ? 'bg-mc-danger'
                      : data.budget.fleetDailySpendCents >= data.budget.config.globalDailyLimitCents * 0.8
                        ? 'bg-mc-warning'
                        : 'bg-mc-success'
                  }`}
                  style={{ width: `${Math.min((data.budget.fleetDailySpendCents / Math.max(data.budget.config.globalDailyLimitCents, 1)) * 100, 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-mc-text-tertiary mt-0.5 font-mono">
                {formatUsd(data.budget.fleetDailySpendCents)} / {formatUsd(data.budget.config.globalDailyLimitCents)}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-[10px] text-mc-text-tertiary mb-1">Fleet Monthly</div>
              <div className="w-full bg-mc-border rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    data.budget.fleetMonthlySpendCents >= data.budget.config.globalMonthlyLimitCents
                      ? 'bg-mc-danger'
                      : data.budget.fleetMonthlySpendCents >= data.budget.config.globalMonthlyLimitCents * 0.8
                        ? 'bg-mc-warning'
                        : 'bg-mc-success'
                  }`}
                  style={{ width: `${Math.min((data.budget.fleetMonthlySpendCents / Math.max(data.budget.config.globalMonthlyLimitCents, 1)) * 100, 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-mc-text-tertiary mt-0.5 font-mono">
                {formatUsd(data.budget.fleetMonthlySpendCents)} / {formatUsd(data.budget.config.globalMonthlyLimitCents)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top 5 agents by spend */}
      <div>
        <h4 className="text-xs font-bold text-mc-text-tertiary uppercase mb-2">Top Agents (This Month)</h4>
        <div className="border border-mc-border rounded overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-mc-surface-hover border-b border-mc-border">
              <tr>
                {['Agent', 'Daily', 'Monthly', 'Status'].map(h => (
                  <th key={h} className="text-left px-3 py-1.5 text-mc-text-tertiary font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.llmSpend.byAgent.slice(0, 5).map(agent => {
                const budgetRow = budgetRows.find(b => b.agentId === agent.agentId);
                const dailyPct = budgetRow && budgetRow.dailyLimitCents > 0
                  ? (agent.dailySpendCents / budgetRow.dailyLimitCents) * 100
                  : 0;
                return (
                  <tr key={agent.agentId} className="border-b border-mc-border/50 hover:bg-mc-surface-hover/50">
                    <td className="px-3 py-1.5">
                      <button onClick={() => onAgentClick(agent.agentId)} className="text-mc-accent hover:underline">
                        {agent.emoji && <span className="mr-1">{agent.emoji}</span>}
                        {agent.label}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-mc-text">{formatUsd(agent.dailySpendCents)}</td>
                    <td className="px-3 py-1.5 text-mc-text">{formatUsd(agent.spendCents)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] font-bold ${
                        dailyPct >= 100 ? 'text-mc-danger' : dailyPct >= 80 ? 'text-mc-warning' : 'text-mc-success'
                      }`}>
                        {dailyPct >= 100 ? 'over' : dailyPct >= 80 ? 'warn' : 'ok'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Crypto by chain */}
      {data.crypto && data.crypto.totalUsd > 0 && (
        <div>
          <h4 className="text-xs font-bold text-mc-text-tertiary uppercase mb-2">Crypto by Chain</h4>
          <div className="space-y-1.5">
            {Object.entries(data.crypto.byChain)
              .sort((a, b) => b[1] - a[1])
              .map(([chain, usd]) => {
                const pct = data.crypto!.totalUsd > 0 ? (usd / data.crypto!.totalUsd) * 100 : 0;
                return (
                  <div key={chain} className="flex items-center gap-2">
                    <span className="text-[10px] text-mc-text-tertiary w-16">{CHAIN_LABELS[chain] ?? chain}</span>
                    <div className="flex-1 bg-mc-border rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${CHAIN_COLORS[chain] ?? 'bg-mc-text-tertiary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-mc-text w-20 text-right">
                      ${usd.toFixed(0)} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Banking summary */}
      {data.banking && data.banking.accounts.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-mc-text-tertiary uppercase mb-2">Banking</h4>
          <div className="space-y-1">
            {data.banking.accounts.map(account => (
              <div key={account.id} className="flex items-center justify-between text-xs px-3 py-1.5 bg-mc-surface-hover border border-mc-border rounded">
                <span className="text-mc-text">{account.name}</span>
                <span className="font-mono text-mc-success">${account.availableBalance.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Agents ────────────────────────────────────────────────────────────

function AgentsTab({
  data,
  budgetRows,
  onBudgetClick,
  onAgentClick,
}: {
  data: TreasuryData;
  budgetRows: BudgetRow[];
  onBudgetClick: () => void;
  onAgentClick: (agentId: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Per-agent table */}
      <div className="border border-mc-border rounded overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead className="bg-mc-surface-hover border-b border-mc-border">
            <tr>
              {['Agent', 'Daily Spend', 'Monthly Spend', 'Requests', 'Budget', 'Status', ''].map(h => (
                <th key={h} className="text-left px-3 py-2 text-mc-text-tertiary font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.llmSpend.byAgent.map(agent => {
              const budgetRow = budgetRows.find(b => b.agentId === agent.agentId);
              const dailyPct = budgetRow && budgetRow.dailyLimitCents > 0
                ? (agent.dailySpendCents / budgetRow.dailyLimitCents) * 100
                : 0;
              const statusText = dailyPct >= 100 ? 'over' : dailyPct >= 80 ? 'warn' : 'ok';
              const statusColor = dailyPct >= 100 ? 'text-mc-danger' : dailyPct >= 80 ? 'text-mc-warning' : 'text-mc-success';

              return (
                <tr key={agent.agentId} className="border-b border-mc-border/50 hover:bg-mc-surface-hover/50">
                  <td className="px-3 py-2">
                    <button onClick={() => onAgentClick(agent.agentId)} className="text-mc-accent hover:underline">
                      {agent.emoji && <span className="mr-1">{agent.emoji}</span>}
                      {agent.label}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-mc-text">{formatUsd(agent.dailySpendCents)}</td>
                  <td className="px-3 py-2 text-mc-text">{formatUsd(agent.spendCents)}</td>
                  <td className="px-3 py-2 text-mc-text-tertiary">{agent.requests.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {budgetRow && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 bg-mc-border rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${dailyPct >= 100 ? 'bg-mc-danger' : dailyPct >= 80 ? 'bg-mc-warning' : 'bg-mc-success'}`}
                            style={{ width: `${Math.min(dailyPct, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-mc-text-tertiary">{dailyPct.toFixed(0)}%</span>
                      </div>
                    )}
                  </td>
                  <td className={`px-3 py-2 font-bold ${statusColor}`}>{statusText}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={onBudgetClick}
                      className="text-mc-text-tertiary hover:text-mc-text transition-colors"
                      title="Budget settings"
                    >
                      &#9881;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Daily spend sparkline */}
      {data.llmSpend.dailyTrend.length > 0 && (
        <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
          <div className="text-xs text-mc-text-tertiary mb-2">Daily Spend (last 14 days)</div>
          <div className="flex items-end gap-1.5 h-20">
            {data.llmSpend.dailyTrend.map(d => {
              const maxCents = Math.max(...data.llmSpend.dailyTrend.map(x => x.spendCents), 1);
              const pct = (d.spendCents / maxCents) * 100;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-mc-info/40 rounded-t hover:bg-mc-info/60 transition-colors"
                    style={{ height: `${Math.max(pct, 3)}%` }}
                    title={`${d.date}: ${formatUsd(d.spendCents)}`}
                  />
                  <span className="text-mc-text-tertiary" style={{ writingMode: 'vertical-lr', fontSize: '8px' }}>
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By model breakdown */}
      {data.llmSpend.byModel.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-mc-text-tertiary uppercase mb-2">By Model</h4>
          <div className="border border-mc-border rounded overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead className="bg-mc-surface-hover border-b border-mc-border">
                <tr>
                  {['Model', 'Spend', 'Requests', 'Share'].map(h => (
                    <th key={h} className="text-left px-3 py-1.5 text-mc-text-tertiary font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.llmSpend.byModel.map(m => {
                  const total = data.llmSpend.byModel.reduce((s, x) => s + x.spendCents, 0);
                  const share = total > 0 ? (m.spendCents / total) * 100 : 0;
                  return (
                    <tr key={m.model} className="border-b border-mc-border/50">
                      <td className="px-3 py-1.5 text-mc-text">{m.model}</td>
                      <td className="px-3 py-1.5 text-mc-success">{formatUsd(m.spendCents)}</td>
                      <td className="px-3 py-1.5 text-mc-text-tertiary">{m.requests.toLocaleString()}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-12 bg-mc-border rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-mc-info" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-mc-text-tertiary">{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Assets ────────────────────────────────────────────────────────────

function AssetsTab({ data }: { data: TreasuryData }) {
  return (
    <div className="space-y-6">
      {/* Crypto Holdings */}
      {data.crypto && data.crypto.holdings.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-mc-text-tertiary uppercase">Crypto Holdings</h4>
            <span className="text-sm font-bold text-mc-success font-mono">
              ${data.crypto.totalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>

          {/* Group by category */}
          {(['treasury', 'fees', 'dev', 'protocol', 'program', 'other'] as const).map(category => {
            const holdings = data.crypto!.holdings.filter(h => h.category === category);
            if (holdings.length === 0) return null;
            const catTotal = holdings.reduce((s, h) => s + h.usdValue, 0);
            return (
              <div key={category}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-mc-text-tertiary uppercase tracking-widest">
                    {category}
                  </span>
                  <span className="text-[10px] font-mono text-mc-text-tertiary">
                    ${catTotal.toFixed(0)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {holdings.map(h => (
                    <div
                      key={h.address}
                      className={`border rounded p-3 ${
                        CHAIN_COLORS[h.chain]
                          ? `bg-${h.chain === 'solana' ? 'mc-accent' : h.chain === 'ethereum' ? 'mc-info' : h.chain === 'base' ? 'mc-accent' : 'mc-blocked'}/5 border-${h.chain === 'solana' ? 'mc-accent' : h.chain === 'ethereum' ? 'mc-info' : h.chain === 'base' ? 'mc-accent' : 'mc-blocked'}/20`
                          : 'border-mc-border bg-mc-surface-hover'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <span className="text-[10px] font-bold text-mc-text-tertiary uppercase">{CHAIN_LABELS[h.chain] ?? h.chain}</span>
                          {h.label && <span className="text-[10px] text-mc-text-tertiary ml-2">{h.label}</span>}
                        </div>
                        <span className="text-[10px] font-mono text-mc-text-tertiary">
                          {h.address.slice(0, 6)}...{h.address.slice(-4)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-mc-text">
                          {h.nativeBalance.toFixed(4)} {h.nativeSymbol}
                        </span>
                        <span className="text-xs font-bold text-mc-success">${h.usdValue.toFixed(2)}</span>
                      </div>
                      {h.tokens.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {h.tokens.map((t, i) => (
                            <div key={i} className="flex items-center justify-between text-[10px]">
                              <span className="text-mc-text-tertiary">{t.balance.toFixed(2)} {t.symbol}</span>
                              <span className="text-mc-success">${t.usdValue.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div className="text-xs text-mc-text-tertiary">No crypto holdings data available.</div>
      )}

      {/* Banking */}
      {data.banking && data.banking.accounts.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-mc-text-tertiary uppercase">Banking</h4>
            <span className="text-sm font-bold text-mc-success font-mono">
              ${data.banking.totalAvailable.toLocaleString()}
            </span>
          </div>
          <div className="space-y-2">
            {data.banking.accounts.map(account => (
              <div key={account.id} className="bg-mc-surface-hover border border-mc-border rounded p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-mc-text">{account.name}</div>
                    <div className="text-[10px] text-mc-text-tertiary">{account.institution} &middot; {account.type}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-mc-success font-mono">
                      ${account.availableBalance.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-mc-text-tertiary">available</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data.lastUpdated.banking && (
            <div className="text-[10px] text-mc-text-tertiary mt-1">
              Last synced: {new Date(data.lastUpdated.banking).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-mc-text-tertiary">No banking data available. Treasurer syncs daily via Teller.io.</div>
      )}
    </div>
  );
}

// ─── Tab: Infra ─────────────────────────────────────────────────────────────

function InfraTab({ data }: { data: TreasuryData }) {
  if (!data.infraCosts) {
    return <div className="text-xs text-mc-text-tertiary">No infrastructure cost data available. Treasurer syncs via AWS Cost Explorer, Atlas, and Redis Cloud APIs.</div>;
  }

  const infra = data.infraCosts;

  return (
    <div className="space-y-6">
      {/* Total */}
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
        <div className="text-xs text-mc-text-tertiary uppercase mb-1">Total Infrastructure (Monthly)</div>
        <div className="text-2xl font-bold font-mono text-mc-danger">
          {formatUsd(infra.totalMonthlyCents)}
        </div>
      </div>

      {/* AWS by service */}
      {infra.aws.byService.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-mc-text-tertiary uppercase">AWS Services</h4>
            <span className="text-xs font-mono text-mc-text">{formatUsd(infra.aws.totalMonthlyCents)}/mo</span>
          </div>
          <div className="space-y-1.5">
            {infra.aws.byService.sort((a, b) => b.costCents - a.costCents).map(svc => {
              const pct = infra.aws.totalMonthlyCents > 0 ? (svc.costCents / infra.aws.totalMonthlyCents) * 100 : 0;
              return (
                <div key={svc.service} className="flex items-center gap-2">
                  <span className="text-[10px] text-mc-text-tertiary w-28 truncate">{svc.service}</span>
                  <div className="flex-1 bg-mc-border rounded-full h-2">
                    <div className="h-2 rounded-full bg-mc-warning" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-mc-text w-16 text-right">{formatUsd(svc.costCents)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MongoDB Atlas */}
      <div className="bg-mc-surface-hover border border-mc-border rounded p-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-mc-text">MongoDB Atlas</div>
          <div className="text-[10px] text-mc-text-tertiary">Database hosting</div>
        </div>
        <span className="text-sm font-mono text-mc-text">{formatUsd(infra.mongoAtlas.monthlyCents)}/mo</span>
      </div>

      {/* Redis Cloud */}
      <div className="bg-mc-surface-hover border border-mc-border rounded p-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-mc-text">Redis Cloud</div>
          <div className="text-[10px] text-mc-text-tertiary">Cache & pub/sub</div>
        </div>
        <span className="text-sm font-mono text-mc-text">{formatUsd(infra.redisCloud.monthlyCents)}/mo</span>
      </div>

      {data.lastUpdated.infra && (
        <div className="text-[10px] text-mc-text-tertiary">
          Last synced: {new Date(data.lastUpdated.infra).toLocaleString()}
        </div>
      )}
    </div>
  );
}
