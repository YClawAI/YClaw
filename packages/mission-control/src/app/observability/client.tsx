'use client';

import { useState, useEffect, useRef } from 'react';
import { HealthOverview } from './components/HealthOverview';
import { ErrorSummary } from './components/ErrorSummary';
import { SystemStats } from './components/SystemStats';
import { AuditTimeline } from './components/AuditTimeline';

interface DetailedHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, { status: 'healthy' | 'unhealthy'; latencyMs?: number; error?: string }>;
  channels: Record<string, { status: 'healthy' | 'disabled' | 'unhealthy'; error?: string }>;
  agents: { total: number; active: number; idle: number; errored: number };
  tasks: { pending: number; running: number; failedLast24h: number };
  recentErrors: Array<{
    timestamp: string; errorCode?: string; message: string;
    agentId?: string; category?: string; severity?: string; action?: string;
  }>;
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  source: 'operator' | 'execution';
  operatorId?: string;
  agentId?: string;
  action: string;
  correlationId?: string;
  decision?: 'allowed' | 'denied';
  status?: string;
  errorCode?: string;
  message?: string;
}

interface TimelineResponse {
  events: TimelineEvent[];
  cursor: string | null;
  hasMore: boolean;
}

interface ObservabilityClientProps {
  initialHealth: DetailedHealth | null;
  initialTimeline: TimelineResponse | null;
  initialError?: string;
}

export function ObservabilityClient({ initialHealth, initialTimeline, initialError }: ObservabilityClientProps) {
  const [health, setHealth] = useState(initialHealth);
  const [error, setError] = useState(initialError);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh health every 30 seconds
  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/observability/health');
        if (res.ok) {
          const data = await res.json() as DetailedHealth;
          setHealth(data);
          setError(undefined);
        }
      } catch (err) {
        console.error('[observability] Refresh failed:', err);
        // Keep last known state — don't crash the UI
      }
    }, 30_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  if (error && !health) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded p-6">
        <p className="text-xs text-terminal-red font-mono">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Row 1: Health + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Health Overview */}
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
            System Health
          </h3>
          {health ? (
            <HealthOverview
              status={health.status}
              uptimeSeconds={health.uptimeSeconds}
              components={health.components}
              channels={health.channels}
            />
          ) : (
            <div className="text-xs text-terminal-dim font-mono">Loading...</div>
          )}
        </div>

        {/* System Stats */}
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
            System Stats
          </h3>
          {health ? (
            <SystemStats agents={health.agents} tasks={health.tasks} />
          ) : (
            <div className="text-xs text-terminal-dim font-mono">Loading...</div>
          )}
        </div>
      </div>

      {/* Row 2: Errors + Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Errors */}
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
            Recent Errors
          </h3>
          <ErrorSummary errors={health?.recentErrors ?? []} />
        </div>

        {/* Audit Timeline */}
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
            Audit Timeline
          </h3>
          <div className="max-h-80 overflow-y-auto">
            <AuditTimeline
              initialEvents={initialTimeline?.events ?? []}
              initialCursor={initialTimeline?.cursor ?? null}
              initialHasMore={initialTimeline?.hasMore ?? false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
