'use client';

interface RecentError {
  timestamp: string;
  errorCode?: string;
  message: string;
  agentId?: string;
  category?: string;
  severity?: string;
  action?: string;
}

interface ErrorSummaryProps {
  errors: RecentError[];
}

const SEVERITY_COLORS = {
  critical: 'text-mc-danger',
  warning: 'text-mc-blocked',
  info: 'text-mc-info',
} as const;

export function ErrorSummary({ errors }: ErrorSummaryProps) {
  if (errors.length === 0) {
    return (
      <div className="text-xs text-mc-text-tertiary font-mono py-2">
        No recent errors
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {errors.map((err, i) => {
        const time = new Date(err.timestamp).toLocaleTimeString('en-US', {
          hour12: false, hour: '2-digit', minute: '2-digit',
        });
        const severityColor = SEVERITY_COLORS[(err.severity as keyof typeof SEVERITY_COLORS)] ?? 'text-mc-text-tertiary';

        return (
          <div key={`${err.timestamp}-${i}`} className="text-xs font-mono border-l-2 border-mc-border pl-2 py-1">
            <div className="flex items-center gap-2">
              <span className="text-mc-text-tertiary">{time}</span>
              {err.agentId && (
                <span className="text-mc-accent">{err.agentId}</span>
              )}
              {err.errorCode && (
                <span className={severityColor}>{err.errorCode}</span>
              )}
            </div>
            <div className="text-mc-text mt-0.5">{err.message}</div>
            {err.action && (
              <div className="text-mc-text-tertiary mt-0.5">Fix: {err.action}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
