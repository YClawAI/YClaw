export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { DeptHeader } from '@/components/dept-header';
import { getAgentsByDept } from '@/lib/agents';
import { getDepartmentData } from '@/lib/department-data';
import { getDepartmentKPIs } from '@/lib/department-kpis';
import { getRecentRuns } from '@/lib/run-records';
import { getAgentHeartbeatData } from '@/lib/heartbeat-data';
import { getAgentSpend } from '@/lib/cost-queries';
import { getSchedules } from '@/lib/yclaw-api';
import { getOctokit } from '@/lib/github';
import { redisZcard } from '@/lib/redis';
import { getBuilderQueueTasks, getDispatcherStatus } from '@/lib/builder-queue';
import { getBudgets } from '@/lib/actions/budget';
import { getBudgetConfig } from '@/lib/actions/budget-config';
import { fetchCommits, fetchLeaves, fetchPosts, getAgentHubHealth } from '@/lib/agenthub-api';
import { getExplorationRuntimeStatus } from '@/lib/runtime-controls';
import { getSentinelAudits } from '@/lib/operations-queries';
import { DevelopmentClient } from './client';

const DEV_AGENTS = ['architect', 'designer'] as const;
const DEV_DAG_AGENTS = ['architect', 'designer', 'worker-1', 'worker-2', 'worker-3'] as const;

interface DevelopmentPipelinePR {
  id: string;
  title: string;
  number?: number;
  author?: string;
  status: string;
  stage: string;
  updatedAt?: string;
}

export default async function DevelopmentPage() {
  const agents = getAgentsByDept('development');

  // Fetch live data from Redis/MongoDB
  const [live, kpis, recentRuns, heartbeatData, agentSpend, builderQueue, dispatcherStatus, budgets, budgetConfig, ahCommits, ahLeaves, schedules, explorationStatus, buildDecisionPosts, agentHubHealth, sentinelAudits] = await Promise.all([
    getDepartmentData([...DEV_AGENTS]),
    getDepartmentKPIs([...DEV_AGENTS]),
    getRecentRuns([...DEV_AGENTS], 30),
    getAgentHeartbeatData([...DEV_AGENTS]),
    getAgentSpend([...DEV_AGENTS]),
    getBuilderQueueTasks(),
    getDispatcherStatus(),
    getBudgets(),
    getBudgetConfig(),
    fetchCommits({ limit: 200 }),
    fetchLeaves(),
    getSchedules(),
    getExplorationRuntimeStatus(),
    fetchPosts('build-decisions', 100),
    getAgentHubHealth(),
    getSentinelAudits(),
  ]);

  // F7: Filter commits and leaves to development agents only
  const devAgentSet = new Set<string>(DEV_DAG_AGENTS);
  const devCommits = ahCommits.filter(c => devAgentSet.has(c.agent_id));
  const devLeaves = ahLeaves.filter(c => devAgentSet.has(c.agent_id));

  // Fetch GitHub data
  let github = { openPRs: 0, reviewReady: 0, failingCI: 0 };
  let pipelinePrs: DevelopmentPipelinePR[] = [];
  const octokit = getOctokit();
  if (octokit) {
    try {
      const prs = await octokit.pulls.list({ owner: 'yclaw-ai', repo: 'yclaw', state: 'open', per_page: 30 });
      github.openPRs = prs.data.length;
      github.reviewReady = prs.data.filter(p => p.labels?.some(l => l.name === 'review-ready')).length;
      // Fetch checks + reviews for all PRs in parallel
      const prDetails = await Promise.all(prs.data.map(async (pr) => {
        let stage = pr.draft ? 'branch_opened' : 'review';
        let status = 'active';
        let hasFailing = false;
        try {
          const [checks, reviews] = await Promise.all([
            octokit.checks.listForRef({
              owner: 'yclaw-ai',
              repo: 'yclaw',
              ref: pr.head.sha,
              per_page: 10,
            }),
            octokit.pulls.listReviews({
              owner: 'yclaw-ai',
              repo: 'yclaw',
              pull_number: pr.number,
              per_page: 20,
            }),
          ]);
          hasFailing = checks.data.check_runs.some(
            (c) => c.conclusion === 'failure' || c.conclusion === 'timed_out',
          );
          const hasRunning = checks.data.check_runs.some(
            (c) => c.status !== 'completed' || c.conclusion === null,
          );

          const approvedCount = reviews.data.filter((review) => review.state === 'APPROVED').length;
          const hasChangesRequested = reviews.data.some((review) => review.state === 'CHANGES_REQUESTED');
          const labelNames = new Set((pr.labels ?? []).map((label) => label.name));

          if (hasFailing) {
            stage = 'ci_running';
            status = 'failed';
          } else if (hasRunning || !pr.draft) {
            stage = 'ci_running';
          }

          if (labelNames.has('deployed-prod') || labelNames.has('production')) {
            stage = 'deploy_prod';
          } else if (labelNames.has('deployed-staging') || labelNames.has('staging')) {
            stage = 'deploy_staging';
          } else if (approvedCount > 0) {
            stage = 'approved';
          } else if (hasChangesRequested || !pr.draft) {
            stage = 'review';
          }
        } catch { /* skip individual PR check failures */ }

        const updatedAt = pr.updated_at ?? pr.created_at ?? undefined;
        if (updatedAt && Date.now() - new Date(updatedAt).getTime() > 48 * 3600000 && status !== 'failed') {
          status = 'stalled';
        }

        return {
          pr: {
            id: String(pr.id),
            title: pr.title,
            number: pr.number,
            author: pr.user?.login,
            status,
            stage,
            updatedAt,
          },
          hasFailing,
        };
      }));

      github.failingCI = prDetails.filter((d) => d.hasFailing).length;
      pipelinePrs = prDetails.map((d) => d.pr);
    } catch {}
  }

  // Fetch queue depths (per-key catch so one failure doesn't zero out the rest)
  const queues: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const p of ['P0', 'P1', 'P2', 'P3'] as const) {
    try {
      queues[p] = await redisZcard(`builder:task_queue:${p}`);
    } catch { /* individual queue unavailable */ }
  }

  return (
    <div>
      <DeptHeader department="development" />
      <Suspense fallback={<div className="text-xs text-terminal-dim text-center py-8">Loading development dashboard...</div>}>
        <DevelopmentClient
          agents={agents}
          live={live}
          kpis={kpis}
          github={github}
          queues={queues}
          recentRuns={recentRuns}
          heartbeatData={heartbeatData}
          agentSpend={agentSpend}
          builderQueue={builderQueue}
          dispatcherStatus={dispatcherStatus}
          budgets={budgets}
          budgetMode={budgetConfig.mode}
          ahCommits={devCommits}
          ahLeaves={devLeaves}
          schedules={schedules.filter((schedule) => DEV_DAG_AGENTS.includes(schedule.agentId as typeof DEV_DAG_AGENTS[number]))}
          explorationStatus={explorationStatus}
          ahPosts={buildDecisionPosts}
          agentHubHealth={agentHubHealth}
          pipelinePrs={pipelinePrs}
          sentinelAudits={sentinelAudits}
        />
      </Suspense>
    </div>
  );
}
