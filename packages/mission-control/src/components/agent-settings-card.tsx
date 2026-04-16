'use client';

import { useState, useCallback } from 'react';
import { HealthDot } from './health-dot';
import { ModelConfig } from './openclaw-settings-drawer';
import type { ModelInfo } from '@/types/gateway';

// ── Cron-to-human helper ─────────────────────────────────────────────────────────────────

const DOW_NAMES: Record<string, string> = {
  '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
  '4': 'Thursday', '5': 'Friday', '6': 'Saturday',
};

export function cronToHuman(expr: string): string {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, _mon, dow] = parts;

  if (min?.startsWith('*/') || hour?.startsWith('*/')) {
    if (hour?.startsWith('*/')) {
      const interval = parseInt(hour.replace('*/', ''), 10);
      if (!isNaN(interval)) return `Every ${interval} hours`;
    }
    const interval = parseInt(min?.replace('*/', '') ?? '0', 10);
    if (!isNaN(interval) && hour?.includes(',')) {
      return `Every ${interval} min (${formatHourRange(hour)})`;
    }
    if (!isNaN(interval)) return `Every ${interval} min`;
  }

  const m = parseInt(min ?? '0', 10);
  const timeStr = formatTime(parseInt(hour ?? '0', 10), m);

  if (dom === '1' && dow === '*') return `1st of month at ${timeStr}`;
  if (dom === '1-7' && dow === '1') return `1st Monday of month at ${timeStr}`;

  if (dow && dow !== '*') {
    if (dow === '1-5') return `Weekdays at ${timeStr}`;
    if (dow === '0,6') return `Weekends at ${timeStr}`;
    const days = dow.split(',');
    if (days.length === 1) {
      const name = DOW_NAMES[days[0] ?? ''] ?? dow;
      return `Every ${name} at ${timeStr}`;
    }
    const names = days.map((d) => DOW_NAMES[d] ?? d);
    return `${names.join(' & ')} at ${timeStr}`;
  }

  if (dom === '*') return `Daily at ${timeStr}`;

  return expr;
}

