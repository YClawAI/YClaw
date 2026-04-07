'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { AGENTS } from '@/lib/agents';
import { scaleEcsFleet } from '@/lib/actions/ecs-fleet';
import { checkMongoHealth, checkRedisHealth } from '@/lib/actions/health-actions';
import { ConnectFlow } from '@/components/connect-flow';
import type { IntegrationDef } from '@/lib/integration-registry';

// ── SVG Icons (Heroicons outline, strokeWidth 1.5) ──────────────────────────

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 17.25v-.228a4.5 4.5 0 0 0-.12-1.03l-2.268-9.64a3.375 3.375 0 0 0-3.285-2.602H7.923a3.375 3.375 0 0 0-3.285 2.602l-2.268 9.64a4.5 4.5 0 0 0-.12 1.03v.228m19.5 0a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3m19.5 0a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3m16.5 0h.008v.008h-.008v-.008Zm-3 0h.008v.008h-.008v-.008Z" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

function PlugIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
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

function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeSlashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-5 h-5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function GripVerticalIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

// ── InfoTooltip ──────────────────────────────────────────────────────────────

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
      <span
        role="note"
        className="w-4 h-4 rounded-full border border-terminal-dim/40 text-terminal-dim text-[9px] font-bold leading-none flex items-center justify-center hover:border-terminal-text hover:text-terminal-text transition-colors cursor-help"
        onMouseEnter={open}
        onMouseLeave={close}
        onClick={(e) => { e.stopPropagation(); show ? close() : open(); }}
        aria-label="Info"
      >
        i
      </span>
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

// ── ToggleSwitch ─────────────────────────────────────────────────────────────

const TOGGLE_STYLES: Record<string, { on: string; off: string; knob: string }> = {
  'terminal-cyan': { on: 'bg-terminal-cyan/50 border-terminal-cyan/30', off: 'bg-terminal-cyan/20 border-terminal-cyan/30', knob: 'bg-terminal-cyan' },
  'terminal-green': { on: 'bg-terminal-green/50 border-terminal-green/30', off: 'bg-terminal-green/20 border-terminal-green/30', knob: 'bg-terminal-green' },
  'terminal-red': { on: 'bg-terminal-red/50 border-terminal-red/30', off: 'bg-terminal-red/20 border-terminal-red/30', knob: 'bg-terminal-red' },
  'terminal-orange': { on: 'bg-terminal-orange/50 border-terminal-orange/30', off: 'bg-terminal-orange/20 border-terminal-orange/30', knob: 'bg-terminal-orange' },
  'terminal-blue': { on: 'bg-terminal-blue/50 border-terminal-blue/30', off: 'bg-terminal-blue/20 border-terminal-blue/30', knob: 'bg-terminal-blue' },
  'terminal-purple': { on: 'bg-terminal-purple/50 border-terminal-purple/30', off: 'bg-terminal-purple/20 border-terminal-purple/30', knob: 'bg-terminal-purple' },
  'terminal-yellow': { on: 'bg-terminal-yellow/50 border-terminal-yellow/30', off: 'bg-terminal-yellow/20 border-terminal-yellow/30', knob: 'bg-terminal-yellow' },
};

