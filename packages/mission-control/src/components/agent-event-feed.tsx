'use client';

import { useState } from 'react';
import { useEventStream } from '@/lib/hooks/use-event-stream';

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

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-terminal-blue',
  merged: 'bg-terminal-blue',
  active: 'bg-terminal-green',
  running: 'bg-terminal-green',
  failed: 'bg-terminal-red',
  error: 'bg-terminal-red',
  pending: 'bg-terminal-yellow',
  queued: 'bg-terminal-yellow',
};

export function AgentEventFeed({ agentId, initialRuns }: { agentId: string; initialRuns: RunEntry[] }) {
  const [runs, setRuns] = useState<RunEntry[]>(initialRuns);
  const { connected } = useEventStream({
    'activity:update': (data) => {
      const all = data as RunEntry[];
      // Filter to this agent — treat empty result as authoritative (Fix #7)
      const filtered = all.filter((r) => r.agentId === agentId);
      setRuns(filtered);
    },
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-purple">Live Feed</h2>
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-terminal-green animate-pulse' : 'bg-terminal-dim'}`}
          title={connected ? 'Live' : 'Connecting...'}
        />
      </div>
      {runs.length === 0 ? (
        <div className="text-xs text-terminal-dim">No recent events</div>
      ) : (
        <div className="space-y-1">
          {runs.slice(0, 10).map((run, i) => {
            const dot = STATUS_DOT[run.status?.toLowerCase()] ?? 'bg-terminal-dim';
            return (
              <div key={`${run.createdAt}-${i}`} className="flex items-center gap-2 text-xs py-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
                <span className="text-terminal-text">{run.status}</span>
                {run.taskId && <span className="text-terminal-dim font-mono truncate max-w-[140px]">{run.taskId}</span>}
                {run.cost?.totalUsd != null && (
                  <span className="text-terminal-green">${run.cost.totalUsd.toFixed(4)}</span>
                )}
                <span className="ml-auto text-terminal-dim">{formatTimeAgo(run.createdAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
