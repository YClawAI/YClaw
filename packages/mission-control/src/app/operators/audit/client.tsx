'use client';

import { useState, useCallback, useMemo } from 'react';
import type { AuditEntry } from '@/types/operators';
import { DEPARTMENTS, DEPT_META } from '@/lib/agents';
import { useAuditLog, useOperators } from '@/hooks/use-operators';
import { ChevronDown, ChevronRight } from '@/components/icons';

const ACTION_TYPES = [
  'task.create',
  'task.cancel',
  'operator.invite',
  'operator.revoke',
  'operator.rotate_key',
  'cross_dept.approve',
  'cross_dept.reject',
  'lock.force_release',
];

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isDenied = entry.decision === 'denied';

  return (
    <div
      className={`border-l-2 ${isDenied ? 'border-terminal-red' : 'border-terminal-green/50'}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 hover:bg-terminal-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-terminal-dim font-mono shrink-0 w-36">
            {formatTimestamp(entry.timestamp)}
          </span>
          <span className="text-xs font-mono text-terminal-text font-medium shrink-0 w-24 truncate">
            {entry.operatorId}
          </span>
          <span className={`text-[10px] font-mono shrink-0 w-32 truncate ${isDenied ? 'text-terminal-red' : 'text-terminal-text'}`}>
            {entry.action}
          </span>
          <span className="text-[10px] font-mono text-terminal-dim shrink-0 w-24 truncate">
            {entry.department || '—'}
          </span>
          <span className="text-[10px] font-mono text-terminal-dim truncate flex-1">
            {entry.target || ''}
          </span>
          <span className="text-[10px] text-terminal-dim">
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 ml-4 space-y-1.5">
          {entry.target && (
            <div className="text-[10px] font-mono">
              <span className="text-terminal-dim">Target: </span>
              <span className="text-terminal-text">{entry.target}</span>
            </div>
          )}
          <div className="text-[10px] font-mono">
            <span className="text-terminal-dim">Decision: </span>
            <span className={isDenied ? 'text-terminal-red font-bold' : 'text-terminal-green'}>
              {(entry.decision ?? 'allowed').toUpperCase()}
            </span>
            {entry.denialReason && (
              <span className="text-terminal-red/80 ml-1">({entry.denialReason})</span>
            )}
          </div>
          {entry.ip && (
            <div className="text-[10px] font-mono">
              <span className="text-terminal-dim">IP: </span>
              <span className="text-terminal-text">{entry.ip}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditClient({ initialEntries }: { initialEntries?: AuditEntry[] }) {
  // Filters
  const [operatorFilter, setOperatorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [deniedOnly, setDeniedOnly] = useState(false);

  // Extra entries from "Load More"
  const [extraEntries, setExtraEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Build filter params for React Query
  const filters = useMemo(() => {
    const p: Record<string, string> = { limit: '50' };
    if (operatorFilter) p.operatorId = operatorFilter;
    if (actionFilter) p.action = actionFilter;
    if (deptFilter) p.department = deptFilter;
    if (fromDate) p.from = fromDate;
    if (toDate) p.to = toDate;
    if (deniedOnly) p.deniedOnly = 'true';
    return p;
  }, [operatorFilter, actionFilter, deptFilter, fromDate, toDate, deniedOnly]);

  const { data, error, isLoading } = useAuditLog(filters);
  const { data: operators } = useOperators();

  // Reset extra entries when filters change
  const entries = useMemo(() => {
    const base = data?.entries ?? initialEntries ?? [];
    // Update cursor/hasMore from latest query result
    return [...base, ...extraEntries];
  }, [data, initialEntries, extraEntries]);

  // Update cursor when data changes
  useMemo(() => {
    if (data) {
      setCursor(data.cursor);
      setHasMore(!!data.hasMore);
      setExtraEntries([]);
    }
  }, [data]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ ...filters, cursor });
      const res = await fetch(`/api/operators/audit?${params}`);
      if (res.ok) {
        const result = await res.json();
        setExtraEntries((prev) => [...prev, ...(result.entries ?? [])]);
        setCursor(result.cursor);
        setHasMore(!!result.hasMore);
      }
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  }, [cursor, filters]);

  const operatorOptions = useMemo(() => {
    return (operators ?? []).map((op) => ({
      operatorId: op.operatorId,
      displayName: op.displayName,
    }));
  }, [operators]);

  const selectClasses = 'px-2 py-1 text-[10px] font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text focus:outline-none focus:border-terminal-purple/50';
  const inputClasses = 'px-2 py-1 text-[10px] font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text focus:outline-none focus:border-terminal-purple/50';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-terminal-text tracking-wide">
          Audit Log
        </h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 px-1">
        <select
          value={operatorFilter}
          onChange={(e) => setOperatorFilter(e.target.value)}
          className={selectClasses}
        >
          <option value="">All Operators</option>
          {operatorOptions.map((op) => (
            <option key={op.operatorId} value={op.operatorId}>
              {op.displayName}
            </option>
          ))}
        </select>

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className={selectClasses}
        >
          <option value="">All Actions</option>
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className={selectClasses}
        >
          <option value="">All Departments</option>
          {DEPARTMENTS.map((dept) => (
            <option key={dept} value={dept}>{DEPT_META[dept].label}</option>
          ))}
        </select>

        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputClasses} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputClasses} />

        <label className="flex items-center gap-1.5 text-[10px] font-mono text-terminal-dim cursor-pointer">
          <input type="checkbox" checked={deniedOnly} onChange={(e) => setDeniedOnly(e.target.checked)} className="rounded border-terminal-border bg-terminal-bg" />
          Denied only
        </label>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-terminal-red/30 bg-terminal-red/5">
          <div className="text-xs font-mono text-terminal-red">{error instanceof Error ? error.message : 'Failed to load'}</div>
        </div>
      )}

      {isLoading && !error && (
        <div className="text-center py-16 text-terminal-dim text-xs font-mono">Loading audit log...</div>
      )}

      {!isLoading && entries.length > 0 && (
        <div className="border border-terminal-border rounded-lg bg-terminal-surface divide-y divide-terminal-border overflow-hidden">
          {entries.map((entry, i) => (
            <AuditRow key={entry.id || `${entry.timestamp}-${i}`} entry={entry} />
          ))}
        </div>
      )}

      {!isLoading && !error && entries.length === 0 && (
        <div className="text-center py-16 text-terminal-dim text-xs font-mono">
          No audit entries found matching filters.
        </div>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 text-xs font-mono rounded border border-terminal-border text-terminal-text hover:bg-terminal-muted transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}
