'use client';

import { StatusDot } from './status-dot';
import { SystemBadge } from './system-badge';
import type { AgentInfo, Department } from '@/lib/agents';
import { DEPT_BORDER_COLORS } from '@/lib/agents';

interface SupportAgentCardProps {
  agent: AgentInfo;
  status?: string;
  lastRunAt?: string;
  runCount24h?: number;
}

export function SupportAgentCard({ agent, status, lastRunAt, runCount24h }: SupportAgentCardProps) {
  const borderColor = DEPT_BORDER_COLORS[agent.department as Department] ?? 'border-terminal-border';
  const dotStatus = status === 'active' ? 'active' : status === 'error' ? 'error' : 'idle';

  return (
    <div className={`bg-terminal-surface border border-terminal-border rounded p-4 border-l-2 ${borderColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {agent.emoji && <span className="text-lg">{agent.emoji}</span>}
          <span className="font-bold text-terminal-text text-sm">{agent.label}</span>
          <StatusDot status={dotStatus} />
          {agent.role === 'lead' && (
            <span className="text-[10px] font-mono text-terminal-yellow border border-terminal-yellow/40 px-1 py-0.5 rounded bg-terminal-yellow/10">
              LEAD
            </span>
          )}
        </div>
        <SystemBadge system={agent.system} />
      </div>

      <p className="text-xs text-terminal-dim mb-3">{agent.description}</p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-sm font-bold text-terminal-text font-mono">{runCount24h ?? 0}</div>
          <div className="text-[10px] text-terminal-dim">runs (24h)</div>
        </div>
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-sm font-bold text-terminal-text font-mono truncate">
            {lastRunAt ? new Date(lastRunAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'}
          </div>
          <div className="text-[10px] text-terminal-dim">last run</div>
        </div>
      </div>
    </div>
  );
}
