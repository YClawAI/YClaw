export const dynamic = 'force-dynamic';

import { DeptHeader } from '@/components/dept-header';
import { getAgentsByDept } from '@/lib/agents';
import { getDepartmentData } from '@/lib/department-data';
import { getDepartmentKPIs } from '@/lib/department-kpis';
import { getRecentRuns } from '@/lib/run-records';
import { getPublishedContent, getGeneratedAssets, getScoutReports } from '@/lib/marketing-queries';
import { getAgentSpend } from '@/lib/cost-queries';
import { getSchedules } from '@/lib/yclaw-api';
import { getBudgets } from '@/lib/actions/budget';
import { getBudgetConfig } from '@/lib/actions/budget-config';
import { fetchCommits, fetchPosts, getAgentHubHealth } from '@/lib/agenthub-api';
import { getGrowthRuntimeStatus } from '@/lib/runtime-controls';
import { MarketingClient } from './client';

const MARKETING_AGENTS = ['ember', 'forge', 'scout'];

export default async function MarketingPage() {
  const agents = getAgentsByDept('marketing');
  const [live, kpis, recentRuns, publishedContent, forgeAssets, scoutReports, agentSpend, schedules, budgets, budgetConfig, ahExperimentPosts, ahCrossLearnPosts, ahCommits, growthStatus, agentHubHealth] = await Promise.all([
    getDepartmentData(MARKETING_AGENTS),
    getDepartmentKPIs(MARKETING_AGENTS),
    getRecentRuns(MARKETING_AGENTS, 30),
    getPublishedContent(),
    getGeneratedAssets(),
    getScoutReports(),
    getAgentSpend(['ember', 'forge', 'scout']),
    getSchedules(),
    getBudgets(),
    getBudgetConfig(),
    fetchPosts('experiment-results', 50),
    fetchPosts('cross-learn', 50),
    fetchCommits({ limit: 200 }),
    getGrowthRuntimeStatus(),
    getAgentHubHealth(),
  ]);

  return (
    <div>
      <DeptHeader department="marketing" />
      <MarketingClient
        agents={agents}
        live={live}
        kpis={kpis}
        recentRuns={recentRuns}
        publishedContent={publishedContent}
        forgeAssets={forgeAssets}
        scoutReports={scoutReports}
        agentSpend={agentSpend}
        schedules={schedules}
        budgets={budgets}
        budgetMode={budgetConfig.mode}
        ahExperimentPosts={ahExperimentPosts}
        ahCrossLearnPosts={ahCrossLearnPosts}
        ahCommits={ahCommits}
        growthStatus={growthStatus}
        agentHubHealth={agentHubHealth}
      />
    </div>
  );
}
