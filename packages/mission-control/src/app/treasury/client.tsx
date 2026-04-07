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
  if (status === 'critical') return 'text-terminal-red';
  if (status === 'warning') return 'text-terminal-yellow';
  return 'text-terminal-green';
}

function severityStyle(s: AttentionItem['severity']): string {
  if (s === 'critical') return 'border-terminal-red/40 bg-terminal-red/5';
  if (s === 'warning') return 'border-terminal-yellow/40 bg-terminal-yellow/5';
  return 'border-terminal-border bg-terminal-surface';
}

function severityDot(s: AttentionItem['severity']): string {
  if (s === 'critical') return 'bg-terminal-red';
  if (s === 'warning') return 'bg-terminal-yellow';
  return 'bg-terminal-dim';
}

type Tab = 'all' | 'agents' | 'assets' | 'infra';

const CHAIN_COLORS: Record<string, string> = {
  solana: 'bg-terminal-purple',
  ethereum: 'bg-terminal-blue',
  base: 'bg-terminal-cyan',
  arbitrum: 'bg-terminal-orange',
  optimism: 'bg-terminal-red',
  polygon: 'bg-terminal-green',
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
        <h1 className="text-lg font-bold text-terminal-text tracking-wide">Treasury</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFinSettingsOpen(true)}
            className="px-3 py-1.5 text-xs font-mono border border-terminal-border rounded hover:bg-terminal-surface transition-colors text-terminal-dim hover:text-terminal-text"
          >
            Settings
          </button>
        </div>
      </div>

      {/* ── Runway Hero ── */}
      <section className="mb-6">
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-terminal-dim uppercase tracking-widest mb-1">Runway</div>
              <div className={`text-4xl font-bold font-mono ${runwayColor(data.runway.status)}`}>
                {data.runway.daysRemaining > 9000 ? '∞' : data.runway.daysRemaining} <span className="text-lg">days</span>
              </div>
              <div className="text-xs text-terminal-dim mt-1">
                Assets: {formatDollars(data.runway.totalAssets)} (Fiat {formatDollars(bankingTotal)} + Crypto {formatDollars(cryptoTotal)})
              </div>
              <div className="text-xs text-terminal-dim">
                Burning: {formatDollars(data.runway.monthlyBurn)}/mo (LLM {formatDollars(llmMonthly)} + Infra {formatDollars(infraMonthly)})
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className={`w-4 h-4 rounded-full ${runwayColor(data.runway.status).replace('text-', 'bg-')}`} />
              <button
                onClick={() => setRunwayExpanded(!runwayExpanded)}
                className="text-[10px] text-terminal-dim hover:text-terminal-text"
              >
                {runwayExpanded ? 'collapse' : 'expand breakdown'}
              </button>
            </div>
          </div>

          {runwayExpanded && (
            <div className="mt-4 pt-4 border-t border-terminal-border grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] text-terminal-dim uppercase">Fiat (Banking)</div>
                <div className="text-sm font-mono text-terminal-text">{formatDollars(bankingTotal)}</div>
              </div>
              <div>
                <div className="text-[10px] text-terminal-dim uppercase">Crypto</div>
                <div className="text-sm font-mono text-terminal-text">{formatDollars(cryptoTotal)}</div>
              </div>
              <div>
                <div className="text-[10px] text-terminal-dim uppercase">LLM Spend (30d)</div>
                <div className="text-sm font-mono text-terminal-red">{formatDollars(llmMonthly)}</div>
              </div>
              <div>
                <div className="text-[10px] text-terminal-dim uppercase">Infra (Monthly)</div>
                <div className="text-sm font-mono text-terminal-red">{formatDollars(infraMonthly)}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Needs Attention ── */}
      {attentionItems.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-yellow mb-3">
            Needs Attention
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {attentionItems.slice(0, 6).map(item => (
              <div key={item.id} className={`border rounded p-3 ${severityStyle(item.severity)}`}>
                <div className="flex items-start gap-2">
                  <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${severityDot(item.severity)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-terminal-text truncate">{item.title}</div>
                    <div className="text-[10px] text-terminal-dim mt-0.5">{item.description}</div>
                    {item.metric && (
                      <div className="text-[10px] font-mono text-terminal-dim mt-1">{item.metric}</div>
                    )}
                  </div>
                  {item.action && (
                    <button
                      onClick={() => setFinSettingsOpen(true)}
                      className="text-[10px] text-terminal-cyan hover:underline shrink-0"
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
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-blue">Daily Burn</h3>
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
        <div className="flex border-b border-terminal-border mb-4">
          {(['all', 'agents', 'assets', 'infra'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-mono transition-colors border-b-2 ${
                tab === t
                  ? 'border-terminal-cyan text-terminal-cyan'
                  : 'border-transparent text-terminal-dim hover:text-terminal-text'
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
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-terminal-dim uppercase">Budget Status</span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              data.budget.config.mode === 'enforcing'
                ? 'bg-terminal-green/10 text-terminal-green'
                : 'bg-terminal-yellow/10 text-terminal-yellow'
            }`}>
              {data.budget.config.mode}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-[10px] text-terminal-dim mb-1">Fleet Daily</div>
              <div className="w-full bg-terminal-border rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    data.budget.fleetDailySpendCents >= data.budget.config.globalDailyLimitCents
                      ? 'bg-terminal-red'
                      : data.budget.fleetDailySpendCents >= data.budget.config.globalDailyLimitCents * 0.8
                        ? 'bg-terminal-yellow'
                        : 'bg-terminal-green'
                  }`}
                  style={{ width: `${Math.min((data.budget.fleetDailySpendCents / Math.max(data.budget.config.globalDailyLimitCents, 1)) * 100, 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-terminal-dim mt-0.5 font-mono">
                {formatUsd(data.budget.fleetDailySpendCents)} / {formatUsd(data.budget.config.globalDailyLimitCents)}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-[10px] text-terminal-dim mb-1">Fleet Monthly</div>
              <div className="w-full bg-terminal-border rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    data.budget.fleetMonthlySpendCents >= data.budget.config.globalMonthlyLimitCents
                      ? 'bg-terminal-red'
                      : data.budget.fleetMonthlySpendCents >= data.budget.config.globalMonthlyLimitCents * 0.8
                        ? 'bg-terminal-yellow'
                        : 'bg-terminal-green'
                  }`}
                  style={{ width: `${Math.min((data.budget.fleetMonthlySpendCents / Math.max(data.budget.config.globalMonthlyLimitCents, 1)) * 100, 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-terminal-dim mt-0.5 font-mono">
                {formatUsd(data.budget.fleetMonthlySpendCents)} / {formatUsd(data.budget.config.globalMonthlyLimitCents)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top 5 agents by spend */}
      <div>
        <h4 className="text-xs font-bold text-terminal-dim uppercase mb-2">Top Agents (This Month)</h4>
        <div className="border border-terminal-border rounded overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-terminal-surface border-b border-terminal-border">
              <tr>
                {['Agent', 'Daily', 'Monthly', 'Status'].map(h => (
                  <th key={h} className="text-left px-3 py-1.5 text-terminal-dim font-normal">{h}</th>
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
                  <tr key={agent.agentId} className="border-b border-terminal-border/50 hover:bg-terminal-surface/50">
                    <td className="px-3 py-1.5">
                      <button onClick={() => onAgentClick(agent.agentId)} className="text-terminal-cyan hover:underline">
                        {agent.emoji && <span className="mr-1">{agent.emoji}</span>}
                        {agent.label}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-terminal-text">{formatUsd(agent.dailySpendCents)}</td>
                    <td className="px-3 py-1.5 text-terminal-text">{formatUsd(agent.spendCents)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] font-bold ${
                        dailyPct >= 100 ? 'text-terminal-red' : dailyPct >= 80 ? 'text-terminal-yellow' : 'text-terminal-green'
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
          <h4 className="text-xs font-bold text-terminal-dim uppercase mb-2">Crypto by Chain</h4>
          <div className="space-y-1.5">
            {Object.entries(data.crypto.byChain)
              .sort((a, b) => b[1] - a[1])
              .map(([chain, usd]) => {
                const pct = data.crypto!.totalUsd > 0 ? (usd / data.crypto!.totalUsd) * 100 : 0;
                return (
                  <div key={chain} className="flex items-center gap-2">
                    <span className="text-[10px] text-terminal-dim w-16">{CHAIN_LABELS[chain] ?? chain}</span>
                    <div className="flex-1 bg-terminal-border rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${CHAIN_COLORS[chain] ?? 'bg-terminal-dim'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-terminal-text w-20 text-right">
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
          <h4 className="text-xs font-bold text-terminal-dim uppercase mb-2">Banking</h4>
          <div className="space-y-1">
            {data.banking.accounts.map(account => (
              <div key={account.id} className="flex items-center justify-between text-xs px-3 py-1.5 bg-terminal-surface border border-terminal-border rounded">
                <span className="text-terminal-text">{account.name}</span>
                <span className="font-mono text-terminal-green">${account.availableBalance.toLocaleString()}</span>
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
      <div className="border border-terminal-border rounded overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead className="bg-terminal-surface border-b border-terminal-border">
            <tr>
              {['Agent', 'Daily Spend', 'Monthly Spend', 'Requests', 'Budget', 'Status', ''].map(h => (
                <th key={h} className="text-left px-3 py-2 text-terminal-dim font-normal">{h}</th>
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
              const statusColor = dailyPct >= 100 ? 'text-terminal-red' : dailyPct >= 80 ? 'text-terminal-yellow' : 'text-terminal-green';

              return (
                <tr key={agent.agentId} className="border-b border-terminal-border/50 hover:bg-terminal-surface/50">
                  <td className="px-3 py-2">
                    <button onClick={() => onAgentClick(agent.agentId)} className="text-terminal-cyan hover:underline">
                      {agent.emoji && <span className="mr-1">{agent.emoji}</span>}
                      {agent.label}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-terminal-text">{formatUsd(agent.dailySpendCents)}</td>
                  <td className="px-3 py-2 text-terminal-text">{formatUsd(agent.spendCents)}</td>
                  <td className="px-3 py-2 text-terminal-dim">{agent.requests.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {budgetRow && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 bg-terminal-border rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${dailyPct >= 100 ? 'bg-terminal-red' : dailyPct >= 80 ? 'bg-terminal-yellow' : 'bg-terminal-green'}`}
                            style={{ width: `${Math.min(dailyPct, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-terminal-dim">{dailyPct.toFixed(0)}%</span>
                      </div>
                    )}
                  </td>
                  <td className={`px-3 py-2 font-bold ${statusColor}`}>{statusText}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={onBudgetClick}
                      className="text-terminal-dim hover:text-terminal-text transition-colors"
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
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <div className="text-xs text-terminal-dim mb-2">Daily Spend (last 14 days)</div>
          <div className="flex items-end gap-1.5 h-20">
            {data.llmSpend.dailyTrend.map(d => {
              const maxCents = Math.max(...data.llmSpend.dailyTrend.map(x => x.spendCents), 1);
              const pct = (d.spendCents / maxCents) * 100;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-terminal-blue/40 rounded-t hover:bg-terminal-blue/60 transition-colors"
                    style={{ height: `${Math.max(pct, 3)}%` }}
                    title={`${d.date}: ${formatUsd(d.spendCents)}`}
                  />
                  <span className="text-terminal-dim" style={{ writingMode: 'vertical-lr', fontSize: '8px' }}>
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
          <h4 className="text-xs font-bold text-terminal-dim uppercase mb-2">By Model</h4>
          <div className="border border-terminal-border rounded overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead className="bg-terminal-surface border-b border-terminal-border">
                <tr>
                  {['Model', 'Spend', 'Requests', 'Share'].map(h => (
                    <th key={h} className="text-left px-3 py-1.5 text-terminal-dim font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.llmSpend.byModel.map(m => {
                  const total = data.llmSpend.byModel.reduce((s, x) => s + x.spendCents, 0);
                  const share = total > 0 ? (m.spendCents / total) * 100 : 0;
                  return (
                    <tr key={m.model} className="border-b border-terminal-border/50">
                      <td className="px-3 py-1.5 text-terminal-text">{m.model}</td>
                      <td className="px-3 py-1.5 text-terminal-green">{formatUsd(m.spendCents)}</td>
                      <td className="px-3 py-1.5 text-terminal-dim">{m.requests.toLocaleString()}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-12 bg-terminal-border rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-terminal-blue" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-terminal-dim">{share.toFixed(0)}%</span>
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
            <h4 className="text-xs font-bold text-terminal-dim uppercase">Crypto Holdings</h4>
            <span className="text-sm font-bold text-terminal-green font-mono">
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
                  <span className="text-[10px] font-bold text-terminal-dim uppercase tracking-widest">
                    {category}
                  </span>
                  <span className="text-[10px] font-mono text-terminal-dim">
                    ${catTotal.toFixed(0)}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {holdings.map(h => (
                    <div
                      key={h.address}
                      className={`border rounded p-3 ${
                        CHAIN_COLORS[h.chain]
                          ? `bg-${h.chain === 'solana' ? 'terminal-purple' : h.chain === 'ethereum' ? 'terminal-blue' : h.chain === 'base' ? 'terminal-cyan' : 'terminal-orange'}/5 border-${h.chain === 'solana' ? 'terminal-purple' : h.chain === 'ethereum' ? 'terminal-blue' : h.chain === 'base' ? 'terminal-cyan' : 'terminal-orange'}/20`
                          : 'border-terminal-border bg-terminal-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <span className="text-[10px] font-bold text-terminal-dim uppercase">{CHAIN_LABELS[h.chain] ?? h.chain}</span>
                          {h.label && <span className="text-[10px] text-terminal-dim ml-2">{h.label}</span>}
                        </div>
                        <span className="text-[10px] font-mono text-terminal-dim">
                          {h.address.slice(0, 6)}...{h.address.slice(-4)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-terminal-text">
                          {h.nativeBalance.toFixed(4)} {h.nativeSymbol}
                        </span>
                        <span className="text-xs font-bold text-terminal-green">${h.usdValue.toFixed(2)}</span>
                      </div>
                      {h.tokens.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {h.tokens.map((t, i) => (
                            <div key={i} className="flex items-center justify-between text-[10px]">
                              <span className="text-terminal-dim">{t.balance.toFixed(2)} {t.symbol}</span>
                              <span className="text-terminal-green">${t.usdValue.toFixed(2)}</span>
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
        <div className="text-xs text-terminal-dim">No crypto holdings data available.</div>
      )}

      {/* Banking */}
      {data.banking && data.banking.accounts.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-terminal-dim uppercase">Banking</h4>
            <span className="text-sm font-bold text-terminal-green font-mono">
              ${data.banking.totalAvailable.toLocaleString()}
            </span>
          </div>
          <div className="space-y-2">
            {data.banking.accounts.map(account => (
              <div key={account.id} className="bg-terminal-surface border border-terminal-border rounded p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-terminal-text">{account.name}</div>
                    <div className="text-[10px] text-terminal-dim">{account.institution} &middot; {account.type}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-terminal-green font-mono">
                      ${account.availableBalance.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-terminal-dim">available</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data.lastUpdated.banking && (
            <div className="text-[10px] text-terminal-dim mt-1">
              Last synced: {new Date(data.lastUpdated.banking).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-terminal-dim">No banking data available. Treasurer syncs daily via Teller.io.</div>
      )}
    </div>
  );
}

// ─── Tab: Infra ─────────────────────────────────────────────────────────────

function InfraTab({ data }: { data: TreasuryData }) {
  if (!data.infraCosts) {
    return <div className="text-xs text-terminal-dim">No infrastructure cost data available. Treasurer syncs via AWS Cost Explorer, Atlas, and Redis Cloud APIs.</div>;
  }

  const infra = data.infraCosts;

  return (
    <div className="space-y-6">
      {/* Total */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <div className="text-xs text-terminal-dim uppercase mb-1">Total Infrastructure (Monthly)</div>
        <div className="text-2xl font-bold font-mono text-terminal-red">
          {formatUsd(infra.totalMonthlyCents)}
        </div>
      </div>

      {/* AWS by service */}
      {infra.aws.byService.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-terminal-dim uppercase">AWS Services</h4>
            <span className="text-xs font-mono text-terminal-text">{formatUsd(infra.aws.totalMonthlyCents)}/mo</span>
          </div>
          <div className="space-y-1.5">
            {infra.aws.byService.sort((a, b) => b.costCents - a.costCents).map(svc => {
              const pct = infra.aws.totalMonthlyCents > 0 ? (svc.costCents / infra.aws.totalMonthlyCents) * 100 : 0;
              return (
                <div key={svc.service} className="flex items-center gap-2">
                  <span className="text-[10px] text-terminal-dim w-28 truncate">{svc.service}</span>
                  <div className="flex-1 bg-terminal-border rounded-full h-2">
                    <div className="h-2 rounded-full bg-terminal-yellow" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-terminal-text w-16 text-right">{formatUsd(svc.costCents)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MongoDB Atlas */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-terminal-text">MongoDB Atlas</div>
          <div className="text-[10px] text-terminal-dim">Database hosting</div>
        </div>
        <span className="text-sm font-mono text-terminal-text">{formatUsd(infra.mongoAtlas.monthlyCents)}/mo</span>
      </div>

      {/* Redis Cloud */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-terminal-text">Redis Cloud</div>
          <div className="text-[10px] text-terminal-dim">Cache & pub/sub</div>
        </div>
        <span className="text-sm font-mono text-terminal-text">{formatUsd(infra.redisCloud.monthlyCents)}/mo</span>
      </div>

      {data.lastUpdated.infra && (
        <div className="text-[10px] text-terminal-dim">
          Last synced: {new Date(data.lastUpdated.infra).toLocaleString()}
        </div>
      )}
    </div>
  );
}
