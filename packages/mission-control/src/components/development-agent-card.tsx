'use client';

import Link from 'next/link';
import { StatusDot } from './status-dot';
import { SystemBadge } from './system-badge';
import type { AgentInfo, Department } from '@/lib/agents';
import { DEPT_BORDER_COLORS } from '@/lib/agents';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AgentStatus = 'active' | 'idle' | 'error' | 'blocked' | 'processing';

// ─── Main Component ──────────────────────────────────────────────────────────

interface DevelopmentAgentCardProps {
  agent: AgentInfo;
  status?: AgentStatus;
  lastRunAt?: string;
  currentTask?: string;
}

export function DevelopmentAgentCard({
  agent,
  status = 'idle',
  lastRunAt,
  currentTask,
}: DevelopmentAgentCardProps) {
  const borderColor = DEPT_BORDER_COLORS[agent.department as Department] ?? 'border-terminal-border';

  return (
    <div className={`bg-terminal-surface border border-terminal-border rounded p-4 border-l-2 ${borderColor}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {agent.emoji && <span className="text-lg">{agent.emoji}</span>}
          <span className="font-bold text-terminal-text text-sm">{agent.label}</span>
          {agent.role === 'lead' && (
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30">
              LEAD
            </span>
          )}
          <StatusDot status={status} />
        </div>
        <SystemBadge system={agent.system} />
      </div>

      {currentTask && (
        <div className="text-xs text-terminal-text mb-2 truncate" title={currentTask}>
          Current: {currentTask}
        </div>
      )}

      <p className="text-xs text-terminal-dim mb-1">{agent.description}</p>

      {lastRunAt && (
        <div className="mt-2 text-[10px] text-terminal-dim">
          Last run: {lastRunAt}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <Link
          href={`/departments/development?agent=${agent.name}`}
          className="px-2 py-1 text-[10px] font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text transition-colors"
        >
          Details
        </Link>
      </div>
    </div>
  );
}
