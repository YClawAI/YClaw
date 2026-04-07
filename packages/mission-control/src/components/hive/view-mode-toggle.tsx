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
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-800/50 text-gray-600 text-xs cursor-not-allowed"
        title={disabledReason || '3D not available'}
      >
        <span>2D</span>
        <span className="text-gray-700">/</span>
        <span className="text-gray-700">3D</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center rounded-lg bg-gray-800/80 backdrop-blur p-0.5">
      <button
        onClick={() => onChange('2d')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
          mode === '2d'
            ? 'bg-blue-500/20 text-blue-300 shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        2D
      </button>
      <button
        onClick={() => onChange('3d')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
          mode === '3d'
            ? 'bg-blue-500/20 text-blue-300 shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        3D
      </button>
    </div>
  );
}
