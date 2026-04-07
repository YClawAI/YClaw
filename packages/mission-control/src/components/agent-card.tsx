'use client';

import Link from 'next/link';
import { StatusDot } from './status-dot';
import { SystemBadge } from './system-badge';
import type { AgentInfo, Department } from '@/lib/agents';
import { DEPT_BORDER_COLORS } from '@/lib/agents';

type AgentStatus = 'active' | 'idle' | 'error' | 'blocked' | 'processing';

interface AgentCardProps {
  agent: AgentInfo;
  status?: AgentStatus;
  currentTask?: string;
  queueSize?: number;
  lastOutput?: string;
  sessionCount?: number;
}

export function AgentCard({ agent, status = 'idle', currentTask, queueSize, lastOutput, sessionCount }: AgentCardProps) {
  const borderColor = DEPT_BORDER_COLORS[agent.department as Department] ?? 'border-terminal-border';

  return (
    <Link
      href={`/departments/${agent.department}?agent=${agent.name}`}
      className={`block bg-terminal-surface border border-terminal-border rounded p-4 border-l-2 ${borderColor} hover:border-terminal-text/30 transition-colors cursor-pointer`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {agent.emoji && <span className="text-lg">{agent.emoji}</span>}
          <span className="font-bold text-terminal-text text-sm">{agent.label}</span>
          <StatusDot status={status} />
        </div>
        <SystemBadge system={agent.system} />
      </div>

      {currentTask && (
        <div className="text-xs text-terminal-text mb-2 truncate" title={currentTask}>
          Current: {currentTask}
        </div>
      )}

      <p className="text-xs text-terminal-dim mb-3">{agent.description}</p>

      <div className="flex items-center gap-3 text-[10px] text-terminal-dim font-mono">
        {queueSize != null && queueSize > 0 && (
          <span>Queue: {queueSize}</span>
        )}
        {sessionCount != null && sessionCount > 0 && (
          <span className="text-terminal-cyan">{sessionCount} session{sessionCount !== 1 ? 's' : ''}</span>
        )}
        {lastOutput && <span className="ml-auto">{lastOutput}</span>}
      </div>
    </Link>
  );
}
