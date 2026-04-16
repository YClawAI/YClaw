import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * SpaceX Metric — the tile used in the top-of-dashboard metrics strip
 * (ACTIVE / QUEUE / COST / UPTIME / SUCCESS) and everywhere else we
 * surface a single scalar next to an uppercase label. Data lives in a
 * monospace numeric, the label in Inter ultralight uppercase.
 *
 * The `trend` prop renders a small delta readout beneath the value with
 * semantic coloring (success/danger/info). Omit it for static tiles.
 * `accent` controls the top-left rule color — defaults to cyan, pass a
 * department token to tint per-department dashboards.
 */

export type MetricAccent =
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'executive'
  | 'development'
  | 'marketing'
  | 'operations'
  | 'finance'
  | 'support';

const ACCENT_RULE: Record<MetricAccent, string> = {
  accent: 'bg-mc-accent',
  success: 'bg-mc-success',
  warning: 'bg-mc-warning',
  danger: 'bg-mc-danger',
  info: 'bg-mc-info',
  executive: 'bg-mc-dept-executive',
  development: 'bg-mc-dept-development',
  marketing: 'bg-mc-dept-marketing',
  operations: 'bg-mc-dept-operations',
  finance: 'bg-mc-dept-finance',
  support: 'bg-mc-dept-support',
};

export interface MetricProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Secondary readout (e.g. "+4 last hr"). */
  trend?: React.ReactNode;
  /** Color of the trend text. */
  trendTone?: 'success' | 'danger' | 'info' | 'neutral';
  /** Color of the 2px accent rule at the top-left of the tile. */
  accent?: MetricAccent;
  /** Units suffix rendered small after the value (e.g. "ms", "%"). */
  unit?: React.ReactNode;
}

export function Metric({
  label,
  value,
  trend,
  trendTone = 'neutral',
  accent = 'accent',
  unit,
  className,
  ...rest
}: MetricProps) {
  const trendColor =
    trendTone === 'success'
      ? 'text-mc-success'
      : trendTone === 'danger'
        ? 'text-mc-danger'
        : trendTone === 'info'
          ? 'text-mc-info'
          : 'text-mc-text-tertiary';

  return (
    <div
      className={cn(
        'relative border border-mc-border rounded-panel bg-transparent px-4 py-3',
        'transition-colors duration-mc ease-mc-out hover:border-mc-border-hover',
        className,
      )}
      {...rest}
    >
      <div className={cn('absolute left-0 top-0 h-0.5 w-8 rounded-tl-panel', ACCENT_RULE[accent])} />
      <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl text-mc-text tabular-nums">{value}</span>
        {unit && (
          <span className="font-sans text-xs text-mc-text-secondary">{unit}</span>
        )}
      </div>
      {trend && (
        <div className={cn('mt-1 font-sans text-[11px]', trendColor)}>{trend}</div>
      )}
    </div>
  );
}
