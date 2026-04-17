'use client';

import { hexAlpha } from './hive-types';
import type { ExternalServiceNode } from '@/lib/hive/external-nodes';

export interface ExternalActivity {
  lastEventAt: number;
  count60s: number;
  events: Array<{ timestamp: number; agentId?: string; detail?: string }>;
}

interface ExternalTooltipProps {
  service: ExternalServiceNode;
  activity: ExternalActivity | undefined;
}

export function ExternalTooltip({ service, activity }: ExternalTooltipProps) {
  const isActive = activity?.lastEventAt
    ? Date.now() - activity.lastEventAt < 10_000
    : false;

  // Aggregate events by agent
  const byAgent: Record<string, number> = {};
  if (activity) {
    const cutoff = Date.now() - 3600_000;
    for (const e of activity.events) {
      if (e.timestamp > cutoff && e.agentId) {
        byAgent[e.agentId] = (byAgent[e.agentId] ?? 0) + 1;
      }
    }
  }

  const lastEventAgo = activity?.lastEventAt
    ? formatTimeAgo(Date.now() - activity.lastEventAt)
    : null;

  const lastDetail = activity?.events.length
    ? activity.events[activity.events.length - 1]?.detail
    : null;

  return (
    <div
      className="bg-mc-bg/95 backdrop-blur-sm border border-mc-border rounded-panel shadow-2xl p-3 min-w-[180px]"
      style={{ borderColor: hexAlpha(service.color, 0.3) }}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-lg">{service.icon}</span>
        <div>
          <div className="font-sans text-sm font-medium text-mc-text">
            {service.name}
          </div>
          <div
            className="font-sans text-[10px] uppercase tracking-label"
            style={{ color: service.color }}
          >
            {service.category === 'orchestrator' ? 'Orchestrator' : 'External Service'}
          </div>
        </div>
      </div>

      {Object.keys(byAgent).length > 0 && (
        <div className="mb-2">
          <div className="font-sans text-[10px] text-mc-text-label mb-1 uppercase tracking-label">
            Events (last hour)
          </div>
          {Object.entries(byAgent)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([agent, count]) => (
              <div
                key={agent}
                className="flex justify-between text-[10px] py-0.5"
              >
                <span className="font-sans text-mc-text capitalize">{agent}</span>
                <span className="font-mono tabular-nums text-mc-text-secondary">{count}</span>
              </div>
            ))}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-mc-border">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-mc-success animate-mc-pulse shadow-[0_0_6px_currentColor]' : 'bg-mc-text-tertiary'}`}
          />
          <span className="font-sans text-[10px] text-mc-text-secondary">
            {lastEventAgo ? `Last: ${lastEventAgo}` : 'No recent activity'}
          </span>
        </div>
        {lastDetail && (
          <div className="font-sans text-[10px] text-mc-text-tertiary mt-1 truncate max-w-[200px]">
            {lastDetail}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
