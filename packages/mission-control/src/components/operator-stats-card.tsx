'use client';

import type { OperatorWithStats } from '@/types/operators';
import { STATUS_COLORS } from '@/types/operators';

function relativeTime(dateStr: string | undefined): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface OperatorStatsCardProps {
  operator: OperatorWithStats;
  compact?: boolean;
  onClick?: () => void;
}

export function OperatorStatsCard({ operator, compact, onClick }: OperatorStatsCardProps) {
  const { stats } = operator;
  const hasDenials = stats.deniedRequests > 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-lg border border-mc-border bg-mc-surface-hover hover:bg-mc-border transition-colors"
    >
      {/* Header — only uses fields the activity endpoint provides */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[operator.status]}`} />
        <span className="text-sm font-mono font-medium text-mc-text truncate">
          {operator.displayName}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] text-mc-text-tertiary font-mono">{operator.role}</span>
        <span className="text-[10px] text-mc-text-tertiary font-mono">
          {relativeTime(operator.lastActiveAt)}
        </span>
      </div>

      {/* Stats — all fields come from the activity endpoint stats object */}
      {!compact && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-mc-text-tertiary">Tasks today</span>
            <span className="text-mc-text">{stats.tasksToday}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-mc-text-tertiary">This week</span>
            <span className="text-mc-text">{stats.tasksThisWeek}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-mc-text-tertiary">Denied</span>
            <span className={hasDenials ? 'text-yellow-500' : 'text-mc-text'}>
              {stats.deniedRequests}
            </span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-mc-text-tertiary">Pending approvals</span>
            <span className="text-mc-text">{stats.pendingApprovals}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-mc-text-tertiary">Active locks</span>
            <span className="text-mc-text">{stats.activeLocks}</span>
          </div>
        </div>
      )}

      {/* Compact stats */}
      {compact && (
        <div className="flex gap-3 text-[10px] font-mono text-mc-text-tertiary">
          <span>{stats.tasksToday} tasks</span>
          {hasDenials && <span className="text-yellow-500">{stats.deniedRequests} denied</span>}
          {stats.activeLocks > 0 && <span>{stats.activeLocks} locks</span>}
        </div>
      )}
    </button>
  );
}
