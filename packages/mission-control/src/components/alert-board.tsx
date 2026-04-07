'use client';

export interface Alert {
  id: string;
  severity: string;
  title: string;
  timestamp: string;
  source?: string;
  details?: string;
}

interface AlertBoardProps {
  alerts: Alert[];
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-terminal-red/15 text-terminal-red border border-terminal-red/30',
  warning: 'bg-terminal-yellow/15 text-terminal-yellow border border-terminal-yellow/30',
  info: 'bg-terminal-blue/15 text-terminal-blue border border-terminal-blue/30',
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-terminal-red',
  warning: 'border-l-terminal-yellow',
  info: 'border-l-terminal-blue',
};

function formatAlertTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function AlertBoard({ alerts }: AlertBoardProps) {
  if (alerts.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded">
        <div className="p-4 text-xs text-terminal-dim text-center font-mono">
          No active alerts
        </div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
          Active Alerts
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-terminal-dim">
            {alerts.length} active
          </span>
          <span className="text-[10px] font-mono text-terminal-dim/50" title="Alerts are computed at page load. Refresh to update.">
            snapshot
          </span>
        </div>
      </div>

      <div className="divide-y divide-terminal-border/50">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`px-4 py-3 border-l-2 ${SEVERITY_BORDER[alert.severity] ?? 'border-l-terminal-dim'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${SEVERITY_BADGE[alert.severity] ?? 'bg-terminal-dim/15 text-terminal-dim border border-terminal-dim/30'}`}
                  >
                    {alert.severity}
                  </span>
                  <span className="text-xs font-bold text-terminal-text truncate">
                    {alert.title}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-terminal-dim font-mono">
                  {alert.source && <span>source: {alert.source}</span>}
                  <span>{formatAlertTime(alert.timestamp)}</span>
                </div>
                {alert.details && (
                  <div className="text-[10px] text-terminal-dim mt-1">{alert.details}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
