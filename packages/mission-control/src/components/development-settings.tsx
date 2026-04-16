'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  DeptSettingsShell, DepartmentDirectiveSection, AgentsSection,
  NotificationsSection, SettingsSection, ToggleSwitch,
  useDeptSaveState, buildCronStates, buildEventStates, toggleNested,
  DEFAULT_MODELS,
} from './department-settings-shared';
import type { AgentCardConfig, AlertDef } from './department-settings-shared';
import { useDepartmentSettings } from '@/hooks/use-department-settings';

// ── Icons ───────────────────────────────────────────────────────────────────────

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
    </svg>
  );
}

// ── Agent Configs ──────────────────────────────────────────────────────────────────

const ARCHITECT: AgentCardConfig = {
  name: 'architect',
  label: 'Architect',
  defaultModel: 'claude-opus-4-6',
  defaultCreativity: 0,
  learnedSkills: ['review-checklist', 'github-same-account-review-limitation'],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch', 'pr_comment', 'pr_review', 'get_diff'] },
    { platform: 'Codegen', actions: ['execute', 'status'] },
    { platform: 'Repo', actions: ['list'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish', 'deploy:assess', 'deploy:execute'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '2 13 * * *', modelOverride: 'Sonnet' },
    { task: 'tech_debt_scan', cron: '0 20 * * 0' },
  ],
  eventTriggers: [
    { event: 'github:pr_opened', label: 'Review PR' },
    { event: 'builder:pr_ready', label: 'Review PR' },
    { event: 'strategist:architect_directive', label: 'Architecture Directive' },
    { event: 'builder:plan_ready', label: 'Review Plan' },
    { event: 'deploy:review', label: 'Review Deploy' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const BUILDER: AgentCardConfig = {
  name: 'builder',
  label: 'Builder',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 0,
  learnedSkills: [
    'codegen-patterns', 'contents-api-no-delete', 'file-deletion-limitations',
    'github-file-deletion-limitation', 'large-file-edit-limitation',
  ],
  integrations: [
    { platform: 'GitHub', actions: ['create_pr', 'pr_comment', 'create_issue', 'create_repo', 'configure_webhook', 'merge_pr', 'get_contents', 'get_multiple_files', 'commit_file', 'commit_batch', 'create_branch', 'get_diff', 'get_issue', 'list_issues'] },
    { platform: 'Codegen', actions: ['execute', 'status'] },
    { platform: 'Repo', actions: ['register', 'list'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '4 13 * * *', modelOverride: 'Sonnet' },
  ],
  eventTriggers: [
    { event: 'github:issue_assigned', label: 'Implement Issue' },
    { event: 'strategist:builder_directive', label: 'Implement Directive' },
    { event: 'github:pr_review_comment', label: 'Address Review Feedback' },
    { event: 'github:ci_fail', label: 'Fix CI Failure' },
    { event: 'github:pr_review_submitted', label: 'Address Human Review' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const DEPLOYER: AgentCardConfig = {
  name: 'deployer',
  label: 'Deployer',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 0,
  learnedSkills: ['deploy-checklist'],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch', 'compare_commits', 'create_issue'] },
    { platform: 'Deploy', actions: ['assess', 'architect_approve', 'execute'] },
    { platform: 'Repo', actions: ['register', 'list'] },
    { platform: 'Slack', actions: ['message', 'thread_reply', 'alert'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '6 13 * * *' },
  ],
  eventTriggers: [
    { event: 'github:ci_pass', label: 'Deploy Assessment' },
    { event: 'sentinel:alert', label: 'Pause Deploy' },
    { event: 'strategist:deployer_directive', label: 'Deploy Directive' },
    { event: 'architect:deploy_review', label: 'Handle Deploy Review' },
    { event: 'deployer:canary_rollback', label: 'Create Rollback Incident' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const DESIGNER: AgentCardConfig = {
  name: 'designer',
  label: 'Designer',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 0,
  learnedSkills: ['component-specs', 'design-system'],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'get_diff', 'create_branch', 'create_issue', 'pr_comment', 'pr_review'] },
    { platform: 'Figma', actions: ['get_file', 'get_node', 'get_images', 'get_components', 'get_styles', 'post_comment', 'get_comments', 'get_variables', 'get_file_versions'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '8 13 * * *' },
  ],
  eventTriggers: [
    { event: 'builder:pr_ready', label: 'Design Review' },
    { event: 'forge:asset_ready', label: 'Integrate Design Update' },
    { event: 'strategist:designer_directive', label: 'Design Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const AGENTS: AgentCardConfig[] = [ARCHITECT, BUILDER, DEPLOYER, DESIGNER];

// ── Notifications ─────────────────────────────────────────────────────────────────

const ALERTS: AlertDef[] = [
  { key: 'ciFailure', label: 'CI failure', desc: 'Alert when CI fails on a PR' },
  { key: 'prReviewBlocked', label: 'PR review blocked', desc: 'Alert when a PR has no available reviewer' },
  { key: 'deployFailed', label: 'Deploy failure', desc: 'Alert when a deployment fails or rolls back' },
  { key: 'agentError', label: 'Agent error state', desc: 'Alert when any dev agent enters error state' },
  { key: 'techDebtHigh', label: 'Tech debt threshold', desc: 'Alert when tech debt score exceeds threshold' },
];

// ── Form State ─────────────────────────────────────────────────────────────────────

interface DevForm {
  directive: string;
  cronStates: Record<string, Record<string, boolean>>;
  eventStates: Record<string, Record<string, boolean>>;
  agentModels: Record<string, { model?: string; temperature?: number; creativityIndex?: number }>;
  autoAssignIssues: boolean;
  requireArchitectReview: boolean;
  branchStrategy: string;
  ciMustPass: boolean;
  autoDeployOnCi: boolean;
  deployRiskThreshold: string;
  requireDeployerSignoff: boolean;
  alerts: Record<string, boolean>;
  slackChannel: string;
}

const INITIAL: DevForm = {
  directive: '',
  cronStates: buildCronStates(AGENTS),
  eventStates: buildEventStates(AGENTS),
  agentModels: {},
  autoAssignIssues: true,
  requireArchitectReview: true,
  branchStrategy: 'feature',
  ciMustPass: true,
  autoDeployOnCi: false,
  deployRiskThreshold: 'medium',
  requireDeployerSignoff: true,
  alerts: { ciFailure: true, prReviewBlocked: true, deployFailed: true, agentError: true, techDebtHigh: false },
  slackChannel: '#yclaw-dev',
};

// ── Component ──────────────────────────────────────────────────────────────────────

interface Props { open: boolean; onClose: () => void }

export function DevelopmentSettings({ open, onClose }: Props) {
  const [exp, setExp] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<DevForm>(INITIAL);
  const { dirty, saveState, saveError, markDirty, setDirty, handleSave } = useDeptSaveState('development');
  const { settings: saved, hasLoaded } = useDepartmentSettings('development');

  useEffect(() => {
    if (!hasLoaded || dirty) return;
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
    setForm((prev) => ({ ...prev, ...saved, agentModels } as DevForm));
  }, [hasLoaded, saved, dirty]);

  const tog = (k: string) => setExp((p) => ({ ...p, [k]: !p[k] }));
  const set = useCallback(<K extends keyof DevForm>(k: K, v: DevForm[K]) => {
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
    <DeptSettingsShell open={open} onClose={onClose} title="Development Settings" dirty={dirty} saveState={saveState} saveError={saveError} onSave={() => handleSave('Development Settings', form)}>
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

      {/* Repository Config */}
      <SettingsSection label="Repository Config" icon={<CodeIcon className="w-4 h-4 text-mc-success" />} iconColor="mc-success" expanded={exp['repo'] ?? false} onToggle={() => tog('repo')}>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Auto-assign issues to Builder</span><span className="font-sans text-[10px] text-mc-text-tertiary">New issues are automatically routed to Builder</span></div>
          <ToggleSwitch checked={form.autoAssignIssues} onChange={(v) => set('autoAssignIssues', v)} color="mc-success" />
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Require Architect review for all PRs</span><span className="font-sans text-[10px] text-mc-text-tertiary">PRs must have Architect approval before merge</span></div>
          <ToggleSwitch checked={form.requireArchitectReview} onChange={(v) => set('requireArchitectReview', v)} color="mc-success" />
        </div>
        <div>
          <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">Default Branch Strategy</label>
          <select className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-sans text-xs text-mc-text focus:outline-none focus:border-mc-success transition-colors duration-mc ease-mc-out" value={form.branchStrategy} onChange={(e) => set('branchStrategy', e.target.value)}>
            <option value="feature">Feature branches</option>
            <option value="trunk">Trunk-based</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">CI must pass before merge</span><span className="font-sans text-[10px] text-mc-text-tertiary">Block merges when CI checks fail</span></div>
          <ToggleSwitch checked={form.ciMustPass} onChange={(v) => set('ciMustPass', v)} color="mc-success" />
        </div>
      </SettingsSection>

      {/* CI/CD Rules */}
      <SettingsSection label="CI/CD Rules" icon={<RocketIcon className="w-4 h-4 text-mc-info" />} iconColor="mc-info" expanded={exp['cicd'] ?? false} onToggle={() => tog('cicd')}>
        <p className="font-sans text-[10px] text-mc-text-tertiary italic mb-2">Managed via deploy-governance.ts in core — settings preview only</p>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Auto-deploy on CI pass</span><span className="font-sans text-[10px] text-mc-text-tertiary">Trigger deploy assessment when CI passes</span></div>
          <ToggleSwitch checked={form.autoDeployOnCi} onChange={(v) => set('autoDeployOnCi', v)} color="mc-info" />
        </div>
        <div>
          <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">Deploy Risk Threshold</label>
          <select className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-sans text-xs text-mc-text focus:outline-none focus:border-mc-info transition-colors duration-mc ease-mc-out" value={form.deployRiskThreshold} onChange={(e) => set('deployRiskThreshold', e.target.value)}>
            <option value="all">All changes</option>
            <option value="medium">Medium+ risk</option>
            <option value="critical">Critical only</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Require Deployer sign-off for infrastructure</span><span className="font-sans text-[10px] text-mc-text-tertiary">Infrastructure changes need explicit Deployer approval</span></div>
          <ToggleSwitch checked={form.requireDeployerSignoff} onChange={(v) => set('requireDeployerSignoff', v)} color="mc-info" />
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

export { DevelopmentSettings as DevelopmentSettingsContent };
