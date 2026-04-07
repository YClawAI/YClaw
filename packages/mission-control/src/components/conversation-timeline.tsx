'use client';

import { useEffect } from 'react';

export interface TimelineMessage {
  id: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  modAction?: string;
}

export interface TimelineCase {
  id: string;
  status: string;
  sentiment?: string;
  subject?: string;
  userId?: string;
  channel?: string;
  assignedTo?: string;
}

interface ConversationTimelineProps {
  supportCase: TimelineCase;
  messages: TimelineMessage[];
  onClose: () => void;
}

const SENDER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  user: { bg: 'bg-terminal-muted/50', text: 'text-terminal-dim', label: 'User' },
  keeper: { bg: 'bg-terminal-yellow/10', text: 'text-terminal-yellow', label: 'Keeper' },
  guide: { bg: 'bg-terminal-blue/10', text: 'text-terminal-blue', label: 'Guide' },
};

const SENTIMENT_BADGE: Record<string, { text: string; bg: string }> = {
  neutral: { text: 'text-terminal-dim', bg: 'bg-terminal-dim/20' },
  confused: { text: 'text-terminal-yellow', bg: 'bg-terminal-yellow/10' },
  angry: { text: 'text-terminal-orange', bg: 'bg-terminal-orange/10' },
  urgent: { text: 'text-terminal-red', bg: 'bg-terminal-red/10' },
};

export function ConversationTimeline({ supportCase, messages, onClose }: ConversationTimelineProps) {
  const sentiment = supportCase.sentiment ?? 'neutral';
  const sentimentStyle = SENTIMENT_BADGE[sentiment] ?? SENTIMENT_BADGE.neutral;

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const formatTime = (timestamp: string) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatDate = (timestamp: string) => {
    const d = new Date(timestamp);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />

      {/* Side panel */}
      <div role="dialog" aria-modal="true" aria-label={`Case ${supportCase.id}`} className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-terminal-surface border-l border-terminal-border shadow-2xl flex flex-col max-sm:max-w-full">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-terminal-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-terminal-text font-mono">
                {supportCase.id.toUpperCase()}
              </span>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${sentimentStyle.bg} ${sentimentStyle.text}`}>
                {sentiment.toUpperCase()}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-terminal-dim hover:text-terminal-text transition-colors text-lg leading-none"
            >
              &times;
            </button>
          </div>

          {supportCase.subject && (
            <div className="text-sm text-terminal-text mb-2">{supportCase.subject}</div>
          )}

          <div className="flex items-center gap-3 text-[10px] text-terminal-dim font-mono">
            {supportCase.userId && <span>{supportCase.userId}</span>}
            {supportCase.channel && (
              <span className="px-1.5 py-0.5 rounded border border-terminal-border uppercase">
                {supportCase.channel}
              </span>
            )}
            {supportCase.assignedTo && <span>{supportCase.assignedTo}</span>}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 ? (
            <div className="text-xs text-terminal-dim text-center py-8">
              No messages in transcript
            </div>
          ) : (
            messages.map((msg) => {
              const style = SENDER_STYLES[msg.sender] ?? SENDER_STYLES.user;

              return (
                <div key={msg.id} className={`rounded p-3 ${style.bg}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold font-mono ${style.text}`}>
                        {msg.senderName}
                      </span>
                      {msg.modAction && (
                        <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-terminal-green/10 text-terminal-green border border-terminal-green/30">
                          {msg.modAction.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-terminal-dim font-mono">
                      {formatDate(msg.timestamp)} {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-terminal-text leading-relaxed">
                    {msg.content}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Action bar */}
        <div className="shrink-0 border-t border-terminal-border px-4 py-3 flex gap-2">
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1.5 text-xs font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface transition-colors"
          >
            CLOSE
          </button>
        </div>
      </div>
    </>
  );
}