function formatTime(h24: number, m: number): string {
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function formatHourRange(hourExpr: string): string {
  const ranges = hourExpr.split(',').map((r) => {
    if (r.includes('-')) {
      const [s, e] = r.split('-');
      return `${formatHourOnly(parseInt(s ?? '0', 10))}\u2013${formatHourOnly(parseInt(e ?? '0', 10))}`;
    }
    return formatHourOnly(parseInt(r, 10));
  });
  return ranges.join(', ');
}

function formatHourOnly(h: number): string {
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
}

function fakeNextRun(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return '';
  const [min, hour, , , dow] = parts;

  if (cron.startsWith('*/')) {
    const interval = parseInt(min?.replace('*/', '') ?? '0', 10);
    if (!isNaN(interval)) return `Next: in ${interval}m`;
  }

  const h = parseInt(hour ?? '0', 10);
  const m = parseInt(min ?? '0', 10);
  const timeStr = formatTime(h, m);
  const now = new Date();
  const nowH = now.getUTCHours();
  const targetH = h;

  if (dow === '*') {
    const diff = targetH - nowH;
    if (diff > 0) return `Next: Today ${timeStr} (in ${diff}h)`;
    return `Next: Tomorrow ${timeStr}`;
  }
  return `Next: ${timeStr}`;
}

// ── Types ────────────────────────────────────────────────────────────────────────────────

export interface AgentIntegration {
  platform: string;
  actions: string[];
}

export interface AgentCronTrigger {
  task: string;
  cron: string;
  modelOverride?: string;
}

export interface AgentEventTrigger {
  event: string;
  label: string;
  modelOverride?: string;
  subtitle?: string;
}

export interface AgentCardConfig {
  name: string;
  label: string;
  role?: string;
  defaultModel: string;
  defaultCreativity?: number;
  learnedSkills: string[];
  integrations: AgentIntegration[];
  cronTriggers: AgentCronTrigger[];
  eventTriggers: AgentEventTrigger[];
}

// ── Sub-section header ──────────────────────────────────────────────────────────────────

function SubSectionHeader({ title }: { title: string }) {
  return (
    <div className="border-t border-mc-border/40 pt-3 mt-3">
      <h4 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-tertiary mb-2">
        {title}
      </h4>
    </div>
  );
}

// ── Chevron icon ─────────────────────────────────────────────────────────────────────────

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={`${className ?? 'w-3 h-3'} transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

// ── MiniToggle (compact toggle for cron/event rows) ──────────────────────────

function MiniToggle({
  checked,
  onChange,
  color,
}: {
  checked: boolean;
  onChange: () => void;
  color: 'blue' | 'green';
}) {
  const colorMap = {
    blue: {
      on: 'bg-mc-info/50 border-mc-info/30',
      off: 'bg-mc-info/20 border-mc-info/30',
      knob: 'bg-mc-info',
    },
    green: {
      on: 'bg-mc-success/50 border-mc-success/30',
      off: 'bg-mc-success/20 border-mc-success/30',
      knob: 'bg-mc-success',
    },
  };
  const styles = colorMap[color];
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative w-8 h-4 rounded-full border transition-colors duration-mc ease-mc-out shrink-0 ml-2 ${
        checked ? styles.on : styles.off
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`absolute top-0.5 left-0 w-3 h-3 rounded-full ${styles.knob} transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// ── Agent Card ──────────────────────────────────────────────────────────────────────────

interface AgentCardProps {
  config: AgentCardConfig;
  models: ModelInfo[];
  cronStates: Record<string, boolean>;
  eventStates: Record<string, boolean>;
  onCronToggle: (task: string) => void;
  onEventToggle: (event: string) => void;
  onDirty: () => void;
  /** Called with the selected model ID when user changes model */
  onModelSelect?: (modelId: string) => void;
  /** Called with creativity index and temperature when user changes creativity */
  onCreativitySelect?: (creativityIndex: number, temperature: number) => void;
  /** Override initial model from saved settings (takes precedence over config.defaultModel) */
  savedModelId?: string;
  /** Override initial creativity from saved settings */
  savedCreativityIndex?: number;
  defaultExpanded?: boolean;
}

export function AgentCard({
  config,
  models,
  cronStates,
  eventStates,
  onCronToggle,
  onEventToggle,
  onDirty,
  onModelSelect,
  onCreativitySelect,
  savedModelId,
  savedCreativityIndex,
  defaultExpanded = false,
}: AgentCardProps) {
  const [cardOpen, setCardOpen] = useState(defaultExpanded);
  const [integrationsExpanded, setIntegrationsExpanded] = useState<Record<string, boolean>>({});

  const togglePlatform = useCallback((platform: string) => {
    setIntegrationsExpanded((prev) => ({ ...prev, [platform]: !prev[platform] }));
  }, []);

  const totalActions = config.integrations.reduce((sum, ig) => sum + ig.actions.length, 0);

  return (
    <div className="bg-mc-surface/50 border border-mc-border rounded-panel overflow-hidden">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setCardOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-mc-surface/30 transition-colors duration-mc ease-mc-out"
      >
        <div className="flex items-center gap-2">
          <ChevronIcon open={cardOpen} className="w-3 h-3 text-mc-text-tertiary" />
          <span className="font-sans text-xs font-medium text-mc-text">{config.label}</span>
          {config.role && (
            <span className="font-sans text-[9px] px-1.5 py-0.5 rounded-panel border border-mc-info/40 text-mc-info bg-mc-info/10">
              {config.role}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono tabular-nums text-[9px] text-mc-text-tertiary">
          <span>{config.cronTriggers.length} crons</span>
          <span className="text-mc-border">|</span>
          <span>{config.eventTriggers.length} events</span>
          <span className="text-mc-border">|</span>
          <span>{totalActions} actions</span>
        </div>
      </button>

      {cardOpen && (
        <div className="px-3 pb-3 space-y-1">
          {/* a) Model config */}
          <ModelConfig
            models={models}
            initialModelId={savedModelId ?? config.defaultModel}
            initialCreativityIndex={savedCreativityIndex ?? config.defaultCreativity}
            onModelChange={(id) => { onModelSelect?.(id); onDirty(); }}
            onCreativityChange={(idx, temp) => { onCreativitySelect?.(idx, temp); onDirty(); }}
          />

          {/* b) Agent Skills (learned) */}
          <SubSectionHeader title="Agent Skills" />
          {config.learnedSkills.length === 0 ? (
            <p className="font-sans text-[10px] text-mc-text-tertiary italic">
              No learned skills yet — added automatically via Claudeception
            </p>
          ) : (
            <div className="space-y-1">
              {config.learnedSkills.map((skill) => (
                <div key={skill} className="flex items-center gap-2 font-sans text-xs">
                  <HealthDot healthy={true} />
                  <span className="text-mc-text">{skill}</span>
                </div>
              ))}
            </div>
          )}

          {/* c) Integrations (read-only) */}
          <SubSectionHeader title="Integrations" />
          <div className="flex flex-wrap gap-1.5">
            {config.integrations.map((ig) => (
              <button
                key={ig.platform}
                type="button"
                onClick={() => togglePlatform(ig.platform)}
                className={`font-sans text-[10px] px-1.5 py-0.5 rounded-panel border transition-colors duration-mc ease-mc-out flex items-center gap-1 ${
                  integrationsExpanded[ig.platform]
                    ? 'border-mc-border-hover bg-mc-surface/50 text-mc-text'
                    : 'border-mc-border text-mc-text hover:border-mc-border-hover'
                }`}
              >
                <span>{ig.platform}</span>
                <span className="text-mc-text-tertiary">({ig.actions.length})</span>
              </button>
            ))}
          </div>
          {config.integrations.map((ig) =>
            integrationsExpanded[ig.platform] ? (
              <div
                key={`${ig.platform}-detail`}
                className="mt-1.5 p-2 bg-mc-surface/50 border border-mc-border/40 rounded-panel text-[10px] text-mc-text-tertiary font-mono flex flex-wrap gap-x-3 gap-y-0.5"
              >
                {ig.actions.map((a) => (
                  <span key={a}>{a}</span>
                ))}
              </div>
            ) : null,
          )}

          {/* d) Scheduled Tasks (cron triggers) */}
          {config.cronTriggers.length > 0 && (
            <>
              <SubSectionHeader title="Scheduled Tasks" />
              <div className="space-y-1">
                {config.cronTriggers.map((cron) => {
                  const enabled = cronStates[cron.task] ?? true;
                  return (
                    <div
                      key={cron.task}
                      className={`flex items-center justify-between py-1.5 ${
                        !enabled ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-sans text-[11px]">
                          <span className="text-mc-text font-medium truncate">
                            {cron.task.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                          {cron.modelOverride && (
                            <span className="font-mono tabular-nums text-[8px] px-1 py-px rounded-panel border border-mc-info/40 text-mc-info bg-mc-info/10 shrink-0">
                              {cron.modelOverride}
                            </span>
                          )}
                        </div>
                        <div className="font-sans text-[10px] text-mc-text-tertiary" title={cron.cron}>
                          {enabled ? cronToHuman(cron.cron) : 'Paused'}
                        </div>
                        {enabled && (
                          <div className="font-sans text-[9px] text-mc-text-tertiary/60">
                            {fakeNextRun(cron.cron)}
                          </div>
                        )}
                      </div>
                      <MiniToggle
                        checked={enabled}
                        onChange={() => onCronToggle(cron.task)}
                        color="blue"
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* e) Event Triggers */}
          {config.eventTriggers.length > 0 && (
            <>
              <SubSectionHeader title="Event Triggers" />
              <div className="space-y-1">
                {config.eventTriggers.map((evt) => {
                  const enabled = eventStates[evt.event] ?? true;
                  return (
                    <div
                      key={evt.event}
                      className={`flex items-center justify-between py-1.5 ${
                        !enabled ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-sans text-[11px]">
                          <span className="text-mc-text font-medium truncate">
                            {evt.label}
                          </span>
                          {evt.modelOverride && (
                            <span className="font-mono tabular-nums text-[8px] px-1 py-px rounded-panel border border-mc-info/40 text-mc-info bg-mc-info/10 shrink-0">
                              {evt.modelOverride}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-mc-text-tertiary font-mono">
                          {enabled ? evt.event : 'Paused'}
                        </div>
                        {evt.subtitle && enabled && (
                          <div className="font-sans text-[9px] text-mc-text-tertiary/60 italic">
                            {evt.subtitle}
                          </div>
                        )}
                      </div>
                      <MiniToggle
                        checked={enabled}
                        onChange={() => onEventToggle(evt.event)}
                        color="green"
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
