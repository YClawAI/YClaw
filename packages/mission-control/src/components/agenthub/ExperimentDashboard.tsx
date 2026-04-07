'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { AHPost } from '@/lib/agenthub-api';
import type { GrowthRuntimeStatus } from '@/lib/runtime-controls';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChannelLane {
  name: string;
  status: 'running' | 'scoring' | 'paused' | 'idle';
  currentChampion: {
    score: number;
    version: string;
    lastUpdated: string;
  };
  stats: {
    totalExperiments: number;
    wins: number;
    winRate: number;
    avgLift: number;
    daysRunning: number;
  };
}

interface ParsedResult {
  channel: string;
  version: string;
  variable: string;
  description: string;
  score: number;
  lift: number;
  isWinner: boolean;
  deployId: string;
  scoredAt: string;
}

interface ExperimentDashboardProps {
  /** Posts from the experiment-results channel */
  resultPosts: AHPost[];
  growthStatus?: GrowthRuntimeStatus;
}

// ─── Parse experiment-results posts ──────────────────────────────────────────
// Format from scorer.ts:
//   +++ cold-email/v1.2.5
//   Variable: subject_tone
//   Description: Changed from formal to friendly
//   Score: 0.0234 (+2.3 pp vs champion)
//   Decision: WINNER
//   Deploy: deploy_xyz123
//   Scored: 2026-03-13T15:00:00.000Z

function parseResultPost(post: AHPost): ParsedResult | null {
  const lines = post.content.split('\n');
  const header = lines[0];
  if (!header) return null;

  // Parse "+++ cold-email/v1.2.5" or "--- cold-email/v1.2.5"
  const headerMatch = header.match(/^[+\-]{3}\s+(\S+)\/v(\S+)/);
  if (!headerMatch) return null;

  const channel = headerMatch[1]!;
  const version = `v${headerMatch[2]}`;

  let variable = '';
  let description = '';
  let score = 0;
  let lift = 0;
  let isWinner = false;
  let deployId = '';
  let scoredAt = post.created_at;

  for (const line of lines.slice(1)) {
    const kv = line.match(/^(\w+):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    switch (key) {
      case 'Variable': variable = val!; break;
      case 'Description': description = val!; break;
      case 'Score': {
        const scoreMatch = val!.match(/([\d.]+)/);
        if (scoreMatch) score = parseFloat(scoreMatch[1]!);
        const liftMatch = val!.match(/([+\-][\d.]+)\s*pp/);
        if (liftMatch) lift = parseFloat(liftMatch[1]!);
        break;
      }
      case 'Decision': isWinner = val!.trim() === 'WINNER'; break;
      case 'Deploy': deployId = val!.trim(); break;
      case 'Scored': scoredAt = val!.trim(); break;
    }
  }

  return { channel, version, variable, description, score, lift, isWinner, deployId, scoredAt };
}

// ─── Derive channel lanes from parsed results ───────────────────────────────

function deriveChannelLanes(
  results: ParsedResult[],
  growthStatus?: GrowthRuntimeStatus,
): ChannelLane[] {
  const byChannel = new Map<string, ParsedResult[]>();
  for (const r of results) {
    const existing = byChannel.get(r.channel) ?? [];
    existing.push(r);
    byChannel.set(r.channel, existing);
  }
  const runtimeByChannel = new Map(
    (growthStatus?.channels ?? []).map((channel) => [channel.channelName, channel]),
  );
  for (const channelName of runtimeByChannel.keys()) {
    if (!byChannel.has(channelName)) {
      byChannel.set(channelName, []);
    }
  }

  const lanes: ChannelLane[] = [];

  for (const [channel, channelResults] of byChannel) {
    // Sort by scoredAt descending
    channelResults.sort((a, b) => new Date(b.scoredAt).getTime() - new Date(a.scoredAt).getTime());

    const wins = channelResults.filter(r => r.isWinner);
    const latestWinner = wins[0];
    const totalExperiments = channelResults.length;
    const winCount = wins.length;
    const winRate = totalExperiments > 0 ? (winCount / totalExperiments) * 100 : 0;
    const avgLift = winCount > 0
      ? wins.reduce((s, r) => s + r.lift, 0) / winCount
      : 0;

    const earliest = channelResults[channelResults.length - 1];
    const daysRunning = earliest
      ? Math.max(1, Math.ceil((Date.now() - new Date(earliest.scoredAt).getTime()) / 86400000))
      : 0;

    const champion = latestWinner ?? channelResults[0];

    const runtime = runtimeByChannel.get(channel);

    lanes.push({
      name: channel,
      status: runtime ? (runtime.running ? 'running' : 'paused') : 'idle',
      currentChampion: {
        score: champion ? champion.score * 100 : 0,
        version: runtime?.championVersion ?? champion?.version ?? 'v1.0',
        lastUpdated: champion?.scoredAt ?? '',
      },
      stats: {
        totalExperiments: runtime ? Math.max(totalExperiments, runtime.experimentsRun) : totalExperiments,
        wins: winCount,
        winRate,
        avgLift,
        daysRunning,
      },
    });
  }

  // Sort by most experiments first
  lanes.sort((a, b) => b.stats.totalExperiments - a.stats.totalExperiments);
  return lanes;
}

// ─── Status Colors ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ChannelLane['status'], { dot: string; text: string; label: string }> = {
  running: { dot: 'bg-terminal-green animate-pulse', text: 'text-terminal-green', label: 'RUNNING' },
  scoring: { dot: 'bg-terminal-yellow', text: 'text-terminal-yellow', label: 'SCORING' },
  paused: { dot: 'bg-terminal-orange', text: 'text-terminal-orange', label: 'PAUSED' },
  idle: { dot: 'bg-terminal-dim', text: 'text-terminal-dim', label: 'IDLE' },
};

