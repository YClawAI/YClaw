'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * SpaceX Toggle — used throughout settings drawers and inline controls.
 * When `on`, the track fills with the accent color and a soft glow; when
 * `off`, it matches the Panel border hue. The `variant` prop swaps in
 * semantic colors for critical toggles (e.g. fleet kill switch uses
 * `danger`, auto-deploy uses `warning`).
 */

type ToggleVariant = 'accent' | 'success' | 'warning' | 'danger';

const TRACK_ON: Record<ToggleVariant, string> = {
  accent: 'bg-mc-accent shadow-[0_0_10px_rgba(90,200,250,0.45)]',
  success: 'bg-mc-success shadow-[0_0_10px_rgba(48,209,88,0.45)]',
  warning: 'bg-mc-warning shadow-[0_0_10px_rgba(255,214,10,0.45)]',
  danger: 'bg-mc-danger shadow-[0_0_10px_rgba(255,69,58,0.45)]',
};

export interface ToggleProps {
  /** Current on/off state — controlled by parent. */
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label to the left of the track (optional). */
  label?: React.ReactNode;
  /** Smaller caption beneath the label. */
  description?: React.ReactNode;
  variant?: ToggleVariant;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  variant = 'accent',
  disabled = false,
  id,
  className,
}: ToggleProps) {
  const autoId = React.useId();
  const toggleId = id ?? autoId;

  const track = cn(
    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full',
    'border transition-colors duration-mc ease-mc-out',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-mc-accent focus-visible:outline-offset-2',
    checked
      ? cn('border-transparent', TRACK_ON[variant])
      : 'border-mc-border bg-transparent hover:border-mc-border-hover',
    disabled && 'opacity-40 cursor-not-allowed',
  );

  const thumb = cn(
    'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-mc ease-mc-out',
    checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
  );

  return (
    <label
      htmlFor={toggleId}
      className={cn(
        'flex items-center gap-3 cursor-pointer select-none',
        disabled && 'cursor-not-allowed',
        className,
      )}
    >
      <button
        id={toggleId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={track}
      >
        <span className={thumb} aria-hidden="true" />
      </button>
      {(label || description) && (
        <div className="flex flex-col gap-0.5 min-w-0">
          {label && (
            <span className="font-sans text-xs text-mc-text">{label}</span>
          )}
          {description && (
            <span className="font-sans text-[11px] text-mc-text-tertiary">{description}</span>
          )}
        </div>
      )}
    </label>
  );
}
