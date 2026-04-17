'use client';

import { useState } from 'react';

// ─── Local Types ───────────────────────────────────────────────────────────────────────

export interface ScheduleEntry {
  agent: string;
  type: 'cron' | 'event';
  schedule: string;
  humanReadable?: string;
  lastRun?: string;
  nextRun?: string;
  status?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────

function statusDotClass(status?: string): string {
  if (status === 'healthy') return 'bg-mc-success';
  if (status === 'warning') return 'bg-mc-warning';
  if (status === 'error') return 'bg-mc-danger';
  return 'bg-mc-text-tertiary';
}

function typeBadge(type: ScheduleEntry['type']): { label: string; className: string } {
  // Pre-flip used purple for CRON + cyan for EVENT; mechanical flip collapsed
  // both to mc-accent. Route CRON to mc-dept-finance to preserve the distinction.
  if (type === 'cron') return { label: 'CRON', className: 'bg-mc-dept-finance/10 text-mc-dept-finance border-mc-dept-finance/30' };
  return { label: 'EVENT', className: 'bg-mc-accent/10 text-mc-accent border-mc-accent/30' };
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

// ─── Chevron Icon ────────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────────────

interface SchedulesPanelProps {
  schedules: ScheduleEntry[];
  title?: string;
  defaultOpen?: boolean;
}

export function SchedulesPanel({ schedules, title = 'Schedules & Triggers', defaultOpen = false }: SchedulesPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (schedules.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 text-center">
        <span className="text-2xl text-mc-text-tertiary/40">◇</span>
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">
          No schedules
        </div>
        <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
          No recurring triggers configured. Configured schedules appear here with status indicators.
        </p>
      </div>
    );
  }

  const healthyCt = schedules.filter(s => s.status === 'healthy').length;
  const warningCt = schedules.filter(s => s.status === 'warning').length;
  const errorCt = schedules.filter(s => s.status === 'error').length;

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-mc-border/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronIcon open={open} />
          <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">{title}</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          {healthyCt > 0 && <span className="text-mc-success">{healthyCt} healthy</span>}
          {warningCt > 0 && <span className="text-mc-warning">{warningCt} warn</span>}
          {errorCt > 0 && <span className="text-mc-danger">{errorCt} error</span>}
          <span className="text-mc-text-tertiary">{schedules.length} total</span>
        </div>
      </button>

      {/* Table */}
      {open && (
        <div className="border-t border-mc-border overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-mc-bg/50">
              <tr className="border-b border-mc-border">
                {['Agent', 'Type', 'Schedule', 'Description', 'Last Run', 'Next Run', 'Status'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] text-mc-text-tertiary font-normal uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map((entry, idx) => {
                const badge = typeBadge(entry.type);
                return (
                  <tr
                    key={`${entry.agent}-${entry.schedule}-${idx}`}
                    className="border-b border-mc-border/30 hover:bg-mc-border/10"
                  >
                    <td className="px-3 py-2 text-mc-text">{entry.agent}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-mc-text-tertiary">{entry.schedule}</td>
                    <td className="px-3 py-2 text-mc-text">{entry.humanReadable ?? '--'}</td>
                    <td className="px-3 py-2 text-mc-text-tertiary">
                      {entry.lastRun ? formatTime(entry.lastRun) : '--'}
                    </td>
                    <td className="px-3 py-2 text-mc-text-tertiary">
                      {entry.nextRun ? formatTime(entry.nextRun) : '--'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${statusDotClass(entry.status)}`} title={entry.status ?? 'unknown'} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
