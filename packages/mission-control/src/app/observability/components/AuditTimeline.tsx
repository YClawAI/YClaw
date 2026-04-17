'use client';

import { useState, useCallback } from 'react';

interface TimelineEvent {
  id: string;
  timestamp: string;
  source: 'operator' | 'execution';
  operatorId?: string;
  agentId?: string;
  action: string;
  correlationId?: string;
  decision?: 'allowed' | 'denied';
  status?: string;
  errorCode?: string;
  message?: string;
}

interface AuditTimelineProps {
  initialEvents: TimelineEvent[];
  initialCursor: string | null;
  initialHasMore: boolean;
}

// Pre-flip used purple for operator + cyan for execution; mechanical flip
// collapsed both to mc-accent. Route operator to mc-dept-finance (only
// iOS-palette purple) to preserve the two-way source distinction.
const SOURCE_COLORS = {
  operator: 'text-mc-dept-finance',
  execution: 'text-mc-accent',
} as const;

export function AuditTimeline({ initialEvents, initialCursor, initialHasMore }: AuditTimelineProps) {
  const [events, setEvents] = useState(initialEvents);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || !cursor) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/observability/audit?before=${encodeURIComponent(cursor)}&limit=20`);
      if (res.ok) {
        const data = await res.json() as { events: TimelineEvent[]; cursor: string | null; hasMore: boolean };
        setEvents(prev => [...prev, ...data.events]);
        setCursor(data.cursor);
        setHasMore(data.hasMore);
      }
    } catch (err) {
      console.error('[observability] Failed to load audit timeline:', err);
      // Keep existing state — user can retry via the button
    } finally {
      setLoading(false);
    }
  }, [cursor, hasMore, loading]);

  if (events.length === 0) {
    return (
      <div className="text-xs text-mc-text-tertiary font-mono py-2">
        No audit events
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((event) => {
        const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
          hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        const sourceColor = SOURCE_COLORS[event.source];

        return (
          <div key={event.id} className="flex items-start gap-2 text-xs font-mono py-1 border-b border-mc-border/30">
            <span className="text-mc-text-tertiary shrink-0">{time}</span>
            <span className={`shrink-0 ${sourceColor}`}>
              {event.source === 'operator' ? 'OP' : 'EX'}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-mc-text">{event.action}</span>
              {event.operatorId && (
                <span className="text-mc-dept-finance ml-2">{event.operatorId}</span>
              )}
              {event.agentId && (
                <span className="text-mc-accent ml-2">{event.agentId}</span>
              )}
              {event.decision === 'denied' && (
                <span className="text-mc-danger ml-2">DENIED</span>
              )}
              {event.errorCode && (
                <span className="text-mc-blocked ml-2">{event.errorCode}</span>
              )}
              {event.message && (
                <div className="text-mc-text-tertiary truncate">{event.message}</div>
              )}
            </div>
          </div>
        );
      })}

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full py-2 text-xs font-mono text-mc-info hover:text-mc-text transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}
