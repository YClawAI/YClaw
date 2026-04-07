'use client';

import { useMemo, useState } from 'react';
import type { AHPost } from '@/lib/agenthub-api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CrossLearnPanelProps {
  insights: AHPost[];
}

/**
 * JSON payload format from propagator.ts:
 * {
 *   sourceChannel: string;
 *   insight: string;
 *   liftPercent: number;
 *   winningVariable: string;
 *   winningValue: string;
 *   timestamp: string;
 * }
 */
interface CrossChannelInsightPayload {
  sourceChannel: string;
  insight: string;
  liftPercent: number;
  winningVariable: string;
  winningValue: string;
  timestamp: string;
}

interface ParsedInsight {
  id: number;
  sourceChannel: string;
  insight: string;
  liftPercent: number;
  winningVariable: string;
  winningValue: string;
  agentId: string;
  createdAt: string;
}

// ─── Insight Parser (F6: parse JSON, not freeform text) ──────────────────────

function parseInsight(post: AHPost): ParsedInsight | null {
  try {
    const payload = JSON.parse(post.content) as CrossChannelInsightPayload;
    if (!payload.sourceChannel || !payload.insight) return null;
    return {
      id: post.id,
      sourceChannel: payload.sourceChannel,
      insight: payload.insight,
      liftPercent: payload.liftPercent ?? 0,
      winningVariable: payload.winningVariable ?? '',
      winningValue: payload.winningValue ?? '',
      agentId: post.agent_id,
      createdAt: post.created_at,
    };
  } catch {
    // Gracefully handle non-JSON posts in #cross-learn
    return null;
  }
}

// ─── Insight Feed View ───────────────────────────────────────────────────────

function InsightFeed({ insights }: { insights: ParsedInsight[] }) {
  if (insights.length === 0) {
    return (
      <div className="text-xs text-terminal-dim text-center py-4">
        No cross-channel insights yet. Insights appear when winning experiments propagate between channels.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {insights.map((insight) => (
        <div key={insight.id} className="bg-terminal-bg border border-terminal-border rounded p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-mono font-bold text-terminal-orange">{insight.sourceChannel}</span>
            {insight.liftPercent > 0 && (
              <span className="text-[10px] font-mono text-terminal-green">+{insight.liftPercent.toFixed(1)}pp</span>
            )}
            <span className="text-[10px] text-terminal-dim ml-auto">{formatRelativeTime(insight.createdAt)}</span>
          </div>
          <div className="text-xs text-terminal-text">{insight.insight}</div>
          {insight.winningVariable && (
            <div className="mt-1.5 text-[10px] text-terminal-dim">
              Variable: <span className="font-mono text-terminal-text">{insight.winningVariable}</span>
              {insight.winningValue && (
                <span className="ml-2 text-terminal-dim/60 truncate">{insight.winningValue.slice(0, 50)}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Propagation Heatmap View ────────────────────────────────────────────────

const CHANNELS = ['cold-email', 'twitter', 'landing-page'];

function PropagationHeatmap({ insights }: { insights: ParsedInsight[] }) {
  const [hoveredCell, setHoveredCell] = useState<{ source: string; target: string } | null>(null);

  // Build heatmap: count insights from each source channel
  // Since the JSON payload doesn't include "adopted by" targets,
  // we show source channel lift aggregated across all their insights
  const sourceLiftMap = useMemo(() => {
    const map = new Map<string, { totalLift: number; count: number; topInsight: string }>();
    for (const insight of insights) {
      const existing = map.get(insight.sourceChannel);
      if (!existing) {
        map.set(insight.sourceChannel, { totalLift: insight.liftPercent, count: 1, topInsight: insight.insight });
      } else {
        existing.totalLift += insight.liftPercent;
        existing.count++;
        if (insight.liftPercent > 0) existing.topInsight = insight.insight;
      }
    }
    return map;
  }, [insights]);

  function liftColor(lift: number | null): string {
    if (lift === null) return 'bg-terminal-muted/10';
    if (lift >= 5) return 'bg-terminal-green/40';
    if (lift >= 2) return 'bg-terminal-green/25';
    if (lift > 0) return 'bg-terminal-green/15';
    return 'bg-terminal-muted/10';
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-[10px] font-mono text-terminal-dim p-2 text-left">Source Channel</th>
            <th className="text-[10px] font-mono text-terminal-dim p-2 text-center">Insights</th>
            <th className="text-[10px] font-mono text-terminal-dim p-2 text-center">Total Lift</th>
            <th className="text-[10px] font-mono text-terminal-dim p-2 text-center">Avg Lift</th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.map((source) => {
            const data = sourceLiftMap.get(source);
            const avgLift = data ? data.totalLift / data.count : 0;

            return (
              <tr key={source}>
                <td className="text-[10px] font-mono text-terminal-text p-2 border-t border-terminal-border">{source}</td>
                <td className="text-[10px] font-mono text-terminal-dim p-2 border-t border-terminal-border text-center">
                  {data?.count ?? 0}
                </td>
                <td className="p-2 border-t border-terminal-border text-center">
                  <span className={`inline-flex items-center justify-center px-2 py-1 rounded ${liftColor(data ? data.totalLift : null)}`}>
                    <span className={`text-[10px] font-mono ${data ? 'text-terminal-text' : 'text-terminal-dim/30'}`}>
                      {data ? `+${data.totalLift.toFixed(1)}pp` : '-'}
                    </span>
                  </span>
                </td>
                <td className="text-[10px] font-mono text-terminal-dim p-2 border-t border-terminal-border text-center">
                  {data ? `+${avgLift.toFixed(1)}pp` : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CrossLearnPanel({ insights: rawInsights }: CrossLearnPanelProps) {
  const [view, setView] = useState<'feed' | 'heatmap'>('feed');

  // F6: Parse JSON payload from propagator.ts, not freeform text
  const insights = useMemo(
    () => rawInsights.map(parseInsight).filter((i): i is ParsedInsight => i !== null),
    [rawInsights],
  );

  if (rawInsights.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 text-center">
        <span className="text-2xl text-terminal-dim/40">&#9671;</span>
        <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim/60">Cross-Channel Learning</div>
        <p className="text-[10px] text-terminal-dim/40 max-w-xs">
          No cross-channel insights yet. When experiment wins propagate between channels, the learning graph appears here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* View toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setView('feed')}
          className={`px-3 py-1.5 text-[10px] font-mono rounded transition-colors ${
            view === 'feed'
              ? 'bg-terminal-muted text-terminal-text'
              : 'text-terminal-dim hover:text-terminal-text'
          }`}
        >
          Insight Feed
        </button>
        <button
          onClick={() => setView('heatmap')}
          className={`px-3 py-1.5 text-[10px] font-mono rounded transition-colors ${
            view === 'heatmap'
              ? 'bg-terminal-muted text-terminal-text'
              : 'text-terminal-dim hover:text-terminal-text'
          }`}
        >
          Source Summary
        </button>
      </div>

      {/* Content */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        {view === 'feed' ? (
          <InsightFeed insights={insights} />
        ) : (
          <PropagationHeatmap insights={insights} />
        )}
      </div>
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
