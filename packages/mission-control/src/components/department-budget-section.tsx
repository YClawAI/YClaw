'use client';

import { BudgetEditor } from '@/components/budget-editor';
import { BudgetModeToggle } from '@/components/budget-mode-toggle';
import type { AgentBudget } from '@/lib/actions/budget';
import type { BudgetMode } from '@/lib/actions/budget-config';
import type { AgentSpend } from '@/lib/cost-queries';

export interface AgentModelConfig {
  name: string;
  label: string;
  provider: string;
  model: string;
  temperature: number;
}

export interface AgentCronSchedule {
  name: string;
  label: string;
  schedules: { task: string; schedule: string }[];
}

interface DepartmentBudgetSectionProps {
  budgets: AgentBudget[];
  budgetMode: BudgetMode;
  agentNames: string[];
  agentLabels: Record<string, string>;
  modelConfigs: AgentModelConfig[];
  cronSchedules: AgentCronSchedule[];
  agentSpend?: AgentSpend[];
}

export function DepartmentBudgetSection({
  budgets,
  budgetMode,
  agentNames,
  agentLabels,
  modelConfigs,
  cronSchedules,
  agentSpend,
}: DepartmentBudgetSectionProps) {
  return (
    <div className="space-y-6">
      {/* Budget Mode Toggle */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <BudgetModeToggle initialMode={budgetMode} />
      </div>

      {/* Per-Agent Budget Editors */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-3">
          Agent Budgets
        </h3>
        <div className="space-y-3">
          {agentNames.map((name) => {
            const budget = budgets.find((b) => b.agentId === name) ?? null;
            const spend = agentSpend?.find((s) => s.agentId === name);
            return (
              <div key={name}>
                <div className="text-xs font-mono text-terminal-text mb-1">
                  {agentLabels[name] ?? name}
                </div>
                <BudgetEditor
                  agentId={name}
                  budget={budget}
                  dailySpend={spend?.today ?? 0}
                  monthlySpend={spend?.month ?? 0}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Model Config (read-only) */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-3">
          Model Configuration
        </h3>
        <div className="space-y-2">
          {modelConfigs.map((cfg) => (
            <div
              key={cfg.name}
              className="bg-terminal-surface border border-terminal-border rounded p-3"
            >
              <div className="text-xs font-mono text-terminal-text mb-2">{cfg.label}</div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-terminal-dim block">Provider</span>
                  <span className="text-terminal-text font-mono">{cfg.provider}</span>
                </div>
                <div>
                  <span className="text-terminal-dim block">Model</span>
                  <span className="text-terminal-text font-mono">{cfg.model}</span>
                </div>
                <div>
                  <span className="text-terminal-dim block">Temperature</span>
                  <span className="text-terminal-text font-mono">{cfg.temperature}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cron Schedules (read-only) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim">
            Cron Schedules
          </h3>
          <span className="text-[9px] text-terminal-dim font-mono">
            Read-only -- editing in Phase 4
          </span>
        </div>
        <div className="space-y-2">
          {cronSchedules.map((agent) => (
            <div
              key={agent.name}
              className="bg-terminal-surface border border-terminal-border rounded p-3"
            >
              <div className="text-xs font-mono text-terminal-text mb-2">{agent.label}</div>
              {agent.schedules.length === 0 ? (
                <div className="text-[10px] text-terminal-dim">No cron schedules (event-driven)</div>
              ) : (
                <div className="space-y-1">
                  {agent.schedules.map((s) => (
                    <div key={s.task} className="flex items-center justify-between text-[10px]">
                      <span className="text-terminal-text font-mono">{s.task}</span>
                      <span className="text-terminal-dim font-mono">{s.schedule}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
