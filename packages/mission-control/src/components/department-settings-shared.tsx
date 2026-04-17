'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SettingsDrawer } from './settings-drawer';
import { DrawerSaveFooter } from './openclaw-settings-drawer';
import { AgentCard } from './agent-settings-card';
import type { AgentCardConfig } from './agent-settings-card';
import type { ModelInfo } from '@/types/gateway';

// ── Shared model list ───────────────────────────────────────────────

export const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6', available: true },
  { id: 'claude-opus-4-0-20250514', provider: 'anthropic', name: 'Claude Opus 4', available: true },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', available: true },
  { id: 'claude-sonnet-4-20250514', provider: 'anthropic', name: 'Claude Sonnet 4', available: true },
  { id: 'claude-haiku-4-5', provider: 'anthropic', name: 'Claude Haiku 4.5', available: true },
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', available: true },
  { id: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1', available: true },
  { id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro', available: true },
  { id: 'grok-3', provider: 'xai', name: 'Grok 3', available: true },
];

// ── SVG Icons ───────────────────────────────────────────────────────────

export function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

export function UsersIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  );
}

// ── Info Tooltip ──────────────────────────────────────────────────────────────

export function InfoTooltip({ text }: { text: string }) {
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
        className="w-4 h-4 rounded-full border border-mc-border text-mc-text-tertiary text-[9px] font-medium leading-none flex items-center justify-center hover:border-mc-border-hover hover:text-mc-text transition-colors duration-mc ease-mc-out"
        onMouseEnter={open}
        onMouseLeave={close}
        onClick={() => (show ? close() : open())}
        aria-label="Info"
      >
        i
      </button>
      {show && pos && (
        <div
          className="fixed w-56 p-2.5 rounded-panel border border-mc-border bg-mc-bg/95 backdrop-blur-sm shadow-2xl font-sans text-[10px] text-mc-text-tertiary leading-relaxed z-[100]"
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
  'mc-accent': 'border-mc-accent/40 bg-mc-accent/5',
  'mc-info': 'border-mc-info/40 bg-mc-info/5',
  'mc-warning': 'border-mc-warning/40 bg-mc-warning/5',
  'mc-success': 'border-mc-success/40 bg-mc-success/5',
  'mc-danger': 'border-mc-danger/40 bg-mc-danger/5',
};

export function SettingsSection({
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
  const expandedStyle = SECTION_EXPANDED_STYLES[iconColor] ?? 'border-mc-border';
  return (
    <section className="mb-4">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-panel border transition-colors duration-mc ease-mc-out ${
          expanded ? expandedStyle : 'border-mc-border hover:border-mc-border-hover'
        }`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
            {label}
          </span>
          {headerExtra && (
            <span onClick={(e) => e.stopPropagation()}>{headerExtra}</span>
          )}
        </div>
        <span className="text-mc-text-tertiary text-xs">{expanded ? '\u2212' : '+'}</span>
      </button>
      {expanded && <div className="mt-3 pl-1 space-y-4">{children}</div>}
    </section>
  );
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────

const TOGGLE_STYLES: Record<string, { on: string; off: string; knob: string }> = {
  'mc-accent': { on: 'bg-mc-accent/40 border-mc-accent/30', off: 'bg-mc-surface border-mc-border', knob: 'bg-mc-accent' },
  'mc-info': { on: 'bg-mc-info/40 border-mc-info/30', off: 'bg-mc-surface border-mc-border', knob: 'bg-mc-info' },
  'mc-warning': { on: 'bg-mc-warning/40 border-mc-warning/30', off: 'bg-mc-surface border-mc-border', knob: 'bg-mc-warning' },
  'mc-success': { on: 'bg-mc-success/40 border-mc-success/30', off: 'bg-mc-surface border-mc-border', knob: 'bg-mc-success' },
  'mc-danger': { on: 'bg-mc-danger/40 border-mc-danger/30', off: 'bg-mc-surface border-mc-border', knob: 'bg-mc-danger' },
};

export function ToggleSwitch({
  checked,
  onChange,
  color = 'mc-accent',
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  color?: string;
}) {
  const styles = TOGGLE_STYLES[color] ?? TOGGLE_STYLES['mc-accent']!;
  return (
    <button
      className={`relative w-10 h-5 rounded-full border transition-colors duration-mc ease-mc-out ${
        checked ? styles.on : styles.off
      }`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className={`absolute top-0.5 left-0 w-4 h-4 rounded-full ${styles.knob} transition-transform duration-mc ease-mc-out ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

// ── Department Directive Section ────────────────────────────────────────────────

const DIRECTIVE_TOOLTIP =
  'The department directive is shared instructions read by all agents in this department before every task. It defines priorities, focus areas, and rules of engagement. Update it whenever your goals change.';

export function DepartmentDirectiveSection({
  directive,
  onDirectiveChange,
  expanded,
  onToggle,
}: {
  directive: string;
  onDirectiveChange: (val: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <SettingsSection
      label="Department Directive"
      icon={<DocumentIcon className="w-4 h-4 text-mc-accent" />}
      iconColor="mc-accent"
      expanded={expanded}
      onToggle={onToggle}
      headerExtra={<InfoTooltip text={DIRECTIVE_TOOLTIP} />}
    >
      <div>
        <textarea
          className="w-full bg-mc-surface border border-mc-border rounded-panel p-2 font-sans text-xs text-mc-text resize-y min-h-[120px] focus:outline-none focus:border-mc-accent placeholder:text-mc-text-tertiary/40 transition-colors duration-mc ease-mc-out"
          placeholder="e.g., Focus on Q1 launch. Prioritize security reviews over feature work. All external communications require Reviewer approval before publishing."
          value={directive}
          onChange={(e) => onDirectiveChange(e.target.value)}
          rows={6}
        />
        <div className="flex justify-end mt-1">
          <span className={`font-mono tabular-nums text-[10px] ${
            directive.length > 500 ? 'text-mc-warning' : 'text-mc-text-tertiary'
          }`}>
            {directive.length} chars
          </span>
        </div>
      </div>
    </SettingsSection>
  );
}

// ── Agents Section ───────────────────────────────────────────────────────────────

export function AgentsSection({
  agents,
  models,
  cronStates,
  eventStates,
  onCronToggle,
  onEventToggle,
  onDirty,
  onModelSelect,
  onCreativitySelect,
  agentModels,
  expanded,
  onToggle,
}: {
  agents: AgentCardConfig[];
  models: ModelInfo[];
  cronStates: Record<string, Record<string, boolean>>;
  eventStates: Record<string, Record<string, boolean>>;
  onCronToggle: (agent: string, task: string) => void;
  onEventToggle: (agent: string, event: string) => void;
  onDirty: () => void;
  /** Called when user selects a model for an agent */
  onModelSelect?: (agent: string, modelId: string) => void;
  /** Called when user changes creativity for an agent */
  onCreativitySelect?: (agent: string, creativityIndex: number, temperature: number) => void;
  /** Saved per-agent model overrides: { agentName: { model?, temperature?, creativityIndex? } } */
  agentModels?: Record<string, { model?: string; temperature?: number; creativityIndex?: number }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <SettingsSection
      label="Agents"
      icon={<UsersIcon className="w-4 h-4 text-mc-info" />}
      iconColor="mc-info"
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="space-y-3">
        {agents.map((cfg) => (
          <AgentCard
            key={cfg.name}
            config={cfg}
            models={models}
            cronStates={cronStates[cfg.name] ?? {}}
            eventStates={eventStates[cfg.name] ?? {}}
            onCronToggle={(task) => onCronToggle(cfg.name, task)}
            onEventToggle={(event) => onEventToggle(cfg.name, event)}
            onDirty={onDirty}
            onModelSelect={onModelSelect ? (id) => onModelSelect(cfg.name, id) : undefined}
            onCreativitySelect={onCreativitySelect ? (idx, temp) => onCreativitySelect(cfg.name, idx, temp) : undefined}
            savedModelId={agentModels?.[cfg.name]?.model}
            savedCreativityIndex={agentModels?.[cfg.name]?.creativityIndex}
            defaultExpanded={false}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

// ── Notifications Section ───────────────────────────────────────────────────────

export interface AlertDef {
  key: string;
  label: string;
  desc: string;
}

export function NotificationsSection({
  alerts,
  alertStates,
  onAlertToggle,
  slackChannel,
  onSlackChannelChange,
  expanded,
  onToggle,
}: {
  alerts: AlertDef[];
  alertStates: Record<string, boolean>;
  onAlertToggle: (key: string, val: boolean) => void;
  slackChannel: string;
  onSlackChannelChange: (val: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <SettingsSection
      label="Notifications"
      icon={<BellIcon className="w-4 h-4 text-mc-warning" />}
      iconColor="mc-warning"
      expanded={expanded}
      onToggle={onToggle}
    >
      <div>
        <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-2">
          Alert Types
        </label>
        <div className="space-y-3">
          {alerts.map((a) => (
            <div key={a.key} className="flex items-center justify-between">
              <div>
                <span className="font-sans text-xs text-mc-text block">{a.label}</span>
                <span className="font-sans text-[10px] text-mc-text-tertiary">{a.desc}</span>
              </div>
              <ToggleSwitch
                checked={alertStates[a.key] ?? false}
                onChange={(val) => onAlertToggle(a.key, val)}
                color="mc-warning"
              />
            </div>
          ))}
        </div>
      </div>
      <div>
        <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">
          Slack Channel
        </label>
        <input
          type="text"
          value={slackChannel}
          onChange={(e) => onSlackChannelChange(e.target.value)}
          placeholder="#channel-name"
          className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-mono tabular-nums text-xs text-mc-text focus:outline-none focus:border-mc-warning transition-colors duration-mc ease-mc-out"
        />
      </div>
    </SettingsSection>
  );
}

// ── Drawer shell with save footer ───────────────────────────────────────────────────

export function useDeptSaveState(department?: string) {
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedToDb, setSavedToDb] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleSave = useCallback(async (label: string, data: unknown) => {
    setSaveState('saving');
    setSaveError(null);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    // Resolve department: explicit param or extract from label (e.g. "Finance Settings" → "finance")
    const dept = department || label.replace(/\s*Settings$/i, '').toLowerCase();

    try {
      const res = await fetch(`/api/departments/settings?department=${encodeURIComponent(dept)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(typeof data === 'object' && data !== null ? data : {}),
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = 'Failed to save';
        try { msg = JSON.parse(text).error || msg; } catch { /* use default */ }
        throw new Error(msg);
      }

      setSaveState('saved');
      setDirty(false);
      setSavedToDb(true);
      timerRef.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      console.error(`[${label}] Save failed:`, message);
      setSaveError(message);
      setSaveState('idle');
    }
  }, [department]);

  return { dirty, saveState, markDirty, setDirty, handleSave, saveError, savedToDb };
}

export function DeptSettingsShell({
  open,
  onClose,
  title,
  dirty,
  saveState,
  saveError,
  onSave,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  dirty: boolean;
  saveState: 'idle' | 'saving' | 'saved';
  saveError?: string | null;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <SettingsDrawer
      open={open}
      onClose={onClose}
      title={title}
      footer={<DrawerSaveFooter dirty={dirty} saveState={saveState} onSave={onSave} />}
    >
      {saveError && (
        <div className="mx-1 mb-3 rounded-panel bg-mc-danger/10 border border-mc-danger/40 p-2 font-sans text-xs text-mc-danger">
          Save failed: {saveError}
        </div>
      )}
      {children}
    </SettingsDrawer>
  );
}

// ── Helper to build initial toggle states ──────────────────────────────────────────────

export function buildCronStates(agents: AgentCardConfig[]): Record<string, Record<string, boolean>> {
  const r: Record<string, Record<string, boolean>> = {};
  for (const a of agents) {
    const s: Record<string, boolean> = {};
    for (const c of a.cronTriggers) s[c.task] = true;
    r[a.name] = s;
  }
  return r;
}

export function buildEventStates(agents: AgentCardConfig[]): Record<string, Record<string, boolean>> {
  const r: Record<string, Record<string, boolean>> = {};
  for (const a of agents) {
    const s: Record<string, boolean> = {};
    for (const e of a.eventTriggers) s[e.event] = true;
    r[a.name] = s;
  }
  return r;
}

export function toggleNested(
  prev: Record<string, Record<string, boolean>>,
  agent: string,
  key: string,
): Record<string, Record<string, boolean>> {
  return {
    ...prev,
    [agent]: { ...prev[agent], [key]: !(prev[agent]?.[key] ?? true) },
  };
}

// Re-export AgentCardConfig for convenience
export type { AgentCardConfig, ModelInfo };
