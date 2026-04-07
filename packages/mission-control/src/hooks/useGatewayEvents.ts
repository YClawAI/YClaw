'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

type EventHandler = (payload: unknown) => void;

interface UseGatewayEventsOptions {
  /** Events to subscribe to (e.g. ['status', 'channels.status']) */
  events: string[];
  /** Handler called for each event */
  onEvent: EventHandler;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
}

/**
 * Hook that subscribes to gateway SSE events via /api/gateway/events.
 * Handles reconnection and cleanup automatically.
 */
export function useGatewayEvents({
  events,
  onEvent,
  autoReconnect = true,
}: UseGatewayEventsOptions) {
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    const source = new EventSource('/api/gateway/events');
    sourceRef.current = source;

    // Listen for the initial connected event
    source.addEventListener('connected', () => {
      setConnected(true);
    });

    // Subscribe to requested events
    for (const event of events) {
      source.addEventListener(event, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current(data);
        } catch {
          // Ignore parse errors
        }
      });
    }

    source.onerror = () => {
      setConnected(false);
      source.close();
      sourceRef.current = null;

      if (autoReconnect) {
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
  }, [events, autoReconnect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, [connect]);

  return { connected };
}
