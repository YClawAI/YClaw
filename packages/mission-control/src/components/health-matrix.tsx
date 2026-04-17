'use client';

import { useState, useCallback, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useEventStream } from '@/lib/hooks/use-event-stream';

export interface ServiceHealth {
  name: string;
  status: string;
  lastCheck?: string;
  latency?: number;
  errorRate?: number;
}

interface SystemHealthEvent {
  mongo: boolean;
  redis: boolean;
  redisState?: string;
  gateway: boolean;
}

interface HealthMatrixProps {
  services: ServiceHealth[];
}

const STATUS_DOT: Record<string, string> = {
  healthy: 'bg-mc-success shadow-[0_0_6px_#30D158]',
  warning: 'bg-mc-warning shadow-[0_0_6px_#FFD60A]',
  degraded: 'bg-mc-blocked shadow-[0_0_6px_#FF9F0A]',
  reconnecting: 'bg-mc-blocked shadow-[0_0_6px_#FF9F0A]',
  down: 'bg-mc-danger shadow-[0_0_6px_#FF453A]',
};

const STATUS_TEXT: Record<string, { label: string; color: string }> = {
  healthy: { label: 'Healthy', color: 'text-mc-success' },
  warning: { label: 'Warning', color: 'text-mc-warning' },
  degraded: { label: 'Degraded', color: 'text-mc-blocked' },
  reconnecting: { label: 'Reconnecting', color: 'text-mc-blocked' },
  down: { label: 'Down', color: 'text-mc-danger' },
};

export function HealthMatrix({ services }: HealthMatrixProps) {
  const [liveServices, setLiveServices] = useState<ServiceHealth[]>(services);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Reconcile when server-rendered props change (e.g. after router.refresh())
  useEffect(() => {
    setLiveServices(services);
  }, [services]);

  const handleRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // Subscribe to SSE system:health events for live refresh
  useEventStream({
    'system:health': (data) => {
      const d = data as SystemHealthEvent;
      const now = new Date().toISOString();
      setLiveServices((prev) => {
        const updated = [...prev];
        // Update MongoDB entry
        const mongoIdx = updated.findIndex((s) => s.name === 'MongoDB Atlas');
        if (mongoIdx !== -1) {
          updated[mongoIdx] = { ...updated[mongoIdx]!, status: d.mongo ? 'healthy' : 'down', lastCheck: now };
        }
        // Update Redis entry
        const redisIdx = updated.findIndex((s) => s.name === 'Redis');
        if (redisIdx !== -1) {
          const redisStatus = d.redis ? 'healthy' : d.redisState === 'reconnecting' ? 'reconnecting' : 'down';
          updated[redisIdx] = { ...updated[redisIdx]!, status: redisStatus, lastCheck: now };
        }
        return updated;
      });
    },
  });

  if (liveServices.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-6">
        <div className="text-xs text-mc-text-tertiary text-center">Awaiting health check data</div>
      </div>
    );
  }

  const healthyCount = liveServices.filter((s) => s.status === 'healthy').length;
  const total = liveServices.length;

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded">
      {/* Header */}
      <div className="px-4 py-3 border-b border-mc-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">
          Service Health Matrix
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-mc-text-tertiary">
            {healthyCount}/{total} healthy
          </span>
          <button
            onClick={handleRefresh}
            disabled={isPending}
            className="px-2 py-0.5 text-[10px] font-mono border border-mc-border rounded text-mc-text-tertiary hover:text-mc-text hover:bg-mc-border/30 transition-colors disabled:opacity-50"
          >
            {isPending ? 'Refreshing...' : 'Refresh'}
          </button>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-mc-success animate-pulse" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-mc-border">
              {['Service', 'Status', 'Last Check', 'Latency', 'Err Rate'].map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary font-normal whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {liveServices.map((svc) => {
              const st = STATUS_TEXT[svc.status] ?? { label: svc.status, color: 'text-mc-text-tertiary' };
              return (
                <tr
                  key={svc.name}
                  className="border-b border-mc-border/50 hover:bg-mc-border/20 transition-colors"
                >
                  <td className="px-3 py-2 text-mc-text whitespace-nowrap">{svc.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[svc.status] ?? 'bg-mc-text-tertiary'}`} />
                      <span className={st.color}>{st.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-mc-text-tertiary whitespace-nowrap">{svc.lastCheck ?? '--'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {svc.latency != null && svc.latency > 0 ? (
                      <span className={svc.latency > 100 ? 'text-mc-warning' : 'text-mc-text'}>
                        {svc.latency}ms
                      </span>
                    ) : (
                      <span className="text-mc-text-tertiary">--</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {svc.errorRate != null ? (
                      <span className={svc.errorRate > 0.1 ? 'text-mc-danger' : svc.errorRate > 0 ? 'text-mc-warning' : 'text-mc-text-tertiary'}>
                        {(svc.errorRate * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-mc-text-tertiary">
                        N/A
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
