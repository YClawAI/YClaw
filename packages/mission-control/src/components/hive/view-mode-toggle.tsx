'use client';

import type { ViewMode } from './hive-types';

interface ViewModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function ViewModeToggle({ mode, onChange, disabled, disabledReason }: ViewModeToggleProps) {
  if (disabled) {
    return (
      <div
        className="inline-flex items-center gap-1 px-2 py-1 rounded-chip border border-mc-border font-sans text-xs text-mc-text-tertiary cursor-not-allowed"
        title={disabledReason || '3D not available'}
      >
        <span>2D</span>
        <span className="text-mc-text-tertiary/60">/</span>
        <span className="text-mc-text-tertiary/60">3D</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center rounded-chip border border-mc-border bg-mc-surface backdrop-blur p-0.5">
      <button
        onClick={() => onChange('2d')}
        className={`px-3 py-1 font-sans text-xs font-medium rounded-chip transition-colors duration-mc ease-mc-out ${
          mode === '2d'
            ? 'bg-mc-accent-dim text-mc-accent'
            : 'text-mc-text-secondary hover:text-mc-text'
        }`}
      >
        2D
      </button>
      <button
        onClick={() => onChange('3d')}
        className={`px-3 py-1 font-sans text-xs font-medium rounded-chip transition-colors duration-mc ease-mc-out ${
          mode === '3d'
            ? 'bg-mc-accent-dim text-mc-accent'
            : 'text-mc-text-secondary hover:text-mc-text'
        }`}
      >
        3D
      </button>
    </div>
  );
}
