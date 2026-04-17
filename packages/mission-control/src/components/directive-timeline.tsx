'use client';

import { AGENTS } from '@/lib/agents';
import type { ObjectiveSummary } from '@/lib/objectives-queries';

interface DirectiveTimelineProps {
  objectives: ObjectiveSummary[];
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-mc-info border-mc-info/30 bg-mc-info/10',
  in_progress: 'text-mc-info border-mc-info/30 bg-mc-info/10',
  completed: 'text-mc-success border-mc-success/30 bg-mc-success/10',
  blocked: 'text-mc-danger border-mc-danger/30 bg-mc-danger/10',
  pending: 'text-mc-text-tertiary border-mc-text-tertiary/30 bg-mc-text-tertiary/10',
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'text-mc-danger bg-mc-danger/10 border-mc-danger/40',
  P1: 'text-mc-blocked bg-mc-blocked/10 border-mc-blocked/40',
  P2: 'text-mc-warning bg-mc-warning/10 border-mc-warning/40',
  P3: 'text-mc-text-tertiary bg-mc-text-tertiary/10 border-mc-text-tertiary/40',
};

const STATUS_ORDER = ['in_progress', 'active', 'blocked', 'pending', 'completed'];

function getAgentEmoji(agentId: string): string {
  const agent = AGENTS.find(a => a.name === agentId);
  return agent?.emoji ?? '';
}

function formatCost(cents: number): string {
  if (cents === 0) return '$0';
  return `$${(cents / 100).toFixed(2)}`;
}

function getKpiProgress(kpis: ObjectiveSummary['kpis']): { done: number; total: number } | null {
  if (!kpis || kpis.length === 0) return null;
  const done = kpis.reduce((s, k) => s + Math.min(k.current, k.target), 0);
  const total = kpis.reduce((s, k) => s + k.target, 0);
  if (total === 0) return null;
  return { done, total };
}

export function DirectiveTimeline({ objectives }: DirectiveTimelineProps) {
  if (objectives.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-4">
          Directives
        </h3>
        <div className="text-xs text-mc-text-tertiary text-center py-8">
          No objectives tracked yet.
        </div>
      </div>
    );
  }

  // Group by status, sorted by STATUS_ORDER
  const grouped = new Map<string, ObjectiveSummary[]>();
  for (const obj of objectives) {
    const existing = grouped.get(obj.status);
    if (existing) {
      existing.push(obj);
    } else {
      grouped.set(obj.status, [obj]);
    }
  }

  const sortedGroups = [...grouped.entries()].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a[0]);
    const bi = STATUS_ORDER.indexOf(b[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-4">
        Directives
      </h3>

      <div className="space-y-4">
        {sortedGroups.map(([status, items]) => (
          <div key={status}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${STATUS_COLORS[status] ?? 'text-mc-text-tertiary border-mc-border'}`}
              >
                {status.replace('_', ' ')}
              </span>
              <span className="text-[10px] text-mc-text-tertiary font-mono">{items.length}</span>
            </div>

            {status === 'completed' ? (
              /* Completed items: condensed single-line */
              <ul className="space-y-1">
                {items.map((obj) => (
                  <li key={obj.id} className="flex items-center gap-2 pl-2 py-0.5">
                    <span className="text-mc-success text-xs shrink-0">&#10003;</span>
                    <span className="text-xs text-mc-text-tertiary truncate flex-1">{obj.title}</span>
                    {obj.ownerAgentId && (
                      <span className="text-[10px] text-mc-text-tertiary shrink-0" title={obj.ownerAgentId}>
                        {getAgentEmoji(obj.ownerAgentId) || obj.ownerAgentId}
                      </span>
                    )}
                    {obj.costSpentCents > 0 && (
                      <span className="text-[10px] text-mc-text-tertiary font-mono shrink-0">
                        {formatCost(obj.costSpentCents)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              /* Active items: full detail rows */
              <ul className="space-y-2">
                {items.map((obj) => {
                  const kpiProgress = getKpiProgress(obj.kpis);
                  const costPct = obj.costBudgetCents > 0
                    ? Math.min(100, Math.round((obj.costSpentCents / obj.costBudgetCents) * 100))
                    : 0;
                  const taskProgress = obj.childTaskCount > 0 ? obj.childTaskCount : null;

                  return (
                    <li key={obj.id} className="pl-2 py-1.5 border-l-2 border-mc-border hover:border-mc-border transition-colors">
                      {/* Row 1: priority, title, owner */}
                      <div className="flex items-center gap-2 mb-1">
                        {/* Priority badge */}
                        <span
                          className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded border shrink-0 ${PRIORITY_COLORS[obj.priority] ?? PRIORITY_COLORS.P2}`}
                        >
                          {obj.priority}
                        </span>

                        {/* Title */}
                        <span className="text-xs text-mc-text truncate flex-1">{obj.title}</span>

                        {/* Owner agent */}
                        {obj.ownerAgentId && (
                          <span className="text-[10px] text-mc-text-tertiary shrink-0" title={obj.ownerAgentId}>
                            {getAgentEmoji(obj.ownerAgentId) || obj.ownerAgentId}
                          </span>
                        )}
                      </div>

                      {/* Row 2: KPI progress, cost bar */}
                      <div className="flex items-center gap-3 pl-6">
                        {/* KPI progress */}
                        {kpiProgress && (
                          <span className="text-[10px] text-mc-text-tertiary font-mono">
                            KPI: {kpiProgress.done}/{kpiProgress.total}
                          </span>
                        )}

                        {/* Task count */}
                        {taskProgress !== null && (
                          <span className="text-[10px] text-mc-text-tertiary font-mono">
                            {taskProgress} task{taskProgress !== 1 ? 's' : ''}
                          </span>
                        )}

                        {/* Cost progress bar */}
                        {obj.costBudgetCents > 0 && (
                          <div className="flex items-center gap-1.5 flex-1 max-w-[140px]">
                            <div className="flex-1 h-1.5 bg-mc-border rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${costPct > 90 ? 'bg-mc-danger' : costPct > 70 ? 'bg-mc-warning' : 'bg-mc-success'}`}
                                style={{ width: `${costPct}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-mc-text-tertiary font-mono shrink-0">
                              {formatCost(obj.costSpentCents)}/{formatCost(obj.costBudgetCents)}
                            </span>
                          </div>
                        )}

                        {/* Spend only (no budget) */}
                        {obj.costBudgetCents === 0 && obj.costSpentCents > 0 && (
                          <span className="text-[10px] text-mc-text-tertiary font-mono">
                            spent {formatCost(obj.costSpentCents)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
