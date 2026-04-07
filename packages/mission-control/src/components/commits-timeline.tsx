'use client';

import { useState } from 'react';

// ─── Local Types ──────────────────────────────────────────────────────────────

export interface CommitEntry {
  sha: string;
  message: string;
  author?: string;
  repo?: string;
  branch?: string;
  prNumber?: number;
  ciStatus?: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ciStatusDot(status?: string): string {
  if (status === 'passing') return 'bg-terminal-green';
  if (status === 'failing') return 'bg-terminal-red';
  if (status === 'running') return 'bg-terminal-blue animate-pulse';
  return 'bg-terminal-dim';
}

function authorHighlight(author?: string): string {
  if (author === 'builder') return 'text-terminal-blue';
  if (author === 'architect') return 'text-terminal-cyan';
  if (author === 'designer') return 'text-terminal-purple';
  if (author === 'deployer') return 'text-terminal-orange';
  return 'text-terminal-dim';
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffM = Math.floor(diffMs / (1000 * 60));

  if (diffM < 60) return `${diffM}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface CommitsTimelineProps {
  commits: CommitEntry[];
  pageSize?: number;
}

export function CommitsTimeline({ commits, pageSize = 10 }: CommitsTimelineProps) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const visible = commits.slice(0, visibleCount);
  const hasMore = visibleCount < commits.length;

  if (commits.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded p-4 flex items-center justify-center py-8">
        <span className="text-xs text-terminal-dim">No recent commits</span>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Recent Commits</h3>
        <span className="text-[10px] font-mono text-terminal-dim">{commits.length} total</span>
      </div>

      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[23px] top-0 bottom-0 w-px bg-terminal-border" />

        <div className="divide-y divide-terminal-border/30">
          {visible.map(commit => (
            <div key={commit.sha} className="px-4 py-3 flex items-start gap-3 relative">
              {/* Timeline dot */}
              <div className="relative z-10 mt-1">
                <div className={`w-2.5 h-2.5 rounded-full border-2 border-terminal-surface ${authorHighlight(commit.author).replace('text-', 'bg-')}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-terminal-dim">{commit.sha.slice(0, 7)}</span>
                  {commit.ciStatus ? (
                    <span className={`w-1.5 h-1.5 rounded-full ${ciStatusDot(commit.ciStatus)}`} title={`CI: ${commit.ciStatus}`} />
                  ) : (
                    <span className="text-[9px] font-mono text-terminal-dim/50">CI: N/A</span>
                  )}
                  {commit.repo && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-terminal-muted/50 text-terminal-dim">
                      {commit.repo}
                    </span>
                  )}
                  {commit.branch && commit.branch !== 'master' && commit.branch !== 'main' && (
                    <span className="text-[10px] font-mono text-terminal-blue/60 truncate max-w-[140px]" title={commit.branch}>
                      {commit.branch}
                    </span>
                  )}
                  {commit.prNumber && (
                    <span className="text-[10px] font-mono text-terminal-blue">
                      #{commit.prNumber}
                    </span>
                  )}
                </div>

                <div className="text-xs text-terminal-text mt-1 truncate" title={commit.message}>
                  {commit.message}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  {commit.author && (
                    <span className={`text-[10px] ${authorHighlight(commit.author)}`}>
                      {commit.author}
                    </span>
                  )}
                  <span className="text-[10px] text-terminal-dim">{formatTimestamp(commit.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="px-4 py-3 border-t border-terminal-border text-center">
          <button
            onClick={() => setVisibleCount(c => c + pageSize)}
            className="px-3 py-1.5 text-xs font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface transition-colors"
          >
            Load more ({commits.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
