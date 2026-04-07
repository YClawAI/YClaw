export const dynamic = 'force-dynamic';

import { fetchCoreApi } from '@/lib/core-api';
import { ObservabilityClient } from './client';

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

interface TimelineResponse {
  events: Array<{
    id: string; timestamp: string; source: 'operator' | 'execution';
    operatorId?: string; agentId?: string; action: string;
    correlationId?: string; decision?: 'allowed' | 'denied';
    status?: string; errorCode?: string; message?: string;
  }>;
  cursor: string | null;
  hasMore: boolean;
}

export default async function ObservabilityPage() {
  let health: DetailedHealth | null = null;
  let timeline: TimelineResponse | null = null;
  let error: string | undefined;

  try {
    const [healthResult, timelineResult] = await Promise.all([
      fetchCoreApi<DetailedHealth>('/v1/observability/health'),
      fetchCoreApi<TimelineResponse>('/v1/observability/audit?limit=20'),
    ]);

    if (healthResult.ok && healthResult.data) {
      health = healthResult.data;
    } else if (healthResult.status === 403 || healthResult.status === 401) {
      error = 'Root operator access required for observability.';
    } else {
      error = healthResult.error ?? 'Failed to fetch health data';
    }

    if (timelineResult.ok && timelineResult.data) {
      timeline = timelineResult.data;
    }
  } catch (err) {
    console.error('[observability] Failed to fetch initial data:', err);
    error = 'Failed to connect to YCLAW API';
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold text-terminal-text">Observability</h1>
        <span className="text-[10px] text-terminal-dim font-mono">Auto-refresh: 30s</span>
      </div>
      <ObservabilityClient
        initialHealth={health}
        initialTimeline={timeline}
        initialError={error}
      />
    </div>
  );
}
