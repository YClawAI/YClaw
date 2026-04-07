'use client';

import { useState, useRef, useEffect } from 'react';

export interface ModerationEntry {
  id: string;
  agentId: string;
  action?: string;
  timestamp: string;
  content?: string;
  userId?: string;
}

interface ModerationFeedProps {
  entries: ModerationEntry[];
}

const ACTION_STYLES: Record<string, { border: string; textClass: string; label: string }> = {
  reply: { border: 'border-l-2 border-terminal-green', textClass: '', label: 'REPLY' },
  delete: { border: 'border-l-2 border-terminal-red', textClass: 'line-through text-terminal-red/60', label: 'DELETED' },
  ban: { border: 'border-l-2 border-terminal-red', textClass: '', label: 'BANNED' },
  restrict: { border: 'border-l-2 border-terminal-orange', textClass: '', label: 'RESTRICTED' },
  pin: { border: 'border-l-2 border-terminal-blue', textClass: '', label: 'PINNED' },
  unknown: { border: 'border-l-2 border-terminal-dim', textClass: '', label: 'UNKNOWN' },
};

function ActionBadge({ type }: { type: string }) {
  const style = ACTION_STYLES[type];
  if (!style) return null;

  const colorClass =
    type === 'reply' ? 'text-terminal-green bg-terminal-green/10 border-terminal-green/30' :
    type === 'delete' ? 'text-terminal-red bg-terminal-red/10 border-terminal-red/30' :
    type === 'ban' ? 'text-terminal-red bg-terminal-red/10 border-terminal-red/30' :
    type === 'restrict' ? 'text-terminal-orange bg-terminal-orange/10 border-terminal-orange/30' :
    type === 'pin' ? 'text-terminal-blue bg-terminal-blue/10 border-terminal-blue/30' :
    type === 'unknown' ? 'text-terminal-dim bg-terminal-dim/10 border-terminal-dim/30' : '';

  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${colorClass}`}>
      {style.label}
    </span>
  );
}

export function ModerationFeed({ entries }: ModerationFeedProps) {
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!paused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, paused]);

  const formatTime = (timestamp: string) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  if (entries.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-terminal-dim">No moderation activity</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
              Live Feed
            </h3>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${paused ? 'bg-terminal-yellow' : 'bg-terminal-green animate-pulse'}`} />
          </div>
          <button
            onClick={() => setPaused(!paused)}
            className="px-3 py-1 text-[10px] font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-muted transition-colors"
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
        </div>
        <span className="text-[10px] text-terminal-dim font-mono mt-1 block">
          Actions estimated from task names and output keywords
        </span>
      </div>

      {/* Entries */}
      <div
        ref={containerRef}
        className="max-h-[480px] overflow-y-auto font-mono text-xs"
      >
        {entries.map((entry) => {
          const actionStyle = entry.action ? ACTION_STYLES[entry.action] : undefined;
          const bgClass =
            entry.action === 'ban' ? 'bg-terminal-red/5' :
            entry.action === 'restrict' ? 'bg-terminal-orange/5' :
            entry.action === 'pin' ? 'bg-terminal-blue/5' : '';

          return (
            <div
              key={entry.id}
              className={`px-4 py-2 border-b border-terminal-border/50 ${actionStyle?.border ?? ''} ${bgClass}`}
            >
              <div className="flex items-start gap-2">
                <span className="text-[10px] text-terminal-dim shrink-0 w-16 pt-0.5">
                  {formatTime(entry.timestamp)}
                </span>
                <div className="flex-1 min-w-0">
                  {entry.userId && (
                    <span className="text-terminal-yellow/80 mr-1">{entry.userId}:</span>
                  )}
                  <span className={`text-terminal-text/80 ${actionStyle?.textClass ?? ''}`}>
                    {entry.content ?? ''}
                  </span>
                  {entry.action && (
                    <div className="mt-1">
                      <ActionBadge type={entry.action} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-terminal-border">
        <span className="text-[10px] text-terminal-dim font-mono">
          {entries.length} entries / {entries.filter((e) => e.action).length} actions
        </span>
      </div>
    </div>
  );
}
