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
  const borderColor = DEPT_BORDER_COLORS[agent.department as Department] ?? 'border-mc-border';
  const dotStatus = status === 'active' ? 'active' : status === 'error' ? 'error' : 'idle';

  return (
    <div className={`bg-mc-surface-hover border border-mc-border rounded p-4 border-l-2 ${borderColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {agent.emoji && <span className="text-lg">{agent.emoji}</span>}
          <span className="font-bold text-mc-text text-sm">{agent.label}</span>
          <StatusDot status={dotStatus} />
          {agent.role === 'lead' && (
            <span className="text-[10px] font-mono text-mc-warning border border-mc-warning/40 px-1 py-0.5 rounded bg-mc-warning/10">
              LEAD
            </span>
          )}
        </div>
        <SystemBadge system={agent.system} />
      </div>

      <p className="text-xs text-mc-text-tertiary mb-3">{agent.description}</p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-mc-bg rounded p-2">
          <div className="text-sm font-bold text-mc-text font-mono">{runCount24h ?? 0}</div>
          <div className="text-[10px] text-mc-text-tertiary">runs (24h)</div>
        </div>
        <div className="bg-mc-bg rounded p-2">
          <div className="text-sm font-bold text-mc-text font-mono truncate">
            {lastRunAt ? new Date(lastRunAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'}
          </div>
          <div className="text-[10px] text-mc-text-tertiary">last run</div>
        </div>
      </div>
    </div>
  );
}
