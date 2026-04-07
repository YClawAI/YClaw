'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

export interface YClawEvent {
  type: string;
  agentId?: string;
  receivedAt: string;
  data?: Record<string, unknown>;
}

// All custom event types the SSE route emits
const SSE_EVENT_TYPES = [
  'system:health',
  'fleet:status',
  'agent:status',
  'activity:update',
  'approvals:count',
  'queue:update',
  'spend:updated',
  'settings:updated',
  'ping',
] as const;

const LOCAL_SSE_URL = '/api/events';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

export function useYClawEventStream() {
  const [events, setEvents] = useState<YClawEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const useFallbackRef = useRef(false);

  const connect = useCallback(() => {
    // Close any existing connection
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }

    const baseUrl = process.env.NEXT_PUBLIC_YCLAW_API_URL;
    // If external URL configured and we haven't fallen back yet, try it first
    const sseUrl = baseUrl && !useFallbackRef.current
      ? `${baseUrl}/api/events`
      : LOCAL_SSE_URL;

    const source = new EventSource(sseUrl);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
      attemptRef.current = 0; // Reset backoff on successful connection
    };

    source.onerror = () => {
      setConnected(false);
      source.close();
      sourceRef.current = null;

      // If external URL failed, fall back to local
      if (!useFallbackRef.current && sseUrl !== LOCAL_SSE_URL) {
        useFallbackRef.current = true;
        attemptRef.current = 0;
        reconnectTimer.current = setTimeout(connect, 500);
        return;
      }

      // Exponential backoff reconnection
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, attemptRef.current),
        RECONNECT_MAX_MS,
      );
      attemptRef.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    function handleEvent(eventType: string, e: MessageEvent) {
      try {
        const payload = JSON.parse(e.data);
        // activity:update is an array of runs — expand each
        if (eventType === 'activity:update' && Array.isArray(payload)) {
          const now = new Date().toISOString();
          const newEvents: YClawEvent[] = payload.map((run: Record<string, unknown>) => ({
            type: eventType,
            agentId: run.agentId as string | undefined,
            receivedAt: (run.createdAt as string) || now,
            data: run,
          }));
          setEvents(prev => [...newEvents, ...prev].slice(0, 100));
        } else if (eventType !== 'ping') {
          setEvents(prev => [{
            type: eventType,
            agentId: payload.agentId as string | undefined,
            receivedAt: new Date().toISOString(),
            data: payload,
          }, ...prev].slice(0, 100));
        }
      } catch { /* skip unparseable */ }
    }

    for (const eventType of SSE_EVENT_TYPES) {
      source.addEventListener(eventType, (e) => handleEvent(eventType, e as MessageEvent));
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, [connect]);

  return { events, connected };
}
