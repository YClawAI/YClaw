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
  active: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
  running: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
  completed: 'bg-terminal-blue/10 text-terminal-blue border-terminal-blue/30',
  merged: 'bg-terminal-blue/10 text-terminal-blue border-terminal-blue/30',
  failed: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30',
  error: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30',
  pending: 'bg-terminal-yellow/10 text-terminal-yellow border-terminal-yellow/30',
  queued: 'bg-terminal-yellow/10 text-terminal-yellow border-terminal-yellow/30',
};

export function LiveActivity({ initialRuns }: { initialRuns: RunEntry[] }) {
  const [runs, setRuns] = useState<RunEntry[]>(initialRuns);
  const { connected } = useEventStream({
    'activity:update': (data) => {
      setRuns(data as RunEntry[]);
    },
  });

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Recent Activity</h2>
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-terminal-green animate-pulse' : 'bg-terminal-dim'}`} title={connected ? 'Live' : 'Connecting...'} />
      </div>
      {runs.length === 0 ? (
        <div className="p-4 text-xs text-terminal-dim text-center">No recent activity</div>
      ) : (
        <div className="divide-y divide-terminal-border">
          {runs.map((run, i) => {
            const agent = AGENTS.find((a) => a.name === run.agentId);
            const statusStyle = STATUS_STYLES[run.status?.toLowerCase()] ?? 'bg-terminal-muted/50 text-terminal-dim border-terminal-border';
            return (
              <div key={`${run.createdAt}-${i}`} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-terminal-muted/30 transition-colors">
                <span className="text-sm">{agent?.emoji || '?'}</span>
                <a href={`/agents/${run.agentId}`} className="text-terminal-text font-semibold hover:text-terminal-purple">
                  {agent?.label || run.agentId}
                </a>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${statusStyle}`}>
                  {run.status}
                </span>
                {run.taskId && <span className="text-terminal-dim font-mono truncate max-w-[200px]">{run.taskId}</span>}
                {run.executionId && (
                  <span className="text-terminal-dim/50 font-mono text-[10px] truncate max-w-[120px]" title={run.executionId}>
                    {run.executionId.slice(0, 8)}
                  </span>
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
