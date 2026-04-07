'use client';

import {
  createContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

type EventHandler = (data: unknown) => void;

export interface SSEContextValue {
  connected: boolean;
  subscribe: (event: string, handler: EventHandler) => () => void;
}

export const SSEContext = createContext<SSEContextValue | null>(null);

/**
 * Provider that maintains a single EventSource connection per page.
 * All child components share this connection via useEventStream().
 */
export function SSEProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const esRef = useRef<EventSource | null>(null);
  const registeredEventsRef = useRef<Set<string>>(new Set());

  function ensureEventListener(event: string) {
    if (registeredEventsRef.current.has(event)) return;
    const es = esRef.current;
    if (!es) return;

    registeredEventsRef.current.add(event);
    es.addEventListener(event, ((e: MessageEvent) => {
      try {
        const data: unknown = JSON.parse(e.data);
        const handlers = listenersRef.current.get(event);
        if (handlers) {
          for (const h of handlers) h(data);
        }
      } catch {
        // malformed JSON — skip
      }
    }) as EventListener);
  }

  useEffect(() => {
    const es = new EventSource('/api/events');
    esRef.current = es;
    const registeredEvents = registeredEventsRef.current;

    es.onopen = () => {
      setConnected(true);
      for (const event of listenersRef.current.keys()) {
        ensureEventListener(event);
      }
    };
    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      esRef.current = null;
      registeredEvents.clear();
      setConnected(false);
    };
  }, []);

  const subscribe = useCallback((event: string, handler: EventHandler): (() => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(handler);
    ensureEventListener(event);

    return () => {
      const handlers = listenersRef.current.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }, []);

  return (
    <SSEContext.Provider value={{ connected, subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}
