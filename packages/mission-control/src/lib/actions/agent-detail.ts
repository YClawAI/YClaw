'use server';

import { getRecentRuns } from '@/lib/run-records';
import { getDepartmentKPIs } from '@/lib/department-kpis';
import { getDb } from '@/lib/mongodb';
import { getAgentSchedules } from '@/lib/yclaw-api';
import type { RunRecord } from '@/lib/run-records';
import type { DepartmentKPIs } from '@/lib/department-kpis';
import type { CronSchedule } from '@/lib/yclaw-api';

export interface AgentDetailData {
  recentRuns: RunRecord[];
  kpis: DepartmentKPIs;
  costSparkline: { date: string; cents: number }[];
  schedules: CronSchedule[];
}

export async function getAgentDetail(agentId: string): Promise<AgentDetailData> {
  const [recentRuns, kpis, schedules] = await Promise.all([
    getRecentRuns([agentId], 10),
    getDepartmentKPIs([agentId]),
    getAgentSchedules(agentId),
  ]);

  const db = await getDb();
  let costSparkline: { date: string; cents: number }[] = [];
  if (db) {
    try {
      const d7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const docs = await db.collection('org_spend_daily')
        .find({ agent: agentId, date: { $gte: d7 } })
        .sort({ date: 1 })
        .toArray();
      costSparkline = docs.map(d => ({
        date: d.date as string,
        cents: Math.round((Number(d.totalUsd) || 0) * 100),
      }));
    } catch { /* graceful */ }
  }

  return { recentRuns, kpis, costSparkline, schedules };
}
