import { getRedis } from './redis';
import { AGENTS } from './agents';

export type AgentStatus = 'active' | 'idle' | 'error' | 'offline';

export async function getAllAgentStatuses(): Promise<Record<string, AgentStatus>> {
  const redis = getRedis();
  const result: Record<string, AgentStatus> = {};

  for (const agent of AGENTS) {
    if (!redis) {
      result[agent.name] = 'offline';
      continue;
    }
    try {
      const status = await redis.hget(`agent:status:${agent.name}`, 'state');
      result[agent.name] = (status as AgentStatus) || 'offline';
    } catch {
      result[agent.name] = 'offline';
    }
  }
  return result;
}
