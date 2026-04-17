export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { DeptHeader } from '@/components/dept-header';
import { getAgentsByDept } from '@/lib/agents';
import { getDepartmentData } from '@/lib/department-data';
import { getDepartmentKPIs } from '@/lib/department-kpis';
import { getEcsFleetStatus } from '@/lib/actions/ecs-fleet';
import { getRecentRuns } from '@/lib/run-records';
import { getAuditLog, getSentinelAudits, getHealthChecks } from '@/lib/operations-queries';
import { getAgentSpend } from '@/lib/cost-queries';
import { getSchedules, getCacheStats, getMemoryStatus } from '@/lib/yclaw-api';
import { getBudgets } from '@/lib/actions/budget';
import { getBudgetConfig } from '@/lib/actions/budget-config';
import type { CronSchedule, CacheStats, MemoryStatus } from '@/lib/yclaw-api';
import type { DepartmentBaseData } from '@/lib/department-data';
import type { DepartmentKPIs } from '@/lib/department-kpis';
import type { EcsFleetStatus } from '@/lib/actions/ecs-fleet';
import type { RunRecord } from '@/lib/run-records';
import { OperationsClient } from './client';

export default async function OperationsPage() {
  const agents = getAgentsByDept('operations');
  const agentNames = agents.map((a) => a.name);

  const [live, kpis, ecsStatus, recentRuns, auditEntries, sentinelAudits, healthServices, agentSpend, schedules, cacheStats, memoryStatus, budgets, budgetConfig] = await Promise.all([
    getDepartmentData(agentNames) as Promise<DepartmentBaseData>,
    getDepartmentKPIs(agentNames) as Promise<DepartmentKPIs>,
    getEcsFleetStatus() as Promise<EcsFleetStatus>,
    getRecentRuns(agentNames, 30) as Promise<RunRecord[]>,
    getAuditLog(20),
    getSentinelAudits(),
    getHealthChecks(),
    getAgentSpend(agentNames),
    getSchedules() as Promise<CronSchedule[]>,
    getCacheStats() as Promise<CacheStats | null>,
    getMemoryStatus() as Promise<MemoryStatus | null>,
    getBudgets(),
    getBudgetConfig(),
  ]);

  return (
    <div>
      <DeptHeader department="operations" />
      <Suspense fallback={<div className="text-xs text-mc-text-tertiary text-center py-8">Loading operations dashboard...</div>}>
        <OperationsClient
          agents={agents}
          live={live}
          kpis={kpis}
          ecsStatus={ecsStatus}
          recentRuns={recentRuns}
          auditEntries={auditEntries}
          sentinelAudits={sentinelAudits}
          healthServices={healthServices}
          agentSpend={agentSpend}
          schedules={schedules}
          cacheStats={cacheStats}
          memoryStatus={memoryStatus}
          budgets={budgets}
          budgetMode={budgetConfig.mode}
        />
      </Suspense>
    </div>
  );
}
