'use client';

import { useState, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { TabLayout } from '@/components/tab-layout';
import { KPICard } from '@/components/kpi-card';
import { AgentCard } from '@/components/agent-card';
import { EventFeed } from '@/components/event-feed';
import { DevelopmentSettings } from '@/components/development-settings';
import { PipelineSwimlane } from '@/components/pipeline-swimlane';
import { TechDebtRadar } from '@/components/tech-debt-radar';
import { CommitsTimeline } from '@/components/commits-timeline';
import { SchedulesPanel } from '@/components/schedules-panel';
import { EventMesh } from '@/components/event-mesh';
import { DevelopmentAgentCard } from '@/components/development-agent-card';
import { AgentDetailDrawer } from '@/components/agent-detail-drawer';
import { HeartbeatMonitor } from '@/components/heartbeat-monitor';
import { ExplorationDAG } from '@/components/agenthub/ExplorationDAG';
import { ExplorationControlPanel } from '@/components/agenthub/ExplorationControlPanel';
import { AgentHubTabs } from '@/components/agenthub/AgentHubTabs';
import { DesignStudio } from '@/components/design-studio/design-studio';
import type { AHCommit, AHPost, AgentHubHealth } from '@/lib/agenthub-api';
import type { AgentInfo } from '@/lib/agents';
import type { DepartmentBaseData } from '@/lib/department-data';
import type { DepartmentKPIs } from '@/lib/department-kpis';
import type { RunRecord } from '@/lib/run-records';
import type { AgentHeartbeatData } from '@/lib/heartbeat-data';
import type { AgentSpend } from '@/lib/cost-queries';
import type { QueueTask, DispatcherStatus } from '@/lib/builder-queue';
import type { CronSchedule } from '@/lib/yclaw-api';
import type { AgentBudget } from '@/lib/actions/budget';
import type { BudgetMode } from '@/lib/actions/budget-config';
import type { ExplorationRuntimeStatus } from '@/lib/runtime-controls';
import type { AuditSummaryData } from '@/lib/operations-queries';

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'queue', label: 'Task Queue' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'codebase', label: 'Codebase' },
  { key: 'agents', label: 'Agents' },
  { key: 'activity', label: 'Activity' },
];

// ─── Priority Styles ────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, { border: string; text: string; bg: string; label: string }> = {
  P0: { border: 'border-mc-danger/40', text: 'text-mc-danger', bg: 'bg-mc-danger/10', label: 'P0 Critical' },
  P1: { border: 'border-mc-blocked/40', text: 'text-mc-blocked', bg: 'bg-mc-blocked/10', label: 'P1 High' },
  P2: { border: 'border-mc-warning/30', text: 'text-mc-warning', bg: 'bg-mc-warning/10', label: 'P2 Medium' },
  P3: { border: 'border-mc-border', text: 'text-mc-text-tertiary', bg: 'bg-mc-surface-hover', label: 'P3 Low' },
};

