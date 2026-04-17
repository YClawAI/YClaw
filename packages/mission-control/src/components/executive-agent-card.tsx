'use client';

import { AgentCard } from './agent-card';
import type { AgentInfo } from '@/lib/agents';

interface ExecutiveAgentCardProps {
  agent: AgentInfo;
  status?: string;
  lastRunAt?: string;
  currentTask?: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const STATUS_DOT: Record<string, { color: string; pulse: boolean }> = {
  idle: { color: 'bg-mc-border', pulse: false },
  active: { color: 'bg-mc-success', pulse: true },
  error: { color: 'bg-mc-danger', pulse: false },
  unknown: { color: 'bg-mc-text-tertiary', pulse: false },
};

export function ExecutiveAgentCard({ agent, status, lastRunAt, currentTask }: ExecutiveAgentCardProps) {
  const cardStatus =
    status === 'active' ? 'active' :
    status === 'error' ? 'error' :
    'idle';

  return (
    <div className="relative">
      <AgentCard
        agent={agent}
        status={cardStatus}
        currentTask={currentTask}
      />

      {/* Extended info overlay */}
      <div className="mt-px bg-mc-surface-hover border border-t-0 border-mc-border rounded-b px-4 py-2.5 space-y-1.5">
        {/* Status dot */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-mc-text-tertiary">Status:</span>
          <span
            className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[status ?? 'unknown']?.color ?? 'bg-mc-text-tertiary'} ${
              STATUS_DOT[status ?? 'unknown']?.pulse ? 'animate-pulse' : ''
            }`}
          />
          <span className="text-[10px] text-mc-text-tertiary">
            {status ?? 'unknown'}
          </span>
        </div>
        {/* Last run */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-mc-text-tertiary">Last run:</span>
          <span className="text-[10px] font-mono text-mc-accent">
            {lastRunAt ? formatRelativeTime(lastRunAt) : 'never'}
          </span>
        </div>
        {/* Current task */}
        {currentTask && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-mc-text-tertiary shrink-0">Task:</span>
            <span className="text-[10px] text-mc-text truncate">{currentTask}</span>
          </div>
        )}
      </div>
    </div>
  );
}
