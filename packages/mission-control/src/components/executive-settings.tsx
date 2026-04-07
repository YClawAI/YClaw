'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SettingsDrawer } from './settings-drawer';
import { DrawerSaveFooter } from './openclaw-settings-drawer';
import { AgentCard } from './agent-settings-card';
import type { AgentCardConfig } from './agent-settings-card';
import type { ModelInfo } from '@/types/gateway';
import { useDepartmentSettings } from '@/hooks/use-department-settings';

// ── SVG Icons ────────────────────────────────────────────────────────────────

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

function GitBranchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  );
}

// ── Info tooltip ──────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const open = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: Math.max(12, rect.left - 100) });
    }
    setShow(true);
  }, []);

  const close = useCallback(() => setShow(false), []);

  return (
    <span ref={ref} className="inline-flex">
      <button
        type="button"
        className="w-4 h-4 rounded-full border border-terminal-dim/40 text-terminal-dim text-[9px] font-bold leading-none flex items-center justify-center hover:border-terminal-text hover:text-terminal-text transition-colors"
        onMouseEnter={open}
        onMouseLeave={close}
        onClick={() => (show ? close() : open())}
        aria-label="Info"
      >
        i
      </button>
      {show && pos && (
        <div
          className="fixed w-56 p-2.5 rounded border border-terminal-border bg-terminal-surface shadow-2xl text-[10px] text-terminal-dim leading-relaxed z-[100]"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={open}
          onMouseLeave={close}
        >
          {text}
        </div>
      )}
    </span>
  );
}

// ── Collapsible Section ──────────────────────────────────────────────────────

const SECTION_EXPANDED_STYLES: Record<string, string> = {
  'terminal-cyan': 'border-terminal-cyan/50 bg-terminal-cyan/5',
  'terminal-purple': 'border-terminal-purple/50 bg-terminal-purple/5',
  'terminal-orange': 'border-terminal-orange/50 bg-terminal-orange/5',
  'terminal-yellow': 'border-terminal-yellow/50 bg-terminal-yellow/5',
};

