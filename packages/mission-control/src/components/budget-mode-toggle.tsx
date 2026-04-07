'use client';

import { useState, useTransition } from 'react';
import { updateBudgetConfig, type BudgetMode } from '@/lib/actions/budget-config';

const MODES: { value: BudgetMode; label: string; desc: string; color: string; activeColor: string }[] = [
  {
    value: 'enforcing',
    label: 'Enforcing',
    desc: 'Agents will be paused/stopped when over budget',
    color: 'border-terminal-green/40 text-terminal-green',
    activeColor: 'bg-terminal-green/20 border-terminal-green text-terminal-green',
  },
  {
    value: 'tracking',
    label: 'Tracking',
    desc: 'Spend is tracked and alerts fire, but no agents will be blocked',
    color: 'border-yellow-400/40 text-yellow-400',
    activeColor: 'bg-yellow-400/20 border-yellow-400 text-yellow-400',
  },
  {
    value: 'off',
    label: 'Off',
    desc: 'Budget system disabled — no tracking, no enforcement',
    color: 'border-terminal-border text-terminal-dim',
    activeColor: 'bg-terminal-dim/20 border-terminal-dim text-terminal-dim',
  },
];

export function BudgetModeToggle({ initialMode }: { initialMode: BudgetMode }) {
  const [mode, setMode] = useState<BudgetMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSwitch(newMode: BudgetMode) {
    if (newMode === mode || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await updateBudgetConfig({ mode: newMode });
      if (result.ok) {
        setMode(newMode);
      } else {
        setError(result.error ?? 'Failed to update mode');
      }
    });
  }

  const active = MODES.find((m) => m.value === mode)!;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-text">Budget System</h2>
      </div>

      <div className="flex items-center gap-2 mb-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => handleSwitch(m.value)}
            disabled={isPending}
            className={`px-4 py-2 text-xs font-mono rounded border transition-all disabled:opacity-40 ${
              mode === m.value ? m.activeColor : `${m.color} hover:bg-terminal-surface/50`
            }`}
          >
            {m.label}
          </button>
        ))}
        {isPending && <span className="text-xs text-terminal-dim ml-2">Saving...</span>}
      </div>

      <p className="text-xs text-terminal-dim">{active.desc}</p>

      {error && (
        <div className="mt-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/30 rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
