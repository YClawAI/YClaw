'use client';

import { useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { TabLayout } from '@/components/tab-layout';
import { KPICard } from '@/components/kpi-card';
import { EventFeed } from '@/components/event-feed';
import { SupportAgentCard } from '@/components/support-agent-card';
import { CommunityTemperature } from '@/components/community-temperature';
import { SupportInbox } from '@/components/support-inbox';
import { ModerationFeed } from '@/components/moderation-feed';
import { ModActionSummaryChart } from '@/components/mod-action-summary';
import { SupportSettings } from '@/components/support-settings';
import { AgentDetailDrawer } from '@/components/agent-detail-drawer';
import type { AgentInfo } from '@/lib/agents';
import type { DepartmentBaseData } from '@/lib/department-data';
import type { DepartmentKPIs } from '@/lib/department-kpis';
import type { RunRecord } from '@/lib/run-records';
import type { AgentSpend } from '@/lib/cost-queries';
import type { AgentBudget } from '@/lib/actions/budget';
import type { BudgetMode } from '@/lib/actions/budget-config';
import type { CommunityTemperature as CommunityTemperatureData } from '@/components/community-temperature';
import type { SupportCase } from '@/components/support-inbox';
import type { ModerationEntry } from '@/components/moderation-feed';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'moderation', label: 'Moderation' },
  { key: 'activity', label: 'Activity' },
];

interface SupportClientProps {
  agents: AgentInfo[];
  live?: DepartmentBaseData;
  kpis: DepartmentKPIs;
  recentRuns: RunRecord[];
  communityTemp?: CommunityTemperatureData;
  agentSpend?: AgentSpend[];
  budgets?: AgentBudget[];
  budgetMode?: BudgetMode;
}

// ─── Main Client ───────────────────────────────────────────────────────────

