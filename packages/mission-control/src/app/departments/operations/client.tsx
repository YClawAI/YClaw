'use client';

import { useState, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { AgentInfo } from '@/lib/agents';
import type { DepartmentBaseData } from '@/lib/department-data';
import type { DepartmentKPIs } from '@/lib/department-kpis';
import type { RunRecord } from '@/lib/run-records';
import type { AuditEntry, AuditSummaryData, ServiceHealthCheck } from '@/lib/operations-queries';
import type { AgentSpend } from '@/lib/cost-queries';
import type { CronSchedule, CacheStats, MemoryStatus } from '@/lib/yclaw-api';
import type { AgentBudget } from '@/lib/actions/budget';
import type { BudgetMode } from '@/lib/actions/budget-config';
import { KPICard } from '@/components/kpi-card';
import { TabLayout } from '@/components/tab-layout';
import { EventFeed } from '@/components/event-feed';
import { SentinelMegaCard } from '@/components/sentinel-mega-card';
import { WatchdogTimers } from '@/components/watchdog-timers';
import type { WatchdogTimer } from '@/components/watchdog-timers';
import { HealthMatrix } from '@/components/health-matrix';
import { AlertBoard } from '@/components/alert-board';
import { AuditFindings } from '@/components/audit-findings';
import { OperationsSettings } from '@/components/operations-settings';
import { AgentDetailDrawer } from '@/components/agent-detail-drawer';

// ─── Constants ──────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'health', label: 'Health' },
  { key: 'audits', label: 'Audits' },
  { key: 'activity', label: 'Activity' },
];

// Sentinel schedule definitions
const SENTINEL_SCHEDULE_MAP: { taskId: string; name: string; schedule: string; type: 'cron' | 'event'; runRecordTaskId: string }[] = [
  { taskId: 'deployment_health', name: 'Deployment Health', schedule: 'Every 4 hours', type: 'cron', runRecordTaskId: 'health_check' },
  { taskId: 'code_quality_audit', name: 'Code Quality Audit', schedule: 'Mon + Thu', type: 'cron', runRecordTaskId: 'code_audit' },
  { taskId: 'weekly_repo_digest', name: 'Weekly Repo Digest', schedule: 'Friday', type: 'cron', runRecordTaskId: 'weekly_repo_digest' },
];

