import { getDb } from './mongodb';

export interface HourlyBucket {
  hour: number;
  status: 'ran' | 'error' | 'idle';
  count: number;
}

export interface AgentHeartbeatData {
  agentId: string;
  buckets: HourlyBucket[];
}

export async function getAgentHeartbeatData(agentNames: string[]): Promise<AgentHeartbeatData[]> {
  const db = await getDb();
  if (!db) {
    return agentNames.map(name => ({
      agentId: name,
      buckets: Array.from({ length: 24 }, (_, h) => ({ hour: h, status: 'idle' as const, count: 0 })),
    }));
  }

  const h24ago = new Date(Date.now() - 24 * 3600000);
  const results: AgentHeartbeatData[] = [];

  for (const agentId of agentNames) {
    try {
      const runs = await db.collection('run_records')
        .find({ agentId, createdAt: { $gte: h24ago } })
        .project({ createdAt: 1, status: 1 })
        .toArray();

      const bucketMap = new Map<number, { ran: number; error: number }>();
      for (const run of runs) {
        const hour = new Date(run.createdAt as string | number | Date).getUTCHours();
        const entry = bucketMap.get(hour) || { ran: 0, error: 0 };
        if (run.status === 'error') entry.error++;
        else entry.ran++;
        bucketMap.set(hour, entry);
      }

      const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, h) => {
        const entry = bucketMap.get(h);
        if (!entry) return { hour: h, status: 'idle' as const, count: 0 };
        if (entry.error > 0) return { hour: h, status: 'error' as const, count: entry.error };
        return { hour: h, status: 'ran' as const, count: entry.ran };
      });

      results.push({ agentId, buckets });
    } catch {
      results.push({
        agentId,
        buckets: Array.from({ length: 24 }, (_, h) => ({ hour: h, status: 'idle' as const, count: 0 })),
      });
    }
  }

  return results;
}
