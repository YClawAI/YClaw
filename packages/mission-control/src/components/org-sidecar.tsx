/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  ORGANIZATION SETTINGS DRAWER — DO NOT REPLACE OR "POLISH"             ║
 * ║                                                                        ║
 * ║  This component renders the MC dashboard "Settings" drawer with        ║
 * ║  4 sections: Core Directives, Organization Skills, Fleet Controls,     ║
 * ║  Governance & Safety.                                                  ║
 * ║                                                                        ║
 * ║  It has been accidentally overwritten TWICE by AI agents confusing     ║
 * ║  it with the OpenClaw Settings drawer or the Global Settings page.     ║
 * ║                                                                        ║
 * ║  CANONICAL VERSION: commit 21743f84 (PR #405, "polish two")           ║
 * ║                                                                        ║
 * ║  This is NOT the OpenClaw Settings (openclaw-settings-drawer.tsx).     ║
 * ║  This is NOT the Global Settings page (global-settings-content.tsx).   ║
 * ║  If you need to modify OpenClaw gateway settings, edit those files.    ║
 * ╚═════════════════════════════════════════════════════════════════════════╝
 */
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SettingsDrawer } from './settings-drawer';
import { PromptEditor } from './prompt-editor';
import { FleetControlsInteractive } from './fleet-controls-interactive';
import { DrawerSaveFooter } from './openclaw-settings-drawer';
import { HealthDot } from './health-dot';

// ── Organization Skills (self-contained — DO NOT move to openclaw-settings-drawer) ──

type SkillTier = 'builtin' | 'trusted' | 'community';

interface SharedSkillDef {
  name: string;
  label: string;
  tier: SkillTier;
  defaultEnabled: boolean;
}

const SHARED_SKILLS: SharedSkillDef[] = [
  { name: 'protocol-overview', label: 'Organization Overview', tier: 'trusted', defaultEnabled: true },
  { name: 'first-principles', label: 'First Principles', tier: 'builtin', defaultEnabled: true },
  { name: 'karpathy-guidelines', label: 'Karpathy Guidelines', tier: 'trusted', defaultEnabled: true },
  { name: 'claudeception', label: 'Claudeception', tier: 'builtin', defaultEnabled: true },
  { name: 'copy-bank', label: 'Copy Bank', tier: 'trusted', defaultEnabled: true },
  { name: 'faq-bank', label: 'FAQ Bank', tier: 'trusted', defaultEnabled: true },
  { name: 'creator-rewards-program', label: 'Creator Rewards Program', tier: 'trusted', defaultEnabled: true },
  { name: 'rlm', label: 'RLM', tier: 'builtin', defaultEnabled: true },
  { name: 'skillforge', label: 'SkillForge', tier: 'trusted', defaultEnabled: false },
  { name: 'vitest-esm-class-mock', label: 'Vitest ESM Class Mock', tier: 'community', defaultEnabled: false },
];

const TIER_BADGE_STYLES: Record<SkillTier, string> = {
  builtin: 'border-mc-accent/40 text-mc-accent bg-mc-accent-dim',
  trusted: 'border-mc-success/40 text-mc-success bg-mc-success/10',
  community: 'border-mc-warning/40 text-mc-warning bg-mc-warning/10',
};

