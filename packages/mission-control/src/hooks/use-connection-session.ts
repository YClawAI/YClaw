'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ConnectionSession } from '@/lib/connections';

const TERMINAL_STATUSES = new Set(['connected', 'failed']);

export function useConnectionSession(
  sessionId: string | null,
  intervalMs = 3000,
): {
  session: ConnectionSession | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [session, setSession] = useState<ConnectionSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/connections/${sessionId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to fetch session' }));
        setError(data.error);
        return;
      }
      const data: ConnectionSession = await res.json();
      setSession(data);
      setError(null);

      // Stop polling on terminal state
      if (TERMINAL_STATUSES.has(data.status) && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setError(null);
      return;
    }

    // Initial fetch
    fetchSession();

    // Start polling
    intervalRef.current = setInterval(fetchSession, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sessionId, intervalMs, fetchSession]);

  return { session, loading, error, refetch: fetchSession };
}
