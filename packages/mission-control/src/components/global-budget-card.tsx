'use client';

import { useState, useTransition } from 'react';
import { updateBudgetConfig, type BudgetConfig, type BudgetMode } from '@/lib/actions/budget-config';

function barColor(pct: number): string {
  if (pct >= 100) return 'bg-mc-danger';
  if (pct >= 80) return 'bg-mc-warning';
  return 'bg-mc-success';
}

export function GlobalBudgetCard({
  config,
  mode,
  fleetDailySpend,
  fleetMonthlySpend,
}: {
  config: BudgetConfig;
  mode: BudgetMode;
  fleetDailySpend: number;  // dollars
  fleetMonthlySpend: number; // dollars
}) {
  const [editing, setEditing] = useState(false);
  const [dailyStr, setDailyStr] = useState(String(config.globalDailyLimitCents / 100));
  const [monthlyStr, setMonthlyStr] = useState(String(config.globalMonthlyLimitCents / 100));
  const [action, setAction] = useState(config.globalAction);
  const [thresholdStr, setThresholdStr] = useState(String(config.globalAlertThresholdPercent));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (mode === 'off') return null;

  const dailyLimit = config.globalDailyLimitCents / 100;
  const monthlyLimit = config.globalMonthlyLimitCents / 100;
  const dailyPct = dailyLimit > 0 ? (fleetDailySpend / dailyLimit) * 100 : 0;
  const monthlyPct = monthlyLimit > 0 ? (fleetMonthlySpend / monthlyLimit) * 100 : 0;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateBudgetConfig({
        globalDailyLimitCents: Math.round((Number(dailyStr) || 0) * 100),
        globalMonthlyLimitCents: Math.round((Number(monthlyStr) || 0) * 100),
        globalAction: action,
        globalAlertThresholdPercent: Number(thresholdStr) || 0,
      });
      if (result.ok) {
        setEditing(false);
      } else {
        setError(result.error ?? 'Save failed');
      }
    });
  }

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-accent">Global Fleet Budget</h3>
        <button
          onClick={() => editing ? save() : setEditing(true)}
          disabled={isPending}
          className="text-xs font-mono text-mc-info hover:text-mc-accent disabled:opacity-40 transition-colors"
        >
          {isPending ? '...' : editing ? 'Save' : 'Edit'}
        </button>
      </div>

      {error && (
        <div className="mb-3 text-xs text-mc-danger bg-mc-danger/10 border border-mc-danger/30 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Daily */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs text-mc-text-tertiary">Daily (fleet)</span>
            <span className="text-xs font-mono text-mc-text">
              ${fleetDailySpend.toFixed(2)} / {editing ? (
                <input
                  type="number"
                  value={dailyStr}
                  onChange={(e) => setDailyStr(e.target.value)}
                  className="w-20 bg-mc-bg border border-mc-border rounded px-1 text-xs text-mc-text"
                  min={0}
                  step={10}
                />
              ) : (
                `$${dailyLimit}`
              )}
            </span>
          </div>
          <div className="w-full bg-mc-border rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${barColor(dailyPct)}`} style={{ width: `${Math.min(dailyPct, 100)}%` }} />
          </div>
        </div>

        {/* Monthly */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs text-mc-text-tertiary">Monthly (fleet)</span>
            <span className="text-xs font-mono text-mc-text">
              ${fleetMonthlySpend.toFixed(2)} / {editing ? (
                <input
                  type="number"
                  value={monthlyStr}
                  onChange={(e) => setMonthlyStr(e.target.value)}
                  className="w-20 bg-mc-bg border border-mc-border rounded px-1 text-xs text-mc-text"
                  min={0}
                  step={100}
                />
              ) : (
                `$${monthlyLimit}`
              )}
            </span>
          </div>
          <div className="w-full bg-mc-border rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${barColor(monthlyPct)}`} style={{ width: `${Math.min(monthlyPct, 100)}%` }} />
          </div>
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-mc-text-tertiary">Action:</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as BudgetConfig['globalAction'])}
              className="bg-mc-bg border border-mc-border rounded px-2 py-0.5 text-xs text-mc-text font-mono"
            >
              <option value="alert">Alert</option>
              <option value="pause">Pause</option>
              <option value="hard_stop">Hard Stop</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-mc-text-tertiary">Alert at:</span>
            <input
              type="number"
              value={thresholdStr}
              onChange={(e) => setThresholdStr(e.target.value)}
              className="w-12 bg-mc-bg border border-mc-border rounded px-1 text-xs text-mc-text"
              min={0}
              max={100}
            />
            <span className="text-xs text-mc-text-tertiary">%</span>
          </div>
          <button
            onClick={() => { setEditing(false); setError(null); }}
            className="ml-auto text-xs text-mc-text-tertiary hover:text-mc-text"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