function ToggleSwitch({
  checked,
  onChange,
  color = 'terminal-cyan',
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  color?: string;
}) {
  const styles = TOGGLE_STYLES[color] ?? TOGGLE_STYLES['terminal-cyan']!;
  return (
    <button
      className={`relative w-10 h-5 rounded-full border transition-colors ${checked ? styles.on : styles.off}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className={`absolute top-0.5 left-0 w-4 h-4 rounded-full ${styles.knob} transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ── Collapsible Section ──────────────────────────────────────────────────────

const SECTION_EXPANDED_STYLES: Record<string, string> = {
  slate: 'border-slate-500/50 bg-slate-500/5',
  cyan: 'border-terminal-cyan/50 bg-terminal-cyan/5',
  purple: 'border-terminal-purple/50 bg-terminal-purple/5',
  blue: 'border-terminal-blue/50 bg-terminal-blue/5',
  red: 'border-terminal-red/50 bg-terminal-red/5',
  green: 'border-terminal-green/50 bg-terminal-green/5',
  orange: 'border-terminal-orange/50 bg-terminal-orange/5',
};

function Section({
  label,
  icon,
  borderColor,
  expanded,
  onToggle,
  tooltip,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  borderColor: string;
  expanded: boolean;
  onToggle: () => void;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const expandedStyle = SECTION_EXPANDED_STYLES[borderColor] ?? 'border-terminal-border';
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
          {tooltip && <InfoTooltip text={tooltip} />}
        </div>
        <span className="text-terminal-dim text-xs">{expanded ? '\u2212' : '+'}</span>
      </button>
      {expanded && <div className="mt-3 pl-1 space-y-4">{children}</div>}
    </section>
  );
}

// ── Sub-header divider ───────────────────────────────────────────────────────

function SubHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-[9px] font-bold uppercase tracking-widest text-terminal-dim/50">{label}</span>
      <div className="flex-1 border-t border-terminal-border/40" />
    </div>
  );
}

// ── Masked Input ─────────────────────────────────────────────────────────────

function MaskedInput({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
  focusColor = 'focus:border-terminal-cyan',
}: {
  label?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  focusColor?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <div>
      {label && (
        <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">
          {label}
        </label>
      )}
      <div className="flex items-center gap-1">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={`flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none ${focusColor} ${readOnly ? 'opacity-70 cursor-default' : ''}`}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="p-1.5 text-terminal-dim hover:text-terminal-text transition-colors"
          aria-label={visible ? 'Hide' : 'Show'}
        >
          {visible ? <EyeSlashIcon /> : <EyeIcon />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="p-1.5 text-terminal-dim hover:text-terminal-text transition-colors"
          aria-label="Copy"
        >
          {copied ? (
            <span className="text-terminal-green text-[10px] font-mono">ok</span>
          ) : (
            <CopyIcon />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Status Dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'connected' | 'available' | 'error' | 'in_progress' }) {
  const colors = {
    connected: 'bg-terminal-green',
    available: 'bg-terminal-dim/40',
    error: 'bg-terminal-red',
    in_progress: 'bg-terminal-orange animate-pulse',
  };
  return <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${colors[status]}`} />;
}

function StatusBadge({ status }: { status: 'connected' | 'available' | 'error' }) {
  const styles = {
    connected: 'text-terminal-green border-terminal-green/30 bg-terminal-green/10',
    available: 'text-terminal-dim border-terminal-border bg-terminal-muted/20',
    error: 'text-terminal-red border-terminal-red/30 bg-terminal-red/10',
  };
  const labels = { connected: 'Connected', available: 'Available', error: 'Error' };
  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ── Connection Card ──────────────────────────────────────────────────────────

const TIER_BADGES: Record<number, { label: string; color: string }> = {
  1: { label: 'Simple', color: 'text-terminal-dim border-terminal-border' },
  2: { label: 'Guided', color: 'text-terminal-purple border-terminal-purple/30' },
  3: { label: 'Full Wiring', color: 'text-terminal-orange border-terminal-orange/30' },
};

function ConnectionCard({
  name,
  status,
  usedBy,
  tier,
  source,
  onConnect,
}: {
  name: string;
  status: 'connected' | 'available' | 'error' | 'in_progress';
  usedBy?: string;
  tier?: number;
  source?: 'hardcoded' | 'recipe';
  onConnect?: () => void;
}) {
  const tierInfo = tier ? TIER_BADGES[tier] : undefined;

  return (
    <div className="flex items-center justify-between py-2 px-2.5 bg-terminal-muted/10 border border-terminal-border/60 rounded hover:border-terminal-muted transition-colors">
      <div className="flex items-center gap-2.5 min-w-0">
        <StatusDot status={status === 'in_progress' ? 'available' : status} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-terminal-text">{name}</span>
            {tierInfo && (
              <span className={`text-[8px] font-mono px-1 py-0.5 rounded border ${tierInfo.color}`}>
                {tierInfo.label}
              </span>
            )}
            {source === 'recipe' && (
              <span className="text-[8px] font-mono px-1 py-0.5 rounded border border-terminal-cyan/30 text-terminal-cyan">
                Recipe
              </span>
            )}
          </div>
          {usedBy && (
            <span className="text-[10px] text-terminal-dim">{usedBy}</span>
          )}
          {status === 'in_progress' && (
            <span className="text-[10px] text-terminal-orange">In progress...</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onConnect}
        className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
          status === 'connected'
            ? 'border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10'
            : status === 'error'
              ? 'border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10'
              : status === 'in_progress'
                ? 'border-terminal-orange/30 text-terminal-orange hover:bg-terminal-orange/10'
                : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-muted'
        }`}
      >
        {status === 'connected' ? 'Configure' : status === 'error' ? 'Reconnect' : status === 'in_progress' ? 'Resume' : 'Connect'}
      </button>
    </div>
  );
}

// ── Connection Category ──────────────────────────────────────────────────────

function ConnectionCategory({
  label,
  connections,
  defaultExpanded,
}: {
  label: string;
  connections: { name: string; status: 'connected' | 'available' | 'error' | 'in_progress'; usedBy?: string; tier?: number; source?: 'hardcoded' | 'recipe'; onConnect?: () => void }[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const connectedCount = connections.filter((c) => c.status === 'connected').length;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-1.5 group"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim/60 group-hover:text-terminal-dim transition-colors">
            {label}
          </span>
          {connectedCount > 0 && (
            <span className="text-[9px] font-mono text-terminal-green">{connectedCount} connected</span>
          )}
        </div>
        <span className="text-terminal-dim/40 text-[10px]">{expanded ? '\u2212' : '+'}</span>
      </button>
      {expanded && (
        <div className="space-y-1.5 mt-1 mb-3">
          {connections.map((c) => (
            <ConnectionCard key={c.name} {...c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM STATE
// ═══════════════════════════════════════════════════════════════════════════════

interface OrgFormState {
  orgName: string;
  orgLogo: string | null;
  timezone: string;
  language: string;

  mongoUri: string;
  redisUrl: string;
  openclawWsUrl: string;
  openclawPubKey: string;
  openclawPrivKey: string;

  litellmUrl: string;
  litellmKey: string;
  litellmRoute: boolean;
  openrouterKey: string;
  anthropicKey: string;
  openaiKey: string;
  googleKey: string;
  xaiKey: string;
  azureKey: string;
  azureEndpoint: string;
  mistralKey: string;
  cohereKey: string;
  groqKey: string;
  togetherKey: string;
  ollamaUrl: string;
  defaultReasoningModel: string;
  defaultFastModel: string;
  fallbackChain: string[];
  showMoreProviders: boolean;

  piiMode: string;
  redactWallets: boolean;
  redactEmails: boolean;
  logPrompts: boolean;
  logRetention: string;
  logSamplingRate: string;
  readExternalUrls: boolean;
  writeExternalServices: boolean;
  fileSystemAccess: boolean;

  defaultAlertChannel: string;
  secondaryAlertChannel: string;
  criticalEmail: string;
  alertAgentFailure: boolean;
  alertConnectionLost: boolean;
  alertSecurityEvent: boolean;
  alertFleetHealth: boolean;
  alertDeployComplete: boolean;
  alertDailyDigest: boolean;
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
  quietBehavior: string;

  auditLogging: boolean;
  auditRetention: string;
  maintenanceMode: boolean;
}

const INITIAL: OrgFormState = {
  orgName: 'YClaw',
  orgLogo: null,
  timezone: 'America/Puerto_Rico',
  language: 'English',

  mongoUri: '',
  redisUrl: '',
  openclawWsUrl: '',
  openclawPubKey: '',
  openclawPrivKey: '',

  litellmUrl: '',
  litellmKey: '',
  litellmRoute: false,
  openrouterKey: '',
  anthropicKey: '',
  openaiKey: '',
  googleKey: '',
  xaiKey: '',
  azureKey: '',
  azureEndpoint: '',
  mistralKey: '',
  cohereKey: '',
  groqKey: '',
  togetherKey: '',
  ollamaUrl: 'http://localhost:11434',
  defaultReasoningModel: 'claude-opus-4-6',
  defaultFastModel: 'claude-sonnet-4-6',
  fallbackChain: ['Anthropic', 'OpenAI', 'Google', 'xAI'],
  showMoreProviders: false,

  piiMode: 'redact',
  redactWallets: true,
  redactEmails: true,
  logPrompts: true,
  logRetention: '30',
  logSamplingRate: '100',
  readExternalUrls: true,
  writeExternalServices: true,
  fileSystemAccess: true,

  defaultAlertChannel: '#yclaw-alerts',
  secondaryAlertChannel: '#yclaw-operations',
  criticalEmail: '',
  alertAgentFailure: true,
  alertConnectionLost: true,
  alertSecurityEvent: true,
  alertFleetHealth: true,
  alertDeployComplete: false,
  alertDailyDigest: true,
  quietHours: false,
  quietStart: '23:00',
  quietEnd: '07:00',
  quietBehavior: 'critical-only',

  auditLogging: true,
  auditRetention: '90',
  maintenanceMode: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// FULL-PAGE SETTINGS CONTENT (used by /settings page)
// ═══════════════════════════════════════════════════════════════════════════════

export function GlobalSettingsContent() {
  const [form, setForm] = useState<OrgFormState>(INITIAL);
  const [sections, setSections] = useState<Record<string, boolean>>({
    org: false,
    fleet: false,
    ai: false,
    connections: false,
    privacy: false,
    notifications: false,
    security: false,
  });

  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);
  const [killSwitchState, setKillSwitchState] = useState<'idle' | 'executing' | 'done' | 'error'>('idle');
  const [killSwitchError, setKillSwitchError] = useState<string | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [orgSettingsLoaded, setOrgSettingsLoaded] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Connect Flow State ──────────────────────────────────────────────────
  const [connectTarget, setConnectTarget] = useState<IntegrationDef | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, 'connected' | 'available' | 'error' | 'in_progress'>>({});
  const [activeSessionIds, setActiveSessionIds] = useState<Record<string, string>>({});
  const [tier1Integrations, setTier1Integrations] = useState<IntegrationDef[]>([]);
  const [tier2Integrations, setTier2Integrations] = useState<IntegrationDef[]>([]);

  // Load integrations from server-merged registry + connection statuses
  useEffect(() => {
    let cancelled = false;
    async function loadIntegrationsAndConnections() {
      try {
        // Fetch server-merged registry (includes recipe overrides)
        const intRes = await fetch('/api/connections/integrations');
        if (intRes.ok && !cancelled) {
          const all: IntegrationDef[] = await intRes.json();
          setTier1Integrations(all.filter((i) => i.tier === 1));
          setTier2Integrations(all.filter((i) => i.tier >= 2));
        }
      } catch {
        // API offline — integrations list stays empty
      }
      try {
        const res = await fetch('/api/connections');
        if (!res.ok) return;
        const sessions: { _id: string; integration: string; status: string }[] = await res.json();
        if (cancelled) return;
        const statuses: Record<string, 'connected' | 'available' | 'error' | 'in_progress'> = {};
        const sessionIds: Record<string, string> = {};
        for (const s of sessions) {
          if (s.status === 'connected') {
            statuses[s.integration] = 'connected';
          } else if (s.status === 'failed') {
            if (statuses[s.integration] !== 'connected' && statuses[s.integration] !== 'in_progress') {
              statuses[s.integration] = 'error';
            }
          } else if (['pending', 'collecting_credentials', 'storing', 'wiring', 'verifying'].includes(s.status)) {
            if (statuses[s.integration] !== 'connected') {
              statuses[s.integration] = 'in_progress';
              sessionIds[s.integration] = s._id;
            }
          }
        }
        setConnectionStatuses(statuses);
        setActiveSessionIds(sessionIds);
      } catch {
        // API offline — keep defaults
      }
    }
    loadIntegrationsAndConnections();
    return () => { cancelled = true; };
  }, []);

  const refreshConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/connections');
      if (!res.ok) return;
      const sessions: { _id: string; integration: string; status: string }[] = await res.json();
      const statuses: Record<string, 'connected' | 'available' | 'error' | 'in_progress'> = {};
      const sessionIds: Record<string, string> = {};
      for (const s of sessions) {
        if (s.status === 'connected') {
          statuses[s.integration] = 'connected';
        } else if (s.status === 'failed' && statuses[s.integration] !== 'connected' && statuses[s.integration] !== 'in_progress') {
          statuses[s.integration] = 'error';
        } else if (['pending', 'collecting_credentials', 'storing', 'wiring', 'verifying'].includes(s.status)) {
          if (statuses[s.integration] !== 'connected') {
            statuses[s.integration] = 'in_progress';
            sessionIds[s.integration] = s._id;
          }
        }
      }
      setConnectionStatuses(statuses);
      setActiveSessionIds(sessionIds);
    } catch {
      // silently fail
    }
  }, []);

  const getConnectionStatus = useCallback(
    (integrationId: string): 'connected' | 'available' | 'error' | 'in_progress' => {
      return connectionStatuses[integrationId] ?? 'available';
    },
    [connectionStatuses],
  );

  const openConnectFlow = useCallback(
    (def: IntegrationDef) => {
      setResumeSessionId(activeSessionIds[def.id] ?? null);
      setConnectTarget(def);
    },
    [activeSessionIds],
  );

  // Fetch org settings from MongoDB on mount
  useEffect(() => {
    let cancelled = false;
    async function loadOrgSettings() {
      try {
        const res = await fetch('/api/org/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setForm((prev) => ({
          ...prev,
          // AI routing
          defaultReasoningModel: data.defaultModel ?? prev.defaultReasoningModel,
          defaultFastModel: data.fallbackModel ?? prev.defaultFastModel,
          maintenanceMode: data.fleetMode === 'paused',
          orgLogo: data.orgLogo ?? prev.orgLogo,
          // Organization metadata
          orgName: data.orgName ?? prev.orgName,
          timezone: data.timezone ?? prev.timezone,
          language: data.language ?? prev.language,
          // Data access & privacy
          piiMode: data.piiMode ?? prev.piiMode,
          redactWallets: data.redactWallets ?? prev.redactWallets,
          redactEmails: data.redactEmails ?? prev.redactEmails,
          logPrompts: data.logPrompts ?? prev.logPrompts,
          logRetention: data.logRetention ?? prev.logRetention,
          logSamplingRate: data.logSamplingRate ?? prev.logSamplingRate,
          readExternalUrls: data.readExternalUrls ?? prev.readExternalUrls,
          writeExternalServices: data.writeExternalServices ?? prev.writeExternalServices,
          fileSystemAccess: data.fileSystemAccess ?? prev.fileSystemAccess,
          // Notifications
          defaultAlertChannel: data.defaultAlertChannel ?? prev.defaultAlertChannel,
          secondaryAlertChannel: data.secondaryAlertChannel ?? prev.secondaryAlertChannel,
          criticalEmail: data.criticalEmail ?? prev.criticalEmail,
          alertAgentFailure: data.alertAgentFailure ?? prev.alertAgentFailure,
          alertConnectionLost: data.alertConnectionLost ?? prev.alertConnectionLost,
          alertSecurityEvent: data.alertSecurityEvent ?? prev.alertSecurityEvent,
          alertFleetHealth: data.alertFleetHealth ?? prev.alertFleetHealth,
          alertDeployComplete: data.alertDeployComplete ?? prev.alertDeployComplete,
          alertDailyDigest: data.alertDailyDigest ?? prev.alertDailyDigest,
          quietHours: data.quietHours ?? prev.quietHours,
          quietStart: data.quietStart ?? prev.quietStart,
          quietEnd: data.quietEnd ?? prev.quietEnd,
          quietBehavior: data.quietBehavior ?? prev.quietBehavior,
          // Security & audit
          auditLogging: data.auditLogging ?? prev.auditLogging,
          auditRetention: data.auditRetention ?? prev.auditRetention,
        }));
        setOrgSettingsLoaded(true);
      } catch {
        // API offline — keep defaults
      }
    }
    loadOrgSettings();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const toggleSection = (key: string) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const set = useCallback(<K extends keyof OrgFormState>(key: K, val: OrgFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  // Wire save to PATCH /api/org/settings for fields in the API schema
  const [logoDragOver, setLogoDragOver] = useState(false);

  function readLogoFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      set('orgLogo', reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readLogoFile(file);
  }

  function handleLogoDrop(e: React.DragEvent) {
    e.preventDefault();
    setLogoDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) readLogoFile(file);
  }

  async function handleSaveAll() {
    setSaveState('saving');
    setSaveError(null);
    try {
      const apiPayload: Record<string, unknown> = {
        // AI routing
        defaultModel: form.defaultReasoningModel,
        fallbackModel: form.defaultFastModel,
        orgLogo: form.orgLogo,
        fleetMode: form.maintenanceMode ? 'paused' : 'active',
        // Organization metadata
        orgName: form.orgName,
        timezone: form.timezone,
        language: form.language,
        // Data access & privacy
        piiMode: form.piiMode,
        redactWallets: form.redactWallets,
        redactEmails: form.redactEmails,
        logPrompts: form.logPrompts,
        logRetention: form.logRetention,
        logSamplingRate: form.logSamplingRate,
        readExternalUrls: form.readExternalUrls,
        writeExternalServices: form.writeExternalServices,
        fileSystemAccess: form.fileSystemAccess,
        // Notifications
        defaultAlertChannel: form.defaultAlertChannel,
        secondaryAlertChannel: form.secondaryAlertChannel,
        criticalEmail: form.criticalEmail,
        alertAgentFailure: form.alertAgentFailure,
        alertConnectionLost: form.alertConnectionLost,
        alertSecurityEvent: form.alertSecurityEvent,
        alertFleetHealth: form.alertFleetHealth,
        alertDeployComplete: form.alertDeployComplete,
        alertDailyDigest: form.alertDailyDigest,
        quietHours: form.quietHours,
        quietStart: form.quietStart,
        quietEnd: form.quietEnd,
        quietBehavior: form.quietBehavior,
        // Security & audit
        auditLogging: form.auditLogging,
        auditRetention: form.auditRetention,
      };

      const res = await fetch('/api/org/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Save failed' }));
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }

      setSaveState('saved');
      setDirty(false);
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setSaveError(msg);
      setSaveState('error');
      savedTimerRef.current = setTimeout(() => {
        setSaveState('idle');
        setSaveError(null);
      }, 4000);
    }
  }

  // Maintenance mode toggle handler — persists to API immediately
  async function handleMaintenanceToggle(enabled: boolean) {
    setMaintenanceLoading(true);
    try {
      const res = await fetch('/api/org/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fleetMode: enabled ? 'paused' : 'active' }),
      });
      if (res.ok) {
        setForm((prev) => ({ ...prev, maintenanceMode: enabled }));
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setMaintenanceLoading(false);
    }
  }

  // Kill Switch handler — calls scaleEcsFleet('stop')
  async function handleKillSwitch() {
    setKillSwitchState('executing');
    setKillSwitchError(null);
    try {
      // First pause the fleet mode
      await fetch('/api/org/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fleetMode: 'paused' }),
      });
      // Then scale ECS to 0
      const result = await scaleEcsFleet('stop');
      if (!result.ok) {
        throw new Error(result.error ?? 'ECS scale-down failed');
      }
      setForm((prev) => ({ ...prev, maintenanceMode: true }));
      setKillSwitchState('done');
      setKillSwitchConfirm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kill switch failed';
      setKillSwitchError(msg);
      setKillSwitchState('error');
    }
  }

  const [copied, setCopied] = useState(false);
  const copyOrgId = useCallback(() => {
    navigator.clipboard.writeText('org_yclaw_001').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // ── Audit Log Modal ─────────────────────────────────────────────────────
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<
    { timestamp: string; changes: Record<string, unknown>; source: string }[]
  >([]);
  const [auditLoading, setAuditLoading] = useState(false);

  async function handleViewAuditLog() {
    setAuditModalOpen(true);
    setAuditLoading(true);
    try {
      const res = await fetch('/api/org/settings/audit?limit=50');
      if (res.ok) {
        const data = await res.json();
        setAuditEntries(data.entries ?? []);
      }
    } catch {
      // silently fail — modal will show empty state
    } finally {
      setAuditLoading(false);
    }
  }

  // ── Export All Logs ─────────────────────────────────────────────────────
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');

  async function handleExportLogs() {
    setExportState('exporting');
    try {
      const res = await fetch('/api/org/settings/audit?limit=1000');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data.entries ?? [], null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportState('done');
      setTimeout(() => setExportState('idle'), 2500);
    } catch {
      setExportState('error');
      setTimeout(() => setExportState('idle'), 3000);
    }
  }

  // ── Purge Old Logs ──────────────────────────────────────────────────────
  const [purgeState, setPurgeState] = useState<'idle' | 'confirming' | 'purging' | 'done' | 'error'>('idle');
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  async function handlePurgeLogs() {
    if (purgeState !== 'confirming') {
      setPurgeState('confirming');
      return;
    }
    setPurgeState('purging');
    setPurgeResult(null);
    try {
      const res = await fetch(
        `/api/org/settings/audit?retentionDays=${form.auditRetention}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPurgeResult(
        data.message ?? `${data.deleted ?? 0} log entries removed`,
      );
      setPurgeState('done');
      setTimeout(() => { setPurgeState('idle'); setPurgeResult(null); }, 4000);
    } catch {
      setPurgeState('error');
      setTimeout(() => { setPurgeState('idle'); setPurgeResult(null); }, 3000);
    }
  }

  // Real connection health checks
  const [testStates, setTestStates] = useState<Record<string, 'idle' | 'testing' | 'success' | 'fail'>>({});
  const autoConnectionChecksStartedRef = useRef(false);
  const runTest = useCallback(async (key: string) => {
    setTestStates((prev) => ({ ...prev, [key]: 'testing' }));
    try {
      let ok = false;
      if (key === 'mongo') {
        // Real MongoDB health check via server action (pings DB directly)
        const result = await checkMongoHealth();
        ok = result.ok;
      } else if (key === 'redis') {
        // Real Redis health check via server action (pings Redis directly)
        const result = await checkRedisHealth();
        ok = result.ok;
      } else if (key === 'openclaw') {
        // Check OpenClaw gateway connection
        const res = await fetch('/api/gateway/health');
        if (res.ok) {
          const data = await res.json();
          ok = data.connected === true;
        }
      } else {
        // For AI providers, just check if the key field is non-empty (env var presence)
        ok = false; // Will show "Not configured" for providers without keys
      }
      setTestStates((prev) => ({ ...prev, [key]: ok ? 'success' : 'fail' }));
      setTimeout(() => setTestStates((prev) => ({ ...prev, [key]: 'idle' })), 3000);
    } catch {
      setTestStates((prev) => ({ ...prev, [key]: 'fail' }));
      setTimeout(() => setTestStates((prev) => ({ ...prev, [key]: 'idle' })), 3000);
    }
  }, []);

  useEffect(() => {
    if (autoConnectionChecksStartedRef.current) return;
    autoConnectionChecksStartedRef.current = true;
    void runTest('redis');
    void runTest('openclaw');
  }, [runTest]);

  function TestButton({ id }: { id: string }) {
    const state = testStates[id] ?? 'idle';
    return (
      <button
        type="button"
        onClick={() => runTest(id)}
        disabled={state === 'testing'}
        className={`text-[10px] font-mono px-2.5 py-1 rounded border transition-colors ${
          state === 'success'
            ? 'border-terminal-green/30 text-terminal-green'
            : state === 'fail'
              ? 'border-terminal-red/30 text-terminal-red'
              : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-muted'
        }`}
      >
        {state === 'testing' ? 'Testing...' : state === 'success' ? 'Connected' : state === 'fail' ? 'Failed' : 'Test Connection'}
      </button>
    );
  }

  const agentCount = AGENTS.length;

  const saveFooterEl = (
    <div className="sticky bottom-0 z-10 bg-terminal-surface border-t border-terminal-border px-6 py-3 flex items-center justify-between -mx-6 -mb-6 mt-6">
      <div>
        {dirty && saveState === 'idle' && (
          <span className="text-[10px] text-terminal-dim">Unsaved changes</span>
        )}
        {saveState === 'error' && saveError && (
          <span className="text-[10px] text-terminal-red">{saveError}</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleSaveAll}
        disabled={!dirty || saveState === 'saving'}
        className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
          saveState === 'saved'
            ? 'border-terminal-green/40 text-terminal-green bg-terminal-green/10'
            : saveState === 'saving'
              ? 'border-terminal-border text-terminal-dim cursor-not-allowed'
              : saveState === 'error'
                ? 'border-terminal-red/40 text-terminal-red'
                : dirty
                  ? 'border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10'
                  : 'border-terminal-border text-terminal-dim cursor-not-allowed'
        }`}
      >
        {saveState === 'saved' ? 'Saved \u2713' : saveState === 'saving' ? 'Saving...' : saveState === 'error' ? 'Retry Save' : 'Save Changes'}
      </button>
    </div>
  );

  return (
    <div className="max-w-2xl">
        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SECTION 1: ORGANIZATION                                        */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Section
          label="Organization"
          icon={<GlobeIcon className="w-4 h-4 text-slate-400" />}
          borderColor="slate"
          expanded={sections['org'] ?? false}
          onToggle={() => toggleSection('org')}
          tooltip="Basic organization settings that apply across the entire platform."
        >
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Organization Name</label>
            <input
              type="text"
              value={form.orgName}
              onChange={(e) => set('orgName', e.target.value)}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-slate-400"
            />
          </div>

          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Organization Logo</label>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoSelect}
            />
            <div
              className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors cursor-pointer ${
                logoDragOver ? 'border-terminal-green bg-terminal-green/5' : 'border-terminal-border hover:border-terminal-muted'
              }`}
              onClick={() => logoInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setLogoDragOver(true); }}
              onDragEnter={(e) => { e.preventDefault(); setLogoDragOver(true); }}
              onDragLeave={() => setLogoDragOver(false)}
              onDrop={handleLogoDrop}
            >
              {form.orgLogo ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.orgLogo} alt="Organization logo" className="max-h-16 max-w-full object-contain mb-2" />
                  <span className="text-[9px] text-terminal-dim">Click to change</span>
                </>
              ) : (
                <>
                  <UploadIcon className="w-6 h-6 text-terminal-dim/40 mb-2" />
                  <span className="text-[10px] text-terminal-dim">Drop logo or click to upload</span>
                  <span className="text-[9px] text-terminal-dim/40 mt-1">PNG, SVG, or JPEG</span>
                </>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Default Timezone</label>
            <select
              value={form.timezone}
              onChange={(e) => set('timezone', e.target.value)}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-slate-400"
            >
              <option value="UTC">UTC</option>
              <option value="US/Eastern">US/Eastern</option>
              <option value="US/Pacific">US/Pacific</option>
              <option value="US/Central">US/Central</option>
              <option value="America/Puerto_Rico">America/Puerto_Rico</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="Asia/Tokyo">Asia/Tokyo</option>
              <option value="Asia/Shanghai">Asia/Shanghai</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Default Language</label>
            <select
              value={form.language}
              onChange={(e) => set('language', e.target.value)}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-slate-400"
            >
              {['English', 'Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Portuguese', 'Korean'].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Organization ID</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value="org_yclaw_001"
                readOnly
                className="flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono opacity-70 cursor-default"
              />
              <button
                type="button"
                onClick={copyOrgId}
                className="p-1.5 text-terminal-dim hover:text-terminal-text transition-colors"
                aria-label="Copy"
              >
                {copied ? (
                  <span className="text-terminal-green text-[10px] font-mono">ok</span>
                ) : (
                  <CopyIcon />
                )}
              </button>
            </div>
          </div>
        </Section>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SECTION 2: FLEET & INFRASTRUCTURE                              */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Section
          label="Fleet & Infrastructure"
          icon={<ServerIcon className="w-4 h-4 text-terminal-cyan" />}
          borderColor="cyan"
          expanded={sections['fleet'] ?? false}
          onToggle={() => toggleSection('fleet')}
          tooltip="Core infrastructure services that power the agent fleet. All agents depend on these connections."
        >
          {/* Fleet Summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-terminal-muted/20 border border-terminal-border rounded p-2.5">
              <div className="text-[9px] text-terminal-dim uppercase tracking-widest mb-1">Agent Count</div>
              <div className="text-xs text-terminal-text font-mono">{agentCount} agents</div>
              <div className="text-[10px] text-terminal-dim">across 6 departments</div>
            </div>
            <div className="bg-terminal-muted/20 border border-terminal-border rounded p-2.5">
              <div className="text-[9px] text-terminal-dim uppercase tracking-widest mb-1">Runtime</div>
              <div className="text-xs text-terminal-text font-mono flex items-center gap-1.5">
                ECS Fargate
                <span className="text-[8px] px-1 py-px rounded border border-terminal-green/30 text-terminal-green bg-terminal-green/10">ACTIVE</span>
              </div>
            </div>
          </div>

          <SubHeader label="Core Services" />

          {/* MongoDB */}
          <div className="bg-terminal-muted/10 border border-terminal-border rounded p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-terminal-text">MongoDB</span>
              </div>
              <StatusBadge status={testStates['mongo'] === 'success' ? 'connected' : testStates['mongo'] === 'fail' ? 'error' : (orgSettingsLoaded ? 'connected' : 'available')} />
            </div>
            <MaskedInput label="Connection URI" value={form.mongoUri} readOnly placeholder="Set via MONGODB_URI env var" focusColor="focus:border-terminal-cyan" />
            <p className="text-[9px] text-terminal-dim/50 italic">Read-only — configure via the <code className="font-mono">MONGODB_URI</code> environment variable.</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-terminal-dim font-mono">{form.mongoUri ? 'Configured via env var' : 'Not configured'}</span>
              <TestButton id="mongo" />
            </div>
          </div>

          {/* Redis */}
          <div className="bg-terminal-muted/10 border border-terminal-border rounded p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-terminal-text">Redis</span>
              <StatusBadge status={testStates['redis'] === 'success' ? 'connected' : testStates['redis'] === 'fail' ? 'error' : 'available'} />
            </div>
            <MaskedInput label="Redis URL" value={form.redisUrl} readOnly placeholder="Set via REDIS_URL env var" focusColor="focus:border-terminal-cyan" />
            <p className="text-[9px] text-terminal-dim/50 italic">Read-only — configure via the <code className="font-mono">REDIS_URL</code> environment variable.</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-terminal-dim font-mono">{form.redisUrl ? 'Configured via env var' : 'Not configured'}</span>
              <TestButton id="redis" />
            </div>
          </div>

          {/* OpenClaw Gateway */}
          <div className="bg-terminal-muted/10 border border-terminal-border rounded p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-terminal-text">OpenClaw Gateway</span>
              <StatusBadge status={testStates['openclaw'] === 'success' ? 'connected' : testStates['openclaw'] === 'fail' ? 'error' : 'available'} />
            </div>
            <div>
              <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">WebSocket URL</label>
              <input
                type="text"
                value={form.openclawWsUrl}
                readOnly
                placeholder="Set via OPENCLAW_WS_URL env var"
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-cyan opacity-70 cursor-default"
              />
            </div>
            <MaskedInput label="Device Public Key" value={form.openclawPubKey} readOnly placeholder="Set via OPENCLAW_PUB_KEY env var" focusColor="focus:border-terminal-cyan" />
            <MaskedInput label="Device Private Key" value={form.openclawPrivKey} readOnly placeholder="Set via OPENCLAW_PRIV_KEY env var" focusColor="focus:border-terminal-cyan" />
            <p className="text-[9px] text-terminal-dim/50 italic">Read-only — configure OpenClaw credentials via environment variables.</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-terminal-dim font-mono">{form.openclawWsUrl ? 'Configured' : 'Not configured'}</span>
              <TestButton id="openclaw" />
            </div>
          </div>
        </Section>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SECTION 3: AI PROVIDERS & ROUTING                              */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Section
          label="AI Providers & Routing"
          icon={<SparklesIcon className="w-4 h-4 text-terminal-purple" />}
          borderColor="purple"
          expanded={sections['ai'] ?? false}
          onToggle={() => toggleSection('ai')}
          tooltip="Configure LLM providers, API keys, and intelligent routing. Keys entered here are available to all agents. Individual model selection is configured per-agent in department settings."
        >
          <SubHeader label="LLM Proxy / Router" />

          {/* LiteLLM */}
          <div className="bg-terminal-muted/10 border border-terminal-border rounded p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-terminal-text">LiteLLM</span>
              <StatusBadge status="available" />
            </div>
            <div>
              <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Proxy URL</label>
              <input
                type="text"
                value={form.litellmUrl}
                readOnly
                placeholder="Set via LITELLM_URL env var"
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-purple placeholder:text-terminal-dim/30 opacity-70 cursor-default"
              />
            </div>
            <MaskedInput label="API Key" value={form.litellmKey} readOnly placeholder="Set via LITELLM_API_KEY env var" focusColor="focus:border-terminal-purple" />
            <p className="text-[9px] text-terminal-dim/50 italic">Read-only — configure LiteLLM credentials via environment variables.</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-terminal-text">Route all LLM traffic through LiteLLM</span>
                <InfoTooltip text="When enabled, all agent LLM requests route through your LiteLLM proxy instead of calling providers directly. Enables unified logging, caching, and rate limiting." />
              </div>
              <ToggleSwitch checked={form.litellmRoute} onChange={(v) => set('litellmRoute', v)} color="terminal-purple" />
            </div>
          </div>

          {/* OpenRouter */}
          <div className="bg-terminal-muted/10 border border-terminal-border rounded p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-terminal-text">OpenRouter</span>
                <InfoTooltip text="Access 100+ models through a single API key." />
              </div>
              <StatusBadge status="available" />
            </div>
            <MaskedInput label="API Key" value={form.openrouterKey} readOnly placeholder="Set via OPENROUTER_API_KEY env var" focusColor="focus:border-terminal-purple" />
            <p className="text-[9px] text-terminal-dim/50 italic">Read-only — configure via the <code className="font-mono">OPENROUTER_API_KEY</code> environment variable.</p>
          </div>

          <SubHeader label="Direct Providers" />

          {/* Direct Providers — status from verified ConnectionSession only */}
          {[
            { name: 'Anthropic', key: 'anthropicKey' as const, integrationId: 'anthropic' },
            { name: 'OpenAI', key: 'openaiKey' as const, integrationId: 'openai' },
            { name: 'Google (Gemini)', key: 'googleKey' as const, integrationId: 'google' },
            { name: 'xAI (Grok)', key: 'xaiKey' as const, integrationId: 'xai' },
          ].map((p) => {
            const apiStatus = getConnectionStatus(p.integrationId);
            const integrationDef = tier1Integrations.find((i) => i.id === p.integrationId);
            return (
              <div key={p.name} className="flex items-center gap-2 py-1.5">
                <StatusDot status={apiStatus} />
                <span className={`text-xs w-28 shrink-0 ${apiStatus === 'connected' ? 'text-terminal-text' : 'text-terminal-dim'}`}>{p.name}</span>
                <div className="flex-1">
                  <input
                    type="password"
                    value={form[p.key]}
                    readOnly
                    placeholder="Set via env var"
                    className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text font-mono focus:outline-none focus:border-terminal-purple placeholder:text-terminal-dim/30 opacity-70 cursor-default"
                  />
                </div>
                {apiStatus === 'connected' ? (
                  <span className="text-[9px] font-mono text-terminal-green">Connected</span>
                ) : integrationDef ? (
                  <button
                    type="button"
                    onClick={() => setConnectTarget(integrationDef)}
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                      apiStatus === 'error'
                        ? 'border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10'
                        : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-muted'
                    }`}
                  >
                    {apiStatus === 'error' ? 'Reconnect' : 'Connect'}
                  </button>
                ) : (
                  <span className="text-[9px] font-mono text-terminal-dim">Not configured</span>
                )}
              </div>
            );
          })}

          {/* Show more providers toggle */}
          <button
            type="button"
            onClick={() => set('showMoreProviders', !form.showMoreProviders)}
            className="text-[10px] font-mono text-terminal-purple hover:text-terminal-text transition-colors"
          >
            {form.showMoreProviders ? 'Hide additional providers' : 'Show more providers...'}
          </button>

          {form.showMoreProviders && (
            <div className="space-y-2 pl-1">
              {[
                { name: 'Azure OpenAI', keyField: 'azureKey' as const, extra: 'azureEndpoint' as const },
                { name: 'Mistral', keyField: 'mistralKey' as const },
                { name: 'Cohere', keyField: 'cohereKey' as const },
                { name: 'Groq', keyField: 'groqKey' as const },
                { name: 'Together', keyField: 'togetherKey' as const },
              ].map((p) => (
                <div key={p.name} className="flex items-center gap-2 py-1">
                  <StatusDot status="available" />
                  <span className="text-xs text-terminal-dim w-28 shrink-0">{p.name}</span>
                  <div className="flex-1">
                    <input
                      type="password"
                      value={form[p.keyField]}
                      readOnly
                      placeholder="Set via env var"
                      className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text font-mono focus:outline-none focus:border-terminal-purple placeholder:text-terminal-dim/30 opacity-70 cursor-default"
                    />
                  </div>
                </div>
              ))}
              {/* Ollama */}
              <div className="flex items-center gap-2 py-1">
                <StatusDot status="available" />
                <span className="text-xs text-terminal-dim w-28 shrink-0">Ollama (Local)</span>
                <div className="flex-1">
                  <input
                    type="text"
                    value={form.ollamaUrl}
                    readOnly
                    placeholder="Set via OLLAMA_BASE_URL env var"
                    className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text font-mono focus:outline-none focus:border-terminal-purple placeholder:text-terminal-dim/30 opacity-70 cursor-default"
                  />
                </div>
              </div>
            </div>
          )}

          <SubHeader label="Global Defaults" />

          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Default Reasoning Model</label>
            <select
              value={form.defaultReasoningModel}
              onChange={(e) => set('defaultReasoningModel', e.target.value)}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-purple"
            >
              <optgroup label="Anthropic">
                <option value="claude-opus-4-6">claude-opus-4-6</option>
                <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-5.2">gpt-5.2</option>
                <option value="gpt-4.1">gpt-4.1</option>
              </optgroup>
              <optgroup label="Google">
                <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              </optgroup>
              <optgroup label="xAI">
                <option value="grok-4-1-fast-reasoning">grok-4-1-fast-reasoning</option>
                <option value="grok-3">grok-3</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Default Fast Model</label>
            <select
              value={form.defaultFastModel}
              onChange={(e) => set('defaultFastModel', e.target.value)}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-purple"
            >
              <optgroup label="Anthropic">
                <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </optgroup>
              <optgroup label="Google">
                <option value="gemini-flash">gemini-flash</option>
              </optgroup>
            </select>
          </div>

          <div className="relative">
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-[10px] text-terminal-dim uppercase tracking-widest">Provider Fallback Chain</label>
              <InfoTooltip text="If the primary provider fails or is rate-limited, agents automatically try the next provider in this chain." />
            </div>
            <div className="space-y-1">
              {form.fallbackChain.map((provider, idx) => (
                <div key={provider} className="flex items-center gap-2 py-1 px-2 bg-terminal-muted/10 border border-terminal-border rounded">
                  <GripVerticalIcon className="w-3 h-3 text-terminal-dim/10" />
                  <span className="text-[10px] text-terminal-dim font-mono w-4">{idx + 1}.</span>
                  <span className="text-xs text-terminal-text flex-1">{provider}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SECTION 4: CONNECTIONS & INTEGRATIONS                          */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Section
          label="Connections & Integrations"
          icon={<PlugIcon className="w-4 h-4 text-terminal-blue" />}
          borderColor="blue"
          expanded={sections['connections'] ?? false}
          onToggle={() => toggleSection('connections')}
          tooltip="External services and platforms your agents can interact with. Configure credentials here — agent-level permissions are set in department settings."
        >
          {/* AI Providers (Tier 1 — paste key + verify) */}
          <ConnectionCategory
            label="AI Providers"
            defaultExpanded
            connections={tier1Integrations.map((def) => ({
              name: def.name,
              status: getConnectionStatus(def.id),
              tier: def.tier,
              source: def.source,
              onConnect: () => openConnectFlow(def),
            }))}
          />

          <ConnectionCategory
            label="Code & Deploy"
            defaultExpanded
            connections={[
              ...(tier2Integrations.filter((i) => i.id === 'github').map((def) => ({
                name: def.name,
                status: getConnectionStatus(def.id),
                usedBy: `Used by: ${AGENTS.length} agents`,
                tier: def.tier,
                source: def.source,
                onConnect: () => openConnectFlow(def),
              }))),
              ...(tier2Integrations.some((i) => i.id === 'github')
                ? []
                : [{ name: 'GitHub', status: 'available' as const }]),
              ...(tier2Integrations.filter((i) => i.id === 'linear').map((def) => ({
                name: def.name,
                status: getConnectionStatus(def.id),
                tier: def.tier,
                source: def.source,
                onConnect: () => openConnectFlow(def),
              }))),
              ...(tier2Integrations.some((i) => i.id === 'linear')
                ? []
                : [{ name: 'Linear', status: 'available' as const }]),
              { name: 'GitLab', status: 'available' },
              { name: 'Bitbucket', status: 'available' },
              { name: 'Jira', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Communication"
            defaultExpanded
            connections={[
              ...(tier2Integrations.filter((i) => i.id === 'slack').map((def) => ({
                name: def.name,
                status: getConnectionStatus(def.id),
                usedBy: `Used by: ${AGENTS.length} agents`,
                tier: def.tier,
                source: def.source,
                onConnect: () => openConnectFlow(def),
              }))),
              ...(tier2Integrations.some((i) => i.id === 'slack')
                ? []
                : [{ name: 'Slack', status: 'available' as const }]),
              { name: 'Telegram', status: 'available' as const },
              { name: 'Email (SMTP)', status: 'available' as const },
              { name: 'Discord', status: 'available' },
              { name: 'Microsoft Teams', status: 'available' },
              { name: 'Twilio (SMS)', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Creative & Media"
            defaultExpanded
            connections={[
              ...(tier2Integrations.filter((i) => i.id === 'figma').map((def) => ({
                name: def.name,
                status: getConnectionStatus(def.id),
                usedBy: 'Used by: 1 agent',
                tier: def.tier,
                source: def.source,
                onConnect: () => openConnectFlow(def),
              }))),
              ...(tier2Integrations.some((i) => i.id === 'figma')
                ? []
                : [{ name: 'Figma', status: 'available' as const }]),
              { name: 'Flux (Images)', status: 'available' as const },
              { name: 'Video / Veo', status: 'available' as const },
              { name: 'Midjourney', status: 'available' },
              { name: 'Runway', status: 'available' },
              { name: 'Stable Diffusion', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Social & Research"
            defaultExpanded
            connections={[
              { name: 'Twitter / X', status: 'available' as const },
              { name: 'Google Search', status: 'available' },
              { name: 'Tavily', status: 'available' },
              { name: 'SerpAPI', status: 'available' },
              { name: 'Perplexity', status: 'available' },
              { name: 'Firecrawl', status: 'available' },
              { name: 'Browserbase', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Blockchain & Payments"
            defaultExpanded
            connections={[
              { name: 'Helius (Solana)', status: 'available' as const },
              { name: 'Alchemy (ETH+L2)', status: 'available' as const },
              { name: 'QuickNode', status: 'available' },
              { name: 'Infura', status: 'available' },
              { name: 'Chainstack', status: 'available' },
              { name: 'Custom RPC', status: 'available' },
              { name: 'Teller.io', status: 'available' },
              { name: 'Stripe', status: 'available' },
              { name: 'Plaid', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Cloud Providers"
            connections={[
              { name: 'Google Cloud (GCP)', status: 'available' },
              { name: 'AWS', status: 'available' },
              { name: 'Microsoft Azure', status: 'available' },
              { name: 'Vercel', status: 'available' },
              { name: 'Netlify', status: 'available' },
              { name: 'Railway', status: 'available' },
              { name: 'Fly.io', status: 'available' },
              { name: 'DigitalOcean', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Storage & Data"
            connections={[
              { name: 'Amazon S3 / GCS', status: 'available' },
              { name: 'Pinecone', status: 'available' },
              { name: 'Weaviate', status: 'available' },
              { name: 'Qdrant', status: 'available' },
              { name: 'Chroma', status: 'available' },
              { name: 'PostgreSQL', status: 'available' },
              { name: 'Notion', status: 'available' },
              { name: 'Google Drive', status: 'available' },
              { name: 'Confluence', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Observability"
            connections={[
              { name: 'Sentry', status: 'available' },
              { name: 'Datadog', status: 'available' },
              { name: 'Grafana', status: 'available' },
              { name: 'PagerDuty', status: 'available' },
              { name: 'Opsgenie', status: 'available' },
            ]}
          />

          <ConnectionCategory
            label="Automation"
            connections={[
              ...(tier2Integrations.filter((i) => i.id === 'custom').map((def) => ({
                name: def.name,
                status: getConnectionStatus(def.id),
                tier: def.tier,
                source: def.source,
                onConnect: () => openConnectFlow(def),
              }))),
              ...(tier2Integrations.some((i) => i.id === 'custom')
                ? []
                : [{ name: 'Custom Integration', status: 'available' as const }]),
              { name: 'Webhooks (Generic)', status: 'available' },
              { name: 'Zapier', status: 'available' },
              { name: 'Make', status: 'available' },
            ]}
          />

          {/* Dynamic: community/recipe integrations not in hardcoded categories */}
          {(() => {
            const knownIds = new Set(['github', 'linear', 'slack', 'figma', 'custom']);
            const communityIntegrations = tier2Integrations.filter(
              (i) => !knownIds.has(i.id) && i.source === 'recipe',
            );
            if (communityIntegrations.length === 0) return null;
            return (
              <ConnectionCategory
                label="Community Recipes"
                connections={communityIntegrations.map((def) => ({
                  name: def.name,
                  status: getConnectionStatus(def.id),
                  tier: def.tier,
                  source: def.source,
                  onConnect: () => openConnectFlow(def),
                }))}
              />
            );
          })()}

          <p className="text-[10px] text-terminal-dim/50 pt-2">
            Need a different integration? Submit a request on GitHub.
          </p>
        </Section>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SECTION 5: DATA ACCESS & PRIVACY                               */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Section
          label="Data Access & Privacy"
          icon={<ShieldIcon className="w-4 h-4 text-terminal-red" />}
          borderColor="red"
          expanded={sections['privacy'] ?? false}
          onToggle={() => toggleSection('privacy')}
          tooltip="Global data handling policies applied to all agents across all departments. Controls what data agents can access, how it's logged, and retention rules."
        >
          <SubHeader label="PII Handling" />
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-[10px] text-terminal-dim uppercase tracking-widest">PII Mode</label>
              <InfoTooltip text="Avoid = agents never process PII. Redact = PII is automatically stripped from logs and outputs. Allowed = no restrictions." />
            </div>
            <select
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-red"
              value={form.piiMode}
              onChange={(e) => set('piiMode', e.target.value)}
            >
              <option value="avoid">Avoid</option>
              <option value="redact">Redact</option>
              <option value="allowed">Allowed</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Auto-redact wallet addresses in logs</span>
            <ToggleSwitch checked={form.redactWallets} onChange={(v) => set('redactWallets', v)} color="terminal-red" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Auto-redact email addresses in logs</span>
            <ToggleSwitch checked={form.redactEmails} onChange={(v) => set('redactEmails', v)} color="terminal-red" />
          </div>

          <SubHeader label="Logging" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Log agent prompts & responses</span>
            <ToggleSwitch checked={form.logPrompts} onChange={(v) => set('logPrompts', v)} color="terminal-red" />
          </div>
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Log Retention</label>
            <select
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-red"
              value={form.logRetention}
              onChange={(e) => set('logRetention', e.target.value)}
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-[10px] text-terminal-dim uppercase tracking-widest">Log Sampling Rate %</label>
              <InfoTooltip text="Percentage of agent interactions to log. Lower values reduce storage costs but provide less debugging visibility." />
            </div>
            <input
              type="number"
              min={1}
              max={100}
              className="w-24 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-red"
              value={form.logSamplingRate}
              onChange={(e) => set('logSamplingRate', e.target.value)}
            />
          </div>

          <SubHeader label="Data Access" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Agents can read external URLs</span>
            <ToggleSwitch checked={form.readExternalUrls} onChange={(v) => set('readExternalUrls', v)} color="terminal-red" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Agents can write to external services</span>
            <ToggleSwitch checked={form.writeExternalServices} onChange={(v) => set('writeExternalServices', v)} color="terminal-red" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Allow file system access</span>
            <ToggleSwitch checked={form.fileSystemAccess} onChange={(v) => set('fileSystemAccess', v)} color="terminal-red" />
          </div>

          <SubHeader label="Export & Deletion" />
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={handleExportLogs}
              disabled={exportState === 'exporting'}
              className={`px-3 py-1.5 text-xs font-mono border rounded transition-colors ${
                exportState === 'done'
                  ? 'border-terminal-green/40 text-terminal-green bg-terminal-green/10'
                  : exportState === 'error'
                  ? 'border-terminal-red/30 text-terminal-red'
                  : exportState === 'exporting'
                  ? 'border-terminal-border text-terminal-dim cursor-not-allowed'
                  : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-muted'
              }`}
            >
              {exportState === 'exporting' ? 'Exporting...' : exportState === 'done' ? 'Downloaded ✓' : exportState === 'error' ? 'Export Failed' : 'Export All Logs'}
            </button>

            {purgeState === 'idle' && (
              <button
                type="button"
                onClick={handlePurgeLogs}
                className="px-3 py-1.5 text-xs font-mono border border-terminal-red/30 rounded text-terminal-red hover:bg-terminal-red/10 transition-colors"
              >
                Purge Old Logs
              </button>
            )}
            {purgeState === 'confirming' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-terminal-red font-mono">
                  Remove logs older than {form.logRetention} days?
                </span>
                <button
                  type="button"
                  onClick={handlePurgeLogs}
                  className="px-2 py-1 text-[10px] font-mono font-bold border-2 border-terminal-red bg-terminal-red/20 text-terminal-red hover:bg-terminal-red/30 rounded transition-colors"
                >
                  Confirm Purge
                </button>
                <button
                  type="button"
                  onClick={() => setPurgeState('idle')}
                  className="px-2 py-1 text-[10px] font-mono border border-terminal-border text-terminal-dim hover:text-terminal-text rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
            {purgeState === 'purging' && (
              <span className="text-[10px] text-terminal-dim font-mono">Purging...</span>
            )}
            {purgeState === 'done' && (
              <span className="text-[10px] text-terminal-green font-mono">{purgeResult ?? 'Done ✓'}</span>
            )}
            {purgeState === 'error' && (
              <span className="text-[10px] text-terminal-red font-mono">Purge failed — try again</span>
            )}
          </div>
        </Section>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SECTION 6: NOTIFICATIONS & ALERTS                              */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Section
          label="Notifications & Alerts"
          icon={<BellIcon className="w-4 h-4 text-terminal-green" />}
          borderColor="green"
          expanded={sections['notifications'] ?? false}
          onToggle={() => toggleSection('notifications')}
          tooltip="Configure where system-level alerts are delivered and when to suppress non-critical notifications."
        >
          <SubHeader label="Alert Routing" />
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Default Alert Channel</label>
            <input
              type="text"
              value={form.defaultAlertChannel}
              onChange={(e) => set('defaultAlertChannel', e.target.value)}
              placeholder="#yclaw-alerts"
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
            />
          </div>
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Secondary Alert Channel</label>
            <input
              type="text"
              value={form.secondaryAlertChannel}
              onChange={(e) => set('secondaryAlertChannel', e.target.value)}
              placeholder="#yclaw-operations"
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
            />
          </div>
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Critical Escalation Email</label>
            <input
              type="email"
              value={form.criticalEmail}
              onChange={(e) => set('criticalEmail', e.target.value)}
              placeholder="ops@example.com"
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
            />
          </div>

          <SubHeader label="Alert Types" />
          {[
            { key: 'alertAgentFailure' as const, label: 'Agent failure / crash' },
            { key: 'alertConnectionLost' as const, label: 'Integration connection lost' },
            { key: 'alertSecurityEvent' as const, label: 'Security event (blocked action, auth failure)' },
            { key: 'alertFleetHealth' as const, label: 'Fleet health degradation' },
            { key: 'alertDeployComplete' as const, label: 'Deployment completed' },
            { key: 'alertDailyDigest' as const, label: 'Daily digest summary' },
          ].map((a) => (
            <div key={a.key} className="flex items-center justify-between">
              <span className="text-xs text-terminal-text">{a.label}</span>
              <ToggleSwitch checked={form[a.key]} onChange={(v) => set(a.key, v)} color="terminal-green" />
            </div>
          ))}

          <SubHeader label="Quiet Hours" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Enable quiet hours</span>
            <ToggleSwitch checked={form.quietHours} onChange={(v) => set('quietHours', v)} color="terminal-green" />
          </div>
          {form.quietHours && (
            <div className="space-y-3 pl-2 border-l-2 border-terminal-green/20">
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Start</label>
                  <input
                    type="time"
                    value={form.quietStart}
                    onChange={(e) => set('quietStart', e.target.value)}
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">End</label>
                  <input
                    type="time"
                    value={form.quietEnd}
                    onChange={(e) => set('quietEnd', e.target.value)}
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">During Quiet Hours</label>
                <select
                  value={form.quietBehavior}
                  onChange={(e) => set('quietBehavior', e.target.value)}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                >
                  <option value="suppress-all">Suppress all</option>
                  <option value="critical-only">Critical only</option>
                  <option value="no-change">No change</option>
                </select>
              </div>
            </div>
          )}
        </Section>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SECTION 7: SECURITY & ACCESS CONTROL                           */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Section
          label="Security & Access Control"
          icon={<KeyIcon className="w-4 h-4 text-terminal-orange" />}
          borderColor="orange"
          expanded={sections['security'] ?? false}
          onToggle={() => toggleSection('security')}
          tooltip="Manage API keys, access roles, audit logging, and emergency controls."
        >
          <SubHeader label="API Key Management" />
          <div className="space-y-1">
            <InfoTooltip text="API keys authenticate external tools and services connecting to Mission Control." />
            <div className="bg-terminal-muted/10 border border-terminal-border rounded overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_100px_80px_60px_50px] gap-1 px-2.5 py-1.5 border-b border-terminal-border/50 text-[9px] text-terminal-dim uppercase tracking-widest">
                <span>Name</span>
                <span>Key</span>
                <span>Created</span>
                <span>Last Used</span>
                <span></span>
              </div>
              {/* Row */}
              <div className="grid grid-cols-[1fr_100px_80px_60px_50px] gap-1 px-2.5 py-2 items-center text-xs">
                <span className="text-terminal-text">Default API Key</span>
                <span className="text-terminal-dim font-mono text-[10px]">••••••yclaw01</span>
                <span className="text-terminal-dim text-[10px]">2026-01-15</span>
                <span className="text-terminal-dim text-[10px]">2h ago</span>
                <button
                  type="button"
                  className="text-[10px] font-mono text-terminal-red hover:text-terminal-red/80 transition-colors"
                >
                  Revoke
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-muted transition-colors"
          >
            + Create API Key
          </button>

          <SubHeader label="Access Roles" />
          <div>
            <div className="space-y-2">
              <InfoTooltip text="Role-based access control for team management." />
              <div className="bg-terminal-muted/10 border border-terminal-border rounded overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px] gap-1 px-2.5 py-1.5 border-b border-terminal-border/50 text-[9px] text-terminal-dim uppercase tracking-widest">
                  <span>User</span>
                  <span>Role</span>
                  <span>Status</span>
                </div>
                <div className="grid grid-cols-[1fr_80px_80px] gap-1 px-2.5 py-2 items-center text-xs">
                  <span className="text-terminal-text">You</span>
                  <span className="text-terminal-orange text-[10px] font-mono">Owner</span>
                  <span className="text-terminal-green text-[10px]">Active</span>
                </div>
              </div>
              <div className="flex gap-2 text-[9px] text-terminal-dim font-mono">
                {['Owner', 'Admin', 'Operator', 'Viewer'].map((r) => (
                  <span key={r} className="px-1.5 py-0.5 rounded border border-terminal-border">{r}</span>
                ))}
              </div>
              <button
                type="button"
                className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-terminal-border text-terminal-dim"
              >
                Invite Member
              </button>
            </div>
          </div>

          <SubHeader label="Audit Log" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-terminal-text">Enable audit logging</span>
            <ToggleSwitch checked={form.auditLogging} onChange={(v) => set('auditLogging', v)} color="terminal-orange" />
          </div>
          <div>
            <label className="text-[10px] text-terminal-dim uppercase tracking-widest block mb-1">Audit Log Retention</label>
            <select
              value={form.auditRetention}
              onChange={(e) => set('auditRetention', e.target.value)}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-orange"
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="forever">Forever</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handleViewAuditLog}
            className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-muted transition-colors"
          >
            View Audit Log
          </button>

          <SubHeader label="Emergency Controls" />
          <div className="border border-terminal-red/30 rounded p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-terminal-text">Maintenance Mode</span>
                <InfoTooltip text="Pauses all agent activity via PATCH /api/org/settings { fleetMode: 'paused' }. Agents will not process any tasks, crons, or events until maintenance mode is disabled." />
              </div>
              <div className="flex items-center gap-2">
                {maintenanceLoading && (
                  <span className="text-[9px] text-terminal-dim font-mono">Saving...</span>
                )}
                <ToggleSwitch
                  checked={form.maintenanceMode}
                  onChange={(v) => handleMaintenanceToggle(v)}
                  color="terminal-red"
                />
              </div>
            </div>
            {form.maintenanceMode && (
              <div className="flex items-center gap-2 px-2.5 py-2 rounded bg-terminal-red/10 border border-terminal-red/30">
                <span className="text-terminal-yellow text-sm">&#9888;</span>
                <span className="text-[10px] text-terminal-red font-mono">Maintenance mode is active. Fleet mode set to &quot;paused&quot; in database.</span>
              </div>
            )}

            <div className="pt-2 border-t border-terminal-red/20">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[10px] text-terminal-dim uppercase tracking-widest">Kill Switch</span>
                <InfoTooltip text="Emergency stop. Sets fleetMode to 'paused' AND scales ECS service to 0 tasks. This is a hard stop — agents will be terminated. Use only in emergencies." />
              </div>
              {killSwitchState === 'done' ? (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded bg-terminal-red/10 border border-terminal-red/30">
                  <span className="text-terminal-red text-sm">&#9632;</span>
                  <span className="text-[10px] text-terminal-red font-mono">Kill switch activated. ECS scaled to 0. Fleet mode paused.</span>
                </div>
              ) : killSwitchState === 'error' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-2.5 py-2 rounded bg-terminal-red/10 border border-terminal-red/30">
                    <span className="text-terminal-red text-sm">&#9888;</span>
                    <span className="text-[10px] text-terminal-red font-mono">Kill switch failed: {killSwitchError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setKillSwitchState('idle'); setKillSwitchConfirm(false); }}
                    className="text-[10px] font-mono text-terminal-dim hover:text-terminal-text transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              ) : !killSwitchConfirm ? (
                <button
                  type="button"
                  onClick={() => setKillSwitchConfirm(true)}
                  disabled={killSwitchState === 'executing'}
                  className="w-full py-2 text-xs font-mono font-bold rounded border-2 border-terminal-red text-terminal-red hover:bg-terminal-red/10 transition-colors"
                >
                  Kill Switch &mdash; Disable All Outbound Actions
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-terminal-red">
                    Are you sure? This will set fleetMode to &quot;paused&quot; and scale ECS to 0 tasks. You can re-enable from this page or via AWS console.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setKillSwitchConfirm(false)}
                      disabled={killSwitchState === 'executing'}
                      className="flex-1 py-1.5 text-[10px] font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleKillSwitch}
                      disabled={killSwitchState === 'executing'}
                      className="flex-1 py-1.5 text-[10px] font-mono font-bold rounded border-2 border-terminal-red bg-terminal-red/20 text-terminal-red hover:bg-terminal-red/30 transition-colors"
                    >
                      {killSwitchState === 'executing' ? 'Executing...' : 'Confirm Kill Switch'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Section>

        {saveFooterEl}

        {/* Connect Flow Modal */}
        {connectTarget && (
          <ConnectFlow
            integration={connectTarget}
            resumeSessionId={resumeSessionId}
            onClose={() => {
              setConnectTarget(null);
              setResumeSessionId(null);
              refreshConnections();
            }}
            onConnected={refreshConnections}
          />
        )}
      </div>
  );
}
