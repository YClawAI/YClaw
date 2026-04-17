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

// ── Icons ───────────────────────────────────────────────────────────────────────

function BookOpenIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function HeadphonesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
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

// ── Agent Configs ──────────────────────────────────────────────────────────────────

const GUIDE: AgentCardConfig = {
  name: 'guide',
  label: 'Guide',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 1,
  learnedSkills: ['support-playbook', 'troubleshooting-guide'],
  integrations: [
    { platform: 'Telegram', actions: ['dm', 'reply'] },
    { platform: 'Email', actions: ['send'] },
    { platform: 'Slack', actions: ['message', 'thread_reply'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [
    { task: 'daily_standup', cron: '24 13 * * *' },
  ],
  eventTriggers: [
    { event: 'keeper:support_case', label: 'Handle Support' },
    { event: 'guide:directive', label: 'Handle Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const KEEPER: AgentCardConfig = {
  name: 'keeper',
  label: 'Keeper',
  defaultModel: 'claude-sonnet-4-6',
  defaultCreativity: 1,
  learnedSkills: ['faq-bank-postlaunch', 'faq-bank', 'moderation-rules', 'platform-guide'],
  integrations: [
    { platform: 'Telegram', actions: ['message', 'reply', 'delete', 'pin', 'ban', 'restrict', 'set_permissions'] },
    { platform: 'Slack', actions: ['message', 'alert'] },
    { platform: 'Internal', actions: ['event:publish'] },
  ],
  cronTriggers: [],
  eventTriggers: [
    { event: 'telegram:message', label: 'Handle Message' },
    { event: 'keeper:directive', label: 'Handle Directive' },
    { event: 'claudeception:reflect', label: 'Self Reflection' },
  ],
};

const AGENTS: AgentCardConfig[] = [GUIDE, KEEPER];

// ── Knowledge Base ────────────────────────────────────────────────────────────────

interface KBDocDef {
  id: string;
  filename: string;
  label: string;
  usedBy: string;
  placeholder: string;
}

const KB_DOCS: KBDocDef[] = [
  { id: 'supportPlaybook', filename: 'support-playbook.md', label: 'Support Playbook', usedBy: 'Guide', placeholder: '# Support Playbook\n\nDefine escalation procedures, response templates, common resolution paths...' },
  { id: 'troubleshootingGuide', filename: 'troubleshooting-guide.md', label: 'Troubleshooting Guide', usedBy: 'Guide', placeholder: '# Troubleshooting Guide\n\nStep-by-step guides for common issues...' },
  { id: 'moderationRules', filename: 'moderation-rules.md', label: 'Moderation Rules', usedBy: 'Keeper', placeholder: '# Moderation Rules\n\nDefine what constitutes spam, harassment, prohibited content...' },
  { id: 'platformGuide', filename: 'platform-guide.md', label: 'Platform Guide', usedBy: 'Keeper', placeholder: '# Platform Guide\n\nTelegram group rules, pinned message templates, command usage...' },
  { id: 'faqBank', filename: 'faq-bank.md', label: 'FAQ Bank', usedBy: 'Keeper', placeholder: '# FAQ Bank\n\nFrequently asked questions and answers...' },
  { id: 'faqPostLaunch', filename: 'faq-bank-postlaunch.md', label: 'FAQ Bank — Post Launch', usedBy: 'Keeper', placeholder: '# FAQ Bank — Post Launch\n\nQuestions specific to post-launch phase...' },
];

// ── Support Channels ────────────────────────────────────────────────────────────

interface ChannelDef { name: string; connected: boolean; note?: string }

const SUPPORT_CHANNELS: ChannelDef[] = [
  { name: 'Telegram', connected: true, note: 'Keeper active' },
  { name: 'Email', connected: true, note: 'Guide active' },
  { name: 'Discord', connected: false },
  { name: 'Slack', connected: false },
  { name: 'WhatsApp', connected: false },
  { name: 'Live Chat Widget', connected: false },
  { name: 'Intercom', connected: false },
  { name: 'Zendesk', connected: false },
  { name: 'Freshdesk', connected: false },
];

// ── Notifications ─────────────────────────────────────────────────────────────────

const ALERTS: AlertDef[] = [
  { key: 'escalation', label: 'Support ticket escalated', desc: 'Alert when a case is escalated to Guide' },
  { key: 'slaBreach', label: 'SLA breach warning', desc: 'Alert when response time nears or exceeds SLA target' },
  { key: 'modAction', label: 'Moderation action taken', desc: 'Alert on bans, restrictions, or deletions by Keeper' },
  { key: 'quietHours', label: 'Quiet hours started/ended', desc: 'Notify when quiet hours window changes' },
  { key: 'highVolume', label: 'High-volume alert', desc: 'Alert on spike in incoming messages' },
  { key: 'guideResolved', label: 'Guide resolution completed', desc: 'Notify when Guide successfully resolves a ticket' },
];

// ── Form State ─────────────────────────────────────────────────────────────────────

interface SupportForm {
  directive: string;
  cronStates: Record<string, Record<string, boolean>>;
  eventStates: Record<string, Record<string, boolean>>;
  agentModels: Record<string, { model?: string; temperature?: number; creativityIndex?: number }>;
  kbDocs: Record<string, string>;
  moderationStrictness: string;
  autoRedactPii: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursAutoResponse: string;
  autoEscalateAfter: string;
  slaTarget: string;
  autoAssignGuide: boolean;
  escalationPriority: string;
  notifySla: boolean;
  maxKeeperRetries: string;
  alerts: Record<string, boolean>;
  slackChannel: string;
}

const INITIAL: SupportForm = {
  directive: '',
  cronStates: buildCronStates(AGENTS),
  eventStates: buildEventStates(AGENTS),
  agentModels: {},
  kbDocs: Object.fromEntries(KB_DOCS.map((d) => [d.id, ''])),
  moderationStrictness: 'standard',
  autoRedactPii: true,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  quietHoursAutoResponse: 'acknowledge',
  autoEscalateAfter: '30',
  slaTarget: '30',
  autoAssignGuide: true,
  escalationPriority: 'medium',
  notifySla: true,
  maxKeeperRetries: '3',
  alerts: { escalation: true, slaBreach: true, modAction: true, quietHours: false, highVolume: true, guideResolved: false },
  slackChannel: '#yclaw-support',
};

// ── KB Document Item (expand/collapse with editable textarea) ────────────

function KBDocItem({
  doc,
  value,
  onChange,
}: {
  doc: KBDocDef;
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-mc-border/60 rounded-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-mc-surface/50 transition-colors duration-mc ease-mc-out ${
          open ? 'bg-mc-surface/50' : ''
        }`}
      >
        <div className="min-w-0">
          <div className="font-sans text-xs text-mc-text font-medium">{doc.label}</div>
          <div className="font-sans text-[9px] text-mc-text-tertiary">Used by: {doc.usedBy}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[9px] text-mc-text-tertiary font-mono">{doc.filename}</span>
          <span className="text-mc-text-tertiary text-xs">{open ? '\u2212' : '+'}</span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <textarea
            className="w-full bg-mc-surface border border-mc-border rounded-panel p-2 text-xs text-mc-text font-mono resize-y focus:outline-none focus:border-mc-accent placeholder:text-mc-text-tertiary/40 transition-colors duration-mc ease-mc-out"
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

// ── Component ──────────────────────────────────────────────────────────────────────

interface Props { open: boolean; onClose: () => void }

export function SupportSettings({ open, onClose }: Props) {
  const [exp, setExp] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<SupportForm>(INITIAL);
  const { dirty, saveState, saveError, markDirty, setDirty, handleSave: deptSave } = useDeptSaveState('support');
  const { settings: saved, hasLoaded } = useDepartmentSettings('support');

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
    setForm((prev) => ({ ...prev, ...saved, agentModels } as SupportForm));
  }, [hasLoaded, saved, dirty]);

  const tog = (k: string) => setExp((p) => ({ ...p, [k]: !p[k] }));
  const set = useCallback(<K extends keyof SupportForm>(k: K, v: SupportForm[K]) => {
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
    deptSave('Support Settings', form);
  }, [form, deptSave]);

  return (
    <DeptSettingsShell open={open} onClose={onClose} title="Support Settings" dirty={dirty} saveState={saveState} saveError={saveError} onSave={handleSave}>
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

      {/* 3. Knowledge Base */}
      <SettingsSection
        label="Knowledge Base"
        icon={<BookOpenIcon className="w-4 h-4 text-mc-accent" />}
        iconColor="mc-accent"
        expanded={exp['kb'] ?? false}
        onToggle={() => tog('kb')}
        headerExtra={
          <InfoTooltip text="Core documents your support agents reference when handling tickets, moderating communities, and troubleshooting issues. Edit them here to keep your agents up to date with the latest answers and policies." />
        }
      >
        <div className="space-y-2">
          {KB_DOCS.map((doc) => (
            <KBDocItem
              key={doc.id}
              doc={doc}
              value={form.kbDocs[doc.id] ?? ''}
              onChange={(v) => set('kbDocs', { ...form.kbDocs, [doc.id]: v })}
            />
          ))}
        </div>
      </SettingsSection>

      {/* 4. Support Channels */}
      <SettingsSection
        label="Support Channels"
        icon={<HeadphonesIcon className="w-4 h-4 text-mc-info" />}
        iconColor="mc-info"
        expanded={exp['channels'] ?? false}
        onToggle={() => tog('channels')}
        headerExtra={
          <InfoTooltip text="Platforms where your support agents monitor and respond to users. Connect channels to enable multi-platform support coverage." />
        }
      >
        <div className="space-y-1.5">
          {SUPPORT_CHANNELS.map((ch) => (
            <div key={ch.name} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${ch.connected ? 'bg-mc-success' : 'bg-mc-text-tertiary/40'}`} />
                <span className="font-sans text-xs text-mc-text">{ch.name}</span>
              </div>
              {ch.connected ? (
                <div className="flex items-center gap-2">
                  <span className="font-sans text-[9px] px-1.5 py-0.5 rounded-panel border border-mc-success/40 text-mc-success bg-mc-success/10">
                    Connected
                  </span>
                  {ch.note && <span className="font-sans text-[8px] text-mc-text-tertiary">{ch.note}</span>}
                  <button type="button" className="font-sans text-[9px] text-mc-text-tertiary hover:text-mc-danger transition-colors duration-mc ease-mc-out">
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-sans text-[9px] px-1.5 py-0.5 rounded-panel border border-mc-border text-mc-text-tertiary">
                    Not Connected
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="font-sans text-[9px] text-mc-text-tertiary/50 mt-2">
          Additional platforms can be configured as they become available.
        </p>
      </SettingsSection>

      {/* 5. Policies & Escalation (merged) */}
      <SettingsSection
        label="Policies & Escalation"
        icon={<ShieldIcon className="w-4 h-4 text-mc-danger" />}
        iconColor="mc-danger"
        expanded={exp['policy'] ?? false}
        onToggle={() => tog('policy')}
        headerExtra={
          <InfoTooltip text="Controls moderation behavior, escalation rules, and service level targets for support agents." />
        }
      >
        {/* Moderation */}
        <div className="font-sans text-[9px] font-medium uppercase tracking-label text-mc-text-tertiary/50 mb-1">Moderation</div>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label">Moderation Strictness</label>
            <InfoTooltip text="Relaxed = warnings only. Standard = warn then restrict. Strict = immediate action." />
          </div>
          <select className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-sans text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.moderationStrictness} onChange={(e) => set('moderationStrictness', e.target.value)}>
            <option value="relaxed">Relaxed</option>
            <option value="standard">Standard</option>
            <option value="strict">Strict</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Auto-redact PII</span><span className="font-sans text-[10px] text-mc-text-tertiary">Wallet addresses, emails, phone numbers</span></div>
          <ToggleSwitch checked={form.autoRedactPii} onChange={(v) => set('autoRedactPii', v)} color="mc-danger" />
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Enable quiet hours</span><span className="font-sans text-[10px] text-mc-text-tertiary">Reduce automated responses during off-hours</span></div>
          <ToggleSwitch checked={form.quietHoursEnabled} onChange={(v) => set('quietHoursEnabled', v)} color="mc-danger" />
        </div>
        {form.quietHoursEnabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">Start (UTC)</label>
                <input type="time" className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-mono tabular-nums text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.quietHoursStart} onChange={(e) => set('quietHoursStart', e.target.value)} />
              </div>
              <div>
                <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">End (UTC)</label>
                <input type="time" className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-mono tabular-nums text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.quietHoursEnd} onChange={(e) => set('quietHoursEnd', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">Auto-response During Quiet Hours</label>
              <select className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-sans text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.quietHoursAutoResponse} onChange={(e) => set('quietHoursAutoResponse', e.target.value)}>
                <option value="disabled">Disabled</option>
                <option value="acknowledge">Acknowledge only</option>
                <option value="faq">FAQ bot</option>
              </select>
            </div>
          </>
        )}

        {/* Divider */}
        <div className="border-t border-mc-border/40 my-1" />

        {/* Escalation */}
        <div className="font-sans text-[9px] font-medium uppercase tracking-label text-mc-text-tertiary/50 mb-1">Escalation</div>
        <div>
          <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">Auto-escalate Unresolved Tickets After</label>
          <select className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-sans text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.autoEscalateAfter} onChange={(e) => set('autoEscalateAfter', e.target.value)}>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="never">Never</option>
          </select>
        </div>
        <div>
          <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">SLA Target Response Time (min)</label>
          <input type="number" min={1} className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-mono tabular-nums text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.slaTarget} onChange={(e) => set('slaTarget', e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Auto-assign escalations to Guide</span><span className="font-sans text-[10px] text-mc-text-tertiary">Automatically route escalated cases to Guide agent</span></div>
          <ToggleSwitch checked={form.autoAssignGuide} onChange={(v) => set('autoAssignGuide', v)} color="mc-danger" />
        </div>
        <div>
          <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label block mb-1">Escalation Priority</label>
          <select className="w-full bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-sans text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.escalationPriority} onChange={(e) => set('escalationPriority', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <div><span className="font-sans text-xs text-mc-text block">Notify on SLA breach</span><span className="font-sans text-[10px] text-mc-text-tertiary">Send alert when response time exceeds SLA target</span></div>
          <ToggleSwitch checked={form.notifySla} onChange={(v) => set('notifySla', v)} color="mc-danger" />
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <label className="font-sans text-[10px] font-medium text-mc-text-tertiary uppercase tracking-label">Max Keeper Retries Before Escalation</label>
            <InfoTooltip text="If Keeper can't resolve after this many attempts, automatically escalate to Guide." />
          </div>
          <input type="number" min={1} max={10} className="w-24 bg-mc-surface border border-mc-border rounded-panel px-2 py-1.5 font-mono tabular-nums text-xs text-mc-text focus:outline-none focus:border-mc-danger transition-colors duration-mc ease-mc-out" value={form.maxKeeperRetries} onChange={(e) => set('maxKeeperRetries', e.target.value)} />
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