function SettingsSection({
  label,
  icon,
  iconColor,
  expanded,
  onToggle,
  headerExtra,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  iconColor: string;
  expanded: boolean;
  onToggle: () => void;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const expandedStyle = SECTION_EXPANDED_STYLES[iconColor] ?? 'border-terminal-border';
  return (
    <section className="mb-4">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition-colors ${
          expanded ? expandedStyle : 'border-terminal-border hover:border-terminal-muted'
        }`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-bold uppercase tracking-widest text-terminal-text">
            {label}
          </span>
          {headerExtra && (
            <span onClick={(e) => e.stopPropagation()}>
              {headerExtra}
            </span>
          )}
        </div>
        <span className="text-terminal-dim text-xs">{expanded ? '\u2212' : '+'}</span>
      </button>
      {expanded && <div className="mt-3 pl-1 space-y-4">{children}</div>}
    </section>
  );
}

// ── Toggle Switch ────────────────────────────────────────────────────────────

const TOGGLE_STYLES: Record<string, { on: string; off: string; knob: string }> = {
  'terminal-orange': {
    on: 'bg-terminal-orange/50 border-terminal-orange/30',
    off: 'bg-terminal-orange/20 border-terminal-orange/30',
    knob: 'bg-terminal-orange',
  },
  'terminal-yellow': {
    on: 'bg-terminal-yellow/50 border-terminal-yellow/30',
    off: 'bg-terminal-yellow/20 border-terminal-yellow/30',
    knob: 'bg-terminal-yellow',
  },
};

function ToggleSwitch({
  checked,
  onChange,
  color = 'terminal-orange',
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  color?: string;
}) {
  const styles = TOGGLE_STYLES[color] ?? TOGGLE_STYLES['terminal-orange']!;
  return (
    <button
      className={`relative w-10 h-5 rounded-full border transition-colors ${
        checked ? styles.on : styles.off
      }`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className={`absolute top-0.5 left-0 w-4 h-4 rounded-full ${styles.knob} transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

// ── Static Data (from strategist.yaml / reviewer.yaml) ──────────────────────

const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6', available: true },
  { id: 'claude-opus-4-0-20250514', provider: 'anthropic', name: 'Claude Opus 4', available: true },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', available: true },
  { id: 'claude-sonnet-4-20250514', provider: 'anthropic', name: 'Claude Sonnet 4', available: true },
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', available: true },
  { id: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1', available: true },
  { id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro', available: true },
  { id: 'grok-3', provider: 'xai', name: 'Grok 3', available: true },
];

const STRATEGIST_CONFIG: AgentCardConfig = {
  name: 'strategist',
  label: 'Strategist',
  role: 'Lead',
  defaultModel: 'claude-opus-4-6',
  defaultCreativity: 1,
  learnedSkills: [],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch', 'get_diff', 'pr_review', 'pr_comment', 'get_issue', 'list_issues'] },
    { platform: 'Twitter', actions: ['update_profile', 'update_profile_image', 'update_profile_banner'] },
    { platform: 'X', actions: ['search', 'user'] },
    { platform: 'Telegram', actions: ['announce', 'set_title', 'set_description'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish', 'deploy:assess', 'deploy:execute', 'task:query', 'task:summary'] },
  ],
  cronTriggers: [
    { task: 'standup_synthesis', cron: '45 13 * * *', modelOverride: 'Sonnet' },
    { task: 'weekly_directive', cron: '0 14 * * 1' },
    { task: 'midweek_review', cron: '0 14 * * 3' },
    { task: 'monthly_strategy', cron: '0 7 1 * *' },
    { task: 'model_review', cron: '0 14 1-7 * 1' },
    { task: 'heartbeat', cron: '*/30 13-23,0-3 * * *', modelOverride: 'Sonnet' },
  ],
  eventTriggers: [
    { event: 'slack:app_mention', label: 'Handle Slack Request' },
    { event: 'claudeception:reflect', label: 'Self Reflection', modelOverride: 'Sonnet' },
    { event: 'standup:report', label: 'Standup Synthesis', modelOverride: 'Opus', subtitle: 'Batch: waits for 10+ reports' },
  ],
};

const REVIEWER_CONFIG: AgentCardConfig = {
  name: 'reviewer',
  label: 'Reviewer',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 0,
  learnedSkills: [],
  integrations: [
    { platform: 'GitHub', actions: ['get_contents'] },
    { platform: 'X', actions: ['search'] },
    { platform: 'Slack', actions: ['message', 'thread_reply', 'alert'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '0 13 * * *' },
  ],
  eventTriggers: [
    { event: 'review:pending', label: 'Review Content' },
    { event: 'ember:content_ready', label: 'Review Content' },
    { event: 'scout:outreach_ready', label: 'Review Content' },
    { event: 'reviewer:directive', label: 'Handle Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection', modelOverride: 'Sonnet' },
  ],
};

const AGENT_CONFIGS: AgentCardConfig[] = [STRATEGIST_CONFIG, REVIEWER_CONFIG];

// ── Form State ───────────────────────────────────────────────────────────────

interface ExecFormState {
  directive: string;
  cronStates: Record<string, Record<string, boolean>>;
  eventStates: Record<string, Record<string, boolean>>;
  agentModels: Record<string, Record<string, unknown>>;
  requireReviewerApproval: boolean;
  reviewThreshold: string;
  escalationBehavior: string;
  reviewTweets: boolean;
  reviewTelegram: boolean;
  reviewInstagram: boolean;
  reviewPrDescriptions: boolean;
  reviewBlogDrafts: boolean;
  reviewEmail: boolean;
  alertFlaggedContent: boolean;
  alertDirectiveBlocked: boolean;
  alertHeartbeatMissed: boolean;
  alertAgentError: boolean;
  alertStandupReady: boolean;
  alertApprovalRateDrop: boolean;
  slackChannel: string;
}

function buildInitialCronStates(): Record<string, Record<string, boolean>> {
  const result: Record<string, Record<string, boolean>> = {};
  for (const agent of AGENT_CONFIGS) {
    const s: Record<string, boolean> = {};
    for (const c of agent.cronTriggers) s[c.task] = true;
    result[agent.name] = s;
  }
  return result;
}

function buildInitialEventStates(): Record<string, Record<string, boolean>> {
  const result: Record<string, Record<string, boolean>> = {};
  for (const agent of AGENT_CONFIGS) {
    const s: Record<string, boolean> = {};
    for (const e of agent.eventTriggers) s[e.event] = true;
    result[agent.name] = s;
  }
  return result;
}

const INITIAL_FORM: ExecFormState = {
  directive: 'Focus on quality assurance and strategic planning. Ensure all agent outputs meet brand and safety standards before publication. Prioritize risk assessment for all outbound content.',
  cronStates: buildInitialCronStates(),
  eventStates: buildInitialEventStates(),
  agentModels: {},
  requireReviewerApproval: true,
  reviewThreshold: 'high-impact',
  escalationBehavior: 'flag-human',
  reviewTweets: true,
  reviewTelegram: true,
  reviewInstagram: true,
  reviewPrDescriptions: false,
  reviewBlogDrafts: true,
  reviewEmail: true,
  alertFlaggedContent: true,
  alertDirectiveBlocked: true,
  alertHeartbeatMissed: true,
  alertAgentError: true,
  alertStandupReady: false,
  alertApprovalRateDrop: true,
  slackChannel: '#yclaw-alerts',
};

const DIRECTIVE_TOOLTIP =
  'The department directive is shared instructions read by all agents in this department before every task. It defines priorities, focus areas, and rules of engagement. Update it whenever your goals change.';

// ── Main Component ───────────────────────────────────────────────────────────

interface ExecutiveSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ExecutiveSettings({ open, onClose }: ExecutiveSettingsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    directive: false,
    agents: false,
    workflow: false,
    notifications: false,
  });

  const [form, setForm] = useState<ExecFormState>(INITIAL_FORM);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { settings, hasLoaded, updateSettings } = useDepartmentSettings('executive');

  // Load saved settings on mount — populate form from API response
  useEffect(() => {
    if (!hasLoaded || Object.keys(settings).length === 0) return;
    setForm((prev) => ({
      ...prev,
      directive: typeof settings.directive === 'string' ? settings.directive : prev.directive,
      cronStates: settings.cronStates && typeof settings.cronStates === 'object'
        ? settings.cronStates as Record<string, Record<string, boolean>>
        : prev.cronStates,
      eventStates: settings.eventStates && typeof settings.eventStates === 'object'
        ? settings.eventStates as Record<string, Record<string, boolean>>
        : prev.eventStates,
      agentModels: settings.agentModels && typeof settings.agentModels === 'object'
        ? settings.agentModels as Record<string, Record<string, unknown>>
        : prev.agentModels,
      requireReviewerApproval: typeof settings.requireReviewerApproval === 'boolean'
        ? settings.requireReviewerApproval : prev.requireReviewerApproval,
      reviewThreshold: typeof settings.reviewThreshold === 'string'
        ? settings.reviewThreshold : prev.reviewThreshold,
      escalationBehavior: typeof settings.escalationBehavior === 'string'
        ? settings.escalationBehavior : prev.escalationBehavior,
      reviewTweets: typeof settings.reviewTweets === 'boolean' ? settings.reviewTweets : prev.reviewTweets,
      reviewTelegram: typeof settings.reviewTelegram === 'boolean' ? settings.reviewTelegram : prev.reviewTelegram,
      reviewInstagram: typeof settings.reviewInstagram === 'boolean' ? settings.reviewInstagram : prev.reviewInstagram,
      reviewPrDescriptions: typeof settings.reviewPrDescriptions === 'boolean' ? settings.reviewPrDescriptions : prev.reviewPrDescriptions,
      reviewBlogDrafts: typeof settings.reviewBlogDrafts === 'boolean' ? settings.reviewBlogDrafts : prev.reviewBlogDrafts,
      reviewEmail: typeof settings.reviewEmail === 'boolean' ? settings.reviewEmail : prev.reviewEmail,
      alertFlaggedContent: typeof settings.alertFlaggedContent === 'boolean' ? settings.alertFlaggedContent : prev.alertFlaggedContent,
      alertDirectiveBlocked: typeof settings.alertDirectiveBlocked === 'boolean' ? settings.alertDirectiveBlocked : prev.alertDirectiveBlocked,
      alertHeartbeatMissed: typeof settings.alertHeartbeatMissed === 'boolean' ? settings.alertHeartbeatMissed : prev.alertHeartbeatMissed,
      alertAgentError: typeof settings.alertAgentError === 'boolean' ? settings.alertAgentError : prev.alertAgentError,
      alertStandupReady: typeof settings.alertStandupReady === 'boolean' ? settings.alertStandupReady : prev.alertStandupReady,
      alertApprovalRateDrop: typeof settings.alertApprovalRateDrop === 'boolean' ? settings.alertApprovalRateDrop : prev.alertApprovalRateDrop,
      slackChannel: typeof settings.slackChannel === 'string' ? settings.slackChannel : prev.slackChannel,
    }));
  }, [hasLoaded, settings]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateField = useCallback(<K extends keyof ExecFormState>(key: K, value: ExecFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleCronToggle = useCallback((agentName: string, task: string) => {
    setForm((prev) => ({
      ...prev,
      cronStates: {
        ...prev.cronStates,
        [agentName]: {
          ...prev.cronStates[agentName],
          [task]: !(prev.cronStates[agentName]?.[task] ?? true),
        },
      },
    }));
    setDirty(true);
  }, []);

  const handleEventToggle = useCallback((agentName: string, event: string) => {
    setForm((prev) => ({
      ...prev,
      eventStates: {
        ...prev.eventStates,
        [agentName]: {
          ...prev.eventStates[agentName],
          [event]: !(prev.eventStates[agentName]?.[event] ?? true),
        },
      },
    }));
    setDirty(true);
  }, []);

  const handleModelSelect = useCallback((agentName: string, modelId: string) => {
    setForm((prev) => ({
      ...prev,
      agentModels: {
        ...prev.agentModels,
        [agentName]: { ...(prev.agentModels[agentName] ?? {}), model: modelId },
      },
    }));
    setDirty(true);
  }, []);

  const handleCreativitySelect = useCallback((agentName: string, _creativityIndex: number, temperature: number) => {
    setForm((prev) => ({
      ...prev,
      agentModels: {
        ...prev.agentModels,
        [agentName]: { ...(prev.agentModels[agentName] ?? {}), temperature },
      },
    }));
    setDirty(true);
  }, []);

  function handleSave() {
    setSaveState('saving');
    void updateSettings(form as unknown as Record<string, unknown>).then((ok) => {
      if (ok) {
        setSaveState('saved');
        setDirty(false);
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
      } else {
        setSaveState('idle');
      }
    });
  }

  const saveFooter = (
    <DrawerSaveFooter dirty={dirty} saveState={saveState} onSave={handleSave} />
  );

  return (
    <SettingsDrawer open={open} onClose={onClose} title="Executive Settings" footer={saveFooter}>
      {/* ── Section 1: Department Directive ───────────────────────── */}
      <SettingsSection
        label="Department Directive"
        icon={<DocumentIcon className="w-4 h-4 text-terminal-cyan" />}
        iconColor="terminal-cyan"
        expanded={expanded['directive'] ?? false}
        onToggle={() => toggle('directive')}
        headerExtra={<InfoTooltip text={DIRECTIVE_TOOLTIP} />}
      >
        <div>
          <textarea
            className="w-full bg-terminal-bg border border-terminal-border rounded p-2 text-xs text-terminal-text font-mono resize-y min-h-[120px] focus:outline-none focus:border-terminal-cyan placeholder:text-terminal-dim/40"
            placeholder="e.g., Focus on Q1 launch. Prioritize security reviews over feature work. All external communications require Reviewer approval before publishing."
            value={form.directive}
            onChange={(e) => updateField('directive', e.target.value)}
            rows={6}
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-terminal-dim/50">
              Last updated: Mar 14, 2026
            </span>
            <span className={`text-[10px] font-mono ${
              form.directive.length > 500 ? 'text-terminal-yellow' : 'text-terminal-dim'
            }`}>
              {form.directive.length} chars
            </span>
          </div>
        </div>
      </SettingsSection>

      {/* ── Section 2: Agents ────────────────────────────────────── */}
      <SettingsSection
        label="Agents"
        icon={<UsersIcon className="w-4 h-4 text-terminal-purple" />}
        iconColor="terminal-purple"
        expanded={expanded['agents'] ?? false}
        onToggle={() => toggle('agents')}
      >
        <div className="space-y-3">
          {AGENT_CONFIGS.map((agentCfg) => {
            const savedModel = form.agentModels[agentCfg.name];
            const savedTemp = savedModel?.temperature as number | undefined;
            const savedCreativity = savedTemp !== undefined
              ? (savedTemp === 0 ? 0 : savedTemp >= 1.3 ? 2 : 1)
              : undefined;
            return (
              <AgentCard
                key={agentCfg.name}
                config={agentCfg}
                models={DEFAULT_MODELS}
                cronStates={form.cronStates[agentCfg.name] ?? {}}
                eventStates={form.eventStates[agentCfg.name] ?? {}}
                onCronToggle={(task) => handleCronToggle(agentCfg.name, task)}
                onEventToggle={(event) => handleEventToggle(agentCfg.name, event)}
                onDirty={markDirty}
                onModelSelect={(modelId) => handleModelSelect(agentCfg.name, modelId)}
                onCreativitySelect={(idx, temp) => handleCreativitySelect(agentCfg.name, idx, temp)}
                savedModelId={savedModel?.model as string | undefined}
                savedCreativityIndex={savedCreativity}
                defaultExpanded={false}
              />
            );
          })}
          <div className="text-[10px] text-terminal-dim/60 pl-1 space-y-0.5">
            <div>Agent schedules are managed via YAML configs</div>
          </div>
        </div>
      </SettingsSection>

      {/* ── Section 3: Workflow & Routing ─────────────────────────── */}
      <SettingsSection
        label="Workflow & Routing"
        icon={<GitBranchIcon className="w-4 h-4 text-terminal-orange" />}
        iconColor="terminal-orange"
        expanded={expanded['workflow'] ?? false}
        onToggle={() => toggle('workflow')}
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-terminal-text block">
              Require Reviewer approval before execution
            </span>
            <span className="text-[10px] text-terminal-dim">
              Strategist decisions must pass Reviewer before acting
            </span>
          </div>
          <ToggleSwitch
            checked={form.requireReviewerApproval}
            onChange={(val) => updateField('requireReviewerApproval', val)}
            color="terminal-orange"
          />
        </div>

        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">
            Review Threshold
          </label>
          <select
            className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-orange"
            value={form.reviewThreshold}
            onChange={(e) => updateField('reviewThreshold', e.target.value)}
          >
            <option value="all">All decisions</option>
            <option value="high-impact">High-impact only</option>
            <option value="critical">Critical only</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">
            Escalation Behavior
          </label>
          <select
            className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-orange"
            value={form.escalationBehavior}
            onChange={(e) => updateField('escalationBehavior', e.target.value)}
          >
            <option value="flag-human">Flag for human review</option>
            <option value="strategist-overrides">Strategist overrides</option>
            <option value="block">Block until resolved</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-2">
            Content Types Requiring Review
          </label>
          <div className="space-y-2">
            {([
              { key: 'reviewTweets' as const, label: 'Tweets / X posts' },
              { key: 'reviewTelegram' as const, label: 'Telegram messages' },
              { key: 'reviewInstagram' as const, label: 'Instagram posts' },
              { key: 'reviewPrDescriptions' as const, label: 'PR descriptions' },
              { key: 'reviewBlogDrafts' as const, label: 'Blog drafts' },
              { key: 'reviewEmail' as const, label: 'Emails' },
            ]).map((ct) => (
              <label key={ct.key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[ct.key]}
                  onChange={(e) => updateField(ct.key, e.target.checked)}
                  className="accent-terminal-orange"
                />
                <span className="text-xs text-terminal-text">{ct.label}</span>
              </label>
            ))}
          </div>
        </div>
      </SettingsSection>

      {/* ── Section 4: Notifications ──────────────────────────────── */}
      <SettingsSection
        label="Notifications"
        icon={<BellIcon className="w-4 h-4 text-terminal-yellow" />}
        iconColor="terminal-yellow"
        expanded={expanded['notifications'] ?? false}
        onToggle={() => toggle('notifications')}
      >
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-2">
            Alert Types
          </label>
          <div className="space-y-3">
            {([
              { key: 'alertFlaggedContent' as const, label: 'Flagged content (review queue)', desc: 'Alert when content is flagged for human review' },
              { key: 'alertDirectiveBlocked' as const, label: 'Directive task blocked', desc: 'Alert when a directive task cannot proceed' },
              { key: 'alertHeartbeatMissed' as const, label: 'Heartbeat missed', desc: 'Alert when an agent misses a heartbeat window' },
              { key: 'alertAgentError' as const, label: 'Agent error state', desc: 'Alert when an agent enters error state' },
              { key: 'alertStandupReady' as const, label: 'Standup synthesis ready', desc: 'Notify when daily standup is generated' },
              { key: 'alertApprovalRateDrop' as const, label: 'Approval rate drop (below 60%)', desc: 'Alert when content approval rate drops significantly' },
            ] as const).map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-terminal-text block">{item.label}</span>
                  <span className="text-[10px] text-terminal-dim">{item.desc}</span>
                </div>
                <ToggleSwitch
                  checked={form[item.key]}
                  onChange={(val) => updateField(item.key, val)}
                  color="terminal-yellow"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">
            Slack Channel
          </label>
          <input
            type="text"
            value={form.slackChannel}
            onChange={(e) => updateField('slackChannel', e.target.value)}
            placeholder="#channel-name"
            className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-yellow"
          />
        </div>
      </SettingsSection>
    </SettingsDrawer>
  );
}
