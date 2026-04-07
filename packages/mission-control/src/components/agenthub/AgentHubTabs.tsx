'use client';

import { useState, useMemo } from 'react';
import type { AHCommit, AHPost } from '@/lib/agenthub-api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentHubTabsProps {
  agentId: string;
  commits: AHCommit[];
  posts: AHPost[];
}

// ─── Commits Tab ─────────────────────────────────────────────────────────────

function CommitsTab({ commits }: { commits: AHCommit[] }) {
  if (commits.length === 0) {
    return (
      <div className="text-xs text-terminal-dim text-center py-4">
        No AgentHub commits from this agent
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {commits.slice(0, 20).map((c) => (
        <div key={c.hash} className="bg-terminal-bg border border-terminal-border rounded p-2.5 hover:border-terminal-muted transition-colors">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-terminal-blue">{c.hash.slice(0, 8)}</span>
            <span className="text-[10px] text-terminal-dim">{formatRelativeTime(c.created_at)}</span>
          </div>
          <div className="text-xs text-terminal-text mt-0.5 truncate">{c.message.split('\n')[0]}</div>
          {c.parent_hash && (
            <div className="text-[10px] text-terminal-dim/60 mt-0.5">
              parent: {c.parent_hash.slice(0, 8)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Threads Tab ─────────────────────────────────────────────────────────────

function ThreadsTab({ posts }: { posts: AHPost[] }) {
  // F1: useMemo MUST be called before any early return (Rules of Hooks)
  const byChannel = useMemo(() => {
    const map = new Map<number, AHPost[]>();
    for (const p of posts) {
      const existing = map.get(p.channel_id) ?? [];
      existing.push(p);
      map.set(p.channel_id, existing);
    }
    return map;
  }, [posts]);

  if (posts.length === 0) {
    return (
      <div className="text-xs text-terminal-dim text-center py-4">
        No AgentHub posts from this agent
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from(byChannel.entries()).map(([channelId, channelPosts]) => (
        <div key={channelId}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-1.5">
            channel #{channelId} ({channelPosts.length})
          </div>
          <div className="space-y-1">
            {channelPosts.slice(0, 10).map((p) => (
              <div key={p.id} className="bg-terminal-bg border border-terminal-border rounded p-2.5">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs text-terminal-text truncate flex-1">
                    {p.content.split('\n')[0]?.slice(0, 60) || 'Empty post'}
                  </span>
                  <span className="text-[10px] text-terminal-dim shrink-0">{formatRelativeTime(p.created_at)}</span>
                </div>
                {p.parent_id !== null && (
                  <span className="text-[10px] text-terminal-dim/60">reply</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AgentHubTabs({ agentId, commits, posts }: AgentHubTabsProps) {
  const [activeTab, setActiveTab] = useState<'commits' | 'threads'>('commits');

  const agentCommits = useMemo(
    () => commits.filter(c => c.agent_id === agentId),
    [commits, agentId],
  );

  const agentPosts = useMemo(
    () => posts.filter(p => p.agent_id === agentId),
    [posts, agentId],
  );

  // Don't render if no data for this agent
  if (agentCommits.length === 0 && agentPosts.length === 0) {
    return null;
  }

  const tabs = [
    { key: 'commits' as const, label: `Commits (${agentCommits.length})` },
    { key: 'threads' as const, label: `Threads (${agentPosts.length})` },
  ];

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded overflow-hidden">
      <div className="px-4 py-2.5 border-b border-terminal-border">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim">AgentHub Activity</h3>
      </div>

      {/* Tab buttons */}
      <div className="flex border-b border-terminal-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-[10px] font-mono border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'text-terminal-text border-terminal-purple'
                : 'text-terminal-dim border-transparent hover:text-terminal-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-3 max-h-64 overflow-y-auto">
        {activeTab === 'commits' ? (
          <CommitsTab commits={agentCommits} />
        ) : (
          <ThreadsTab posts={agentPosts} />
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
