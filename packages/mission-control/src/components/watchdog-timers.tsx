'use client';

export interface WatchdogTimer {
  name: string;
  schedule: string;
  type: 'cron' | 'event';
  lastRun?: string;
  lastStatus?: string;
  nextRun?: string;
}

interface WatchdogTimersProps {
  timers: WatchdogTimer[];
}

const STATUS_COLOR: Record<string, string> = {
  success: 'text-terminal-green',
  error: 'text-terminal-red',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  // Future times (nextRun)
  if (diff < -86400000) return `in ${Math.floor(-diff / 86400000)}d`;
  if (diff < -3600000) return `in ${Math.floor(-diff / 3600000)}h`;
  if (diff < -60000) return `in ${Math.floor(-diff / 60000)}m`;
  if (diff < 0) return 'in <1m';
  // Past times (lastRun)
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function WatchdogTimers({ timers }: WatchdogTimersProps) {
  if (timers.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <div className="text-xs text-terminal-dim text-center">No watchdog timers configured</div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
          Watchdog Timers
        </h3>
      </div>

      <div className="space-y-3">
        {timers.map((timer) => (
          <div key={timer.name} className="flex items-center gap-3 font-mono">
            {/* Label */}
            <div className="w-36 sm:w-44 text-xs text-terminal-text truncate flex-shrink-0">
              {timer.name}:
            </div>

            {/* Schedule */}
            <div className="text-[10px] text-terminal-dim flex-shrink-0">
              {timer.type === 'event' ? '(event-driven)' : timer.schedule}
            </div>

            {/* Next run */}
            <div className="text-[10px] text-terminal-dim flex-shrink-0">
              {timer.nextRun ? (
                <span>next: {formatRelativeTime(timer.nextRun)}</span>
              ) : (
                <span className="text-terminal-dim/60">—</span>
              )}
            </div>

            {/* Last run */}
            <div className="text-[10px] text-terminal-dim ml-auto flex-shrink-0">
              {timer.lastRun ? (
                <span>
                  last:{' '}
                  <span className={STATUS_COLOR[timer.lastStatus ?? ''] ?? 'text-terminal-dim'}>
                    {timer.lastStatus ?? 'unknown'}
                  </span>{' '}
                  {formatRelativeTime(timer.lastRun)}
                </span>
              ) : (
                <span className="text-terminal-dim">awaiting first run</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
