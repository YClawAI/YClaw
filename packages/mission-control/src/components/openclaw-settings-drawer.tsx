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

// ── Props ────────────────────────────────────────────────────────────────────────────────

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

// ── SVG Icons (Heroicons outline, strokeWidth 1.5) ─────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────────────────

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
    <div className="mb-3 p-2 bg-mc-danger/10 border border-mc-danger/40 rounded-panel flex items-start gap-2">
      <span className="font-sans text-xs text-mc-danger flex-1">{message}</span>
      <button
        onClick={onDismiss}
        className="font-sans text-[10px] text-mc-danger hover:text-mc-text shrink-0 transition-colors duration-mc ease-mc-out"
      >
        dismiss
      </button>
    </div>
  );
}

// ── ModelConfig (reusable, UI-only) ─────────────────────────────────────────────────

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
  anthropic: 'bg-mc-info',
  openai: 'bg-mc-success',
  google: 'bg-mc-info',
  xai: 'bg-mc-warning',
  other: 'bg-mc-text-tertiary',
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
          <span className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-tertiary">
            AI Model
          </span>
          {selectedModel && selectedModel.id === safeInitialModelId && (
            <span className="font-sans text-[9px] px-1 py-0.5 rounded-panel border border-mc-success/40 text-mc-success bg-mc-success/10">
              Recommended
            </span>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="w-full px-2 py-1.5 font-sans text-xs bg-mc-surface border border-mc-border rounded-panel flex items-center justify-between hover:border-mc-border-hover transition-colors duration-mc ease-mc-out"
          >
            {selectedModel ? (
              <div className="flex items-center gap-2">
                <span
                  className={`w-4 h-4 rounded-full ${PROVIDER_COLORS[getProviderKey(selectedModel.provider)]}`}
                />
                <span className="text-mc-text truncate">
                  {selectedModel.alias || selectedModel.name || selectedModel.id}
                </span>
                <span className="font-sans text-[10px] text-mc-text-tertiary">
                  {PROVIDER_LABELS[getProviderKey(selectedModel.provider)]}
                </span>
              </div>
            ) : (
              <span className="font-sans text-xs text-mc-text-tertiary">Select a model</span>
            )}
            <span className="text-mc-text-tertiary text-[10px] ml-2">
              {dropdownOpen ? '\u2212' : '+'}
            </span>
          </button>

          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full bg-mc-surface border border-mc-border rounded-panel shadow-xl max-h-64 overflow-hidden">
              <div className="p-2 border-b border-mc-border bg-mc-surface/60">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1 font-sans text-[11px] text-mc-text focus:outline-none focus:border-mc-accent transition-colors duration-mc ease-mc-out"
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
                        className="border-b border-mc-border/60 last:border-b-0"
                      >
                        <div className="px-2 py-1 font-sans text-[9px] uppercase tracking-label text-mc-text-tertiary bg-mc-surface/40">
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
                              className={`w-full px-2 py-1.5 flex items-center justify-between text-left hover:bg-mc-surface/60 transition-colors duration-mc ease-mc-out ${
                                isSelected ? 'bg-mc-surface/60' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-3 h-3 rounded-full ${PROVIDER_COLORS[getProviderKey(model.provider)]}`}
                                />
                                <span className="text-mc-text truncate">
                                  {model.alias || model.name || model.id}
                                </span>
                                {!model.available && (
                                  <span className="font-sans text-[9px] text-mc-danger ml-1">unavailable</span>
                                )}
                              </div>
                              {isRecommended && (
                                <span className="font-sans text-[9px] px-1 rounded-panel border border-mc-success/40 text-mc-success">
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
          <span className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-tertiary">
            Creativity
          </span>
          <span className="font-sans text-[10px] text-mc-text">
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
          className="w-full accent-mc-accent"
        />
        <div className="flex justify-between font-sans text-[9px] text-mc-text-tertiary mt-1">
          <span>Precise</span>
          <span>Balanced</span>
          <span>Creative</span>
        </div>
      </div>
    </div>
  );
}

// ── Save Footer (shared pattern for drawer footers) ───────────────────────

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
    buttonStyle = 'border-mc-success/40 text-mc-success bg-mc-success/10';
  } else if (saveState === 'saving') {
    buttonText = 'Saving...';
    buttonStyle = 'border-mc-border text-mc-text-tertiary cursor-not-allowed';
  } else if (dirty) {
    buttonText = 'Save Changes';
    buttonStyle = 'border-mc-success/40 text-mc-success hover:bg-mc-success/10';
  } else {
    buttonText = 'Save Changes';
    buttonStyle = 'border-mc-border text-mc-text-tertiary cursor-not-allowed';
  }

  return (
    <div className="shrink-0 bg-mc-bg/95 backdrop-blur-sm border-t border-mc-border px-6 py-3 flex items-center justify-between">
      <div>
        {dirty && saveState === 'idle' && (
          <span className="font-sans text-xs text-mc-warning">Unsaved changes</span>
        )}
      </div>
      <button
        onClick={onSave}
        disabled={!canClick}
        className={`px-4 py-1.5 font-sans text-xs rounded-panel border transition-colors duration-mc ease-mc-out ${buttonStyle}`}
      >
        {buttonText}
      </button>
    </div>
  );
}

