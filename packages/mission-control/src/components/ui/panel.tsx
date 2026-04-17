import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * SpaceX Panel — the foundational container. Outlined (1px cyan hairline),
 * not filled. Interactive variants brighten the border on hover/focus. Use
 * instead of raw `bg-mc-surface-hover border border-mc-border` once
 * a surface has been migrated to the mc-* system.
 *
 * Variants:
 *   - static:      no hover treatment (the default)
 *   - interactive: border brightens on hover, further on active/focus
 *   - glass:       subtle surface tint (rgba 0.02) for layered contexts
 *
 * Department color: pass `department="development"` (etc.) to tint the
 * border with the dept accent instead of cyan. Used on department pages
 * and agent cards.
 */

export type McDepartment =
  | 'executive'
  | 'development'
  | 'marketing'
  | 'operations'
  | 'finance'
  | 'support';

const DEPT_BORDER: Record<McDepartment, string> = {
  executive: 'border-mc-dept-executive/20 hover:border-mc-dept-executive/40',
  development: 'border-mc-dept-development/20 hover:border-mc-dept-development/40',
  marketing: 'border-mc-dept-marketing/20 hover:border-mc-dept-marketing/40',
  operations: 'border-mc-dept-operations/20 hover:border-mc-dept-operations/40',
  finance: 'border-mc-dept-finance/20 hover:border-mc-dept-finance/40',
  support: 'border-mc-dept-support/20 hover:border-mc-dept-support/40',
};

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: 'static' | 'interactive' | 'glass';
  department?: McDepartment;
  /** Renders the panel header row with title + optional actions slot. */
  title?: React.ReactNode;
  actions?: React.ReactNode;
  /** 8px by default (the spec); 6px for chip-sized, 12px for feature panels. */
  radius?: 'panel' | 'chip' | 'lg';
}

export function Panel({
  variant = 'static',
  department,
  title,
  actions,
  radius = 'panel',
  className,
  children,
  ...rest
}: PanelProps) {
  const base = 'border transition-colors duration-mc ease-mc-out';
  const bg =
    variant === 'glass' ? 'bg-mc-surface' : 'bg-transparent';
  const border = department
    ? DEPT_BORDER[department]
    : variant === 'interactive'
      ? 'border-mc-border hover:border-mc-border-hover focus-within:border-mc-border-active'
      : 'border-mc-border';
  const rounded =
    radius === 'chip' ? 'rounded-chip' : radius === 'lg' ? 'rounded-xl' : 'rounded-panel';

  return (
    <div className={cn(base, bg, border, rounded, className)} {...rest}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-mc-border">
          {title && (
            <div className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">
              {title}
            </div>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={title || actions ? 'p-4' : ''}>{children}</div>
    </div>
  );
}
