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
  critical: 'bg-mc-danger/15 text-mc-danger border-mc-danger/40',
  warning: 'bg-mc-warning/15 text-mc-warning border-mc-warning/40',
  info: 'bg-mc-info/15 text-mc-info border-mc-info/40',
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-mc-danger',
  warning: 'border-l-mc-warning',
  info: 'border-l-mc-info',
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
      <div className="border border-mc-border rounded-panel bg-transparent transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
        <div className="p-4 font-sans text-xs text-mc-text-tertiary text-center">
          No active alerts
        </div>
      </div>
    );
  }

  return (
    <div className="border border-mc-border rounded-panel bg-transparent transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
      <div className="px-4 py-3 border-b border-mc-border flex items-center justify-between">
        <h3 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">
          Active Alerts
        </h3>
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-[10px] text-mc-text-secondary">
            {alerts.length} active
          </span>
          <span
            className="font-sans text-[10px] uppercase tracking-label text-mc-text-tertiary"
            title="Alerts are computed at page load. Refresh to update."
          >
            snapshot
          </span>
        </div>
      </div>

      <div className="divide-y divide-mc-border">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`px-4 py-3 border-l-2 ${SEVERITY_BORDER[alert.severity] ?? 'border-l-mc-text-tertiary'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-badge font-sans text-[10px] font-medium uppercase tracking-label border ${SEVERITY_BADGE[alert.severity] ?? 'bg-transparent text-mc-text-secondary border-mc-border'}`}
                  >
                    {alert.severity}
                  </span>
                  <span className="font-sans text-xs font-medium text-mc-text truncate">
                    {alert.title}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono tabular-nums text-[10px] text-mc-text-tertiary">
                  {alert.source && <span>source: {alert.source}</span>}
                  <span>{formatAlertTime(alert.timestamp)}</span>
                </div>
                {alert.details && (
                  <div className="font-sans text-[11px] text-mc-text-secondary mt-1">{alert.details}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
