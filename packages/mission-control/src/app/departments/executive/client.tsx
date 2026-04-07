'use client';

import { useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { TabLayout } from '@/components/tab-layout';
import { EventFeed } from '@/components/event-feed';
import { HeartbeatMonitor } from '@/components/heartbeat-monitor';
import { DirectiveTimeline } from '@/components/directive-timeline';
import { ReviewQueue } from '@/components/review-queue';
import { ExecutiveAgentCard } from '@/components/executive-agent-card';
import { ExecutiveSettings } from '@/components/executive-settings';
import { AgentDetailDrawer } from '@/components/agent-detail-drawer';
import { PendingApprovalsWidget } from '@/components/pending-approvals-widget';
import { ActivityWidget } from '@/components/agenthub/ActivityWidget';
import { AgentHubTabs } from '@/components/agenthub/AgentHubTabs';
import type { AHCommit, AgentHubHealth } from '@/lib/agenthub-api';
import type { AgentInfo } from '@/lib/agents';
import type { DepartmentKPIs } from '@/lib/department-kpis';
import type { RunRecord } from '@/lib/run-records';
import type { DepartmentBaseData } from '@/lib/department-data';
import type { StandupSynthesis } from '@/lib/executive-queries';
import type { ObjectiveSummary } from '@/lib/objectives-queries';
import type { ApprovalItem } from '@/lib/approvals-queries';
import type { AgentHeartbeatData } from '@/lib/heartbeat-data';
import type { AgentSpend } from '@/lib/cost-queries';
import type { AgentBudget } from '@/lib/actions/budget';
import type { BudgetMode } from '@/lib/actions/budget-config';

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'directives', label: 'Directives' },
  { key: 'review-queue', label: 'Review Queue' },
  { key: 'activity', label: 'Activity' },
];

// ─── KPI Card ────────────────────────────────────────────────────────────────

function ExecKPI({
  label,
  children,
  subtext,
}: {
  label: string;
  children: React.ReactNode;
  subtext?: string;
}) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4 hover:border-terminal-muted transition-colors">
      {children}
      <div className="text-xs text-terminal-dim mt-1">{label}</div>
      {subtext && (
        <div className="text-[10px] text-terminal-dim/60 mt-0.5">{subtext}</div>
      )}
    </div>
  );
}

// ─── Relative time formatter ─────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Standup Synthesis Section ───────────────────────────────────────────────

