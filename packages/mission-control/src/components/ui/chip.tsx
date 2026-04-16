import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * SpaceX Chip — compact pill for integrations, tags, status badges,
 * filter toggles. Two tones: `outline` (default, cyan hairline on bg)
 * and `solid` (dim accent wash for active/selected state). Semantic
 * variants (success/warning/danger/info/blocked) recolor both border
 * and text for state badges (e.g. "OK", "STALE", "BLOCKED").
 */

type ChipTone = 'outline' | 'solid';
type ChipVariant =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'blocked';

const OUTLINE: Record<ChipVariant, string> = {
  default: 'border-mc-border text-mc-text-secondary hover:border-mc-border-hover',
  accent: 'border-mc-accent/40 text-mc-accent',
  success: 'border-mc-success/40 text-mc-success',
  warning: 'border-mc-warning/40 text-mc-warning',
  danger: 'border-mc-danger/40 text-mc-danger',
  info: 'border-mc-info/40 text-mc-info',
  blocked: 'border-mc-blocked/40 text-mc-blocked',
};

const SOLID: Record<ChipVariant, string> = {
  default: 'border-mc-border bg-mc-surface text-mc-text',
  accent: 'border-mc-accent/50 bg-mc-accent-dim text-mc-accent',
  success: 'border-mc-success/50 bg-mc-success/10 text-mc-success',
  warning: 'border-mc-warning/50 bg-mc-warning/10 text-mc-warning',
  danger: 'border-mc-danger/50 bg-mc-danger/10 text-mc-danger',
  info: 'border-mc-info/50 bg-mc-info/10 text-mc-info',
  blocked: 'border-mc-blocked/50 bg-mc-blocked/10 text-mc-blocked',
};

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  variant?: ChipVariant;
  /** Inline icon before the label (e.g. Lucide icon node). */
  icon?: React.ReactNode;
  /** Render as a monospace data tag instead of uppercase label. */
  mono?: boolean;
}

export function Chip({
  tone = 'outline',
  variant = 'default',
  icon,
  mono = false,
  className,
  children,
  ...rest
}: ChipProps) {
  const toneStyles = tone === 'solid' ? SOLID[variant] : OUTLINE[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2 rounded-chip border',
        'transition-colors duration-mc ease-mc-out',
        mono
          ? 'font-mono text-[11px]'
          : 'font-sans text-[10px] font-medium uppercase tracking-label',
        toneStyles,
        className,
      )}
      {...rest}
    >
      {icon && <span className="flex items-center" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
