export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { DeptHeader } from '@/components/dept-header';
import { getAgentsByDept } from '@/lib/agents';
import { getDepartmentData } from '@/lib/department-data';
import { getDepartmentKPIs } from '@/lib/department-kpis';
import { getRecentRuns } from '@/lib/run-records';
import { getAgentSpend } from '@/lib/cost-queries';
import { getBudgets } from '@/lib/actions/budget';
import { getBudgetConfig } from '@/lib/actions/budget-config';
import { SupportClient } from './client';

export default async function SupportPage() {
  const agents = getAgentsByDept('support');
  const [live, kpis, keeperKpis, recentRuns, agentSpend, budgets, budgetConfig] = await Promise.all([
    getDepartmentData(['keeper', 'guide']),
    getDepartmentKPIs(['keeper', 'guide']),
    getDepartmentKPIs(['keeper']),
    getRecentRuns(['keeper', 'guide'], 30),
    getAgentSpend(['keeper', 'guide']),
    getBudgets(),
    getBudgetConfig(),
  ]);

  // Use uncapped countDocuments from getDepartmentKPIs instead of filtering capped recentRuns
  const now = new Date();
  const keeperRuns24h = keeperKpis.runCount24h;

  // Derive community temperature from keeper activity
  const communityTemp: { level: string; score: number; factors: string[]; lastUpdated: string } =
    keeperRuns24h >= 31
      ? { level: 'crisis', score: 95, factors: [`${keeperRuns24h} keeper interventions in 24h`], lastUpdated: now.toISOString() }
      : keeperRuns24h >= 16
        ? { level: 'heated', score: 75, factors: [`${keeperRuns24h} keeper interventions in 24h`], lastUpdated: now.toISOString() }
        : keeperRuns24h >= 6
          ? { level: 'active', score: 50, factors: [`${keeperRuns24h} keeper interventions in 24h`], lastUpdated: now.toISOString() }
          : { level: 'calm', score: 20, factors: [`${keeperRuns24h} keeper interventions in 24h`], lastUpdated: now.toISOString() };

  return (
    <div>
      <DeptHeader department="support" />
      <Suspense fallback={<div className="text-xs text-terminal-dim text-center py-8">Loading support dashboard...</div>}>
        <SupportClient agents={agents} live={live} kpis={kpis} recentRuns={recentRuns} communityTemp={communityTemp} agentSpend={agentSpend} budgets={budgets} budgetMode={budgetConfig.mode} />
      </Suspense>
    </div>
  );
}
