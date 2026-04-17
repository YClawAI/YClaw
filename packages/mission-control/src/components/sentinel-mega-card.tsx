'use client';

import { SystemBadge } from './system-badge';
import type { AgentInfo } from '@/lib/agents';

interface SentinelMegaCardProps {
  agent: AgentInfo;
  status?: string;
  lastRunAt?: string;
  runCount24h?: number;
  errorCount24h?: number;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const STATUS_STYLES: Record<string, { dot: string; label: string; color: string }> = {
  idle: {
    dot: 'bg-mc-success shadow-[0_0_8px_#30D158] animate-pulse',
    label: 'IDLE',
    color: 'text-mc-success',
  },
  active: {
    dot: 'bg-mc-accent shadow-[0_0_8px_#5AC8FA] animate-pulse',
    label: 'ACTIVE',
    color: 'text-mc-accent',
  },
  error: {
    dot: 'bg-mc-danger shadow-[0_0_8px_#FF453A] animate-pulse',
    label: 'ERROR',
    color: 'text-mc-danger',
  },
  unknown: {
    dot: 'bg-mc-text-tertiary',
    label: 'UNKNOWN',
    color: 'text-mc-text-tertiary',
  },
};

export function SentinelMegaCard({ agent, status, lastRunAt, runCount24h, errorCount24h }: SentinelMegaCardProps) {
  const st = STATUS_STYLES[status ?? 'unknown'] ?? STATUS_STYLES.unknown;

  return (
    <div className="bg-mc-surface-hover border border-mc-border border-l-2 border-l-mc-success rounded p-5">
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
        {/* Left side -- agent identity */}
        <div className="flex-shrink-0 lg:w-64">
          <div className="flex items-center gap-3 mb-3">
            {agent.emoji && <span className="text-2xl">{agent.emoji}</span>}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-mc-text">{agent.label}</span>
                <SystemBadge system={agent.system} />
              </div>
              {agent.role && (
                <span className="text-[10px] font-mono text-mc-success uppercase tracking-widest">
                  {agent.role}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-mc-text-tertiary mb-3">{agent.description}</p>
          {agent.model && (
            <div className="text-[10px] text-mc-text-tertiary font-mono">
              model: {agent.model}
            </div>
          )}
          <div className="text-[10px] text-mc-text-tertiary font-mono">
            system: {agent.system}
          </div>
        </div>

        {/* Right side -- stats grid */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {/* Status */}
          <div className="bg-mc-bg/50 border border-mc-border rounded p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
              Status
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-block w-3 h-3 rounded-full ${st.dot}`} />
              <span className={`text-sm font-bold font-mono ${st.color}`}>
                {st.label}
              </span>
            </div>
          </div>

          {/* Last Run */}
          <div className="bg-mc-bg/50 border border-mc-border rounded p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
              Last Run
            </div>
            <div className="text-sm font-bold font-mono text-mc-text">
              {lastRunAt ? formatRelativeTime(lastRunAt) : '--'}
            </div>
          </div>

          {/* Runs (24h) */}
          <div className="bg-mc-bg/50 border border-mc-border rounded p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
              Runs (24h)
            </div>
            <div className="text-sm font-bold font-mono text-mc-text">
              {runCount24h ?? 0}
            </div>
          </div>

          {/* Errors (24h) */}
          <div className="bg-mc-bg/50 border border-mc-border rounded p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
              Errors (24h)
            </div>
            <div className={`text-sm font-bold font-mono ${(errorCount24h ?? 0) > 0 ? 'text-mc-danger' : 'text-mc-success'}`}>
              {errorCount24h ?? 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
