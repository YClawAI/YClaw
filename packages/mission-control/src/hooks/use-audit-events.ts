'use client';

import { useEffect, useRef, useState } from 'react';
import type { AuditEvent, AuditFilters } from '@/components/audit/audit-types';

interface UseAuditEventsOptions {
  filters: AuditFilters;
}

export function useAuditEvents({ filters }: UseAuditEventsOptions) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const seenIds = useRef(new Set<string>());

  // Initial REST load
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('timeRange', filters.timeRange);
    if (filters.types.length) params.set('types', filters.types.join(','));
    if (filters.agentIds.length) params.set('agents', filters.agentIds.join(','));
    if (filters.severities.length) params.set('severities', filters.severities.join(','));
    if (filters.search) params.set('search', filters.search);

    fetch(`/api/audit?${params}`)
      .then(r => r.json())
      .then((data: AuditEvent[]) => {
        seenIds.current = new Set(data.map(e => e.id));
        setEvents(data);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [filters]);

  // SSE live updates with auto-reconnect
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      if (disposed) return;
      es = new EventSource('/api/audit/stream');

      es.addEventListener('audit:event', (e) => {
        try {
          const event: AuditEvent = JSON.parse(e.data);
          if (seenIds.current.has(event.id)) return;
          seenIds.current.add(event.id);

          if (matchesFilters(event, filters)) {
            setEvents(prev => [event, ...prev]);
          }
        } catch { /* skip malformed */ }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      es?.close();
      clearTimeout(reconnectTimer);
    };
  }, [filters]);

  return { events, loading };
}

function matchesFilters(event: AuditEvent, filters: AuditFilters): boolean {
  if (filters.types.length && !filters.types.includes(event.type)) return false;
  if (filters.agentIds.length && event.agentId && !filters.agentIds.includes(event.agentId)) return false;
  if (filters.severities.length && !filters.severities.includes(event.severity)) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    if (!event.title.toLowerCase().includes(q) && !(event.detail || '').toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}