function formatQueueTime(score: number): string {
  // Scores are stored as Date.now() * 1000 (microseconds) — convert to ms
  const scoreMs = score > 1e15 ? score / 1000 : score;
  const elapsed = Date.now() - scoreMs;
  if (elapsed < 0) return 'just now';
  const secs = Math.floor(elapsed / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ─── Main Client ─────────────────────────────────────────────────────────────

interface DevelopmentClientProps {
  agents: AgentInfo[];
  live?: DepartmentBaseData;
  kpis: DepartmentKPIs;
  github?: { openPRs: number; reviewReady: number; failingCI: number };
  queues?: Record<string, number>;
  recentRuns: RunRecord[];
  heartbeatData?: AgentHeartbeatData[];
  agentSpend?: AgentSpend[];
  builderQueue?: Record<string, QueueTask[]>;
  dispatcherStatus?: DispatcherStatus | null;
  activeSessions?: number;
  budgets?: AgentBudget[];
  budgetMode?: BudgetMode;
  ahCommits?: AHCommit[];
  ahLeaves?: AHCommit[];
  schedules: CronSchedule[];
  explorationStatus: ExplorationRuntimeStatus;
  ahPosts: AHPost[];
  agentHubHealth: AgentHubHealth;
  pipelinePrs: Array<{
    id: string;
    title: string;
    number?: number;
    author?: string;
    status: string;
    stage: string;
    updatedAt?: string;
  }>;
  sentinelAudits?: { latest: AuditSummaryData | null; history: AuditSummaryData[] };
}

const EVENT_MESH = {
  nodes: [
    { id: 'strategist', label: 'Strategist', emoji: 'S' },
    { id: 'builder', label: 'Builder', emoji: 'B' },
    { id: 'workers', label: 'Workers', emoji: 'W' },
    { id: 'reviewer', label: 'Reviewer', emoji: 'R' },
    { id: 'deployer', label: 'Deployer', emoji: 'D' },
  ],
  edges: [
    { from: 'strategist', to: 'builder', label: 'builder_directive' },
    { from: 'strategist', to: 'builder', label: 'exploration_directive' },
    { from: 'builder', to: 'workers', label: 'task queue' },
    { from: 'workers', to: 'reviewer', label: 'PR ready' },
    { from: 'reviewer', to: 'deployer', label: 'approved deploy' },
  ],
};

function gradeToScore(grade?: string): number {
  switch ((grade || '').toUpperCase()) {
    case 'A+':
    case 'A':
      return 95;
    case 'A-':
      return 90;
    case 'B+':
      return 85;
    case 'B':
      return 80;
    case 'B-':
      return 75;
    case 'C+':
      return 68;
    case 'C':
      return 62;
    case 'C-':
      return 56;
    case 'D+':
    case 'D':
    case 'D-':
      return 40;
    case 'F':
      return 20;
    default:
      return 0;
  }
}

function buildTechDebtModel(latest: AuditSummaryData | null | undefined) {
  if (!latest) {
    return { axes: [], items: [] };
  }

  const findings = latest.findingsCount ?? 0;
  const ageDays = latest.date ? Math.max(0, Math.floor((Date.now() - new Date(latest.date).getTime()) / 86400000)) : 30;
  const freshnessScore = Math.max(0, 100 - ageDays * 5);
  const findingLoadScore = Math.max(0, 100 - findings * 8);
  const auditScore = gradeToScore(latest.grade);

  const rawLines = (latest.summary ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);

  const severity = findings >= 5 || auditScore < 60
    ? 'critical'
    : findings > 0 || auditScore < 80
      ? 'warning'
      : 'info';

  const items = rawLines.map((line) => ({
    title: line.replace(/^[-*]\s*/, ''),
    severity,
  }));

  return {
    axes: [
      { label: 'Audit Grade', score: auditScore || 50 },
      { label: 'Finding Load', score: findingLoadScore },
      { label: 'Freshness', score: freshnessScore },
    ],
    items,
  };
}

function buildScheduleEntries(schedules: CronSchedule[]) {
  return schedules.map((schedule) => ({
    agent: schedule.agentId,
    type: 'cron' as const,
    schedule: schedule.schedule,
    humanReadable: schedule.taskId,
    lastRun: schedule.lastRunAt,
    nextRun: schedule.nextFireAt,
    status: schedule.enabled ? 'healthy' : 'warning',
  }));
}

function buildCommitEntries(commits: AHCommit[]) {
  return commits.map((commit) => ({
    sha: commit.hash,
    message: commit.message.split('\n')[0] || commit.message,
    author: commit.agent_id,
    repo: 'agenthub',
    createdAt: commit.created_at,
  }));
}

export function DevelopmentClient({ agents, live, kpis, github, queues, recentRuns, heartbeatData, agentSpend, builderQueue, dispatcherStatus, activeSessions, budgets, budgetMode, ahCommits, ahLeaves, schedules, explorationStatus, ahPosts, agentHubHealth, pipelinePrs, sentinelAudits }: DevelopmentClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const drawerAgent = searchParams.get('agent');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | undefined>();

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Build a status map from live data
  const statusMap: Record<string, string> = {};
  if (live) {
    for (const a of live.agents) {
      statusMap[a.name] = a.state === 'active' ? 'active' : a.state === 'error' ? 'error' : 'idle';
    }
  }

  // Build a lastRunAt map from live data
  const lastRunMap: Record<string, string | undefined> = {};
  if (live) {
    for (const a of live.agents) {
      if (a.lastRunAt) {
        lastRunMap[a.name] = new Date(a.lastRunAt).toISOString();
      }
    }
  }

  // KPI values
  const failingCI = github?.failingCI ?? 0;
  const healthLabel = failingCI === 0 ? 'All Clear' : `${failingCI} Failing`;
  const healthColor = failingCI === 0 ? 'text-mc-success' : 'text-mc-danger';

  const queueTotal = queues ? Object.values(queues).reduce((s, v) => s + v, 0) : 0;
  const scheduleEntries = buildScheduleEntries(schedules);
  const commitEntries = buildCommitEntries(ahCommits ?? []);
  const deployQueue = pipelinePrs
    .filter((pr) => pr.stage === 'approved' || pr.stage === 'deploy_staging' || pr.stage === 'deploy_prod')
    .map((pr) => ({
      id: pr.id,
      title: pr.title,
      env: pr.stage === 'deploy_prod' ? 'production' : 'staging',
      estimatedAt: pr.updatedAt,
    }));
  const techDebt = buildTechDebtModel(sentinelAudits?.latest);

  return (
    <div>
      {/* Header actions */}
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={openSettings}
          className="px-3 py-1.5 rounded-chip border border-mc-border font-sans text-xs text-mc-text-secondary hover:border-mc-border-hover hover:text-mc-text transition-colors duration-mc ease-mc-out"
        >
          Settings
        </button>
      </div>

      <TabLayout tabs={TABS} defaultTab="overview">
        {{
          // ─── Overview Tab ──────────────────────────────────────────
          overview: (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <KPICard
                  label="Open PRs"
                  value={`${github?.openPRs ?? 0}`}
                  subtext={`${github?.reviewReady ?? 0} review-ready`}
                />
                <KPICard
                  label="Task Queue"
                  value={`${queueTotal}`}
                  subtext={queues ? `P0:${queues.P0 ?? 0} P1:${queues.P1 ?? 0} P2:${queues.P2 ?? 0} P3:${queues.P3 ?? 0}` : 'Queue unavailable'}
                />
                <KPICard
                  label="Runs (24h)"
                  value={`${kpis.runCount24h}`}
                  subtext={`${kpis.errorCount24h} errors`}
                />
                <div className="relative border border-mc-border rounded-panel bg-transparent p-4 transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
                  <div className={`font-mono text-2xl tabular-nums ${healthColor}`}>{healthLabel}</div>
                  <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mt-1">CI Status</div>
                </div>
                <KPICard
                  label="Queue Depth"
                  value={`${builderQueue ? Object.values(builderQueue).reduce((s, tasks) => s + tasks.length, 0) : 0}`}
                  subtext={builderQueue ? `${(builderQueue.P0 || []).length} critical` : 'Unavailable'}
                />
                <KPICard
                  label="Active Sessions"
                  value={`${activeSessions ?? 0}`}
                  subtext="active sessions"
                />
              </div>

              {/* Agent Grid (compact) */}
              <div>
                <h2 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-3">Agents</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {agents.map(agent => (
                    <AgentCard
                      key={agent.name}
                      agent={agent}
                      status={(statusMap[agent.name] as 'active' | 'idle' | 'error') ?? 'idle'}
                    />
                  ))}
                </div>
              </div>

              {/* Heartbeat Heatmap */}
              <HeartbeatMonitor
                data={(heartbeatData || []).map(d => ({
                  agentId: d.agentId,
                  buckets: d.buckets,
                }))}
              />

              {/* Per-Agent Spend */}
              {agentSpend && agentSpend.length > 0 && (
                <div className="border border-mc-border rounded-panel bg-transparent p-4">
                  <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-3">
                    Agent Spend
                  </h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {agentSpend.map(s => (
                      <div key={s.agentId} className="border border-mc-border rounded-panel p-3">
                        <div className="font-mono text-xs text-mc-text mb-2">{s.agentId}</div>
                        <div className="space-y-1 font-sans text-xs text-mc-text-tertiary">
                          <div className="flex justify-between">
                            <span>Today</span>
                            <span className="font-mono text-mc-text tabular-nums">${s.today.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>7d</span>
                            <span className="font-mono text-mc-text tabular-nums">${s.week.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>MTD</span>
                            <span className="font-mono text-mc-text tabular-nums">${s.month.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <ExplorationControlPanel health={agentHubHealth} status={explorationStatus} />

              {/* AgentHub Exploration DAG */}
              <div>
                <h2 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-3">Exploration DAG</h2>
                <ExplorationDAG
                  commits={ahCommits ?? []}
                  leaves={ahLeaves ?? []}
                  selectedHash={selectedCommitHash}
                  onSelectCommit={setSelectedCommitHash}
                />
              </div>

              {/* Schedules & Triggers */}
              <SchedulesPanel schedules={scheduleEntries} defaultOpen />

              {/* Design Studio */}
              <DesignStudio />
            </div>
          ),

          // ─── Builder Queue Tab ─────────────────────────────────────
          queue: (
            <div className="space-y-6">
              {/* Dispatcher status banner */}
              {dispatcherStatus === null || dispatcherStatus === undefined ? (
                <div className="border border-mc-border rounded-panel bg-transparent p-4 text-center">
                  <span className="font-sans text-xs text-mc-text-tertiary">Dispatcher unavailable</span>
                </div>
              ) : (
                <>
                  {/* Metrics strip */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="border border-mc-border rounded-panel bg-transparent p-4">
                      <div className="font-mono text-2xl text-mc-text tabular-nums">{dispatcherStatus.totalProcessed.toLocaleString()}</div>
                      <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mt-1">Total Processed</div>
                    </div>
                    <div className="border border-mc-border rounded-panel bg-transparent p-4">
                      <div className={`font-mono text-2xl tabular-nums ${dispatcherStatus.totalFailed > 0 ? 'text-mc-danger' : 'text-mc-text'}`}>{dispatcherStatus.totalFailed.toLocaleString()}</div>
                      <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mt-1">Total Failed</div>
                    </div>
                    <div className="border border-mc-border rounded-panel bg-transparent p-4">
                      <div className="font-mono text-2xl text-mc-text tabular-nums">{formatMs(dispatcherStatus.avgExecutionMs)}</div>
                      <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mt-1">Avg Execution Time</div>
                    </div>
                  </div>

                  {/* Worker status panel */}
                  <div className="border border-mc-border rounded-panel bg-transparent p-4">
                    <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-3">Workers</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {(dispatcherStatus.workers.length > 0 ? dispatcherStatus.workers : [
                        { id: 'worker-0', status: 'idle' as const },
                        { id: 'worker-1', status: 'idle' as const },
                        { id: 'worker-2', status: 'idle' as const },
                      ]).map((worker) => (
                        <div key={worker.id} className={`border rounded-panel p-3 transition-colors duration-mc ease-mc-out ${worker.status === 'busy' ? 'border-mc-success/40 bg-mc-success/5' : 'border-mc-border bg-transparent'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`w-2 h-2 rounded-full ${worker.status === 'busy' ? 'bg-mc-success animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-success' : 'bg-mc-text-tertiary'}`} />
                            <span className="font-mono text-xs text-mc-text">{worker.id}</span>
                            <span className={`ml-auto font-sans text-[10px] font-medium uppercase tracking-label ${worker.status === 'busy' ? 'text-mc-success' : 'text-mc-text-tertiary'}`}>{worker.status}</span>
                          </div>
                          {worker.currentTask && (
                            <div className="font-mono text-[10px] text-mc-text-tertiary truncate mt-1" title={worker.currentTask}>
                              {worker.currentTask}
                            </div>
                          )}
                          {worker.currentAgent && (
                            <div className="font-mono text-[10px] text-mc-text-tertiary/60 mt-0.5">{worker.currentAgent}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Priority columns */}
              {(() => {
                const allEmpty = !builderQueue || Object.values(builderQueue).every(tasks => tasks.length === 0);
                if (allEmpty) {
                  return (
                    <div className="border border-mc-border rounded-panel bg-transparent p-6 text-center">
                      <span className="font-sans text-xs text-mc-text-tertiary">No tasks in queue</span>
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => {
                      const style = PRIORITY_STYLES[priority]!;
                      const tasks = builderQueue?.[priority] ?? [];
                      return (
                        <div key={priority} className={`border rounded-panel bg-transparent ${style.border}`}>
                          <div className={`px-3 py-2 border-b ${style.border} flex items-center gap-2`}>
                            <span className={`font-sans text-[11px] font-medium uppercase tracking-label ${style.text}`}>{style.label}</span>
                            <span className={`ml-auto font-mono text-[10px] tabular-nums ${style.text}`}>{tasks.length}</span>
                          </div>
                          {tasks.length === 0 ? (
                            <div className="p-3 font-sans text-[10px] text-mc-text-tertiary text-center">No tasks</div>
                          ) : (
                            <div className="divide-y divide-mc-border">
                              {tasks.map((task) => (
                                <div key={task.taskId} className="px-3 py-2 hover:bg-mc-surface-hover transition-colors duration-mc ease-mc-out">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-mc-text truncate" title={task.taskId}>{task.taskId}</span>
                                    <span className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded-badge font-sans text-[10px] font-medium uppercase tracking-label border ${style.bg} ${style.text} ${style.border}`}>{priority}</span>
                                  </div>
                                  <div className="font-mono text-[10px] text-mc-text-tertiary tabular-nums mt-0.5">
                                    {formatQueueTime(task.score)} in queue
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          ),

          // ─── Pipeline Tab ──────────────────────────────────────────
          pipeline: (
            <div className="space-y-6">
              {/* Event Mesh */}
              <div>
                <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-2">Event Mesh</h3>
                <EventMesh nodes={EVENT_MESH.nodes} edges={EVENT_MESH.edges} />
              </div>

              {/* Pipeline Swimlane */}
              <div>
                <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-2">Pipeline Swimlane</h3>
                <PipelineSwimlane prs={pipelinePrs} deployQueue={deployQueue} />
              </div>
            </div>
          ),

          // ─── Codebase Tab ──────────────────────────────────────────
          codebase: (
            <div className="space-y-6">
              {/* Tech Debt Radar + Items */}
              <div>
                <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-2">Tech Debt Radar</h3>
                <TechDebtRadar axes={techDebt.axes} items={techDebt.items} />
              </div>

              {/* Commits Timeline */}
              <div>
                <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-2">Commits Timeline</h3>
                <CommitsTimeline commits={commitEntries} />
              </div>
            </div>
          ),

          // ─── Agents Tab ────────────────────────────────────────────
          agents: (
            <div className="space-y-4">
              <h2 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">Development Roster</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {agents.map(agent => (
                  <DevelopmentAgentCard
                    key={agent.name}
                    agent={agent}
                    status={(statusMap[agent.name] as 'active' | 'idle' | 'error' | 'blocked' | 'processing') ?? 'idle'}
                    lastRunAt={lastRunMap[agent.name]}
                  />
                ))}
              </div>
            </div>
          ),

          // ─── Activity Tab ──────────────────────────────────────────
          activity: (
            <EventFeed
              initialRuns={recentRuns.map(r => ({
                agentId: r.agentId,
                status: r.status,
                createdAt: r.createdAt,
                taskId: r.taskId,
                executionId: r.executionId,
              }))}
              agentNames={agents.map(a => a.name)}
            />
          ),
        }}
      </TabLayout>

      {/* Agent Detail Drawer */}
      <AgentDetailDrawer
        agentId={drawerAgent}
        open={!!drawerAgent}
        onClose={() => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete('agent');
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
        fleetOnline={live ? live.agents.some(a => a.state === 'active') : false}
      >
        {drawerAgent && <AgentHubTabs agentId={drawerAgent} commits={ahCommits ?? []} posts={ahPosts ?? []} />}
      </AgentDetailDrawer>

      {/* Settings Drawer */}
      <DevelopmentSettings open={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
