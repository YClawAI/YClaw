'use client';

import { useState, useEffect, useMemo } from 'react';
import type { TaskLock } from '@/types/operators';
import { DEPT_COLORS, type Department } from '@/lib/agents';
import { useToastStore } from '@/stores/toast-store';
import { useLocks, useReleaseLock, useOperators } from '@/hooks/use-operators';
import { ChevronDown, ChevronRight } from '@/components/icons';

function timeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function resourceKeyColor(key: string): string {
  const prefix = key.split(':')[0] ?? '';
  const deptMap: Record<string, Department> = {
    executive: 'executive', exec: 'executive',
    development: 'development', dev: 'development',
    marketing: 'marketing', mkt: 'marketing',
    operations: 'operations', ops: 'operations',
    finance: 'finance', fin: 'finance',
    support: 'support',
  };
  const dept = deptMap[prefix];
  return dept ? DEPT_COLORS[dept] : 'text-terminal-text';
}

interface OperatorInfo {
  displayName: string;
  role: string;
}

function LockRow({
  lock,
  operatorInfo,
  onRelease,
}: {
  lock: TaskLock;
  operatorInfo?: OperatorInfo;
  onRelease: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  // Live countdown via tick state
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const remaining = timeRemaining(lock.expiresAt);
  const isExpired = remaining === 'expired';
  const operatorLabel = operatorInfo
    ? `${operatorInfo.displayName} (${operatorInfo.role})`
    : lock.operatorId;

  return (
    <div className="border-b border-terminal-border last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 hover:bg-terminal-muted transition-colors"
      >
        <div className="flex items-center gap-4">
          <span className={`text-xs font-mono shrink-0 w-48 truncate ${resourceKeyColor(lock.resourceKey)}`}>
            {lock.resourceKey}
          </span>
          <span className="text-xs font-mono text-terminal-text shrink-0 w-36 truncate">
            {operatorLabel}
          </span>
          <span className="text-[10px] font-mono text-terminal-dim shrink-0 w-12 text-center">
            P{lock.priority}
          </span>
          <span className={`text-[10px] font-mono shrink-0 w-16 text-right ${isExpired ? 'text-terminal-red' : 'text-terminal-text'}`}>
            {remaining}
          </span>
          <span className="text-[10px] text-terminal-dim ml-auto">
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 ml-4 space-y-1.5">
          <div className="text-[10px] font-mono">
            <span className="text-terminal-dim">Task ID: </span>
            <span className="text-terminal-text">{lock.taskId}</span>
          </div>
          <div className="text-[10px] font-mono">
            <span className="text-terminal-dim">Acquired: </span>
            <span className="text-terminal-text">{formatTimestamp(lock.acquiredAt)}</span>
          </div>
          <div className="text-[10px] font-mono">
            <span className="text-terminal-dim">Expires: </span>
            <span className="text-terminal-text">{formatTimestamp(lock.expiresAt)}</span>
          </div>
          <div className="text-[10px] font-mono">
            <span className="text-terminal-dim">Resource: </span>
            <span className="text-terminal-text">{lock.resourceKey}</span>
          </div>

          {!confirmRelease && (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmRelease(true); }}
              className="mt-2 px-3 py-1 text-[10px] font-mono rounded border border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10 transition-colors"
            >
              Force Release
            </button>
          )}
          {confirmRelease && (
            <div className="mt-2 p-3 rounded border border-terminal-red/30 bg-terminal-red/5">
              <p className="text-[10px] text-terminal-text font-mono mb-2">
                This will release the lock but NOT cancel the task. The task will continue but other operators can now work on this resource.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onRelease(lock.resourceKey); setConfirmRelease(false); }}
                  className="px-3 py-1 text-[10px] font-mono rounded border border-terminal-red/50 bg-terminal-red/10 text-terminal-red hover:bg-terminal-red/20 transition-colors"
                >
                  Confirm Release
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmRelease(false); }}
                  className="px-3 py-1 text-[10px] font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LocksClient({
  initialLocks,
  initialNote,
}: {
  initialLocks?: TaskLock[];
  initialNote?: string;
}) {
  const { data: locksData, error: queryError, isLoading } = useLocks(
    initialLocks ? { locks: initialLocks, note: initialNote } : undefined,
  );
  const { data: operators } = useOperators();
  const releaseMutation = useReleaseLock();
  const addToast = useToastStore((s) => s.add);

  const locks = locksData?.locks ?? [];
  const note = locksData?.note;
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : undefined;

  const operatorMap = useMemo(() => {
    const map: Record<string, OperatorInfo> = {};
    for (const op of operators ?? []) {
      map[op.operatorId] = { displayName: op.displayName, role: op.role };
    }
    return map;
  }, [operators]);

  const handleRelease = async (resourceKey: string) => {
    try {
      const data = await releaseMutation.mutateAsync(resourceKey);
      addToast('success', data.released ? `Released lock: ${resourceKey}` : 'Lock was already released');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to release');
    }
  };

  const loading = isLoading;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-terminal-text tracking-wide">
          Resource Locks
        </h1>
        {locks.length > 0 && (
          <span className="text-[10px] font-mono text-terminal-dim bg-terminal-muted px-2 py-0.5 rounded">
            Active: {locks.length}
          </span>
        )}
      </div>

      {note && (
        <div className="mb-4 px-3 py-2 rounded border border-terminal-yellow/30 bg-terminal-yellow/5 text-[10px] font-mono text-terminal-yellow">
          {note}
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-terminal-red/30 bg-terminal-red/5">
          <div className="text-xs font-mono text-terminal-red">{error}</div>
          <button onClick={() => window.location.reload()} className="mt-2 text-[10px] font-mono text-terminal-text border border-terminal-border rounded px-2 py-1 hover:bg-terminal-muted transition-colors">Retry</button>
        </div>
      )}

      {loading && !error && (
        <div className="text-center py-16 text-terminal-dim text-xs font-mono">Loading...</div>
      )}

      {!loading && locks.length > 0 && (
        <div>
          {/* Table header */}
          <div className="flex items-center gap-4 px-4 py-2 text-[10px] font-mono text-terminal-dim uppercase tracking-wider border-b border-terminal-border">
            <span className="w-48">Resource Key</span>
            <span className="w-36">Operator</span>
            <span className="w-12 text-center">Priority</span>
            <span className="w-16 text-right">Expires</span>
          </div>
          <div className="border border-terminal-border rounded-lg bg-terminal-surface">
            {locks.map((lock) => (
              <LockRow
                key={lock.resourceKey}
                lock={lock}
                operatorInfo={operatorMap[lock.operatorId]}
                onRelease={handleRelease}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && !error && locks.length === 0 && (
        <div className="text-center py-16 text-terminal-dim text-xs font-mono border border-terminal-border rounded-lg bg-terminal-surface">
          No active resource locks
        </div>
      )}
    </div>
  );
}