function OrgSkillsList({
  skills: skillStates,
  onToggle,
  subtitle,
}: {
  skills: Record<string, boolean>;
  onToggle: (name: string) => void;
  subtitle?: string;
}) {
  return (
    <div className="p-3 bg-mc-surface border border-mc-border rounded-panel">
      <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-0.5">
        Shared Skills
      </h4>
      <p className="font-sans text-[10px] text-mc-text-tertiary mb-3">
        {subtitle ?? 'Available to all agents across all departments'}
      </p>
      <div className="space-y-1.5">
        {SHARED_SKILLS.map((skill) => {
          const enabled = skillStates[skill.name] ?? skill.defaultEnabled;
          return (
            <div key={skill.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <HealthDot healthy={enabled} />
                <span className="font-sans text-mc-text truncate">{skill.label}</span>
                <span className={`font-sans text-[9px] font-medium uppercase tracking-label px-1 py-px rounded-badge border shrink-0 ${TIER_BADGE_STYLES[skill.tier]}`}>
                  {skill.tier}
                </span>
              </div>
              <button
                onClick={() => onToggle(skill.name)}
                className={`font-sans text-[10px] font-medium px-1.5 py-0.5 rounded-chip border transition-colors duration-mc ease-mc-out shrink-0 ml-2 ${
                  enabled
                    ? 'border-mc-danger/40 text-mc-danger hover:bg-mc-danger/10'
                    : 'border-mc-success/40 text-mc-success hover:bg-mc-success/10'
                }`}
              >
                {enabled ? 'disable' : 'enable'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt file registry (matches prompts/*.md in repo root)
// ---------------------------------------------------------------------------
interface PromptFile {
  name: string;
  label: string;
  category: string;
  /** Safety-floor protected: agents cannot self-modify */
  protected?: boolean;
  /** Which agents load this file */
  loadedBy: string;
}

const PROMPT_FILES: PromptFile[] = [
  // Identity & Voice
  { name: 'executive-directive.md', label: 'Executive Directive', category: 'Identity & Voice', loadedBy: 'All agents' },
  { name: 'mission_statement.md', label: 'Mission Statement', category: 'Identity & Voice', protected: true, loadedBy: 'All agents' },
  { name: 'brand-voice.md', label: 'Brand Voice', category: 'Identity & Voice', loadedBy: 'All agents' },
  { name: 'strategist-objectives.md', label: 'Strategic Objectives', category: 'Identity & Voice', loadedBy: 'Strategist' },
  { name: 'strategist-heartbeat.md', label: 'Heartbeat Protocol', category: 'Identity & Voice', loadedBy: 'Strategist' },

  // Governance & Rules
  { name: 'chain-of-command.md', label: 'Chain of Command', category: 'Governance & Rules', loadedBy: 'All agents' },
  { name: 'review-rules.md', label: 'Review Rules', category: 'Governance & Rules', protected: true, loadedBy: 'Reviewer' },
  { name: 'daily-standup.md', label: 'Daily Standup', category: 'Governance & Rules', loadedBy: 'All agents' },
  { name: 'daily-standup-dev.md', label: 'Dev Standup', category: 'Governance & Rules', loadedBy: 'Development' },
  { name: 'moderation-rules.md', label: 'Moderation Rules', category: 'Governance & Rules', loadedBy: 'Keeper, Reviewer' },

  // Engineering & Standards
  { name: 'engineering-standards.md', label: 'Engineering Standards', category: 'Engineering & Standards', loadedBy: 'Development' },
  { name: 'protocol-overview.md', label: 'Organization Overview', category: 'Engineering & Standards', loadedBy: 'All agents' },
  { name: 'design-system.md', label: 'Design System', category: 'Engineering & Standards', loadedBy: 'Designer' },
  { name: 'component-specs.md', label: 'Component Specs', category: 'Engineering & Standards', loadedBy: 'Designer' },
  { name: 'data-integrity.md', label: 'Data Integrity', category: 'Engineering & Standards', loadedBy: 'Architect' },

  // Agent Workflows
  { name: 'strategist-workflow.md', label: 'Strategist Workflow', category: 'Agent Workflows', loadedBy: 'Strategist' },
  { name: 'architect-workflow.md', label: 'Architect Workflow', category: 'Agent Workflows', loadedBy: 'Architect' },
  { name: 'designer-workflow.md', label: 'Designer Workflow', category: 'Agent Workflows', loadedBy: 'Designer' },
  { name: 'reviewer-workflow.md', label: 'Reviewer Workflow', category: 'Agent Workflows', loadedBy: 'Reviewer' },
  { name: 'sentinel-quality-workflow.md', label: 'Sentinel Quality', category: 'Agent Workflows', loadedBy: 'Sentinel' },

  // Content & Reviews
  { name: 'content-templates.md', label: 'Content Templates', category: 'Content & Reviews', loadedBy: 'Marketing' },
  { name: 'review-submission.md', label: 'Review Submission', category: 'Content & Reviews', loadedBy: 'Reviewer' },
  { name: 'model-review.md', label: 'Model Review', category: 'Content & Reviews', loadedBy: 'Reviewer' },

  // System
  { name: 'claudeception.md', label: 'Claudeception', category: 'System', loadedBy: 'All agents' },
  { name: 'skill-usage.md', label: 'Skill Usage', category: 'System', loadedBy: 'All agents' },
  { name: 'keeper-telegram-safety.md', label: 'Telegram Safety', category: 'System', loadedBy: 'Keeper' },
];

const CATEGORIES = [...new Set(PROMPT_FILES.map((f) => f.category))];

// ---------------------------------------------------------------------------
// SVG Icons (inline, no emoji)
// ---------------------------------------------------------------------------
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

function BookOpenIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
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

export function OrgSidecar() {
  const [open, setOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    directives: false,
    skills: false,
    fleet: false,
    governance: false,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Shared skills local state — initialised from defaults, overwritten by API on mount
  const [sharedSkillStates, setSharedSkillStates] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of SHARED_SKILLS) init[s.name] = s.defaultEnabled;
    return init;
  });
  const handleToggleSharedSkill = useCallback((name: string) => {
    setSharedSkillStates((prev) => ({ ...prev, [name]: !(prev[name] ?? false) }));
    setDirty(true);
  }, []);

  // Load persisted skills from org settings on mount
  useEffect(() => {
    fetch('/api/org/settings', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<Record<string, unknown>> : null)
      .then((data) => {
        if (data && typeof data.skills === 'object' && data.skills !== null) {
          setSharedSkillStates((prev) => ({ ...prev, ...(data.skills as Record<string, boolean>) }));
        }
      })
      .catch(() => { /* non-fatal — defaults remain */ });
  }, []);

  // Dirty state + save
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  function handleSaveAll() {
    setSaveState('saving');
    fetch('/api/org/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ skills: sharedSkillStates }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Save failed (${r.status})`);
        setSaveState('saved');
        setDirty(false);
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
      })
      .catch(() => { setSaveState('idle'); });
  }

  const saveFooter = (
    <DrawerSaveFooter dirty={dirty} saveState={saveState} onSave={handleSaveAll} />
  );

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-chip border border-mc-border font-sans text-xs text-mc-text-secondary hover:border-mc-border-hover hover:text-mc-text transition-colors duration-mc ease-mc-out"
      >
        Settings
      </button>

      {/* Drawer */}
      <SettingsDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Organization Settings"
        footer={saveFooter}
      >
        {/* ── Section 1: Core Directives ──────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('directives')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-chip border transition-colors duration-mc ease-mc-out ${
              expandedSections['directives']
                ? 'border-mc-warning/40 bg-mc-warning/5'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <FolderIcon className="w-4 h-4 text-mc-warning" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Core Directives
              </span>
            </div>
            <span className="font-mono text-mc-text-tertiary text-xs">
              {expandedSections['directives'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['directives'] && (
            <div className="mt-3 space-y-4">
              {CATEGORIES.map((category) => {
                const files = PROMPT_FILES.filter(
                  (f) => f.category === category,
                );
                return (
                  <div key={category}>
                    <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-1.5 px-2">
                      {category}
                    </h4>
                    <div className="space-y-0.5">
                      {files.map((file) => (
                        <PromptEditor
                          key={file.name}
                          filename={file.name}
                          label={file.label}
                          isProtected={file.protected}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Section 2: Organization Skills ────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('skills')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-chip border transition-colors duration-mc ease-mc-out ${
              expandedSections['skills']
                ? 'border-mc-dept-finance/40 bg-mc-dept-finance/5'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <BookOpenIcon className="w-4 h-4 text-mc-dept-finance" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Organization Skills
              </span>
            </div>
            <span className="font-mono text-mc-text-tertiary text-xs">
              {expandedSections['skills'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['skills'] && (
            <div className="mt-3">
              <OrgSkillsList
                skills={sharedSkillStates}
                onToggle={handleToggleSharedSkill}
                subtitle="Shared knowledge available to every agent in the organization"
              />
            </div>
          )}
        </section>

        {/* ── Section 3: Fleet Controls ───────────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('fleet')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-chip border transition-colors duration-mc ease-mc-out ${
              expandedSections['fleet']
                ? 'border-mc-accent/40 bg-mc-accent-dim'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <CogIcon className="w-4 h-4 text-mc-accent" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Fleet Controls
              </span>
            </div>
            <span className="font-mono text-mc-text-tertiary text-xs">
              {expandedSections['fleet'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['fleet'] && (
            <div className="mt-3">
              <FleetControlsInteractive />
            </div>
          )}
        </section>

        {/* ── Section 4: Governance & Safety ───────────────────── */}
        <section className="mb-6">
          <button
            onClick={() => toggleSection('governance')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-chip border transition-colors duration-mc ease-mc-out ${
              expandedSections['governance']
                ? 'border-mc-danger/40 bg-mc-danger/5'
                : 'border-mc-border hover:border-mc-border-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldIcon className="w-4 h-4 text-mc-danger" />
              <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text">
                Governance & Safety
              </span>
            </div>
            <span className="font-mono text-mc-text-tertiary text-xs">
              {expandedSections['governance'] ? '\u2212' : '+'}
            </span>
          </button>

          {expandedSections['governance'] && (
            <div className="mt-3 space-y-3">
              <div className="bg-mc-surface border border-mc-border rounded-panel p-3">
                <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-2">
                  Agent Safety Floor
                </h4>
                <p className="font-sans text-[11px] text-mc-text-secondary leading-relaxed">
                  Agents cannot self-modify protected prompt files
                  (mission_statement.md, review-rules.md), CI/CD workflows, or
                  safety infrastructure. Humans can edit all files from Mission
                  Control.
                </p>
              </div>

              <div className="bg-mc-surface border border-mc-border rounded-panel p-3">
                <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-2">
                  Protected Paths (CI-Enforced)
                </h4>
                <div className="space-y-1 font-mono text-[11px] text-mc-warning tabular-nums">
                  <div>.github/workflows/**</div>
                  <div>packages/core/src/safety/**</div>
                  <div>packages/core/src/review/**</div>
                </div>
              </div>

              <div className="bg-mc-surface border border-mc-border rounded-panel p-3">
                <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-2">
                  Codegen Exclusion
                </h4>
                <p className="font-sans text-[11px] text-mc-text-secondary leading-relaxed">
                  The yclaw repo is excluded from subprocess codegen
                  (self-modification protection). Direct GitHub API actions are
                  unaffected.
                </p>
              </div>

              <div className="bg-mc-surface border border-mc-border rounded-panel p-3">
                <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-2">
                  Budget Enforcement Gate
                </h4>
                <p className="font-sans text-[11px] text-mc-text-secondary leading-relaxed">
                  When hard stop is enabled, a single gate before every LLM call
                  checks Redis spend vs cap. Exceeding the cap triggers
                  BudgetExceededError and suspends the agent. Soft warnings emit
                  events at the warn threshold.
                </p>
              </div>
            </div>
          )}
        </section>
      </SettingsDrawer>
    </>
  );
}