function buildWatchdogTimers(recentRuns: RunRecord[], schedules: CronSchedule[]): WatchdogTimer[] {
  const sentinelSchedules = schedules.filter(s => s.agentId === 'sentinel');
  const fleetOnline = sentinelSchedules.length > 0;

  return SENTINEL_SCHEDULE_MAP.map((def) => {
    const lastRun = recentRuns.find((r) => r.taskId === def.runRecordTaskId);
    const cronMatch = sentinelSchedules.find(s => s.taskId === def.taskId);

    return {
      name: def.name,
      schedule: cronMatch?.schedule ?? def.schedule,
      type: def.type,
      lastRun: lastRun?.createdAt,
      lastStatus: lastRun?.status,
      nextRun: fleetOnline ? cronMatch?.nextFireAt : undefined,
    };
  });
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface OperationsClientProps {
  agents: AgentInfo[];
  live?: DepartmentBaseData;
  kpis: DepartmentKPIs;
  ecsStatus?: {
    desiredCount: number;
    runningCount: number;
    status: string;
  };
  recentRuns: RunRecord[];
  auditEntries?: AuditEntry[];
  sentinelAudits?: { latest: AuditSummaryData | null; history: AuditSummaryData[] };
  healthServices?: ServiceHealthCheck[];
  agentSpend?: AgentSpend[];
  schedules: CronSchedule[];
  cacheStats: CacheStats | null;
  memoryStatus: MemoryStatus | null;
  budgets?: AgentBudget[];
  budgetMode?: BudgetMode;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OperationsClient({
  agents,
  live,
  kpis,
  ecsStatus,
  recentRuns,
  auditEntries,
  sentinelAudits,
  healthServices,
  agentSpend,
  schedules,
  cacheStats,
  memoryStatus,
  budgets,
  budgetMode,
}: OperationsClientProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const drawerAgentId = searchParams.get('agent');

  const openSettings = useCallback((section?: string) => {
    setSettingsSection(section ?? null);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsSection(null);
  }, []);

  const sentinel = agents.find((a) => a.name === 'sentinel');
  const sentinelLive = live?.agents?.find((a) => a.name === 'sentinel');

  // Derive ECS Fleet KPI label
  const ecsLabel =
    ecsStatus?.status === 'running'
      ? `${ecsStatus.runningCount}/${ecsStatus.desiredCount} Running`
      : ecsStatus?.status === 'scaling'
        ? 'Scaling...'
        : ecsStatus?.status === 'stopped'
          ? 'Stopped'
          : 'Unknown';

  // Derive error rate
  const errorRate =
    kpis.errorCount24h > 0 && kpis.runCount24h > 0
      ? ((kpis.errorCount24h / kpis.runCount24h) * 100).toFixed(1) + '%'
      : '0%';

  // Build watchdog timers from recentRuns + schedules
  const watchdogTimers = buildWatchdogTimers(recentRuns, schedules);

  // Build alerts from audit entries with severity classification
  const alerts = (auditEntries ?? []).map((entry) => {
    const actionLower = entry.action.toLowerCase();
    let severity: 'critical' | 'warning' | 'info' = 'info';
    if (/error|fail|critical/.test(actionLower)) {
      severity = 'critical';
    } else if (/warn|degrade/.test(actionLower)) {
      severity = 'warning';
    }
    return {
      id: entry.id,
      severity,
      title: entry.action,
      timestamp: entry.timestamp,
      source: entry.source,
      details: entry.details ? JSON.stringify(entry.details) : undefined,
    };
  });

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        <div />
        <button
          onClick={() => openSettings()}
          className="px-3 py-1.5 rounded-chip border border-mc-border font-sans text-xs text-mc-text-secondary hover:border-mc-border-hover hover:text-mc-text transition-colors duration-mc ease-mc-out"
        >
          Settings
        </button>
      </div>

      {/* Tabs */}
      <TabLayout tabs={TABS} defaultTab="overview">
        {{
          overview: (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  label="ECS Fleet"
                  value={ecsLabel}
                />
                <KPICard
                  label="Sentinel Runs (24h)"
                  value={String(kpis.runCount24h)}
                />
                <KPICard
                  label="Error Rate (24h)"
                  value={errorRate}
                />
                <KPICard
                  label="Dept Spend (MTD)"
                  value={`$${kpis.spendMTD.toFixed(2)}`}
                />
              </div>

              {/* Sentinel Mega-Card */}
              {sentinel && (
                <div
                  className="cursor-pointer"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('agent', 'sentinel');
                    router.push(`${pathname}?${params.toString()}`);
                  }}
                >
                  <SentinelMegaCard
                    agent={sentinel}
                    status={sentinelLive?.state}
                    lastRunAt={sentinelLive?.lastRunAt ? new Date(sentinelLive.lastRunAt).toISOString() : undefined}
                    runCount24h={kpis.runCount24h}
                    errorCount24h={kpis.errorCount24h}
                  />
                </div>
              )}

              {/* Watchdog Timers */}
              <div className="space-y-2">
                <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">Watchdog Timers</h3>
                <WatchdogTimers timers={watchdogTimers} />
              </div>

              {/* Alert Board */}
              <div className="space-y-2">
                <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">Alert Board</h3>
                <AlertBoard alerts={alerts} />
              </div>

              {/* Cache Stats + Memory Status */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Cache Stats Panel */}
                <div className="border border-mc-border rounded-panel bg-transparent p-4 transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
                  <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-3">
                    Cache Stats
                  </h3>
                  {cacheStats ? (
                    <div className="space-y-2 font-mono text-xs tabular-nums">
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Hit Rate</span>
                        <span className="text-mc-text">{(cacheStats.averageCacheHitRate * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Executions</span>
                        <span className="text-mc-text">{formatCount(cacheStats.executions)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Cached Runs</span>
                        <span className="text-mc-text">{formatCount(cacheStats.cachedExecutions)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Adoption</span>
                        <span className="text-mc-text">{cacheStats.cacheAdoptionRate.toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Read Tokens</span>
                        <span className="text-mc-text">{formatCount(cacheStats.cacheReadTokens)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Savings</span>
                        <span className="text-mc-text">${cacheStats.savingsUsd.toFixed(4)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="font-sans text-xs text-mc-text-tertiary text-center py-4">
                      No data available
                    </div>
                  )}
                </div>

                {/* Memory Status Panel */}
                <div className="border border-mc-border rounded-panel bg-transparent p-4 transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
                  <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label mb-3">
                    Memory Status
                  </h3>
                  {memoryStatus ? (
                    <div className="space-y-2 font-mono text-xs tabular-nums">
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Tables</span>
                        <span className="text-mc-text">{memoryStatus.tableCount.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Categories</span>
                        <span className="text-mc-text">{memoryStatus.categoryCount.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Items</span>
                        <span className="text-mc-text">{memoryStatus.itemCount.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-mc-text-tertiary">Connection</span>
                        <span className={memoryStatus.connected ? 'text-mc-success' : 'text-mc-danger'}>
                          {memoryStatus.connected ? 'Connected' : 'Disconnected'}
                        </span>
                      </div>
                      {memoryStatus.error && (
                        <div className="pt-2 border-t border-mc-border text-mc-danger">
                          {memoryStatus.error}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="font-sans text-xs text-mc-text-tertiary text-center py-4">
                      No data available
                    </div>
                  )}
                </div>
              </div>
            </div>
          ),
          health: (
            <div className="space-y-4">
              <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">Health Matrix</h3>
              <HealthMatrix services={healthServices ?? []} />
            </div>
          ),
          audits: (
            <div className="space-y-4">
              <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">Audit Findings</h3>
              <AuditFindings
                latestAudit={sentinelAudits?.latest ?? undefined}
                auditHistory={sentinelAudits?.history}
              />
            </div>
          ),
          activity: (
            <EventFeed
              initialRuns={recentRuns.map((r) => ({
                agentId: r.agentId,
                status: r.status,
                createdAt: r.createdAt,
                taskId: r.taskId,
                executionId: r.executionId,
              }))}
              agentNames={agents.map((a) => a.name)}
            />
          ),
        }}
      </TabLayout>

      {/* Settings Drawer */}
      <OperationsSettings open={settingsOpen} onClose={closeSettings} />

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
    </div>
  );
}
