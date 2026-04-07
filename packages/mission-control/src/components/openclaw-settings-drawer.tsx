'use client';

import { useState, useCallback } from 'react';
import { SettingsDrawer } from './settings-drawer';
import { HealthDot } from './health-dot';
import { useOpenClawActions } from '@/hooks/use-openclaw-actions';
import type {
  GatewayStatus,
  GatewayConfig,
  CronJob,
  CronStatus,
  SessionInfo,
  ChannelStatus,
  SkillInfo,
  ModelInfo,
} from '@/types/gateway';

// ── Props ────────────────────────────────────────────────────────────────────

interface OpenClawSettingsDrawerProps {
  gateway: GatewayStatus | null;
  config: GatewayConfig | null;
  cronJobs: CronJob[];
  cronStatus: CronStatus | null;
  sessions: SessionInfo[];
  channels: ChannelStatus[];
  skills: SkillInfo[];
  models: ModelInfo[];
}

// ── SVG Icons (Heroicons outline, strokeWidth 1.5) ───────────────────────────

function SignalIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0-3.75-3.75M17.25 21l3.75-3.75" />
    </svg>
  );
}

function CpuChipIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3M21 8.25h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3M21 15.75h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 5.25 8.25v9a2.25 2.25 0 0 0 2.25 2.25Zm0-12h9a2.25 2.25 0 0 1 2.25 2.25v9" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ArrowUpCircleIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m15 11.25-3-3m0 0-3 3m3-3v7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateInput: string | number): string {
  const timestamp = typeof dateInput === 'number' ? dateInput : new Date(dateInput).getTime();
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatSchedule(job: CronJob): string {
  if (job.schedule.kind === 'cron' && job.schedule.expr) return job.schedule.expr;
  if (job.schedule.kind === 'every' && job.schedule.everyMs) {
    const mins = Math.round(job.schedule.everyMs / 60000);
    if (mins < 60) return `every ${mins}m`;
    return `every ${Math.round(mins / 60)}h`;
  }
  if (job.schedule.kind === 'at' && job.schedule.at) return `at ${job.schedule.at}`;
  return job.schedule.kind;
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mb-3 p-2 bg-terminal-red/10 border border-terminal-red/40 rounded flex items-start gap-2">
      <span className="text-xs text-terminal-red flex-1">{message}</span>
      <button
        onClick={onDismiss}
        className="text-[10px] text-terminal-red hover:text-terminal-text shrink-0"
      >
        dismiss
      </button>
    </div>
  );
}

// ── ModelConfig (reusable, UI-only) ─────────────────────────────────────────

type ProviderKey = 'anthropic' | 'openai' | 'google' | 'xai' | 'other';

function getProviderKey(provider: string): ProviderKey {
  const p = provider.toLowerCase();
  if (p.includes('anthropic')) return 'anthropic';
  if (p.includes('openai')) return 'openai';
  if (p.includes('google') || p.includes('gemini')) return 'google';
  if (p.includes('xai') || p.includes('grok')) return 'xai';
  return 'other';
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  other: 'Other',
};

const PROVIDER_COLORS: Record<ProviderKey, string> = {
  anthropic: 'bg-terminal-purple',
  openai: 'bg-terminal-green',
  google: 'bg-terminal-blue',
  xai: 'bg-terminal-orange',
  other: 'bg-terminal-dim',
};

const CREATIVITY_STOPS = [
  { index: 0, label: 'Precise', temperature: 0.0 },
  { index: 1, label: 'Balanced', temperature: 0.7 },
  { index: 2, label: 'Creative', temperature: 1.3 },
];

export interface ModelConfigProps {
  models: ModelInfo[];
  initialModelId?: string;
  initialCreativityIndex?: number;
  onModelChange?: (modelId: string) => void;
  onCreativityChange?: (index: number, temperature: number) => void;
}