// ─── Channel Lane Card ───────────────────────────────────────────────────────

function ChannelLaneCard({ lane, expanded, onToggle }: { lane: ChannelLane; expanded: boolean; onToggle: () => void }) {
  const style = STATUS_STYLES[lane.status];

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-terminal-muted/10 transition-colors text-left"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
        <span className="text-xs font-mono font-bold text-terminal-text flex-1">{lane.name}</span>
        <span className={`text-[10px] font-mono font-bold ${style.text}`}>{style.label}</span>
        <span className="text-[10px] font-mono text-terminal-dim ml-2">
          Champion: {lane.currentChampion.version}
        </span>
        <span className="text-[8px] text-terminal-dim">{expanded ? 'v' : '>'}</span>
      </button>

      {/* Stats strip */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-4 text-[10px] font-mono text-terminal-dim">
          <span>Score: <span className="text-terminal-text">{lane.currentChampion.score.toFixed(1)}%</span></span>
          <span>Win rate: <span className="text-terminal-text">{lane.stats.winRate > 0 ? `${lane.stats.winRate.toFixed(0)}%` : '--'}</span>
            {lane.stats.wins > 0 && <span className="text-terminal-dim/60"> ({lane.stats.wins}/{lane.stats.totalExperiments})</span>}
          </span>
          <span className="ml-auto">{lane.stats.daysRunning}d running</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-terminal-border pt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-1.5">Stats</div>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Total" value={String(lane.stats.totalExperiments)} />
            <Stat label="Wins" value={String(lane.stats.wins)} />
            <Stat label="Win Rate" value={lane.stats.winRate > 0 ? `${lane.stats.winRate.toFixed(0)}%` : '--'} />
            <Stat label="Avg Lift" value={lane.stats.avgLift > 0 ? `+${lane.stats.avgLift.toFixed(1)}pp` : '--'} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-terminal-bg border border-terminal-border rounded p-2 text-center">
      <div className="text-sm font-bold font-mono text-terminal-text">{value}</div>
      <div className="text-[10px] text-terminal-dim">{label}</div>
    </div>
  );
}

// ─── Aggregate Stats Bar ─────────────────────────────────────────────────────

function AggregateStats({ channels }: { channels: ChannelLane[] }) {
  const totals = useMemo(() => {
    let totalExperiments = 0;
    let totalWins = 0;
    let liftSum = 0;
    let liftCount = 0;

    for (const ch of channels) {
      totalExperiments += ch.stats.totalExperiments;
      totalWins += ch.stats.wins;
      if (ch.stats.avgLift > 0) {
        liftSum += ch.stats.avgLift;
        liftCount++;
      }
    }

    return {
      totalExperiments,
      totalWins,
      winRate: totalExperiments > 0 ? (totalWins / totalExperiments) * 100 : 0,
      avgLift: liftCount > 0 ? liftSum / liftCount : 0,
      activeChannels: channels.length,
    };
  }, [channels]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard label="Total Experiments" value={String(totals.totalExperiments)} />
      <StatCard label="Winners" value={String(totals.totalWins)} />
      <StatCard label="Win Rate" value={totals.winRate > 0 ? `${totals.winRate.toFixed(0)}%` : '--'} />
      <StatCard label="Avg Lift" value={totals.avgLift > 0 ? `+${totals.avgLift.toFixed(1)}pp` : '--'} />
      <StatCard label="Channels" value={String(totals.activeChannels)} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-3 text-center hover:border-terminal-muted transition-colors">
      <div className="text-xl font-bold font-mono text-terminal-text">{value}</div>
      <div className="text-[10px] text-terminal-dim mt-0.5">{label}</div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ExperimentDashboard({ resultPosts, growthStatus }: ExperimentDashboardProps) {
  const [expandedLane, setExpandedLane] = useState<string | null>(null);

  const toggleLane = useCallback((name: string) => {
    setExpandedLane(prev => prev === name ? null : name);
  }, []);

  // F4+F5: Derive channel lanes from experiment-results posts
  const channels = useMemo(() => {
    const parsed = resultPosts
      .map(parseResultPost)
      .filter((r): r is ParsedResult => r !== null);
    return deriveChannelLanes(parsed, growthStatus);
  }, [resultPosts, growthStatus]);

  if (channels.length === 0 && resultPosts.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 text-center">
        <span className="text-2xl text-terminal-dim/40">&#9671;</span>
        <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim/60">Experiment Dashboard</div>
        <p className="text-[10px] text-terminal-dim/40 max-w-xs">
          No experiment data available. Marketing experiment channels will appear here once the growth engine is active.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Aggregate Stats */}
      <AggregateStats channels={channels} />

      {/* Channel Lanes */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">Channel Lanes</h3>
        <div className="space-y-2">
          {channels.map((lane) => (
            <ChannelLaneCard
              key={lane.name}
              lane={lane}
              expanded={expandedLane === lane.name}
              onToggle={() => toggleLane(lane.name)}
            />
          ))}
        </div>
      </div>

      {/* Raw result feed */}
      {resultPosts.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">Recent Results</h3>
          <div className="space-y-1">
            {resultPosts.slice(0, 10).map((post) => (
              <div key={post.id} className="flex items-center gap-3 px-3 py-2 bg-terminal-surface border border-terminal-border rounded text-[10px]">
                <span className="font-mono text-terminal-dim w-16 shrink-0">{post.agent_id}</span>
                <span className="text-terminal-text flex-1 truncate font-mono">{post.content.split('\n')[0]?.slice(0, 80)}</span>
                <span className="text-terminal-dim shrink-0">{formatRelativeTime(post.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '--';
  const diff = Date.now() - ts;
  if (diff < 0 || diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
