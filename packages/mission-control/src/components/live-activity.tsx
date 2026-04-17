'use client';

import { useState } from 'react';
import { useEventStream } from '@/lib/hooks/use-event-stream';
import { AGENTS } from '@/lib/agents';

interface RunEntry {
  agentId: string;
  status: string;
  createdAt: string;
  taskId?: string;
  executionId?: string;
  cost?: { totalUsd?: number };
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'border-mc-success/40 text-mc-success bg-mc-success/10',
  running: 'border-mc-success/40 text-mc-success bg-mc-success/10',
  completed: 'border-mc-info/40 text-mc-info bg-mc-info/10',
  merged: 'border-mc-info/40 text-mc-info bg-mc-info/10',
  failed: 'border-mc-danger/40 text-mc-danger bg-mc-danger/10',
  error: 'border-mc-danger/40 text-mc-danger bg-mc-danger/10',
  pending: 'border-mc-warning/40 text-mc-warning bg-mc-warning/10',
  queued: 'border-mc-warning/40 text-mc-warning bg-mc-warning/10',
};

export function LiveActivity({ initialRuns }: { initialRuns: RunEntry[] }) {
  const [runs, setRuns] = useState<RunEntry[]>(initialRuns);
  const { connected } = useEventStream({
    'activity:update': (data) => {
      setRuns(data as RunEntry[]);
    },
  });

  return (
    <div className="border border-mc-border rounded-panel bg-transparent transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
      <div className="px-4 py-3 border-b border-mc-border flex items-center justify-between">
        <h2 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">Recent Activity</h2>
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-mc-success animate-mc-pulse shadow-[0_0_6px_currentColor]' : 'bg-mc-text-tertiary'}`}
          title={connected ? 'Live' : 'Connecting...'}
        />
      </div>
      {runs.length === 0 ? (
        <div className="p-4 font-sans text-xs text-mc-text-tertiary text-center">No recent activity</div>
      ) : (
        <div className="divide-y divide-mc-border">
          {runs.map((run, i) => {
            const agent = AGENTS.find((a) => a.name === run.agentId);
            const statusStyle = STATUS_STYLES[run.status?.toLowerCase()] ?? 'border-mc-border text-mc-text-secondary bg-transparent';
            return (
              <div
                key={`${run.createdAt}-${i}`}
                className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-mc-surface-hover transition-colors duration-mc ease-mc-out"
              >
                <span className="text-sm">{agent?.emoji || '?'}</span>
                <a
                  href={`/agents/${run.agentId}`}
                  className="font-sans text-mc-text font-medium hover:text-mc-accent transition-colors duration-mc ease-mc-out"
                >
                  {agent?.label || run.agentId}
                </a>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-badge font-sans text-[10px] font-medium uppercase tracking-label border ${statusStyle}`}
                >
                  {run.status}
                </span>
                {run.taskId && (
                  <span className="font-mono text-xs text-mc-text-secondary truncate max-w-[200px]">
                    {run.taskId}
                  </span>
                )}
                {run.executionId && (
                  <span
                    className="font-mono text-[10px] text-mc-text-tertiary truncate max-w-[120px]"
                    title={run.executionId}
                  >
                    {run.executionId.slice(0, 8)}
                  </span>
                )}
                <span className="ml-auto font-mono tabular-nums text-[11px] text-mc-text-tertiary">
                  {formatTimeAgo(run.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
