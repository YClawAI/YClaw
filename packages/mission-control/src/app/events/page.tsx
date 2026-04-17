export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { queryEventLog, getEventLogAgents, getEventLogTypes } from '@/lib/event-log-queries';
import { EventLogTable } from '@/components/event-log-table';

async function EventLogContent() {
  const [initialData, agents, types] = await Promise.all([
    queryEventLog({}, 1, 50),
    getEventLogAgents(),
    getEventLogTypes(),
  ]);

  return (
    <EventLogTable
      initialData={initialData}
      agents={agents}
      types={types}
    />
  );
}

export default function EventsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-mc-text tracking-wide">Event Log</h1>
        <span className="text-xs text-mc-text-tertiary font-mono">
          Unified timeline · run_records + event_log
        </span>
      </div>
      <Suspense
        fallback={
          <div className="bg-mc-surface-hover border border-mc-border rounded px-4 py-6 text-xs text-mc-text-tertiary text-center animate-pulse">
            Loading event log…
          </div>
        }
      >
        <EventLogContent />
      </Suspense>
    </div>
  );
}
