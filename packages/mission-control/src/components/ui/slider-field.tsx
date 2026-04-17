'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * SpaceX SliderField — used for agent creativity/temperature, risk
 * thresholds, cost caps. Cyan track fill up to the thumb, dim hairline
 * rail beyond. Renders an optional label + formatted value readout
 * above the rail. Owns no state — parent is the source of truth.
 *
 * The thumb is a 12px circle with a soft cyan halo; on drag, the halo
 * brightens. Keyboard support: left/right arrows nudge by `step`,
 * shift+arrow nudges by `step * 10`.
 */

export interface SliderFieldProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: React.ReactNode;
  /** Formatter for the right-side readout. Defaults to raw value. */
  format?: (value: number) => string;
  /** Inline helper beneath the rail. */
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function SliderField({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  format,
  description,
  disabled = false,
  id,
  className,
}: SliderFieldProps) {
  const autoId = React.useId();
  const inputId = id ?? autoId;

  // Clamp so downstream consumers never get out-of-range values on drag end.
  const clamped = Math.min(max, Math.max(min, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const readout = format ? format(clamped) : String(clamped);

  return (
    <div className={cn('flex flex-col gap-2', disabled && 'opacity-50', className)}>
      {(label || format) && (
        <div className="flex items-center justify-between gap-3">
          {label && (
            <label
              htmlFor={inputId}
              className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label"
            >
              {label}
            </label>
          )}
          <span className="font-mono text-xs text-mc-text tabular-nums">{readout}</span>
        </div>
      )}
      <div className="relative h-6 flex items-center">
        {/* Rail */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-mc-border" />
        {/* Filled section */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-px bg-mc-accent"
          style={{ width: `${pct}%` }}
        />
        <input
          id={inputId}
          type="range"
          value={clamped}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          // Native range styled to be invisible — we render the visual rail
          // above, but keep the native input for accessibility + keyboard.
          className={cn(
            'relative z-10 w-full h-6 appearance-none bg-transparent cursor-pointer',
            'focus-visible:outline-none',
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white',
            '[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-mc-accent',
            '[&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(90,200,250,0.2)]',
            '[&::-webkit-slider-thumb]:transition-shadow',
            'hover:[&::-webkit-slider-thumb]:shadow-[0_0_0_5px_rgba(90,200,250,0.25)]',
            'focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_6px_rgba(90,200,250,0.35)]',
            '[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3',
            '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white',
            '[&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-mc-accent',
          )}
        />
      </div>
      {description && (
        <p className="font-sans text-[11px] text-mc-text-tertiary">{description}</p>
      )}
    </div>
  );
}
