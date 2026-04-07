import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { AGENTS } from '@/lib/agents';
import type { AgentRealtimeStatus } from '@/components/hive/hive-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json([] as AgentRealtimeStatus[]);
  }

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const statuses: AgentRealtimeStatus[] = [];

  for (const agent of AGENTS) {
    try {
      const [statusRaw, execCount] = await Promise.all([
        redis.hgetall(`agent:status:${agent.name}`),
        redis.zcount(`agent:executions:${agent.name}`, fiveMinAgo, '+inf'),
      ]);

      statuses.push({
        agentName: agent.name,
        state: (statusRaw?.state as AgentRealtimeStatus['state']) || 'idle',
        execCount5m: execCount || 0,
        lastRunAt: statusRaw?.lastRunAt ? Number(statusRaw.lastRunAt) : null,
        lastSuccessAt: statusRaw?.lastSuccessAt ? Number(statusRaw.lastSuccessAt) : 0,
        lastErrorAt: statusRaw?.lastErrorAt ? Number(statusRaw.lastErrorAt) : 0,
      });
    } catch {
      statuses.push({
        agentName: agent.name,
        state: 'idle',
        execCount5m: 0,
        lastRunAt: null,
        lastSuccessAt: 0,
        lastErrorAt: 0,
      });
    }
  }

  return NextResponse.json(statuses);
}
