'use client';

import type { AgentRealtimeStatus } from './hive-types';

const STATE_INDICATORS: Record<string, { emoji: string; color: string }> = {
  idle: { emoji: '\u{1F4A4}', color: 'text-gray-400' },
  running: { emoji: '\u{1F7E2}', color: 'text-green-400' },
  error: { emoji: '\u{1F534}', color: 'text-red-400' },
  paused: { emoji: '\u23F8\uFE0F', color: 'text-yellow-400' },
};

interface MobileAgentCardProps {
  agentName: string;
  status?: AgentRealtimeStatus;
  onTap: () => void;
}

export function MobileAgentCard({ agentName, status, onTap }: MobileAgentCardProps) {
  const state = status?.state || 'idle';
  const indicator = STATE_INDICATORS[state] || STATE_INDICATORS['idle']!;
  const execCount = status?.execCount5m || 0;

  const lastRunLabel = status?.lastRunAt
    ? formatTimeAgo(status.lastRunAt)
    : 'never';

  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-gray-900/60 hover:bg-gray-800/60 active:bg-gray-700/60 transition-colors text-left"
    >
      <span className="text-lg">{indicator.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-100 capitalize">
            {agentName}
          </span>
          {execCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
              {execCount}
            </span>
          )}
        </div>
        <div className={`text-xs ${indicator.color} truncate`}>
          {state === 'running' && status?.execCount5m
            ? `Active \u2014 ${execCount} executions (5m)`
            : state === 'error'
            ? `Error \u2014 last run ${lastRunLabel}`
            : state === 'paused'
            ? 'Paused'
            : `Idle \u2014 last run ${lastRunLabel}`}
        </div>
      </div>
      <span className="text-gray-600 text-sm">\u203A</span>
    </button>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
