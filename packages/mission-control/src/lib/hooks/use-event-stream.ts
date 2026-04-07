'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { SSEContext } from './sse-provider';

type EventHandler = (data: unknown) => void;

// Re-export provider for convenience
export { SSEProvider } from './sse-provider';

/**
 * Subscribe to SSE events. Shares a single EventSource via SSEProvider.
 * Handlers are updated on every render via ref, so closures always see latest state.
 *
 * Falls back to a standalone EventSource if no SSEProvider is present.
 */
export function useEventStream(handlers: Record<string, EventHandler>) {
  const ctx = useContext(SSEContext);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (ctx) {
      // ── Provider path: subscribe to shared EventSource ──
      const unsubs: (() => void)[] = [];
      for (const event of Object.keys(handlersRef.current)) {
        const unsub = ctx.subscribe(event, (data) => {
          handlersRef.current[event]?.(data);
        });
        unsubs.push(unsub);
      }

      return () => {
        for (const unsub of unsubs) unsub();
      };
    }

    // ── Fallback: standalone EventSource (no provider) ──
    const es = new EventSource('/api/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    for (const event of Object.keys(handlersRef.current)) {
      es.addEventListener(event, ((e: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(e.data);
          handlersRef.current[event]?.(data);
        } catch {
          // malformed JSON — skip
        }
      }) as EventListener);
    }

    return () => {
      es.close();
      setConnected(false);
    };
  }, [ctx]);

  // Sync connected state from provider
  useEffect(() => {
    if (ctx) setConnected(ctx.connected);
  }, [ctx, ctx?.connected]);

  return { connected };
}
