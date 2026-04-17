'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  DeptSettingsShell, DepartmentDirectiveSection, AgentsSection,
  NotificationsSection, SettingsSection, ToggleSwitch,
  useDeptSaveState, buildCronStates, buildEventStates, toggleNested,
  DEFAULT_MODELS,
} from './department-settings-shared';
import { BudgetModeToggle } from './budget-mode-toggle';
import { GlobalBudgetCard } from './global-budget-card';
import { BudgetOverview } from './budget-overview';
import type { BudgetRow } from './budget-overview';
import { BudgetEditor } from './budget-editor';
import type { AgentCardConfig, AlertDef } from './department-settings-shared';
import type { BudgetSummary } from '@/lib/treasury-data';
import { useDepartmentSettings } from '@/hooks/use-department-settings';

// ── Icons ───────────────────────────────────────────────────────────────────────

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
    </svg>
  );
}

// ── Agent Config ──────────────────────────────────────────────────────────────────

const TREASURER: AgentCardConfig = {
  name: 'treasurer',
  label: 'Treasurer',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 0,
  learnedSkills: ['ai-usage-tracking', 'infra-cost-tracking', 'treasury-operations', 'treasury-protocol-reference'],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch'] },
    { platform: 'Slack', actions: ['message', 'thread_reply', 'alert'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '22 13 * * *' },
    { task: 'treasury_check', cron: '0 7 * * *' },
    { task: 'weekly_spend', cron: '0 8 * * 1' },
    { task: 'monthly_summary', cron: '0 8 1 * *' },
  ],
  eventTriggers: [
    { event: 'treasurer:directive', label: 'Handle Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const AGENTS: AgentCardConfig[] = [TREASURER];

// ── Notifications ─────────────────────────────────────────────────────────────────

const ALERTS: AlertDef[] = [
  { key: 'budgetExceeded', label: 'Budget exceeded', desc: 'Alert when any agent exceeds daily/monthly budget' },
  { key: 'spendSpike', label: 'Spend spike detected', desc: 'Alert when spend increases rapidly' },
  { key: 'treasuryLow', label: 'Treasury balance low', desc: 'Alert when treasury drops below threshold' },
  { key: 'agentError', label: 'Agent error state', desc: 'Alert when Treasurer enters error state' },
  { key: 'reportReady', label: 'Report ready', desc: 'Notify when weekly/monthly report is generated' },
];

// ── Form State ─────────────────────────────────────────────────────────────────────

interface FinForm {
  directive: string;
  cronStates: Record<string, Record<string, boolean>>;
  eventStates: Record<string, Record<string, boolean>>;
  agentModels: Record<string, { model?: string; temperature?: number; creativityIndex?: number }>;
  aiUsageTracking: boolean;
  infraCostTracking: boolean;
  reportFrequency: string;
  alerts: Record<string, boolean>;
  slackChannel: string;
}

const INITIAL: FinForm = {
  directive: '',
  cronStates: buildCronStates(AGENTS),
  eventStates: buildEventStates(AGENTS),
  agentModels: {},
  aiUsageTracking: true,
  infraCostTracking: true,
  reportFrequency: 'weekly',
  alerts: { budgetExceeded: true, spendSpike: true, treasuryLow: true, agentError: true, reportReady: false },
  slackChannel: '#yclaw-treasury',
};

// ── Per-agent budget editor (inline within the accordion) ────────────────────

function AgentBudgetRow({ agent }: {
  agent: BudgetSummary['agents'][number];
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {agent.emoji && <span className="text-sm">{agent.emoji}</span>}
          <span className="font-sans text-xs text-mc-text truncate">{agent.label}</span>
        </div>
        <div className="flex items-center gap-3 font-mono tabular-nums text-[10px] text-mc-text-tertiary shrink-0">
          <span>${(agent.dailySpendCents / 100).toFixed(2)} / ${(agent.dailyLimitCents / 100).toFixed(0)}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-sans text-[9px] uppercase tracking-label px-1.5 py-0.5 rounded-panel border border-mc-border text-mc-text-tertiary hover:text-mc-text hover:border-mc-border-hover transition-colors duration-mc ease-mc-out"
          >
            edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-2 border-t border-mc-border/40">
      <BudgetEditor
        agentId={agent.agentId}
        budget={{
          agentId: agent.agentId,
          dailyLimitCents: agent.dailyLimitCents,
          monthlyLimitCents: agent.monthlyLimitCents,
          action: agent.action === 'pause' || agent.action === 'hard_stop' ? agent.action : 'alert',
          alertThresholdPercent: agent.alertThresholdPercent,
        }}
        dailySpend={agent.dailySpendCents / 100}
        monthlySpend={agent.monthlySpendCents / 100}
      />
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="mt-2 font-sans text-[9px] uppercase tracking-label px-2 py-0.5 rounded-panel border border-mc-border text-mc-text-tertiary hover:text-mc-text transition-colors duration-mc ease-mc-out"
      >
        collapse
      </button>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  budgetData?: BudgetSummary;
  budgetRows?: BudgetRow[];
}

export function FinanceSettings({ open, onClose, budgetData, budgetRows }: Props) {
  const [exp, setExp] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<FinForm>(INITIAL);
  const { dirty, saveState, saveError, markDirty, setDirty, handleSave } = useDeptSaveState('finance');
  const { settings, hasLoaded } = useDepartmentSettings('finance');

  useEffect(() => {
    if (!hasLoaded || dirty || Object.keys(settings).length === 0) return;
    const agentModels: Record<string, { model?: string; temperature?: number; creativityIndex?: number }> = {};
    const agents = (settings as Record<string, unknown>)?.agents as Record<string, Record<string, unknown>> | undefined;
    if (agents) {
      for (const [name, data] of Object.entries(agents)) {
        if (data?.model || data?.temperature !== undefined) {
          agentModels[name] = {
            model: data.model as string | undefined,
            temperature: data.temperature as number | undefined,
            creativityIndex: data.temperature === 0 ? 0 : data.temperature === 1.3 ? 2 : data.temperature != null ? 1 : undefined,
          };
        }
      }
    }
    setForm((prev) => ({
      ...prev,
      directive: typeof settings.directive === 'string' ? settings.directive : prev.directive,
      cronStates: settings.cronStates && typeof settings.cronStates === 'object'
        ? settings.cronStates as Record<string, Record<string, boolean>>
        : prev.cronStates,
      eventStates: settings.eventStates && typeof settings.eventStates === 'object'
        ? settings.eventStates as Record<string, Record<string, boolean>>
        : prev.eventStates,
      agentModels,
      aiUsageTracking: typeof settings.aiUsageTracking === 'boolean' ? settings.aiUsageTracking : prev.aiUsageTracking,
      infraCostTracking: typeof settings.infraCostTracking === 'boolean' ? settings.infraCostTracking : prev.infraCostTracking,
      reportFrequency: typeof settings.reportFrequency === 'string' ? settings.reportFrequency : prev.reportFrequency,
      alerts: settings.alerts && typeof settings.alerts === 'object'
        ? settings.alerts as Record<string, boolean>
        : prev.alerts,
      slackChannel: typeof settings.slackChannel === 'string' ? settings.slackChannel : prev.slackChannel,
    }));
  }, [hasLoaded, settings, dirty]);

  const tog = (k: string) => setExp((p) => ({ ...p, [k]: !p[k] }));
  const set = useCallback(<K extends keyof FinForm>(k: K, v: FinForm[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    setDirty(true);
  }, [setDirty]);

  const handleModelSelect = (agent: string, modelId: string) => {
    set('agentModels', {
      ...form.agentModels,
      [agent]: { ...(form.agentModels[agent] ?? {}), model: modelId },
    });
  };

  const handleCreativitySelect = (agent: string, creativityIndex: number, temperature: number) => {
    set('agentModels', {
      ...form.agentModels,
      [agent]: { ...(form.agentModels[agent] ?? {}), temperature, creativityIndex },
    });
  };

  return (
    <DeptSettingsShell open={open} onClose={onClose} title="Finance Settings" dirty={dirty} saveState={saveState} saveError={saveError} onSave={() => handleSave('Finance Settings', form)}>
      {/* Budget Controls — the live system, shown first without preview banner */}
      <SettingsSection label="Budget Controls" icon={<DollarIcon className="w-4 h-4 text-mc-success" />} iconColor="mc-success" expanded={exp['budget'] ?? false} onToggle={() => tog('budget')}>
        {budgetData ? (
          <div className="space-y-5">
            <div>
              <h4 className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label mb-2">Budget Mode</h4>
              <BudgetModeToggle initialMode={budgetData.config.mode} />
            </div>
            <div>
              <h4 className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label mb-2">Global Fleet Budget</h4>
              <GlobalBudgetCard
                config={budgetData.config}
                mode={budgetData.config.mode}
                fleetDailySpend={budgetData.fleetDailySpendCents / 100}
                fleetMonthlySpend={budgetData.fleetMonthlySpendCents / 100}
              />
            </div>
            <div>
              <h4 className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label mb-2">Per-Agent Budgets</h4>
              {budgetRows ? (
                <BudgetOverview rows={budgetRows} />
              ) : (
                <div className="space-y-0.5">
                  {budgetData.agents.map((agent) => (
                    <AgentBudgetRow key={agent.agentId} agent={agent} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="font-sans text-xs text-mc-text-tertiary italic p-3 bg-mc-surface/50 border border-mc-border rounded-panel">
            Budget data unavailable. Budget controls will appear here when treasury data loads.
          </div>
        )}
      </SettingsSection>

      <DepartmentDirectiveSection directive={form.directive} onDirectiveChange={(v) => set('directive', v)} expanded={exp['directive'] ?? false} onToggle={() => tog('directive')} />

      <AgentsSection
        agents={AGENTS} models={DEFAULT_MODELS}
        cronStates={form.cronStates} eventStates={form.eventStates}
        onCronToggle={(a, t) => { set('cronStates', toggleNested(form.cronStates, a, t)); }}
        onEventToggle={(a, e) => { set('eventStates', toggleNested(form.eventStates, a, e)); }}
        onDirty={markDirty}
        onModelSelect={handleModelSelect}
        onCreativitySelect={handleCreativitySelect}
        agentModels={form.agentModels}
        expanded={exp['agents'] ?? false} onToggle={() => tog('agents')}
      />

      {/* Cost Tracking */}
      <SettingsSection label="Cost Tracking" icon={<ChartIcon className="w-4 h-4 text-mc-info" />} iconColor="mc-info" expanded={exp['cost'] ?? false} onToggle={() => tog('cost')}>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">AI usage tracking</span><span className="font-sans text-[10px] text-mc-text-tertiary">Track token usage and costs per agent</span></div>
          <ToggleSwitch checked={form.aiUsageTracking} onChange={(v) => set('aiUsageTracking', v)} color="mc-info" />
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Infrastructure cost tracking</span><span className="font-sans text-[10px] text-mc-text-tertiary">Track ECS, Redis, MongoDB costs</span></div>
          <ToggleSwitch checked={form.infraCostTracking} onChange={(v) => set('infraCostTracking', v)} color="mc-info" />
        </div>
        <div>
          <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">Report Frequency</label>
          <select className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-sans text-xs text-mc-text focus:outline-none focus:border-mc-info transition-colors duration-mc ease-mc-out" value={form.reportFrequency} onChange={(e) => set('reportFrequency', e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </SettingsSection>

      <NotificationsSection
        alerts={ALERTS} alertStates={form.alerts}
        onAlertToggle={(k, v) => { set('alerts', { ...form.alerts, [k]: v }); }}
        slackChannel={form.slackChannel} onSlackChannelChange={(v) => set('slackChannel', v)}
        expanded={exp['notif'] ?? false} onToggle={() => tog('notif')}
      />
    </DeptSettingsShell>
  );
}
