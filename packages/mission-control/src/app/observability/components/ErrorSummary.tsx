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
  critical: 'text-terminal-red',
  warning: 'text-terminal-orange',
  info: 'text-terminal-blue',
} as const;

export function ErrorSummary({ errors }: ErrorSummaryProps) {
  if (errors.length === 0) {
    return (
      <div className="text-xs text-terminal-dim font-mono py-2">
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
        const severityColor = SEVERITY_COLORS[(err.severity as keyof typeof SEVERITY_COLORS)] ?? 'text-terminal-dim';

        return (
          <div key={`${err.timestamp}-${i}`} className="text-xs font-mono border-l-2 border-terminal-border pl-2 py-1">
            <div className="flex items-center gap-2">
              <span className="text-terminal-dim">{time}</span>
              {err.agentId && (
                <span className="text-terminal-cyan">{err.agentId}</span>
              )}
              {err.errorCode && (
                <span className={severityColor}>{err.errorCode}</span>
              )}
            </div>
            <div className="text-terminal-text mt-0.5">{err.message}</div>
            {err.action && (
              <div className="text-terminal-dim mt-0.5">Fix: {err.action}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
