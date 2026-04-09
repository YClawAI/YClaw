'use client';

import { useEffect, useState, useRef } from 'react';
import type { PublicEvent } from '@/lib/api';

const API_URL = process.env.YCLAW_PUBLIC_API_URL || 'https://agents.yclaw.ai';

export default function EventsPage() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Load initial events
    fetch(`${API_URL}/public/v1/events`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data) => setEvents(data.events || []))
      .catch(() => {});

    // SSE stream
    const es = new EventSource(`${API_URL}/public/v1/events/stream`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as PublicEvent;
        setEvents((prev) => [event, ...prev].slice(0, 100));
      } catch {}
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-terminal-text mb-2">Event Feed</h1>
          <p className="text-terminal-dim">Real-time agent activity stream</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-terminal-green animate-live' : 'bg-terminal-dim'}`} />
          <span className="text-xs text-terminal-dim">{connected ? 'Connected' : 'Reconnecting...'}</span>
        </div>
      </div>

      <div className="space-y-2">
        {events.length > 0 ? (
          events.map((event) => (
            <div
              key={event.id}
              className="bg-terminal-surface border border-terminal-border rounded-lg px-4 py-3 flex items-start gap-4 animate-fade-in"
            >
              <div className="flex-shrink-0 mt-0.5">
                <span className="inline-block w-2 h-2 rounded-full bg-terminal-cyan" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-terminal-text capitalize">{event.agentName}</span>
                  <span className="text-xs text-terminal-dim">{event.type}</span>
                </div>
                <p className="text-sm text-terminal-dim truncate">{event.summary}</p>
              </div>
              <time className="text-xs text-terminal-dim flex-shrink-0 whitespace-nowrap">
                {new Date(event.timestamp).toLocaleTimeString()}
              </time>
            </div>
          ))
        ) : (
          <p className="text-terminal-dim text-center py-12">No events yet</p>
        )}
      </div>
    </div>
  );
}
