'use client';

import { useState } from 'react';
import { useEventStream } from '@/lib/hooks/use-event-stream';
import { EventFeedItem } from './event-feed-item';

interface RunEntry {
  agentId: string;
  status: string;
  createdAt: string;
  taskId?: string;
  executionId?: string;
}

interface EventFeedProps {
  initialRuns: RunEntry[];
  filterDept?: string;
  agentNames?: string[];
}

export function EventFeed({ initialRuns, agentNames }: EventFeedProps) {
  const [runs, setRuns] = useState<RunEntry[]>(initialRuns);
  const { connected } = useEventStream({
    'activity:update': (data) => {
      let entries = data as RunEntry[];
      if (agentNames && agentNames.length > 0) {
        entries = entries.filter((r) => agentNames.includes(r.agentId));
      }
      if (entries.length > 0) {
        setRuns((prev) => {
          const existing = new Set(prev.map((r) => `${r.agentId}:${r.createdAt}`));
          const novel = entries.filter((r) => !existing.has(`${r.agentId}:${r.createdAt}`));
          return [...novel, ...prev].slice(0, 100);
        });
      }
    },
  });

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Activity</h2>
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-terminal-green animate-pulse' : 'bg-terminal-dim'}`}
          title={connected ? 'Live' : 'Connecting...'}
        />
      </div>
      {runs.length === 0 ? (
        <div className="p-4 text-xs text-terminal-dim text-center">No recent activity</div>
      ) : (
        <div className="divide-y divide-terminal-border">
          {runs.map((run, i) => (
            <EventFeedItem
              key={`${run.createdAt}-${i}`}
              agentId={run.agentId}
              status={run.status}
              createdAt={run.createdAt}
              taskId={run.taskId}
              executionId={run.executionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
