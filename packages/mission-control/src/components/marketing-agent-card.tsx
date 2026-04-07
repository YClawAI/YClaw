'use client';

import { AgentCard } from '@/components/agent-card';
import type { AgentInfo } from '@/lib/agents';

interface MarketingAgentCardProps {
  agent: AgentInfo;
  status?: string;
  lastRunAt?: string;
  runCount24h?: number;
}

export function MarketingAgentCard({ agent, status, lastRunAt, runCount24h }: MarketingAgentCardProps) {
  const agentStatus =
    status === 'active' ? 'active' :
    status === 'error' ? 'error' :
    'idle';

  return (
    <AgentCard
      agent={agent}
      status={agentStatus}
      lastOutput={
        lastRunAt
          ? `Last run ${new Date(lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : undefined
      }
      queueSize={runCount24h}
    />
  );
}
