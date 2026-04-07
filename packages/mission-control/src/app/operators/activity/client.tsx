'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { OperatorActivity } from '@/types/operators';
import { OperatorStatsCard } from '@/components/operator-stats-card';
import { useOperatorActivity } from '@/hooks/use-operators';

// Alert colors — backend currently only emits high_denial_rate,
// but we style all types for forward-compatibility
const ALERT_STYLES: Record<string, { border: string; dot: string }> = {
  high_denial_rate: {
    border: 'border-terminal-red/40 bg-terminal-red/5 text-terminal-red',
    dot: 'bg-terminal-red',
  },
  invitation_expiring: {
    border: 'border-terminal-yellow/40 bg-terminal-yellow/5 text-terminal-yellow',
    dot: 'bg-terminal-yellow',
  },
  high_rate_usage: {
    border: 'border-terminal-yellow/40 bg-terminal-yellow/5 text-terminal-yellow',
    dot: 'bg-terminal-yellow',
  },
  lock_conflict: {
    border: 'border-terminal-orange/40 bg-terminal-orange/5 text-terminal-orange',
    dot: 'bg-terminal-orange',
  },
};

const DEFAULT_ALERT_STYLE = {
  border: 'border-terminal-border bg-terminal-surface text-terminal-text',
  dot: 'bg-terminal-dim',
};

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

interface Props {
  initialActivity: OperatorActivity | null;
  initialError?: string;
}

export function ActivityClient({ initialActivity, initialError }: Props) {
  const router = useRouter();
  const { data: activity, error: queryError } = useOperatorActivity(initialActivity);
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : initialError;

  const operators = activity?.operators ?? [];
  const actions = activity?.recentActions ?? [];
  const alerts = activity?.alerts ?? [];

  // Build operator name lookup from the operators list
  const operatorNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const op of operators) {
      map[op.operatorId] = op.displayName;
    }
    return map;
  }, [operators]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-terminal-text tracking-wide">
          Operator Activity
        </h1>
        <span className="text-[10px] text-terminal-dim font-mono">
          Auto-refreshes every 30s
        </span>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-terminal-red/30 bg-terminal-red/5">
          <div className="text-xs font-mono text-terminal-red font-bold mb-1">Error</div>
          <div className="text-xs font-mono text-terminal-red/80">{error}</div>
        </div>
      )}

      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs font-bold font-mono text-terminal-dim uppercase tracking-wider">
              Alerts
            </span>
            <span className="text-[10px] font-mono text-terminal-dim bg-terminal-muted px-1.5 py-0.5 rounded">
              {alerts.length}
            </span>
          </div>
          <div className="space-y-2">
            {alerts.map((alert, i) => {
              const style = ALERT_STYLES[alert.type] ?? DEFAULT_ALERT_STYLE;
              return (
                <div
                  key={`${alert.operatorId}-${alert.type}-${i}`}
                  className={`px-4 py-2.5 rounded-lg border ${style.border}`}
                >
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                    <span>{alert.message}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Operator Status Grid ── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3 px-1">
          <span className="text-xs font-bold font-mono text-terminal-dim uppercase tracking-wider">
            Operator Status
          </span>
          <span className="text-[10px] font-mono text-terminal-dim bg-terminal-muted px-1.5 py-0.5 rounded">
            {operators.length}
          </span>
        </div>
        {operators.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {operators.map((op) => (
              <OperatorStatsCard
                key={op.operatorId}
                operator={op}
                onClick={() => router.push('/operators')}
              />
            ))}
          </div>
        ) : (
          !error && (
            <div className="text-center py-8 text-terminal-dim text-xs font-mono">
              No operator data available
            </div>
          )
        )}
      </div>

      {/* ── Recent Actions Feed ── */}
      <div>
        <div className="flex items-center gap-2 mb-3 px-1">
          <span className="text-xs font-bold font-mono text-terminal-dim uppercase tracking-wider">
            Recent Actions
          </span>
          <span className="text-[10px] font-mono text-terminal-dim bg-terminal-muted px-1.5 py-0.5 rounded">
            {actions.length}
          </span>
        </div>
        {actions.length > 0 ? (
          <div className="border border-terminal-border rounded-lg bg-terminal-surface divide-y divide-terminal-border">
            {actions.map((action, i) => {
              const isDenied = action.decision === 'denied';
              const isAllowed = action.decision === 'allowed';
              const actionColorClass = isDenied
                ? 'text-terminal-red'
                : isAllowed
                  ? 'text-terminal-green'
                  : 'text-terminal-text';

              return (
                <div
                  key={`${action.operatorId}-${action.timestamp}-${i}`}
                  className={`px-4 py-2.5 flex items-start gap-3 hover:bg-terminal-muted transition-colors ${
                    isDenied ? 'border-l-2 border-terminal-red' : ''
                  }`}
                >
                  <span className="text-[10px] text-terminal-dim font-mono shrink-0 w-12">
                    {formatTime(action.timestamp)}
                  </span>
                  <span className="text-xs font-mono text-terminal-text font-medium shrink-0 w-24 truncate">
                    {operatorNames[action.operatorId] ?? action.operatorId}
                  </span>
                  <span className={`text-[10px] font-mono shrink-0 w-28 truncate ${actionColorClass}`}>
                    {action.action}
                  </span>
                  <span className="text-[10px] font-mono text-terminal-dim shrink-0 w-20 truncate">
                    {action.target || '—'}
                  </span>
                  <span className="text-[10px] font-mono text-terminal-dim truncate flex-1">
                    {action.summary}
                  </span>
                  {isDenied && (
                    <span className="text-[10px] font-mono text-terminal-red shrink-0">DENIED</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          !error && (
            <div className="text-center py-8 text-terminal-dim text-xs font-mono">
              No recent actions
            </div>
          )
        )}
      </div>
    </div>
  );
}
