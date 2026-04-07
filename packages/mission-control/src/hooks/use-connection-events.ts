'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface StepEvent {
  stepId: string;
  status: string;
  detail?: string;
  actor?: string;
  label?: string;
}

export interface SessionEvent {
  status: string;
  error?: string;
}

/**
 * Subscribe to SSE events from GET /api/connections/[id]/events.
 *
 * Returns real-time step and session updates. Automatically reconnects
 * on connection loss. Closes when session reaches terminal state.
 */
export function useConnectionEvents(
  sessionId: string | null,
  callbacks: {
    onStepUpdate?: (event: StepEvent) => void;
    onSessionUpdate?: (event: SessionEvent) => void;
    onComplete?: (event: SessionEvent) => void;
  },
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const closedRef = useRef(false);

  // Stable callback ref to avoid reconnection on callback changes
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const connect = useCallback(() => {
    if (!sessionId || closedRef.current) return;

    const es = new EventSource(`/api/connections/${sessionId}/events`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.addEventListener('step_update', (e) => {
      try {
        const data: StepEvent = JSON.parse(e.data);
        cbRef.current.onStepUpdate?.(data);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('session_update', (e) => {
      try {
        const data: SessionEvent = JSON.parse(e.data);
        cbRef.current.onSessionUpdate?.(data);
      } catch { /* ignore */ }
    });

    es.addEventListener('complete', (e) => {
      try {
        const data: SessionEvent = JSON.parse(e.data);
        cbRef.current.onComplete?.(data);
      } catch { /* ignore */ }
      closedRef.current = true;
      es.close();
      setConnected(false);
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 3s unless intentionally closed
      if (!closedRef.current) {
        setTimeout(connect, 3000);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    closedRef.current = false;
    connect();

    return () => {
      closedRef.current = true;
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [connect]);

  return { connected };
}
