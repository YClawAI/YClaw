'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useEventStream } from '@/lib/hooks/use-event-stream';
import { EventDetailDrawer } from './event-detail-drawer';
import { AGENTS } from '@/lib/agents';
import type { UnifiedEvent, EventLogPage } from '@/lib/event-log-queries';

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active:    'text-mc-success bg-mc-success/10 border-mc-success/30',
  running:   'text-mc-success bg-mc-success/10 border-mc-success/30',
  completed: 'text-mc-info bg-mc-info/10 border-mc-info/30',
  success:   'text-mc-info bg-mc-info/10 border-mc-info/30',
  merged:    'text-mc-info bg-mc-info/10 border-mc-info/30',
  failed:    'text-mc-danger bg-mc-danger/10 border-mc-danger/30',
  error:     'text-mc-danger bg-mc-danger/10 border-mc-danger/30',
  pending:   'text-mc-warning bg-mc-warning/10 border-mc-warning/30',
  queued:    'text-mc-warning bg-mc-warning/10 border-mc-warning/30',
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

// ── Sub-components ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-mc-text-tertiary/50">—</span>;
  const style = STATUS_STYLES[status.toLowerCase()] ?? 'text-mc-text-tertiary bg-mc-border border-mc-border';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border ${style}`}>
      {status}
    </span>
  );
}

function FilterBar({
  agents,
  types,
  filters,
  onChange,
  onReset,
}: {
  agents: string[];
  types: string[];
  filters: FilterState;
  onChange: (f: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-mc-surface-hover border border-mc-border rounded px-3 py-2 mb-4">
      {/* Agent */}
      <select
        value={filters.agent}
        onChange={(e) => onChange({ agent: e.target.value })}
        className="bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info"
      >
        <option value="">All agents</option>
        {agents.map((a) => {
          const info = AGENTS.find((x) => x.name === a);
          return (
            <option key={a} value={a}>
              {info ? `${info.emoji ?? ''} ${info.label}` : a}
            </option>
          );
        })}
      </select>

      {/* Type */}
      <select
        value={filters.type}
        onChange={(e) => onChange({ type: e.target.value })}
        className="bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info"
      >
        <option value="">All types</option>
        {types.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Status */}
      <select
        value={filters.status}
        onChange={(e) => onChange({ status: e.target.value })}
        className="bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info"
      >
        <option value="">All statuses</option>
        {['active', 'running', 'completed', 'success', 'failed', 'error', 'pending', 'queued'].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* From */}
      <input
        type="datetime-local"
        value={filters.from}
        onChange={(e) => onChange({ from: e.target.value })}
        className="bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info"
        placeholder="From"
      />

      {/* To */}
      <input
        type="datetime-local"
        value={filters.to}
        onChange={(e) => onChange({ to: e.target.value })}
        className="bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info"
        placeholder="To"
      />

      {/* Reset */}
      {(filters.agent || filters.type || filters.status || filters.from || filters.to) && (
        <button
          onClick={onReset}
          className="text-[10px] font-mono text-mc-text-tertiary hover:text-mc-text border border-mc-border rounded px-2 py-1 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────────

interface FilterState {
  agent: string;
  type: string;
  status: string;
  from: string;
  to: string;
}

const DEFAULT_FILTERS: FilterState = {
  agent: '',
  type: '',
  status: '',
  from: '',
  to: '',
};

interface EventLogTableProps {
  initialData: EventLogPage;
  agents: string[];
  types: string[];
}

// ── Main component ───────────────────────────────────────────────────────────────────

export function EventLogTable({ initialData, agents, types }: EventLogTableProps) {
  const [data, setData] = useState<EventLogPage>(initialData);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [liveCount, setLiveCount] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<UnifiedEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchPage = useCallback(
    (f: FilterState, p: number) => {
      startTransition(async () => {
        const params = new URLSearchParams();
        if (f.agent) params.set('agent', f.agent);
        if (f.type) params.set('type', f.type);
        if (f.status) params.set('status', f.status);
        if (f.from) params.set('from', new Date(f.from).toISOString());
        if (f.to) params.set('to', new Date(f.to).toISOString());
        params.set('page', String(p));

        try {
          const res = await fetch(`/api/events/log?${params.toString()}`);
          if (res.ok) {
            const json = await res.json() as EventLogPage;
            setData(json);
          }
        } catch {
          // network error — keep previous data
        }
      });
    },
    [],
  );

  // Re-fetch when filters or page changes
  useEffect(() => {
    if (!mounted) return;
    fetchPage(filters, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, mounted]);

  // Live SSE updates — increment badge and refresh page 1 if on page 1
  const { connected } = useEventStream({
    'activity:update': () => {
      setLiveCount((c) => c + 1);
      if (page === 1) {
        fetchPage(filters, 1);
        setLiveCount(0);
      }
    },
  });

  const handleFilterChange = (partial: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
    setPage(1);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const openDetail = (event: UnifiedEvent) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  };

  const { events, total, totalPages } = data;

  return (
    <div>
      {/* Filter bar */}
      <FilterBar
        agents={agents}
        types={types}
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleReset}
      />

      {/* Table header */}
      <div className="bg-mc-surface-hover border border-mc-border rounded overflow-hidden">
        {/* Status bar */}
        <div className="px-4 py-2 border-b border-mc-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary">
              Event Log
            </span>
            <span className="text-[10px] font-mono text-mc-text-tertiary">
              {total} event{total !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {liveCount > 0 && page !== 1 && (
              <button
                onClick={() => { setPage(1); setLiveCount(0); }}
                className="text-[10px] font-mono text-mc-success bg-mc-success/10 border border-mc-success/30 rounded px-2 py-0.5 hover:bg-mc-success/20 transition-colors"
              >
                ↑ {liveCount} new
              </button>
            )}
            <span
              className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-mc-success animate-pulse' : 'bg-mc-text-tertiary'}`}
              title={connected ? 'Live' : 'Connecting…'}
            />
          </div>
        </div>

        {/* Table */}
        {isPending ? (
          <div className="px-4 py-6 text-xs text-mc-text-tertiary text-center animate-pulse">Loading…</div>
        ) : events.length === 0 ? (
          <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded p-6 m-4 flex flex-col items-center justify-center gap-2 text-center">
            <span className="text-2xl text-mc-text-tertiary/40">◇</span>
            <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">
              No events
            </div>
            <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
              Waiting for agent activity. The log streams live from the gateway.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-mc-border">
            {events.map((event) => {
              const agent = AGENTS.find((a) => a.name === event.agentId);
              return (
                <button
                  key={event.id}
                  onClick={() => openDetail(event)}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-mc-border/30 transition-colors"
                >
                  {/* Agent */}
                  <span className="text-sm w-5 shrink-0">{agent?.emoji ?? '?'}</span>
                  <span className="text-mc-text font-semibold w-24 shrink-0 truncate">
                    {agent?.label ?? event.agentId}
                  </span>

                  {/* Type badge — event_log (persistent) vs. in-memory.
                      Pre-flip used purple for event_log + cyan for others; mechanical flip
                      collapsed both to mc-accent. Route event_log to mc-dept-finance
                      (only iOS-palette purple) to preserve the two-way distinction. */}
                  <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono ${
                    event.source === 'event_log'
                      ? 'text-mc-dept-finance bg-mc-dept-finance/10 border-mc-dept-finance/30'
                      : 'text-mc-accent bg-mc-accent/10 border-mc-accent/30'
                  }`}>
                    {event.type}
                  </span>

                  {/* Status */}
                  <span className="shrink-0">
                    <StatusBadge status={event.status} />
                  </span>

                  {/* Task */}
                  {event.taskId && (
                    <span className="text-mc-text-tertiary font-mono truncate max-w-[160px]">
                      {event.taskId}
                    </span>
                  )}

                  {/* Time */}
                  <span className="ml-auto shrink-0 text-mc-text-tertiary">
                    {mounted ? formatTimeAgo(event.createdAt) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-2 border-t border-mc-border flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-[10px] font-mono text-mc-text-tertiary disabled:opacity-40 hover:text-mc-text transition-colors px-2 py-1 border border-mc-border rounded disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <span className="text-[10px] font-mono text-mc-text-tertiary">
              Page {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-[10px] font-mono text-mc-text-tertiary disabled:opacity-40 hover:text-mc-text transition-colors px-2 py-1 border border-mc-border rounded disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <EventDetailDrawer
        event={selectedEvent}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
