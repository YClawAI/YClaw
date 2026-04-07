'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  DeptSettingsShell, DepartmentDirectiveSection, AgentsSection,
  NotificationsSection, SettingsSection, ToggleSwitch, InfoTooltip,
  useDeptSaveState, buildCronStates, buildEventStates, toggleNested,
  DEFAULT_MODELS,
} from './department-settings-shared';
import type { AgentCardConfig, AlertDef } from './department-settings-shared';
import { useDepartmentSettings } from '@/hooks/use-department-settings';

// ── Icons ────────────────────────────────────────────────────────────────────

function BookOpenIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function RouteIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

// ── Agent Config ─────────────────────────────────────────────────────────────

const SENTINEL: AgentCardConfig = {
  name: 'sentinel',
  label: 'Sentinel',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 0,
  learnedSkills: ['code-audit-standards', 'deploy-health-checklist', 'post-deploy-verification'],
  integrations: [
    { platform: 'GitHub', actions: ['get_contents', 'get_diff', 'repo:list'] },
    { platform: 'Deploy', actions: ['assess', 'status'] },
    { platform: 'CodeGen', actions: ['execute', 'status'] },
    { platform: 'Slack', actions: ['message', 'alert', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '15 13 * * *' },
    { task: 'deployment_health', cron: '0 */4 * * *' },
    { task: 'code_quality_audit', cron: '0 10 * * 1,4' },
    { task: 'weekly_repo_digest', cron: '0 17 * * 5' },
  ],
  eventTriggers: [
    { event: 'architect:deploy_complete', label: 'Post-Deploy Verification' },
    { event: 'sentinel:directive', label: 'Handle Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection', modelOverride: 'Sonnet' },
  ],
};

const LIBRARIAN: AgentCardConfig = {
  name: 'librarian',
  label: 'Librarian',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 0,
  learnedSkills: [],
  integrations: [
    { platform: 'Vault', actions: ['read', 'search', 'write'] },
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_curation', cron: '0 14 * * *' },
    { task: 'weekly_curation', cron: '0 8 * * 1' },
  ],
  eventTriggers: [
    { event: 'claudeception:reflect', label: 'Self Reflection', modelOverride: 'Sonnet' },
  ],
};

const AGENTS: AgentCardConfig[] = [SENTINEL, LIBRARIAN];

// ── Runbooks ─────────────────────────────────────────────────────────────────

interface RunbookDef {
  id: string;
  filename: string;
  label: string;
  lineCount: string;
  placeholder: string;
}

const RUNBOOKS: RunbookDef[] = [
  { id: 'codeAudit', filename: 'code-audit-standards.md', label: 'Code Audit Standards', lineCount: '50 lines', placeholder: '# Code Audit Standards\n\nDefine code quality thresholds, patterns to flag, severity classifications...' },
  { id: 'deployHealth', filename: 'deploy-health-checklist.md', label: 'Deploy Health Checklist', lineCount: '50 lines', placeholder: '# Deploy Health Checklist\n\nPost-deploy verification steps, rollback criteria, health check endpoints...' },
  { id: 'postDeploy', filename: 'post-deploy-verification.md', label: 'Post-Deploy Verification', lineCount: '77 lines', placeholder: '# Post-Deploy Verification\n\nCanary analysis procedures, traffic shift criteria, error budget checks...' },
];

// ── Notifications ────────────────────────────────────────────────────────────

const ALERTS: AlertDef[] = [
  { key: 'deployHealthDone', label: 'Deploy health check completed', desc: 'Notify when scheduled health check finishes' },
  { key: 'deployVerifyFail', label: 'Deploy verification failed', desc: 'Alert when post-deploy verification detects issues' },
  { key: 'auditDone', label: 'Code quality audit completed', desc: 'Notify when a code audit run finishes' },
  { key: 'qualityBelow', label: 'Code quality below threshold', desc: 'Alert when a repo scores below minimum quality' },
  { key: 'repoDigest', label: 'Weekly repo digest ready', desc: 'Notify when the weekly digest is generated' },
  { key: 'serviceRestart', label: 'Service restart triggered', desc: 'Alert when auto-restart fires for a failed service' },
];

// ── Form State ───────────────────────────────────────────────────────────────

interface OpsForm {
  directive: string;
  cronStates: Record<string, Record<string, boolean>>;
  eventStates: Record<string, Record<string, boolean>>;
  agentModels: Record<string, { model?: string; temperature?: number; creativityIndex?: number }>;
  runbooks: Record<string, string>;
  healthCheckInterval: string;
  autoRestart: boolean;
  failuresBeforeAlert: string;
  auditFrequency: string;
  minQualityScore: string;
  defaultSeverity: string;
  deployFailImmediate: boolean;
  qualityDropDigest: boolean;
  degradationImmediate: boolean;
  primaryChannel: string;
  secondaryChannel: string;
  escalateToExec: boolean;
  alerts: Record<string, boolean>;
  slackChannel: string;
}

const INITIAL: OpsForm = {
  directive: '',
  cronStates: buildCronStates(AGENTS),
  eventStates: buildEventStates(AGENTS),
  agentModels: {},
  runbooks: Object.fromEntries(RUNBOOKS.map((r) => [r.id, ''])),
  healthCheckInterval: '4h',
  autoRestart: false,
  failuresBeforeAlert: '3',
  auditFrequency: 'mon-thu',
  minQualityScore: '80',
  defaultSeverity: 'warning',
  deployFailImmediate: true,
  qualityDropDigest: true,
  degradationImmediate: true,
  primaryChannel: '#yclaw-alerts',
  secondaryChannel: '#yclaw-operations',
  escalateToExec: false,
  alerts: { deployHealthDone: false, deployVerifyFail: true, auditDone: false, qualityBelow: true, repoDigest: true, serviceRestart: true },
  slackChannel: '#yclaw-operations',
};

// ── Runbook Item (expand/collapse with editable textarea) ────────────────────

function RunbookItem({
  doc,
  value,
  onChange,
}: {
  doc: RunbookDef;
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-terminal-border/60 rounded overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-terminal-muted/10 transition-colors ${
          open ? 'bg-terminal-muted/10' : ''
        }`}
      >
        <div className="min-w-0">
          <div className="text-xs text-terminal-text font-medium">{doc.label}</div>
          <div className="text-[9px] text-terminal-dim">{doc.lineCount} · Used by: Sentinel</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[9px] text-terminal-dim font-mono">{doc.filename}</span>
          <span className="text-terminal-dim text-xs">{open ? '\u2212' : '+'}</span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <textarea
            className="w-full bg-terminal-bg border border-terminal-border rounded p-2 text-xs text-terminal-text font-mono resize-y focus:outline-none focus:border-terminal-green placeholder:text-terminal-dim/40"
            style={{ maxHeight: 300, minHeight: value ? 150 : 80 }}
            placeholder={doc.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={value ? 10 : 4}
          />
        </div>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props { open: boolean; onClose: () => void }

export function OperationsSettings({ open, onClose }: Props) {
  const [exp, setExp] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<OpsForm>(INITIAL);
  const { dirty, saveState, markDirty, setDirty, handleSave: deptSave } = useDeptSaveState('operations');
  const { settings: saved, hasLoaded } = useDepartmentSettings('operations');

  // Load saved settings on mount — fall back to hardcoded defaults
  useEffect(() => {
    if (!hasLoaded) return;
    if (Object.keys(saved).length === 0) return;
    const agentModels: Record<string, { model?: string; temperature?: number; creativityIndex?: number }> = {};
    const agents = (saved as Record<string, unknown>)?.agents as Record<string, Record<string, unknown>> | undefined;
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
    setForm((prev) => ({ ...prev, ...saved, agentModels } as OpsForm));
  }, [hasLoaded, saved]);

  const tog = (k: string) => setExp((p) => ({ ...p, [k]: !p[k] }));
  const set = useCallback(<K extends keyof OpsForm>(k: K, v: OpsForm[K]) => {
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

  // Save to MongoDB via useDeptSaveState (Phase 0 wired this to real API)
  const handleSave = useCallback(() => {
    deptSave('Operations Settings', form);
  }, [form, deptSave]);

  return (
    <DeptSettingsShell open={open} onClose={onClose} title="Operations Settings" dirty={dirty} saveState={saveState} onSave={handleSave}>
      {/* 1. Department Directive */}
      <DepartmentDirectiveSection directive={form.directive} onDirectiveChange={(v) => set('directive', v)} expanded={exp['directive'] ?? false} onToggle={() => tog('directive')} />

      {/* 2. Agents */}
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

      {/* 3. Runbooks */}
      <SettingsSection
        label="Runbooks"
        icon={<BookOpenIcon className="w-4 h-4 text-terminal-cyan" />}
        iconColor="terminal-cyan"
        expanded={exp['runbooks'] ?? false}
        onToggle={() => tog('runbooks')}
        headerExtra={
          <InfoTooltip text="Operational playbooks Sentinel follows during audits, health checks, and post-deploy verification. Edit them here to update standards and procedures." />
        }
      >
        <div className="space-y-2">
          {RUNBOOKS.map((doc) => (
            <RunbookItem
              key={doc.id}
              doc={doc}
              value={form.runbooks[doc.id] ?? ''}
              onChange={(v) => set('runbooks', { ...form.runbooks, [doc.id]: v })}
            />
          ))}
        </div>
      </SettingsSection>

      {/* 4. Health Monitoring */}
      <SettingsSection label="Health Monitoring" icon={<ActivityIcon className="w-4 h-4 text-terminal-green" />} iconColor="terminal-green" expanded={exp['health'] ?? false} onToggle={() => tog('health')}>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest">Health Check Interval</label>
            <InfoTooltip text="How often Sentinel checks deployment health and service status." />
          </div>
          <select className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green" value={form.healthCheckInterval} onChange={(e) => set('healthCheckInterval', e.target.value)}>
            <option value="1h">Every 1 hour</option>
            <option value="2h">Every 2 hours</option>
            <option value="4h">Every 4 hours</option>
            <option value="6h">Every 6 hours</option>
            <option value="12h">Every 12 hours</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <div><span className="text-xs text-terminal-text block">Auto-restart failed services</span><span className="text-[10px] text-terminal-dim">Automatically attempt restart on service failure</span></div>
          <ToggleSwitch checked={form.autoRestart} onChange={(v) => set('autoRestart', v)} color="terminal-green" />
        </div>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Consecutive Failures Before Alert</label>
          <input type="number" min={1} max={10} className="w-24 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green" value={form.failuresBeforeAlert} onChange={(e) => set('failuresBeforeAlert', e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Code Quality Audit Frequency</label>
          <select className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green" value={form.auditFrequency} onChange={(e) => set('auditFrequency', e.target.value)}>
            <option value="daily">Daily</option>
            <option value="mwf">Mon-Wed-Fri</option>
            <option value="mon-thu">Mon & Thu</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest">Min Code Quality Score</label>
            <InfoTooltip text="Sentinel flags repos scoring below this threshold." />
          </div>
          <input type="number" min={0} max={100} className="w-24 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green" value={form.minQualityScore} onChange={(e) => set('minQualityScore', e.target.value)} />
          <span className="text-[9px] text-terminal-dim ml-2">/ 100</span>
        </div>
      </SettingsSection>

      {/* 5. Alert Routing */}
      <SettingsSection label="Alert Routing" icon={<RouteIcon className="w-4 h-4 text-terminal-orange" />} iconColor="terminal-orange" expanded={exp['routing'] ?? false} onToggle={() => tog('routing')}>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Default Alert Severity</label>
          <select className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-orange" value={form.defaultSeverity} onChange={(e) => set('defaultSeverity', e.target.value)}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <div><span className="text-xs text-terminal-text block">Deploy failure → immediate alert</span><span className="text-[10px] text-terminal-dim">Send alert immediately on deploy failure</span></div>
          <ToggleSwitch checked={form.deployFailImmediate} onChange={(v) => set('deployFailImmediate', v)} color="terminal-orange" />
        </div>
        <div className="flex items-center justify-between">
          <div><span className="text-xs text-terminal-text block">Code quality drop → daily digest</span><span className="text-[10px] text-terminal-dim">Batch quality alerts into a daily summary</span></div>
          <ToggleSwitch checked={form.qualityDropDigest} onChange={(v) => set('qualityDropDigest', v)} color="terminal-orange" />
        </div>
        <div className="flex items-center justify-between">
          <div><span className="text-xs text-terminal-text block">Service degradation → immediate alert</span><span className="text-[10px] text-terminal-dim">Alert immediately on service health degradation</span></div>
          <ToggleSwitch checked={form.degradationImmediate} onChange={(v) => set('degradationImmediate', v)} color="terminal-orange" />
        </div>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Primary Alert Channel</label>
          <input type="text" className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-orange" value={form.primaryChannel} onChange={(e) => set('primaryChannel', e.target.value)} placeholder="#yclaw-alerts" />
        </div>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Secondary Alert Channel</label>
          <input type="text" className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-orange" value={form.secondaryChannel} onChange={(e) => set('secondaryChannel', e.target.value)} placeholder="#yclaw-operations" />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-terminal-text block">Escalate critical alerts to Executive</span>
            <span className="text-[10px] text-terminal-dim">Routes critical infrastructure alerts to the Strategist</span>
          </div>
          <div className="flex items-center gap-1.5">
            <InfoTooltip text="Routes critical infrastructure alerts to the Strategist for executive visibility." />
            <ToggleSwitch checked={form.escalateToExec} onChange={(v) => set('escalateToExec', v)} color="terminal-orange" />
          </div>
        </div>
      </SettingsSection>

      {/* 6. Notifications */}
      <NotificationsSection
        alerts={ALERTS} alertStates={form.alerts}
        onAlertToggle={(k, v) => { set('alerts', { ...form.alerts, [k]: v }); }}
        slackChannel={form.slackChannel} onSlackChannelChange={(v) => set('slackChannel', v)}
        expanded={exp['notif'] ?? false} onToggle={() => tog('notif')}
      />
    </DeptSettingsShell>
  );
}
