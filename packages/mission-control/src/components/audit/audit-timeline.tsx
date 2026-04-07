'use client';

import { useState, useCallback } from 'react';
import { AuditTimelineItem } from './audit-timeline-item';
import { AuditFilterBar } from './audit-filters';
import { useAuditEvents } from '@/hooks/use-audit-events';
import type { AuditEvent, AuditFilters } from './audit-types';
import { DEFAULT_FILTERS } from './audit-types';

interface AuditTimelineProps {
  onFocusAgent?: (agentId: string) => void;
}

export function AuditTimeline({ onFocusAgent }: AuditTimelineProps) {
  const [filters, setFilters] = useState<AuditFilters>({ ...DEFAULT_FILTERS });
  const { events, loading } = useAuditEvents({ filters });

  const handleEventClick = useCallback((event: AuditEvent) => {
    if (event.agentId && onFocusAgent) {
      onFocusAgent(event.agentId);
    }
  }, [onFocusAgent]);

  return (
    <div className="h-full flex flex-col">
      <AuditFilterBar filters={filters} onChange={setFilters} />

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Loading audit events...
        </div>
      ) : events.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-2">
          <span className="text-3xl">{'\u{1F4CB}'}</span>
          <span>No events in the last {filters.timeRange}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {events.map((event, index) => (
            <AuditTimelineItem
              key={event.id}
              event={event}
              onClick={() => handleEventClick(event)}
              isNew={index === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
