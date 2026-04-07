'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  DeptSettingsShell, DepartmentDirectiveSection, AgentsSection,
  NotificationsSection, SettingsSection, InfoTooltip,
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

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

// ── Agent Configs ────────────────────────────────────────────────────────────

const EMBER: AgentCardConfig = {
  name: 'ember',
  label: 'Ember',
  role: 'Content',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 1,
  learnedSkills: ['humanizer-guide', 'x-algorithm-optimization', 'asset-request-guide'],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch'] },
    { platform: 'Twitter', actions: ['post', 'thread', 'reply', 'like', 'retweet', 'media_upload'] },
    { platform: 'Twitter Profile', actions: ['update_profile', 'update_profile_image', 'update_profile_banner'] },
    { platform: 'X', actions: ['search', 'lookup', 'user', 'user_tweets'] },
    { platform: 'Telegram', actions: ['message', 'announce'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '10 13 * * *' },
    { task: 'daily_content_batch', cron: '0 14 * * 1-5' },
    { task: 'midday_post', cron: '30 16 * * 1-5' },
    { task: 'afternoon_engagement', cron: '0 22 * * 1-5' },
    { task: 'weekend_content', cron: '0 15 * * 0,6' },
  ],
  eventTriggers: [
    { event: 'forge:asset_ready', label: 'Publish With Asset' },
    { event: 'ember:directive', label: 'Handle Directive' },
    { event: 'reviewer:approved', label: 'Publish Approved Content' },
    { event: 'reviewer:flagged', label: 'Revise Flagged Content' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const FORGE: AgentCardConfig = {
  name: 'forge',
  label: 'Forge',
  role: 'Creative',
  defaultModel: 'claude-haiku-4-5',
  defaultCreativity: 1,
  learnedSkills: ['image-generation', 'video-generation'],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch'] },
    { platform: 'Flux', actions: ['generate'] },
    { platform: 'Video', actions: ['text_to_video', 'image_to_video', 'edit', 'veo_generate'] },
    { platform: 'Twitter', actions: ['media_upload', 'update_profile_image', 'update_profile_banner'] },
    { platform: 'Telegram', actions: ['set_chat_photo'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '14 13 * * *' },
  ],
  eventTriggers: [
    { event: 'ember:needs_asset', label: 'Create Asset' },
    { event: 'strategist:slack_delegation', label: 'Handle Slack Delegation' },
    { event: 'forge:directive', label: 'Handle Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const SCOUT: AgentCardConfig = {
  name: 'scout',
  label: 'Scout',
  role: 'Intel',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 1,
  learnedSkills: ['competitor-watchlist', 'outreach-templates', 'x-research'],
  integrations: [
    { platform: 'GitHub', actions: ['commit_file', 'get_contents', 'create_branch'] },
    { platform: 'X', actions: ['search', 'lookup', 'user', 'user_tweets'] },
    { platform: 'Twitter', actions: ['read_metrics'] },
    { platform: 'Email', actions: ['send'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '12 13 * * *' },
    { task: 'daily_intel_scan', cron: '0 8 * * 1-5' },
    { task: 'weekly_prospecting', cron: '0 10 * * 1' },
    { task: 'follow_ups', cron: '0 10 * * 3' },
    { task: 'pipeline_report', cron: '0 16 * * 5' },
    { task: 'x_algorithm_research', cron: '0 9 1 * *' },
  ],
  eventTriggers: [
    { event: 'scout:directive', label: 'Handle Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const AGENTS: AgentCardConfig[] = [EMBER, FORGE, SCOUT];

// ── Brand Assets ─────────────────────────────────────────────────────────────

interface BrandAssetDef {
  id: string;
  filename: string;
  label: string;
  lineCount: string;
  usedBy: string;
  placeholder: string;
}

const BRAND_ASSETS: BrandAssetDef[] = [
  { id: 'brandVoice', filename: 'brand-voice.md', label: 'Brand Voice', lineCount: '517 lines', usedBy: 'Ember', placeholder: '# Brand Voice\n\nDefine your brand personality, tone, and communication style...' },
  { id: 'contentTemplates', filename: 'content-templates.md', label: 'Content Templates', lineCount: '1159 lines', usedBy: 'Ember', placeholder: '# Content Templates\n\nDefine templates for tweets, threads, announcements...' },
  { id: 'reviewProtocol', filename: 'review-submission.md', label: 'Review Protocol', lineCount: '30 lines', usedBy: 'Ember, Scout', placeholder: '# Review Submission Protocol\n\nDefine how content is submitted for review...' },
  { id: 'designSystem', filename: 'design-system.md', label: 'Design System', lineCount: '', usedBy: 'Forge', placeholder: '# Design System\n\nDefine visual guidelines, color palette, typography...' },
];

// ── Channels ─────────────────────────────────────────────────────────────────

interface ChannelDef {
  name: string;
  connected: boolean;
}

const CHANNELS: ChannelDef[] = [
  { name: 'X / Twitter', connected: true },
  { name: 'Telegram', connected: true },
  { name: 'Instagram', connected: false },
  { name: 'Facebook', connected: false },
  { name: 'LinkedIn', connected: false },
  { name: 'YouTube', connected: false },
  { name: 'TikTok', connected: false },
  { name: 'Google Ads', connected: false },
  { name: 'Email Marketing', connected: false },
];

// ── Notifications ────────────────────────────────────────────────────────────

const ALERTS: AlertDef[] = [
  { key: 'contentFlagged', label: 'Content flagged by Reviewer', desc: 'Alert when content is rejected or needs revision' },
  { key: 'contentPublished', label: 'Content published successfully', desc: 'Notify on each successful post across channels' },
  { key: 'engagementThreshold', label: 'Engagement threshold reached', desc: 'Alert when a post exceeds engagement targets' },
  { key: 'scoutOutreach', label: 'Scout outreach completed', desc: 'Notify when Scout finishes a prospecting run' },
  { key: 'assetGenFailed', label: 'Asset generation failed (Forge)', desc: 'Alert when Forge fails to generate a requested asset' },
  { key: 'scheduleMissed', label: 'Posting schedule missed', desc: 'Alert when a scheduled batch fails to publish' },
];

// ── Form State ───────────────────────────────────────────────────────────────

interface MktForm {
  directive: string;
  cronStates: Record<string, Record<string, boolean>>;
  eventStates: Record<string, Record<string, boolean>>;
  agentModels: Record<string, { model?: string; temperature?: number; creativityIndex?: number }>;
  brandAssets: Record<string, string>;
  bannedTopics: string;
  voiceTone: string;
  requiredHashtags: string;
  bannedHashtags: string;
  maxHashtags: number;
  alerts: Record<string, boolean>;
  slackChannel: string;
}

const INITIAL: MktForm = {
  directive: '',
  cronStates: buildCronStates(AGENTS),
  eventStates: buildEventStates(AGENTS),
  agentModels: {},
  brandAssets: Object.fromEntries(BRAND_ASSETS.map((a) => [a.id, ''])),
  bannedTopics: '',
  voiceTone: '',
  requiredHashtags: '',
  bannedHashtags: '',
  maxHashtags: 5,
  alerts: { contentFlagged: true, contentPublished: false, engagementThreshold: false, scoutOutreach: false, assetGenFailed: true, scheduleMissed: true },
  slackChannel: '#yclaw-marketing',
};

// ── Brand Asset Item (expand/collapse with editable textarea) ────────────────

function BrandAssetItem({
  asset,
  value,
  onChange,
}: {
  asset: BrandAssetDef;
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
          <div className="text-xs text-terminal-text font-medium">{asset.label}</div>
          <div className="text-[9px] text-terminal-dim">
            {asset.lineCount ? `${asset.lineCount} · ` : ''}Used by: {asset.usedBy}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[9px] text-terminal-dim font-mono">{asset.filename}</span>
          <span className="text-terminal-dim text-xs">{open ? '\u2212' : '+'}</span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <textarea
            className="w-full bg-terminal-bg border border-terminal-border rounded p-2 text-xs text-terminal-text font-mono resize-y focus:outline-none focus:border-terminal-orange placeholder:text-terminal-dim/40"
            style={{ maxHeight: 300, minHeight: value ? 150 : 80 }}
            placeholder={asset.placeholder}
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

export function MarketingSettings({ open, onClose }: Props) {
  const [exp, setExp] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<MktForm>(INITIAL);
  const { dirty, saveState, saveError, markDirty, setDirty, handleSave: deptSave } = useDeptSaveState('marketing');
  const { settings: saved, hasLoaded } = useDepartmentSettings('marketing');

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
    setForm((prev) => ({ ...prev, ...saved, agentModels } as MktForm));
  }, [hasLoaded, saved, dirty]);

  const tog = (k: string) => setExp((p) => ({ ...p, [k]: !p[k] }));
  const set = useCallback(<K extends keyof MktForm>(k: K, v: MktForm[K]) => {
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

  const handleSave = useCallback(() => {
    deptSave('Marketing Settings', form);
  }, [form, deptSave]);

  return (
    <DeptSettingsShell open={open} onClose={onClose} title="Marketing Settings" dirty={dirty} saveState={saveState} saveError={saveError} onSave={handleSave}>
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

      {/* 3. Brand Assets */}
      <SettingsSection
        label="Brand Assets"
        icon={<BookOpenIcon className="w-4 h-4 text-terminal-orange" />}
        iconColor="terminal-orange"
        expanded={exp['assets'] ?? false}
        onToggle={() => tog('assets')}
        headerExtra={
          <InfoTooltip text="Core documents that define how your marketing agents communicate. These are loaded by agents before generating any content. Edit them here to update brand guidelines, templates, and review protocols." />
        }
      >
        <div className="space-y-2">
          {BRAND_ASSETS.map((asset) => (
            <BrandAssetItem
              key={asset.id}
              asset={asset}
              value={form.brandAssets[asset.id] ?? ''}
              onChange={(v) => set('brandAssets', { ...form.brandAssets, [asset.id]: v })}
            />
          ))}
        </div>
      </SettingsSection>

      {/* 4. Channels */}
      <SettingsSection
        label="Channels"
        icon={<GlobeIcon className="w-4 h-4 text-terminal-blue" />}
        iconColor="terminal-blue"
        expanded={exp['channels'] ?? false}
        onToggle={() => tog('channels')}
        headerExtra={
          <InfoTooltip text="Marketing platforms your agents can publish to. Connect platforms to enable content distribution across multiple channels." />
        }
      >
        <div className="space-y-1.5">
          {CHANNELS.map((ch) => (
            <div key={ch.name} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${ch.connected ? 'bg-terminal-green' : 'bg-terminal-dim/40'}`} />
                <span className="text-xs text-terminal-text">{ch.name}</span>
              </div>
              {ch.connected ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-terminal-green/40 text-terminal-green bg-terminal-green/10">
                  Connected
                </span>
              ) : (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-terminal-border text-terminal-dim">
                  Not Connected
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-[9px] text-terminal-dim/50 mt-2">
          Additional platforms can be configured as they become available.
        </p>
      </SettingsSection>

      {/* 5. Brand & Safety */}
      <SettingsSection label="Brand & Safety" icon={<ShieldIcon className="w-4 h-4 text-terminal-red" />} iconColor="terminal-red" expanded={exp['brand'] ?? false} onToggle={() => tog('brand')}>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Banned Topics</label>
          <textarea className="w-full bg-terminal-bg border border-terminal-border rounded p-2 text-xs text-terminal-text font-mono resize-y min-h-[60px] focus:outline-none focus:border-terminal-red placeholder:text-terminal-dim/40" placeholder="Enter topics separated by commas" value={form.bannedTopics} onChange={(e) => set('bannedTopics', e.target.value)} rows={3} />
        </div>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Voice / Tone Guidelines</label>
          <input type="text" className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-red" value={form.voiceTone} onChange={(e) => set('voiceTone', e.target.value)} placeholder="e.g., Professional but approachable" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Required Hashtags</label>
            <input type="text" className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-red" value={form.requiredHashtags} onChange={(e) => set('requiredHashtags', e.target.value)} placeholder="#yclaw" />
          </div>
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Banned Hashtags</label>
            <input type="text" className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-red" value={form.bannedHashtags} onChange={(e) => set('bannedHashtags', e.target.value)} placeholder="#NFA, #DYOR" />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Max Hashtags Per Post</label>
          <input type="number" min={0} max={30} className="w-24 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-red" value={form.maxHashtags} onChange={(e) => set('maxHashtags', Number(e.target.value) || 0)} />
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

export { MarketingSettings as MarketingSettingsContent };