function StandupSynthesisSection({ synthesis }: { synthesis: StandupSynthesis | null | undefined }) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggle = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      <div className="px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
          Standup Synthesis
        </h3>
      </div>
      <div className="px-4 pb-4">
        {!synthesis ? (
          <div className="text-xs text-terminal-dim text-center py-4">
            No standup synthesis yet.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary */}
            <p className="text-xs text-terminal-text leading-relaxed">
              {synthesis.summary}
            </p>

            {/* Expandable sections */}
            {synthesis.risks.length > 0 && (
              <div>
                <button
                  onClick={() => toggle('risks')}
                  className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-terminal-red hover:text-terminal-red/80 transition-colors"
                >
                  <span className="text-[8px]">{expandedSection === 'risks' ? '▼' : '▶'}</span>
                  Risks ({synthesis.risks.length})
                </button>
                {expandedSection === 'risks' && (
                  <ul className="mt-1.5 space-y-1 pl-3">
                    {synthesis.risks.map((r, i) => (
                      <li key={i} className="text-xs text-terminal-text flex items-start gap-1.5">
                        <span className="text-terminal-red shrink-0 mt-0.5">*</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {synthesis.asks.length > 0 && (
              <div>
                <button
                  onClick={() => toggle('asks')}
                  className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-terminal-yellow hover:text-terminal-yellow/80 transition-colors"
                >
                  <span className="text-[8px]">{expandedSection === 'asks' ? '▼' : '▶'}</span>
                  Asks ({synthesis.asks.length})
                </button>
                {expandedSection === 'asks' && (
                  <ul className="mt-1.5 space-y-1 pl-3">
                    {synthesis.asks.map((a, i) => (
                      <li key={i} className="text-xs text-terminal-text flex items-start gap-1.5">
                        <span className="text-terminal-yellow shrink-0 mt-0.5">?</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {synthesis.highlights.length > 0 && (
              <div>
                <button
                  onClick={() => toggle('highlights')}
                  className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-terminal-green hover:text-terminal-green/80 transition-colors"
                >
                  <span className="text-[8px]">{expandedSection === 'highlights' ? '▼' : '▶'}</span>
                  Highlights ({synthesis.highlights.length})
                </button>
                {expandedSection === 'highlights' && (
                  <ul className="mt-1.5 space-y-1 pl-3">
                    {synthesis.highlights.map((h, i) => (
                      <li key={i} className="text-xs text-terminal-text flex items-start gap-1.5">
                        <span className="text-terminal-green shrink-0 mt-0.5">+</span>
                        {h}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Generated timestamp */}
            <div className="text-[10px] text-terminal-dim/60 pt-1 border-t border-terminal-border">
              Generated {formatRelativeTime(synthesis.generatedAt)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Client Component ──────────────────────────────────────────────────

interface ExecClientProps {
  agents: AgentInfo[];
  live?: DepartmentBaseData;
  kpis: DepartmentKPIs;
  pendingApprovals: number;
  activeObjectives: number;
  objectives: ObjectiveSummary[];
  approvals: ApprovalItem[];
  recentRuns: RunRecord[];
  standupSynthesis?: StandupSynthesis | null;
  heartbeatData: AgentHeartbeatData[];
  agentSpend?: AgentSpend[];
  budgets?: AgentBudget[];
  budgetMode?: BudgetMode;
  ahCommits?: AHCommit[];
  agentHubHealth: AgentHubHealth;
}

export function ExecClient({ agents, live, kpis, pendingApprovals, activeObjectives, objectives, approvals, recentRuns, standupSynthesis, heartbeatData, ahCommits, agentHubHealth }: ExecClientProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const drawerAgent = searchParams.get('agent');

  const handleCloseDrawer = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('agent');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const strategistAgent = agents.find((a) => a.name === 'strategist');
  const reviewerAgent = agents.find((a) => a.name === 'reviewer');

  // Derive agent live statuses
  const getAgentLive = (name: string) => live?.agents.find((a) => a.name === name);

  // Core API is considered offline if live data is missing or all agents report 'unknown'
  const coreOffline = !live || live.agents.every((a) => a.state === 'unknown');

  // Fleet health
  const healthyCount = live ? live.agents.filter((a) => a.state !== 'error' && a.state !== 'unknown').length : 0;
  const totalCount = live ? live.agents.length : agents.length;

  // Convert AgentHeartbeatData to HeartbeatMonitor format
  const heartbeatMonitorData = heartbeatData.map(hb => ({
    agentId: hb.agentId,
    buckets: hb.buckets,
  }));

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-terminal-text tracking-wide">Executive</h2>
        <button
          onClick={() => setSettingsOpen(true)}
          className="px-3 py-1.5 text-xs font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface transition-colors"
        >
          Settings
        </button>
      </div>

      {/* Tab layout */}
      <TabLayout tabs={TABS} defaultTab="overview">
        {{
          /* ── Overview Tab ── */
          overview: (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Active Objectives */}
                <ExecKPI label="Active Objectives">
                  <div className="text-2xl font-bold text-terminal-text font-mono">
                    {activeObjectives}
                  </div>
                </ExecKPI>

                {/* 2. Pending Approvals */}
                <ExecKPI label="Pending Approvals">
                  <div className="text-2xl font-bold font-mono">
                    <span className={pendingApprovals > 0 ? 'text-terminal-yellow' : 'text-terminal-text'}>
                      {pendingApprovals}
                    </span>
                  </div>
                </ExecKPI>

                {/* 3. Exec Dept Spend (MTD) */}
                <ExecKPI label="Exec Dept Spend (MTD)">
                  <div className="text-2xl font-bold text-terminal-text font-mono">
                    ${kpis.spendMTD.toFixed(2)}
                  </div>
                </ExecKPI>

                {/* 4. Dept Health */}
                <ExecKPI
                  label="Dept Health"
                  subtext={healthyCount === totalCount ? 'All systems nominal' : `${totalCount - healthyCount} agent(s) degraded`}
                >
                  <div className="text-2xl font-bold font-mono">
                    <span className={healthyCount === totalCount ? 'text-terminal-green' : 'text-terminal-yellow'}>
                      {healthyCount}
                    </span>
                    <span className="text-terminal-dim text-lg">/{totalCount}</span>
                    <span className="text-terminal-dim text-sm ml-1">healthy</span>
                  </div>
                </ExecKPI>
              </div>

              {/* Agent Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {strategistAgent && (() => {
                  const liveStatus = getAgentLive('strategist');
                  return (
                    <ExecutiveAgentCard
                      agent={strategistAgent}
                      status={liveStatus?.state}
                      lastRunAt={liveStatus?.lastRunAt ? new Date(liveStatus.lastRunAt).toISOString() : undefined}
                    />
                  );
                })()}
                {reviewerAgent && (() => {
                  const liveStatus = getAgentLive('reviewer');
                  return (
                    <ExecutiveAgentCard
                      agent={reviewerAgent}
                      status={liveStatus?.state}
                      lastRunAt={liveStatus?.lastRunAt ? new Date(liveStatus.lastRunAt).toISOString() : undefined}
                    />
                  );
                })()}
              </div>

              {/* Pending Cross-Department Approvals */}
              <PendingApprovalsWidget />

              {/* Heartbeat Monitor */}
              <HeartbeatMonitor data={heartbeatMonitorData} />

              <div className={`border rounded p-3 text-xs ${
                agentHubHealth.ok
                  ? 'bg-terminal-green/5 border-terminal-green/20 text-terminal-dim'
                  : 'bg-terminal-red/5 border-terminal-red/20 text-terminal-red'
              }`}>
                {agentHubHealth.ok
                  ? 'AgentHub reachable. Executive activity reflects live commit traffic.'
                  : `AgentHub degraded: ${agentHubHealth.error || 'connectivity check failed'}`}
              </div>

              {/* AgentHub Activity Widget */}
              <ActivityWidget commits={ahCommits ?? []} />

              {/* Standup Synthesis */}
              <StandupSynthesisSection synthesis={standupSynthesis} />
            </div>
          ),

          /* ── Directives Tab ── */
          directives: (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Directive Timeline</h3>
              </div>
              <DirectiveTimeline objectives={objectives} />
            </div>
          ),

          /* ── Review Queue Tab ── */
          'review-queue': (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
                  Review Queue
                </h3>
              </div>
              <ReviewQueue items={approvals} fleetOnline={!coreOffline} />
            </div>
          ),

          /* ── Activity Tab ── */
          activity: (
            <EventFeed
              initialRuns={
                recentRuns.map((r) => ({
                  agentId: r.agentId,
                  status: r.status,
                  createdAt: r.createdAt,
                  ...(r.taskId ? { taskId: r.taskId } : {}),
                  ...(r.executionId ? { executionId: r.executionId } : {}),
                }))
              }
              agentNames={agents.map((a) => a.name)}
            />
          ),
        }}
      </TabLayout>

      {/* Settings Drawer */}
      <ExecutiveSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Agent Detail Drawer */}
      <AgentDetailDrawer
        agentId={drawerAgent}
        open={!!drawerAgent}
        onClose={handleCloseDrawer}
        fleetOnline={!coreOffline && live!.agents.some(a => a.state === 'active')}
      >
        {drawerAgent && <AgentHubTabs agentId={drawerAgent} commits={ahCommits ?? []} posts={[]} />}
      </AgentDetailDrawer>
    </div>
  );
}
