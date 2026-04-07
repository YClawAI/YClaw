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
  healthy: 'bg-terminal-green shadow-[0_0_6px_#a6e3a1]',
  warning: 'bg-terminal-yellow shadow-[0_0_6px_#f9e2af]',
  degraded: 'bg-terminal-orange shadow-[0_0_6px_#fab387]',
  reconnecting: 'bg-terminal-orange shadow-[0_0_6px_#fab387]',
  down: 'bg-terminal-red shadow-[0_0_6px_#f38ba8]',
};

const STATUS_TEXT: Record<string, { label: string; color: string }> = {
  healthy: { label: 'Healthy', color: 'text-terminal-green' },
  warning: { label: 'Warning', color: 'text-terminal-yellow' },
  degraded: { label: 'Degraded', color: 'text-terminal-orange' },
  reconnecting: { label: 'Reconnecting', color: 'text-terminal-orange' },
  down: { label: 'Down', color: 'text-terminal-red' },
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
      <div className="bg-terminal-surface border border-terminal-border rounded p-6">
        <div className="text-xs text-terminal-dim text-center">Awaiting health check data</div>
      </div>
    );
  }

  const healthyCount = liveServices.filter((s) => s.status === 'healthy').length;
  const total = liveServices.length;

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
          Service Health Matrix
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-terminal-dim">
            {healthyCount}/{total} healthy
          </span>
          <button
            onClick={handleRefresh}
            disabled={isPending}
            className="px-2 py-0.5 text-[10px] font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-muted/30 transition-colors disabled:opacity-50"
          >
            {isPending ? 'Refreshing...' : 'Refresh'}
          </button>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-terminal-green animate-pulse" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-terminal-border">
              {['Service', 'Status', 'Last Check', 'Latency', 'Err Rate'].map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-terminal-dim font-normal whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {liveServices.map((svc) => {
              const st = STATUS_TEXT[svc.status] ?? { label: svc.status, color: 'text-terminal-dim' };
              return (
                <tr
                  key={svc.name}
                  className="border-b border-terminal-border/50 hover:bg-terminal-muted/20 transition-colors"
                >
                  <td className="px-3 py-2 text-terminal-text whitespace-nowrap">{svc.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[svc.status] ?? 'bg-terminal-dim'}`} />
                      <span className={st.color}>{st.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-terminal-dim whitespace-nowrap">{svc.lastCheck ?? '--'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {svc.latency != null && svc.latency > 0 ? (
                      <span className={svc.latency > 100 ? 'text-terminal-yellow' : 'text-terminal-text'}>
                        {svc.latency}ms
                      </span>
                    ) : (
                      <span className="text-terminal-dim">--</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {svc.errorRate != null ? (
                      <span className={svc.errorRate > 0.1 ? 'text-terminal-red' : svc.errorRate > 0 ? 'text-terminal-yellow' : 'text-terminal-dim'}>
                        {(svc.errorRate * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-terminal-dim">
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
