'use client';

import { useMemo } from 'react';
import type { AHCommit } from '@/lib/agenthub-api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityWidgetProps {
  /** Recent commits — activity is derived from these. */
  commits: AHCommit[];
}

interface ActivityRow {
  agentId: string;
  commits24h: number;
  lastActivityAt: string;
  isIdle: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  if (!iso) return '--';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '--';
  const diff = Date.now() - ts;
  if (diff < 0 || diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function deriveRows(commits: AHCommit[]): ActivityRow[] {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const agentMap = new Map<string, { commits24h: number; lastActivityAt: number }>();

  for (const c of commits) {
    const ts = new Date(c.created_at).getTime();
    if (Number.isNaN(ts)) continue;

    const existing = agentMap.get(c.agent_id);
    const isRecent = (now - ts) < oneDayMs;

    if (!existing) {
      agentMap.set(c.agent_id, {
        commits24h: isRecent ? 1 : 0,
        lastActivityAt: ts,
      });
    } else {
      if (isRecent) existing.commits24h++;
      if (ts > existing.lastActivityAt) existing.lastActivityAt = ts;
    }
  }

  const rows: ActivityRow[] = [];
  for (const [agentId, data] of agentMap) {
    rows.push({
      agentId,
      commits24h: data.commits24h,
      lastActivityAt: new Date(data.lastActivityAt).toISOString(),
      isIdle: (now - data.lastActivityAt) > twoHoursMs,
    });
  }

  // Sort: active first, then by most recent activity
  rows.sort((a, b) => {
    if (a.isIdle !== b.isIdle) return a.isIdle ? 1 : -1;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });

  return rows;
}

// ─── Bar Component ────────────────────────────────────────────────────────────────────

function ActivityBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-24 h-2 bg-mc-border/30 rounded-sm overflow-hidden">
      <div className={`h-full rounded-sm ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────────

export function ActivityWidget({ commits }: ActivityWidgetProps) {
  const rows = useMemo(() => deriveRows(commits), [commits]);

  if (rows.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded p-4 flex flex-col items-center justify-center gap-2 text-center">
        <span className="text-2xl text-mc-text-tertiary/40">&#9671;</span>
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">AgentHub Activity</div>
        <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
          No AgentHub activity data available. Activity will populate when agents begin pushing to AgentHub.
        </p>
      </div>
    );
  }

  const maxCommits = Math.max(...rows.map(r => r.commits24h), 1);

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded">
      <div className="px-4 py-3 border-b border-mc-border">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">
          AgentHub Activity (24h)
        </h3>
      </div>
      <div className="divide-y divide-mc-border">
        {rows.map((row) => (
          <div
            key={row.agentId}
            className={`px-4 py-2 flex items-center gap-3 ${row.isIdle ? 'opacity-40' : ''}`}
          >
            <span className="text-xs font-mono text-mc-text w-24 truncate">{row.agentId}</span>
            <div className="flex items-center gap-1.5 flex-1">
              <ActivityBar value={row.commits24h} max={maxCommits} color="bg-mc-info" />
              <span className="text-[10px] font-mono text-mc-text-tertiary w-6 text-right">{row.commits24h}</span>
            </div>
            <span className="text-[10px] font-mono text-mc-text-tertiary w-8 text-right">
              {formatRelativeTime(row.lastActivityAt)}
            </span>
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="px-4 py-2 border-t border-mc-border flex items-center gap-4 text-[10px] text-mc-text-tertiary">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-mc-info" />
          commits
        </span>
        <span className="ml-auto">ago</span>
      </div>
    </div>
  );
}
