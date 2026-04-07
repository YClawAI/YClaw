'use client';

import Link from 'next/link';
import { AGENTS } from '@/lib/agents';

interface EventFeedItemProps {
  agentId: string;
  status: string;
  createdAt: string;
  taskId?: string;
  executionId?: string;
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

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function EventFeedItem({ agentId, status, createdAt, taskId, executionId }: EventFeedItemProps) {
  const agent = AGENTS.find((a) => a.name === agentId);
  const statusStyle = STATUS_STYLES[status?.toLowerCase()] ?? 'bg-terminal-muted/50 text-terminal-dim border-terminal-border';

  return (
    <Link
      href={`/agents/${agentId}`}
      className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-terminal-muted/30 transition-colors cursor-pointer"
    >
      <span className="text-sm">{agent?.emoji || '?'}</span>
      <span className="text-terminal-text font-semibold">{agent?.label || agentId}</span>
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${statusStyle}`}>
        {status}
      </span>
      {taskId && <span className="text-terminal-dim font-mono truncate max-w-[200px]">{taskId}</span>}
      {executionId && (
        <span className="text-terminal-dim/50 font-mono text-[10px] truncate max-w-[120px]" title={executionId}>
          {executionId.slice(0, 8)}
        </span>
      )}
      <span className="ml-auto text-terminal-dim">{formatTimeAgo(createdAt)}</span>
    </Link>
  );
}