export function SupportClient({ agents, live, kpis, recentRuns, communityTemp, agentSpend, budgets, budgetMode }: SupportClientProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const drawerAgentId = searchParams.get('agent');

  const keeper = agents.find((a) => a.name === 'keeper');
  const guide = agents.find((a) => a.name === 'guide');

  // Derive agent statuses from live data
  const agentStatus = (name: string) => {
    const a = live?.agents.find((s) => s.name === name);
    return a?.state ?? 'unknown';
  };
  const agentLastRun = (name: string) => {
    const a = live?.agents.find((s) => s.name === name);
    return a?.lastRunAt ? new Date(a.lastRunAt).toISOString() : undefined;
  };
  const agentRunCount = (name: string) => {
    const a = live?.agents.find((s) => s.name === name);
    return a?.execCount24h ?? 0;
  };

  // Guide runs for inbox
  const guideRuns = recentRuns.filter((r) => r.agentId === 'guide');
  const guideCases: SupportCase[] = guideRuns.map((r) => {
    // Map run status to display status (covers full contract: pending|running|completed|failed|cancelled|success|error)
    const s = r.status?.toLowerCase();
    const status =
      s === 'error' || s === 'failed' ? 'escalated' :
      s === 'success' || s === 'completed' ? 'resolved' :
      s === 'cancelled' ? 'cancelled' :
      s === 'pending' || s === 'running' ? 'in_progress' :
      'new';
    return {
      id: r.taskId ?? r.executionId ?? r.createdAt,
      status,
      lastMessage: r.output ?? undefined,
      createdAt: r.createdAt,
      assignedTo: 'guide',
    };
  });

  // Keeper runs for moderation feed
  // Action classification: check taskId first, then output keywords, fall back to "unknown"
  const keeperRuns = recentRuns.filter((r) => r.agentId === 'keeper');
  const moderationEntries: ModerationEntry[] = keeperRuns.map((r, i) => {
    const tid = (r.taskId ?? '').toLowerCase();
    const out = (r.output ?? '').toLowerCase();

    // 1. Check taskId for explicit action keywords
    const actionFromTask =
      tid.includes('delete') ? 'delete' :
      tid.includes('ban') ? 'ban' :
      tid.includes('restrict') ? 'restrict' :
      tid.includes('pin') ? 'pin' :
      tid.includes('reply') ? 'reply' :
      undefined;

    // 2. If taskId didn't match, check output for action keywords
    const actionFromOutput = !actionFromTask
      ? (out.includes('deleted message') || out.includes('message deleted') ? 'delete' :
         out.includes('banned user') || out.includes('user banned') ? 'ban' :
         out.includes('restricted') ? 'restrict' :
         out.includes('pinned') ? 'pin' :
         out.includes('replied') || out.includes('sent reply') || out.includes('response sent') ? 'reply' :
         undefined)
      : undefined;

    // 3. Fall back to unknown — handle_message is too generic to classify
    const action = actionFromTask ?? actionFromOutput ?? 'unknown';

    // Truncate output for content preview
    const contentPreview = r.output
      ? r.output.length > 120 ? r.output.slice(0, 120) + '...' : r.output
      : undefined;
    return {
      id: r.executionId ?? `mod-${i}`,
      agentId: r.agentId,
      action,
      timestamp: r.createdAt,
      content: contentPreview,
    };
  });

  // Map live recent runs to EventFeed format
  const feedRuns = (live?.recentRuns ?? []).map((r) => ({
    agentId: r.agentId,
    status: r.status,
    createdAt: r.createdAt,
    taskId: r.taskId,
  }));

  return (
    <>
      {/* Settings button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setSettingsOpen(true)}
          className="px-3 py-1.5 text-xs font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface transition-colors"
        >
          Settings
        </button>
      </div>

      <TabLayout tabs={TABS} defaultTab="overview">
        {{
          /* ─── Overview Tab ──────────────────────────────────────── */
          overview: (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  label="Support Runs (24h)"
                  value={String(kpis.runCount24h)}
                  subtext="keeper + guide runs"
                />
                <KPICard
                  label="Guide Runs (recent)"
                  value={String(guideRuns.length)}
                  subtext="guide recent runs"
                />
                <KPICard
                  label="Errors (24h)"
                  value={String(kpis.errorCount24h)}
                />
                <KPICard
                  label="Dept Spend (MTD)"
                  value={`$${kpis.spendMTD.toFixed(2)}`}
                />
              </div>

              {/* Community Temperature */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">Community Temperature</h3>
                <CommunityTemperature data={communityTemp} />
              </div>

              {/* Agent Cards */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
                  Agents
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {keeper && (
                    <div onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set('agent', 'keeper');
                      router.push(`${pathname}?${params.toString()}`);
                    }} className="cursor-pointer">
                      <SupportAgentCard
                        agent={keeper}
                        status={agentStatus('keeper')}
                        lastRunAt={agentLastRun('keeper')}
                        runCount24h={agentRunCount('keeper')}
                      />
                    </div>
                  )}
                  {guide && (
                    <div onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set('agent', 'guide');
                      router.push(`${pathname}?${params.toString()}`);
                    }} className="cursor-pointer">
                      <SupportAgentCard
                        agent={guide}
                        status={agentStatus('guide')}
                        lastRunAt={agentLastRun('guide')}
                        runCount24h={agentRunCount('guide')}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ),

          /* ─── Inbox Tab ─────────────────────────────────────────── */
          inbox: (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Guide Activity</h3>
                <span className="text-[10px] text-terminal-dim font-mono">
                  {guideCases.length} recent runs
                </span>
              </div>
              <SupportInbox cases={guideCases} />
            </div>
          ),

          /* ─── Moderation Tab ────────────────────────────────────── */
          moderation: (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Live feed -- left 2/3 */}
              <div className="lg:col-span-2">
                <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">Keeper Activity</h3>
                <ModerationFeed entries={moderationEntries} />
              </div>

              {/* Right sidebar */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">Mod Action Summary</h3>
                  <ModActionSummaryChart data={
                    Object.entries(
                      moderationEntries.reduce((acc, e) => {
                        acc[e.action ?? 'unknown'] = (acc[e.action ?? 'unknown'] ?? 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([action, count]) => ({ action, count }))
                  } />
                </div>
              </div>
            </div>
          ),

          /* ─── Activity Tab ──────────────────────────────────────── */
          activity: (
            <div className="space-y-6">
              <EventFeed
                initialRuns={feedRuns}
                agentNames={agents.map((a) => a.name)}
              />
            </div>
          ),
        }}
      </TabLayout>

      {/* Settings Drawer */}
      <SupportSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Agent Detail Drawer */}
      <AgentDetailDrawer
        agentId={drawerAgentId}
        open={!!drawerAgentId}
        onClose={() => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete('agent');
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
        fleetOnline={live ? live.agents.some(a => a.state === 'active') : false}
      />
    </>
  );
}
