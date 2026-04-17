'use client';

import { useState, useEffect, useTransition } from 'react';
import { updateBudget, type AgentBudget } from '@/lib/actions/budget';

interface BudgetEditorProps {
  agentId: string;
  budget: AgentBudget | null;
  dailySpend: number;
  monthlySpend: number;
}

export function BudgetEditor({ agentId, budget, dailySpend, monthlySpend }: BudgetEditorProps) {
  const [savedBudget, setSavedBudget] = useState<AgentBudget | null>(budget);
  // String state for inputs so users can clear fields while editing
  const [dailyStr, setDailyStr] = useState(String((budget?.dailyLimitCents ?? 1000) / 100));
  const [monthlyStr, setMonthlyStr] = useState(String((budget?.monthlyLimitCents ?? 20000) / 100));
  const [action, setAction] = useState<AgentBudget['action']>(budget?.action ?? 'alert');
  const [thresholdStr, setThresholdStr] = useState(String(budget?.alertThresholdPercent ?? 80));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sync local state when budget prop changes
  useEffect(() => {
    if (!editing) {
      setSavedBudget(budget);
      setDailyStr(String((budget?.dailyLimitCents ?? 1000) / 100));
      setMonthlyStr(String((budget?.monthlyLimitCents ?? 20000) / 100));
      setAction(budget?.action ?? 'alert');
      setThresholdStr(String(budget?.alertThresholdPercent ?? 80));
    }
  }, [budget, editing]);

  function save() {
    const dailyDollars = Number(dailyStr) || 0;
    const monthlyDollars = Number(monthlyStr) || 0;
    const threshold = Number(thresholdStr) || 0;
    setError(null);
    startTransition(async () => {
      const result = await updateBudget(agentId, {
        dailyLimitCents: Math.round(dailyDollars * 100),
        monthlyLimitCents: Math.round(monthlyDollars * 100),
        action,
        alertThresholdPercent: threshold,
      });
      if (result.ok) {
        setSavedBudget({
          agentId,
          dailyLimitCents: Math.round(dailyDollars * 100),
          monthlyLimitCents: Math.round(monthlyDollars * 100),
          action,
          alertThresholdPercent: threshold,
        });
        setEditing(false);
      } else {
        setError(result.error ?? 'Save failed');
      }
    });
  }

  const dailyLimit = (savedBudget?.dailyLimitCents ?? 1000) / 100;
  const monthlyLimit = (savedBudget?.monthlyLimitCents ?? 20000) / 100;
  const dailyPct = dailyLimit > 0 ? (dailySpend / dailyLimit) * 100 : 0;
  const monthlyPct = monthlyLimit > 0 ? (monthlySpend / monthlyLimit) * 100 : 0;

  function barColor(pct: number): string {
    if (pct >= 100) return 'bg-mc-danger';
    if (pct >= 80) return 'bg-mc-warning';
    return 'bg-mc-success';
  }

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-success">Budget</h3>
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
            <span className="text-xs text-mc-text-tertiary">Daily</span>
            <span className="text-xs font-mono text-mc-text">
              ${dailySpend.toFixed(2)} / {editing ? (
                <input
                  type="number"
                  value={dailyStr}
                  onChange={(e) => setDailyStr(e.target.value)}
                  className="w-16 bg-mc-bg border border-mc-border rounded px-1 text-xs text-mc-text"
                  min={0}
                  step={1}
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
            <span className="text-xs text-mc-text-tertiary">Monthly</span>
            <span className="text-xs font-mono text-mc-text">
              ${monthlySpend.toFixed(2)} / {editing ? (
                <input
                  type="number"
                  value={monthlyStr}
                  onChange={(e) => setMonthlyStr(e.target.value)}
                  className="w-16 bg-mc-bg border border-mc-border rounded px-1 text-xs text-mc-text"
                  min={0}
                  step={10}
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
              onChange={(e) => setAction(e.target.value as AgentBudget['action'])}
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
