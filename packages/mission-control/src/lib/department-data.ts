import { getDb } from './mongodb';
import { getRedis } from './redis';

export interface AgentLiveStatus {
  name: string;
  state: 'idle' | 'active' | 'error' | 'unknown';
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  execCount24h: number;
}

export interface RecentRun {
  agentId: string;
  status: string;
  createdAt: string;
  taskId?: string;
  cost?: number;
}

export interface DepartmentBaseData {
  agents: AgentLiveStatus[];
  recentRuns: RecentRun[];
  spend7d: number;
  spend30d: number;
}

/**
 * Fetch live agent status + recent runs for a set of agent names.
 * Gracefully returns empty/zero if data sources are unavailable.
 */
export async function getDepartmentData(agentNames: string[]): Promise<DepartmentBaseData> {
  const redis = getRedis();
  const db = await getDb();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Agent statuses from Redis
  const agents: AgentLiveStatus[] = [];
  for (const name of agentNames) {
    if (redis) {
      try {
        const [statusRaw, execCount] = await Promise.all([
          redis.hgetall(`agent:status:${name}`),
          redis.zcount(`agent:executions:${name}`, oneDayAgo, '+inf'),
        ]);
        agents.push({
          name,
          state: (statusRaw?.state as AgentLiveStatus['state']) || 'unknown',
          lastRunAt: statusRaw?.lastRunAt ? Number(statusRaw.lastRunAt) : null,
          lastSuccessAt: statusRaw?.lastSuccessAt ? Number(statusRaw.lastSuccessAt) : null,
          lastErrorAt: statusRaw?.lastErrorAt ? Number(statusRaw.lastErrorAt) : null,
          execCount24h: execCount || 0,
        });
      } catch {
        agents.push({ name, state: 'unknown', lastRunAt: null, lastSuccessAt: null, lastErrorAt: null, execCount24h: 0 });
      }
    } else {
      agents.push({ name, state: 'unknown', lastRunAt: null, lastSuccessAt: null, lastErrorAt: null, execCount24h: 0 });
    }
  }

  // Recent runs from MongoDB
  let recentRuns: RecentRun[] = [];
  if (db) {
    try {
      const runs = await db
        .collection('run_records')
        .find({ agentId: { $in: agentNames } })
        .sort({ createdAt: -1 })
        .limit(30)
        .toArray();
      recentRuns = runs.map((r) => ({
        agentId: r.agentId as string,
        status: r.status as string,
        createdAt: r.createdAt as string,
        ...(r.taskId ? { taskId: r.taskId as string } : {}),
        ...(r.cost?.totalUsd != null ? { cost: r.cost.totalUsd as number } : {}),
      }));
    } catch { /* graceful */ }
  }

  // Spend from MongoDB
  let spend7d = 0;
  let spend30d = 0;
  if (db) {
    try {
      const now = new Date();
      const d7 = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
      const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const spendDocs = await db
        .collection('org_spend_daily')
        .find({ date: { $gte: d30 }, agent: { $in: agentNames } })
        .toArray();
      for (const doc of spendDocs) {
        const usd = Number(doc.totalUsd) || 0;
        spend30d += usd;
        if (doc.date >= d7) spend7d += usd;
      }
    } catch { /* graceful */ }
  }

  return { agents, recentRuns, spend7d: Math.round(spend7d * 100) / 100, spend30d: Math.round(spend30d * 100) / 100 };
}