export { DrawerSaveFooter };

// ── Shared Skills List ────────────────────────────────────────────────────────────

export type SkillTier = 'builtin' | 'trusted' | 'community';

const TIER_BADGE_STYLES: Record<SkillTier, string> = {
  builtin: 'border-mc-accent/40 text-mc-accent bg-mc-accent/10',
  trusted: 'border-mc-success/40 text-mc-success bg-mc-success/10',
  community: 'border-mc-warning/40 text-mc-warning bg-mc-warning/10',
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
    <div className="p-3 bg-mc-surface border border-mc-border rounded-panel">
      <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-tertiary mb-0.5">
        Gateway Skills
      </h4>
      <p className="font-sans text-[9px] text-mc-text-tertiary/70 mb-3">
        {subtitle ?? 'Skills loaded in the OpenClaw gateway'}
      </p>
      {skillItems.length === 0 ? (
        <div className="font-sans text-xs text-mc-text-tertiary">No skills reported by gateway</div>
      ) : (
        <div className="space-y-1.5">
          {skillItems.map((skill) => {
            const tier = getTier(skill);
            return (
              <div key={skill.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <HealthDot healthy={skill.enabled} />
                  <span className="text-mc-text truncate">
                    {skill.emoji ? `${skill.emoji} ` : ''}{skill.name}
                  </span>
                  <span className={`font-sans text-[8px] px-1 py-px rounded-panel border shrink-0 ${TIER_BADGE_STYLES[tier]}`}>
                    {tier}
                  </span>
                </div>
                <button
                  onClick={() => onToggle(skill.name, skill.enabled)}
                  disabled={pendingSkill === skill.name}
                  className={`font-sans text-[10px] px-1.5 py-0.5 rounded-panel border transition-colors duration-mc ease-mc-out shrink-0 ml-2 disabled:opacity-50 ${
                    skill.enabled
                      ? 'border-mc-danger/30 text-mc-danger hover:bg-mc-danger/10'
                      : 'border-mc-success/30 text-mc-success hover:bg-mc-success/10'
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

// ── Main Component ──────────────────────────────────────────────────────────────────────────

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
        className="px-3 py-1.5 font-sans text-[11px] uppercase tracking-label rounded-panel border border-mc-border text-mc-text-tertiary hover:text-mc-text hover:border-mc-border-hover transition-colors duration-mc ease-mc-out"
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

        {/* ── Section 1: Channels Detail ──────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('channels')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-panel border transition-colors duration-mc ease-mc-out ${
              expandedSections['channels']
                ? 'border-mc-success/50 bg-mc-success/5'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <SignalIcon className="w-4 h-4 text-mc-success" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Channels
              </span>
              {channels.length > 0 && (
                <span className="font-mono tabular-nums text-[10px] text-mc-text-tertiary">
                  ({channels.filter((c) => c.connected).length}/{channels.length})
                </span>
              )}
            </div>
            <span className="text-mc-text-tertiary text-xs">
              {expandedSections['channels'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['channels'] && (
            <div className="mt-3 space-y-2">
              {channels.length === 0 ? (
                <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded-panel p-6 flex flex-col items-center justify-center gap-2 text-center">
                  <span className="text-2xl text-mc-text-tertiary/40">◇</span>
                  <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">
                    No channels
                  </div>
                  <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
                    Connect Slack, Discord, or email to route OpenClaw notifications here.
                  </p>
                </div>
              ) : (
                channels.map((ch) => (
                  <div key={ch.provider} className="p-3 bg-mc-surface border border-mc-border rounded-panel">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HealthDot healthy={ch.connected} />
                        <span className="font-sans text-xs text-mc-text capitalize">{ch.provider}</span>
                        {ch.accountId && (
                          <span className="font-mono tabular-nums text-[10px] text-mc-text-tertiary">{ch.accountId}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {ch.error && (
                          <span className="font-sans text-[10px] text-mc-danger">{ch.error}</span>
                        )}
                        {ch.lastMessageAt && (
                          <span className="font-sans text-[10px] text-mc-text-tertiary">
                            {relativeTime(ch.lastMessageAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    {ch.stats && (
                      <div className="mt-1 font-mono tabular-nums text-[10px] text-mc-text-tertiary">
                        Sent: {ch.stats.sent} — Received: {ch.stats.received}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* ── Section 2: Model & Skills ─────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('model')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-panel border transition-colors duration-mc ease-mc-out ${
              expandedSections['model']
                ? 'border-mc-info/50 bg-mc-info/5'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <CpuChipIcon className="w-4 h-4 text-mc-info" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Model & Skills
              </span>
            </div>
            <span className="text-mc-text-tertiary text-xs">
              {expandedSections['model'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['model'] && (
            <div className="mt-3 space-y-3">
              <div className="p-3 bg-mc-surface border border-mc-border rounded-panel space-y-3">
                <ModelConfig
                  models={models}
                  initialModelId={gateway?.model || configModel}
                  onModelChange={handleModelChange}
                  onCreativityChange={handleCreativityChanged}
                />
              </div>

              <div className="border-t border-mc-border/60" />

              <SharedSkillsList
                skills={localSkills}
                onToggle={handleToggleSharedSkill}
                pendingSkill={actionPending}
              />
            </div>
          )}
        </section>
        {/* ── Section 3: Heartbeat & Cron ─────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('cron')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-panel border transition-colors duration-mc ease-mc-out ${
              expandedSections['cron']
                ? 'border-mc-warning/50 bg-mc-warning/5'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <ClockIcon className="w-4 h-4 text-mc-warning" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Heartbeat & Cron
              </span>
              {cronStatus && (
                <span className="font-mono tabular-nums text-[10px] text-mc-text-tertiary">({cronStatus.jobCount} jobs)</span>
              )}
            </div>
            <span className="text-mc-text-tertiary text-xs">
              {expandedSections['cron'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['cron'] && (
            <div className="mt-3 space-y-3">
              {cronStatus && (
                <div className="p-3 bg-mc-surface border border-mc-border rounded-panel">
                  <div className="flex items-center gap-2 font-sans text-xs">
                    <HealthDot healthy={cronStatus.running} />
                    <span className="text-mc-text">
                      Scheduler {cronStatus.running ? 'running' : 'stopped'}
                    </span>
                    {cronStatus.nextRun && (
                      <span className="text-mc-text-tertiary ml-auto">
                        next: {relativeTime(cronStatus.nextRun)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {cronJobs.length === 0 ? (
                <div className="font-sans text-xs text-mc-text-tertiary p-3 bg-mc-surface border border-mc-border rounded-panel">
                  No cron jobs configured
                </div>
              ) : (
                cronJobs.map((job) => (
                  <div key={job.id} className="p-3 bg-mc-surface border border-mc-border rounded-panel">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <HealthDot healthy={job.enabled} />
                        <span className="font-sans text-xs text-mc-text font-medium">
                          {job.name || job.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRunCronJob(job.id)}
                          disabled={actionPending === job.id}
                          className="font-sans text-[10px] px-1.5 py-0.5 border border-mc-warning/30 text-mc-warning rounded-panel hover:bg-mc-warning/10 transition-colors duration-mc ease-mc-out disabled:opacity-50"
                        >
                          {actionPending === job.id ? '...' : 'run'}
                        </button>
                        <button
                          onClick={() => handleToggleCronJob(job.id, !job.enabled)}
                          disabled={actionPending === job.id}
                          className={`font-sans text-[10px] px-1.5 py-0.5 rounded-panel border transition-colors duration-mc ease-mc-out disabled:opacity-50 ${
                            job.enabled
                              ? 'border-mc-danger/30 text-mc-danger hover:bg-mc-danger/10'
                              : 'border-mc-success/30 text-mc-success hover:bg-mc-success/10'
                          }`}
                        >
                          {job.enabled ? 'disable' : 'enable'}
                        </button>
                      </div>
                    </div>
                    <div className="font-mono tabular-nums text-[10px] text-mc-text-tertiary space-y-0.5">
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

        {/* ── Section 4: Restart ─────────────────────────────── */}
        <section>
          <button
            onClick={() => toggleSection('restart')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-panel border transition-colors duration-mc ease-mc-out ${
              expandedSections['restart']
                ? 'border-mc-text-tertiary/50 bg-mc-text-tertiary/5'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <ArrowUpCircleIcon className="w-4 h-4 text-mc-text-tertiary" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Restart
              </span>
            </div>
            <span className="text-mc-text-tertiary text-xs">
              {expandedSections['restart'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['restart'] && (
            <div className="mt-3 space-y-3">
              {!restartConfirm ? (
                <button
                  onClick={() => setRestartConfirm(true)}
                  disabled={actionPending === 'restart' || !gateway}
                  className="w-full px-3 py-2 font-sans text-xs text-mc-danger border border-mc-danger/30 rounded-panel hover:bg-mc-danger/10 transition-colors duration-mc ease-mc-out disabled:opacity-50"
                >
                  {actionPending === 'restart' ? 'Restarting...' : 'Restart Gateway'}
                </button>
              ) : (
                <div className="p-3 bg-mc-danger/5 border border-mc-danger/30 rounded-panel space-y-2">
                  <p className="font-sans text-xs text-mc-danger">
                    This will restart the OpenClaw gateway. All active sessions will be interrupted.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRestart}
                      className="px-3 py-1.5 font-sans text-xs text-mc-bg bg-mc-danger rounded-panel hover:bg-mc-danger/80 transition-colors duration-mc ease-mc-out"
                    >
                      Confirm Restart
                    </button>
                    <button
                      onClick={() => setRestartConfirm(false)}
                      className="px-3 py-1.5 font-sans text-xs text-mc-text border border-mc-border rounded-panel hover:bg-mc-surface transition-colors duration-mc ease-mc-out"
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
