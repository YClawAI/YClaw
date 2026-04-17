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
  active: 'bg-mc-success/10 text-mc-success border-mc-success/30',
  running: 'bg-mc-success/10 text-mc-success border-mc-success/30',
  completed: 'bg-mc-info/10 text-mc-info border-mc-info/30',
  merged: 'bg-mc-info/10 text-mc-info border-mc-info/30',
  failed: 'bg-mc-danger/10 text-mc-danger border-mc-danger/30',
  error: 'bg-mc-danger/10 text-mc-danger border-mc-danger/30',
  pending: 'bg-mc-warning/10 text-mc-warning border-mc-warning/30',
  queued: 'bg-mc-warning/10 text-mc-warning border-mc-warning/30',
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
  const statusStyle = STATUS_STYLES[status?.toLowerCase()] ?? 'bg-mc-border/50 text-mc-text-tertiary border-mc-border';

  return (
    <Link
      href={`/agents/${agentId}`}
      className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-mc-border/30 transition-colors cursor-pointer"
    >
      <span className="text-sm">{agent?.emoji || '?'}</span>
      <span className="text-mc-text font-semibold">{agent?.label || agentId}</span>
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${statusStyle}`}>
        {status}
      </span>
      {taskId && <span className="text-mc-text-tertiary font-mono truncate max-w-[200px]">{taskId}</span>}
      {executionId && (
        <span className="text-mc-text-tertiary/50 font-mono text-[10px] truncate max-w-[120px]" title={executionId}>
          {executionId.slice(0, 8)}
        </span>
      )}
      <span className="ml-auto text-mc-text-tertiary">{formatTimeAgo(createdAt)}</span>
    </Link>
  );
}