export function ModelConfig({
  models,
  initialModelId,
  initialCreativityIndex,
  onModelChange,
  onCreativityChange,
}: ModelConfigProps) {
  const [search, setSearch] = useState('');

  const safeInitialModelId =
    initialModelId ||
    models.find((m) => m.available)?.id ||
    (models[0]?.id ?? '');

  const [selectedModelId, setSelectedModelId] = useState(safeInitialModelId);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [creativityIndex, setCreativityIndex] = useState<number>(initialCreativityIndex ?? 1);

  const selectedModel = models.find((m) => m.id === selectedModelId);
  const currentCreativity = CREATIVITY_STOPS[creativityIndex] ?? CREATIVITY_STOPS[1];

  const modelsByProvider = models.reduce<Record<ProviderKey, ModelInfo[]>>((acc, model) => {
    const key = getProviderKey(model.provider);
    if (!acc[key]) acc[key] = [];
    acc[key].push(model);
    return acc;
  }, { anthropic: [], openai: [], google: [], xai: [], other: [] });

  const searchLower = search.trim().toLowerCase();

  const handleModelSelect = useCallback((id: string) => {
    setSelectedModelId(id);
    setDropdownOpen(false);
    onModelChange?.(id);
  }, [onModelChange]);

  const handleCreativityChange = useCallback((idx: number) => {
    setCreativityIndex(idx);
    const temp = CREATIVITY_STOPS[idx]?.temperature ?? 0.7;
    onCreativityChange?.(idx, temp);
  }, [onCreativityChange]);

  return (
    <div className="space-y-4">
      {/* AI Model */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim">
            AI Model
          </span>
          {selectedModel && selectedModel.id === safeInitialModelId && (
            <span className="text-[9px] px-1 py-0.5 rounded border border-terminal-green/40 text-terminal-green bg-terminal-green/10">
              Recommended
            </span>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="w-full px-2 py-1.5 text-xs bg-terminal-bg border border-terminal-border rounded flex items-center justify-between hover:border-terminal-muted transition-colors"
          >
            {selectedModel ? (
              <div className="flex items-center gap-2">
                <span
                  className={`w-4 h-4 rounded-full ${PROVIDER_COLORS[getProviderKey(selectedModel.provider)]}`}
                />
                <span className="text-terminal-text truncate">
                  {selectedModel.alias || selectedModel.name || selectedModel.id}
                </span>
                <span className="text-[10px] text-terminal-dim">
                  {PROVIDER_LABELS[getProviderKey(selectedModel.provider)]}
                </span>
              </div>
            ) : (
              <span className="text-xs text-terminal-dim">Select a model</span>
            )}
            <span className="text-terminal-dim text-[10px] ml-2">
              {dropdownOpen ? '\u2212' : '+'}
            </span>
          </button>

          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full bg-terminal-surface border border-terminal-border rounded shadow-xl max-h-64 overflow-hidden">
              <div className="p-2 border-b border-terminal-border bg-terminal-muted/20">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[11px] text-terminal-text font-mono focus:outline-none focus:border-terminal-purple"
                />
              </div>
              <div className="max-h-52 overflow-y-auto text-xs">
                {(['anthropic', 'openai', 'google', 'xai', 'other'] as ProviderKey[]).map(
                  (providerKey) => {
                    const group = modelsByProvider[providerKey] ?? [];
                    const filtered = group.filter((m) => {
                      if (!searchLower) return true;
                      const label = (m.alias || m.name || m.id || '').toLowerCase();
                      const provider = m.provider.toLowerCase();
                      return label.includes(searchLower) || provider.includes(searchLower);
                    });
                    if (filtered.length === 0) return null;
                    return (
                      <div
                        key={providerKey}
                        className="border-b border-terminal-border/60 last:border-b-0"
                      >
                        <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-terminal-dim bg-terminal-muted/10">
                          {PROVIDER_LABELS[providerKey]}
                        </div>
                        {filtered.map((model) => {
                          const isSelected = model.id === selectedModelId;
                          const isRecommended = model.id === safeInitialModelId;
                          return (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => handleModelSelect(model.id)}
                              className={`w-full px-2 py-1.5 flex items-center justify-between text-left hover:bg-terminal-muted/30 transition-colors ${
                                isSelected ? 'bg-terminal-muted/30' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-3 h-3 rounded-full ${PROVIDER_COLORS[getProviderKey(model.provider)]}`}
                                />
                                <span className="text-terminal-text truncate">
                                  {model.alias || model.name || model.id}
                                </span>
                                {!model.available && (
                                  <span className="text-[9px] text-terminal-red ml-1">unavailable</span>
                                )}
                              </div>
                              {isRecommended && (
                                <span className="text-[9px] px-1 rounded border border-terminal-green/40 text-terminal-green">
                                  Recommended
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Creativity */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim">
            Creativity
          </span>
          <span className="text-[10px] text-terminal-text">
            {currentCreativity.label} · temp {currentCreativity.temperature.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={creativityIndex}
          onChange={(e) => handleCreativityChange(Number(e.target.value) || 0)}
          className="w-full accent-terminal-purple"
        />
        <div className="flex justify-between text-[9px] text-terminal-dim mt-1">
          <span>Precise</span>
          <span>Balanced</span>
          <span>Creative</span>
        </div>
      </div>
    </div>
  );
}

// ── Save Footer (shared pattern for drawer footers) ─────────────────────────

function DrawerSaveFooter({
  dirty,
  saveState,
  onSave,
}: {
  dirty: boolean;
  saveState: 'idle' | 'saving' | 'saved';
  onSave: () => void;
}) {
  const canClick = dirty && saveState === 'idle';

  let buttonText: string;
  let buttonStyle: string;

  if (saveState === 'saved') {
    buttonText = 'Saved \u2713';
    buttonStyle = 'border-terminal-green/40 text-terminal-green bg-terminal-green/10';
  } else if (saveState === 'saving') {
    buttonText = 'Saving...';
    buttonStyle = 'border-terminal-border text-terminal-dim cursor-not-allowed';
  } else if (dirty) {
    buttonText = 'Save Changes';
    buttonStyle = 'border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10';
  } else {
    buttonText = 'Save Changes';
    buttonStyle = 'border-terminal-border text-terminal-dim cursor-not-allowed';
  }

  return (
    <div className="shrink-0 bg-terminal-surface border-t border-terminal-border px-6 py-3 flex items-center justify-between">
      <div>
        {dirty && saveState === 'idle' && (
          <span className="text-xs text-terminal-yellow font-mono">Unsaved changes</span>
        )}
      </div>
      <button
        onClick={onSave}
        disabled={!canClick}
        className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${buttonStyle}`}
      >
        {buttonText}
      </button>
    </div>
  );
}

export { DrawerSaveFooter };

// ── Shared Skills List ──────────────────────────────────────────────────────

export type SkillTier = 'builtin' | 'trusted' | 'community';

const TIER_BADGE_STYLES: Record<SkillTier, string> = {
  builtin: 'border-terminal-cyan/40 text-terminal-cyan bg-terminal-cyan/10',
  trusted: 'border-terminal-green/40 text-terminal-green bg-terminal-green/10',
  community: 'border-terminal-yellow/40 text-terminal-yellow bg-terminal-yellow/10',
};

export function SharedSkillsList({
  skills: skillItems,
  onToggle,
  subtitle,
  pendingSkill,
}: {
  skills: SkillInfo[];
  onToggle: (name: string, currentlyEnabled: boolean) => void;
  subtitle?: string;
  pendingSkill?: string | null;
}) {
  // Derive tier from source field: bundled → builtin, otherwise → trusted
  function getTier(skill: SkillInfo): SkillTier {
    if (skill.bundled) return 'builtin';
    if (skill.source === 'community') return 'community';
    return 'trusted';
  }

  return (
    <div className="p-3 bg-terminal-muted/20 border border-terminal-border rounded">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-terminal-dim mb-0.5">
        Gateway Skills
      </h4>
      <p className="text-[9px] text-terminal-dim/70 mb-3">
        {subtitle ?? 'Skills loaded in the OpenClaw gateway'}
      </p>
      {skillItems.length === 0 ? (
        <div className="text-xs text-terminal-dim">No skills reported by gateway</div>
      ) : (
        <div className="space-y-1.5">
          {skillItems.map((skill) => {
            const tier = getTier(skill);
            return (
              <div key={skill.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <HealthDot healthy={skill.enabled} />
                  <span className="text-terminal-text truncate">
                    {skill.emoji ? `${skill.emoji} ` : ''}{skill.name}
                  </span>
                  <span className={`text-[8px] px-1 py-px rounded border shrink-0 ${TIER_BADGE_STYLES[tier]}`}>
                    {tier}
                  </span>
                </div>
                <button
                  onClick={() => onToggle(skill.name, skill.enabled)}
                  disabled={pendingSkill === skill.name}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors shrink-0 ml-2 disabled:opacity-50 ${
                    skill.enabled
                      ? 'border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10'
                      : 'border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10'
                  }`}
                >
                  {pendingSkill === skill.name ? '...' : skill.enabled ? 'disable' : 'enable'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function OpenClawSettingsDrawer({
  gateway,
  config,
  cronJobs,
  cronStatus,
  sessions,
  channels,
  skills,
  models,
}: OpenClawSettingsDrawerProps) {
  const [open, setOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    channels: false,
    model: false,
    cron: false,
    restart: false,
  });

  const {
    actionPending,
    restartConfirm,
    setRestartConfirm,
    errorMessage,
    setErrorMessage,
    localSkills,
    dirty,
    saveState,
    handleModelChange,
    handleCreativityChanged,
    handleRunCronJob,
    handleToggleCronJob,
    handleToggleSharedSkill,
    handleRestart,
    handleSaveAll,
  } = useOpenClawActions({ skills });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const configModel = config ? String((config as Record<string, unknown>).model || '') : '';

  const saveFooter = (
    <DrawerSaveFooter dirty={dirty} saveState={saveState} onSave={handleSaveAll} />
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-mono text-terminal-text border border-terminal-border rounded hover:border-terminal-muted hover:bg-terminal-muted/30 transition-colors"
      >
        Settings
      </button>

      <SettingsDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="OpenClaw Settings"
        footer={saveFooter}
      >
        {errorMessage && (
          <ErrorBanner message={errorMessage} onDismiss={() => setErrorMessage(null)} />
        )}

        {/* ── Section 1: Channels Detail ──────────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('channels')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition-colors ${
              expandedSections['channels']
                ? 'border-terminal-green/50 bg-terminal-green/5'
                : 'border-terminal-border hover:border-terminal-muted'
            }`}
          >
            <div className="flex items-center gap-2">
              <SignalIcon className="w-4 h-4 text-terminal-green" />
              <span className="text-xs font-bold uppercase tracking-widest text-terminal-text">
                Channels
              </span>
              {channels.length > 0 && (
                <span className="text-[10px] text-terminal-dim">
                  ({channels.filter((c) => c.connected).length}/{channels.length})
                </span>
              )}
            </div>
            <span className="text-terminal-dim text-xs">
              {expandedSections['channels'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['channels'] && (
            <div className="mt-3 space-y-2">
              {channels.length === 0 ? (
                <div className="text-xs text-terminal-dim p-3 bg-terminal-muted/20 border border-terminal-border rounded">
                  No channels configured
                </div>
              ) : (
                channels.map((ch) => (
                  <div key={ch.provider} className="p-3 bg-terminal-muted/20 border border-terminal-border rounded">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HealthDot healthy={ch.connected} />
                        <span className="text-xs text-terminal-text capitalize">{ch.provider}</span>
                        {ch.accountId && (
                          <span className="text-[10px] text-terminal-dim">{ch.accountId}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {ch.error && (
                          <span className="text-[10px] text-terminal-red">{ch.error}</span>
                        )}
                        {ch.lastMessageAt && (
                          <span className="text-[10px] text-terminal-dim">
                            {relativeTime(ch.lastMessageAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    {ch.stats && (
                      <div className="mt-1 text-[10px] text-terminal-dim">
                        Sent: {ch.stats.sent} — Received: {ch.stats.received}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* ── Section 2: Model & Skills ───────────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('model')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition-colors ${
              expandedSections['model']
                ? 'border-terminal-purple/50 bg-terminal-purple/5'
                : 'border-terminal-border hover:border-terminal-muted'
            }`}
          >
            <div className="flex items-center gap-2">
              <CpuChipIcon className="w-4 h-4 text-terminal-purple" />
              <span className="text-xs font-bold uppercase tracking-widest text-terminal-text">
                Model & Skills
              </span>
            </div>
            <span className="text-terminal-dim text-xs">
              {expandedSections['model'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['model'] && (
            <div className="mt-3 space-y-3">
              <div className="p-3 bg-terminal-muted/20 border border-terminal-border rounded space-y-3">
                <ModelConfig
                  models={models}
                  initialModelId={gateway?.model || configModel}
                  onModelChange={handleModelChange}
                  onCreativityChange={handleCreativityChanged}
                />
              </div>

              <div className="border-t border-terminal-border/60" />

              <SharedSkillsList
                skills={localSkills}
                onToggle={handleToggleSharedSkill}
                pendingSkill={actionPending}
              />
            </div>
          )}
        </section>
        {/* ── Section 3: Heartbeat & Cron ─────────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('cron')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition-colors ${
              expandedSections['cron']
                ? 'border-terminal-orange/50 bg-terminal-orange/5'
                : 'border-terminal-border hover:border-terminal-muted'
            }`}
          >
            <div className="flex items-center gap-2">
              <ClockIcon className="w-4 h-4 text-terminal-orange" />
              <span className="text-xs font-bold uppercase tracking-widest text-terminal-text">
                Heartbeat & Cron
              </span>
              {cronStatus && (
                <span className="text-[10px] text-terminal-dim">({cronStatus.jobCount} jobs)</span>
              )}
            </div>
            <span className="text-terminal-dim text-xs">
              {expandedSections['cron'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['cron'] && (
            <div className="mt-3 space-y-3">
              {cronStatus && (
                <div className="p-3 bg-terminal-muted/20 border border-terminal-border rounded">
                  <div className="flex items-center gap-2 text-xs">
                    <HealthDot healthy={cronStatus.running} />
                    <span className="text-terminal-text">
                      Scheduler {cronStatus.running ? 'running' : 'stopped'}
                    </span>
                    {cronStatus.nextRun && (
                      <span className="text-terminal-dim ml-auto">
                        next: {relativeTime(cronStatus.nextRun)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {cronJobs.length === 0 ? (
                <div className="text-xs text-terminal-dim p-3 bg-terminal-muted/20 border border-terminal-border rounded">
                  No cron jobs configured
                </div>
              ) : (
                cronJobs.map((job) => (
                  <div key={job.id} className="p-3 bg-terminal-muted/20 border border-terminal-border rounded">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <HealthDot healthy={job.enabled} />
                        <span className="text-xs text-terminal-text font-medium">
                          {job.name || job.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRunCronJob(job.id)}
                          disabled={actionPending === job.id}
                          className="text-[10px] px-1.5 py-0.5 border border-terminal-orange/30 text-terminal-orange rounded hover:bg-terminal-orange/10 transition-colors disabled:opacity-50"
                        >
                          {actionPending === job.id ? '...' : 'run'}
                        </button>
                        <button
                          onClick={() => handleToggleCronJob(job.id, !job.enabled)}
                          disabled={actionPending === job.id}
                          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50 ${
                            job.enabled
                              ? 'border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10'
                              : 'border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10'
                          }`}
                        >
                          {job.enabled ? 'disable' : 'enable'}
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] text-terminal-dim space-y-0.5">
                      <div>Schedule: {formatSchedule(job)}</div>
                      <div>Target: {job.sessionTarget}</div>
                      {job.lastRun && (
                        <div>
                          Last: {job.lastRun.status} — {relativeTime(job.lastRun.at)}
                          {job.lastRun.durationMs && ` (${job.lastRun.durationMs}ms)`}
                        </div>
                      )}
                      {job.nextRun && <div>Next: {relativeTime(job.nextRun)}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* ── Section 4: Restart ───────────────────────────────────── */}
        <section>
          <button
            onClick={() => toggleSection('restart')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition-colors ${
              expandedSections['restart']
                ? 'border-terminal-dim/50 bg-terminal-dim/5'
                : 'border-terminal-border hover:border-terminal-muted'
            }`}
          >
            <div className="flex items-center gap-2">
              <ArrowUpCircleIcon className="w-4 h-4 text-terminal-dim" />
              <span className="text-xs font-bold uppercase tracking-widest text-terminal-text">
                Restart
              </span>
            </div>
            <span className="text-terminal-dim text-xs">
              {expandedSections['restart'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['restart'] && (
            <div className="mt-3 space-y-3">
              {!restartConfirm ? (
                <button
                  onClick={() => setRestartConfirm(true)}
                  disabled={actionPending === 'restart' || !gateway}
                  className="w-full px-3 py-2 text-xs text-terminal-red border border-terminal-red/30 rounded hover:bg-terminal-red/10 transition-colors disabled:opacity-50"
                >
                  {actionPending === 'restart' ? 'Restarting...' : 'Restart Gateway'}
                </button>
              ) : (
                <div className="p-3 bg-terminal-red/5 border border-terminal-red/30 rounded space-y-2">
                  <p className="text-xs text-terminal-red">
                    This will restart the OpenClaw gateway. All active sessions will be interrupted.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRestart}
                      className="px-3 py-1.5 text-xs text-terminal-bg bg-terminal-red rounded hover:bg-terminal-red/80 transition-colors"
                    >
                      Confirm Restart
                    </button>
                    <button
                      onClick={() => setRestartConfirm(false)}
                      className="px-3 py-1.5 text-xs text-terminal-text border border-terminal-border rounded hover:bg-terminal-muted/30 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </SettingsDrawer>
    </>
  );
}
