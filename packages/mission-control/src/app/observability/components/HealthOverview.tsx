'use client';

interface ComponentStatus {
  status: 'healthy' | 'unhealthy';
  latencyMs?: number;
  error?: string;
}

interface ChannelStatus {
  status: 'healthy' | 'disabled' | 'unhealthy';
  error?: string;
}

interface HealthOverviewProps {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  components: Record<string, ComponentStatus>;
  channels: Record<string, ChannelStatus>;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const STATUS_COLORS = {
  healthy: 'text-terminal-green',
  degraded: 'text-terminal-orange',
  unhealthy: 'text-terminal-red',
  disabled: 'text-terminal-dim',
} as const;

const STATUS_DOT = {
  healthy: 'bg-terminal-green',
  degraded: 'bg-terminal-orange',
  unhealthy: 'bg-terminal-red',
  disabled: 'bg-terminal-dim',
} as const;

export function HealthOverview({ status, uptimeSeconds, components, channels }: HealthOverviewProps) {
  return (
    <div className="space-y-4">
      {/* Overall status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
          <span className={`text-sm font-mono font-bold ${STATUS_COLORS[status]}`}>
            {status.toUpperCase()}
          </span>
        </div>
        <span className="text-xs text-terminal-dim font-mono">
          Uptime: {formatUptime(uptimeSeconds)}
        </span>
      </div>

      {/* Infrastructure components */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">
          Infrastructure
        </h4>
        <div className="space-y-1">
          {Object.entries(components).map(([name, comp]) => (
            <div key={name} className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[comp.status]}`} />
                <span className="text-terminal-text">{name}</span>
              </div>
              <div className="flex items-center gap-3">
                {comp.latencyMs !== undefined && (
                  <span className="text-terminal-dim">{comp.latencyMs}ms</span>
                )}
                <span className={STATUS_COLORS[comp.status]}>{comp.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Channels */}
      {Object.keys(channels).length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">
            Channels
          </h4>
          <div className="space-y-1">
            {Object.entries(channels).map(([name, ch]) => (
              <div key={name} className="flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[ch.status]}`} />
                  <span className="text-terminal-text">{name}</span>
                </div>
                <span className={STATUS_COLORS[ch.status]}>{ch.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
