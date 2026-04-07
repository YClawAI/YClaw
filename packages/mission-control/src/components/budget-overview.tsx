'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAllBudgets } from '@/lib/actions/budget';

export interface BudgetRow {
  agentId: string;
  emoji?: string;
  label: string;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  alertThresholdPercent?: number; // defaults to 80 if not set
  dailySpend: number;   // dollars (from run_records aggregation)
  monthlySpend: number; // dollars
  action: string;
  hasBudget?: boolean;  // false = agent has no saved budget config
}

function barColor(pct: number, threshold: number): string {
  if (pct >= 100) return 'bg-terminal-red';
  if (pct >= threshold) return 'bg-terminal-yellow';
  return 'bg-terminal-green';
}

export function BudgetOverview({ rows }: { rows: BudgetRow[] }) {
  const router = useRouter();
  const [batchDailyStr, setBatchDailyStr] = useState('5');
  const [batchMonthlyStr, setBatchMonthlyStr] = useState('100');
  const [showBatch, setShowBatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleBatchSet() {
    setError(null);
    startTransition(async () => {
      // Convert dollars to cents before sending
      const result = await setAllBudgets(Math.round((Number(batchDailyStr) || 0) * 100), Math.round((Number(batchMonthlyStr) || 0) * 100));
      if (result.ok) {
        setShowBatch(false);
        router.refresh();
      } else {
        setError(result.error ?? 'Failed to set budgets');
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-cyan">Per-Agent Budgets</h2>
        <button
          onClick={() => setShowBatch(!showBatch)}
          className="text-xs font-mono text-terminal-blue hover:text-terminal-cyan transition-colors"
        >
          Set All
        </button>
      </div>

      {error && (
        <div className="mb-3 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/30 rounded px-2 py-1">
          {error}
        </div>
      )}

      {showBatch && (
        <div className="bg-terminal-surface border border-terminal-border rounded p-3 mb-3 flex items-center gap-3">
          <label className="text-xs text-terminal-dim">Daily ($):</label>
          <input
            type="number"
            value={batchDailyStr}
            onChange={(e) => setBatchDailyStr(e.target.value)}
            className="w-16 bg-terminal-bg border border-terminal-border rounded px-1 text-xs text-terminal-text font-mono"
            min={0}
          />
          <label className="text-xs text-terminal-dim">Monthly ($):</label>
          <input
            type="number"
            value={batchMonthlyStr}
            onChange={(e) => setBatchMonthlyStr(e.target.value)}
            className="w-16 bg-terminal-bg border border-terminal-border rounded px-1 text-xs text-terminal-text font-mono"
            min={0}
          />
          <button
            onClick={handleBatchSet}
            disabled={isPending}
            className="px-3 py-1 text-xs font-mono rounded border border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-40"
          >
            {isPending ? '...' : 'Apply'}
          </button>
          <button
            onClick={() => { setShowBatch(false); setError(null); }}
            className="text-xs text-terminal-dim hover:text-terminal-text ml-auto"
          >
            Cancel
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-terminal-dim text-sm">No budget data. Configure budgets from agent detail pages.</p>
      ) : (
        <div className="border border-terminal-border rounded overflow-hidden">
          <table className="w-full text-sm font-mono">
            <thead className="bg-terminal-surface border-b border-terminal-border">
              <tr>
                {['Agent', 'Daily Limit', 'Daily Spend', 'Monthly Limit', 'Monthly Spend', 'Action', 'Status'].map((h) => (
                  <th key={h} className="text-left px-4 py-2 text-xs text-terminal-dim font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const threshold = row.alertThresholdPercent ?? 80;
                const dailyLimit = row.dailyLimitCents / 100;
                const monthlyLimit = row.monthlyLimitCents / 100;
                const noBudget = row.hasBudget === false;
                const dailyPct = dailyLimit > 0 ? (row.dailySpend / dailyLimit) * 100 : 0;
                const monthlyPct = monthlyLimit > 0 ? (row.monthlySpend / monthlyLimit) * 100 : 0;
                const maxPct = Math.max(dailyPct, monthlyPct);
                const statusText = noBudget ? '--' : maxPct >= 100 ? 'over' : maxPct >= threshold ? 'warning' : 'ok';
                const statusColor = noBudget ? 'text-terminal-dim' : maxPct >= 100 ? 'text-terminal-red' : maxPct >= threshold ? 'text-terminal-yellow' : 'text-terminal-green';

                return (
                  <tr key={row.agentId} className="border-b border-terminal-border/50 hover:bg-terminal-surface/50">
                    <td className="px-4 py-2">
                      <a href={`/agents/${row.agentId}`} className="text-terminal-cyan hover:underline">
                        {row.emoji && <span className="mr-1">{row.emoji}</span>}
                        {row.label}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-terminal-dim">{noBudget ? '--' : `$${dailyLimit}`}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-terminal-text">${row.dailySpend.toFixed(2)}</span>
                        {!noBudget && (
                          <div className="flex-1 bg-terminal-border rounded-full h-1.5 max-w-16">
                            <div className={`h-1.5 rounded-full ${barColor(dailyPct, threshold)}`} style={{ width: `${Math.min(dailyPct, 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-terminal-dim">{noBudget ? '--' : `$${monthlyLimit}`}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-terminal-text">${row.monthlySpend.toFixed(2)}</span>
                        {!noBudget && (
                          <div className="flex-1 bg-terminal-border rounded-full h-1.5 max-w-16">
                            <div className={`h-1.5 rounded-full ${barColor(monthlyPct, threshold)}`} style={{ width: `${Math.min(monthlyPct, 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-terminal-dim text-xs">{noBudget ? '--' : row.action}</td>
                    <td className={`px-4 py-2 text-xs font-bold ${statusColor}`}>{statusText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
