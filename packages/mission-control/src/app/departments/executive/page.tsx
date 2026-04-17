export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { DeptHeader } from '@/components/dept-header';
import { getAgentsByDept } from '@/lib/agents';
import { getDepartmentData } from '@/lib/department-data';
import { getDepartmentKPIs } from '@/lib/department-kpis';
import { getRecentRuns } from '@/lib/run-records';
import { getLatestStandupSynthesis } from '@/lib/executive-queries';
import { getObjectives, getActiveObjectiveCount } from '@/lib/objectives-queries';
import { getApprovals, getPendingApprovalCount } from '@/lib/approvals-queries';
import { getAgentHeartbeatData } from '@/lib/heartbeat-data';
import { getAgentSpend } from '@/lib/cost-queries';
import { getBudgets } from '@/lib/actions/budget';
import { getBudgetConfig } from '@/lib/actions/budget-config';
import { fetchCommits, getAgentHubHealth } from '@/lib/agenthub-api';
import { ExecClient } from './client';

const EXEC_AGENTS = ['strategist', 'reviewer'];

export default async function ExecutivePage() {
  const agents = getAgentsByDept('executive');

  const [live, kpis, recentRuns, standupSynthesis, objectives, approvals, heartbeatData, agentSpend, pendingApprovals, activeObjectives, budgets, budgetConfig, ahCommits, agentHubHealth] = await Promise.all([
    getDepartmentData(EXEC_AGENTS),
    getDepartmentKPIs(EXEC_AGENTS),
    getRecentRuns(EXEC_AGENTS, 30),
    getLatestStandupSynthesis(),
    getObjectives(),
    getApprovals(),
    getAgentHeartbeatData(EXEC_AGENTS),
    getAgentSpend(EXEC_AGENTS),
    getPendingApprovalCount(),
    getActiveObjectiveCount(),
    getBudgets(),
    getBudgetConfig(),
    fetchCommits({ limit: 200 }),
    getAgentHubHealth(),
  ]);

  return (
    <div>
      <DeptHeader department="executive" />
      <Suspense fallback={<div className="text-xs text-mc-text-tertiary text-center py-8">Loading executive dashboard...</div>}>
        <ExecClient
          agents={agents}
          live={live}
          kpis={kpis}
          pendingApprovals={pendingApprovals}
          activeObjectives={activeObjectives}
          objectives={objectives}
          approvals={approvals}
          recentRuns={recentRuns}
          standupSynthesis={standupSynthesis}
          heartbeatData={heartbeatData}
          agentSpend={agentSpend}
          budgets={budgets}
          budgetMode={budgetConfig.mode}
          ahCommits={ahCommits}
          agentHubHealth={agentHubHealth}
        />
      </Suspense>
    </div>
  );
}
