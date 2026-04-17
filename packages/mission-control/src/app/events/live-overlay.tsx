'use client';

import { useYClawEventStream } from '@/lib/hooks/use-yclaw-events';

/**
 * SSE overlay that shows live events from the YClaw API.
 * When disconnected (fleet off, no env var), shows a muted indicator.
 * When connected, prepends live events above the MongoDB-based feed.
 */
export function LiveEventOverlay() {
  const { events, connected } = useYClawEventStream();

  return (
    <div className="mb-4">
      {/* Connection indicator */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-mc-success animate-pulse' : 'bg-mc-text-tertiary'}`}
        />
        <span className="text-[10px] text-mc-text-tertiary font-mono">
          {connected ? 'Live stream: connected' : 'Live stream: disconnected'}
        </span>
      </div>

      {/* Live events */}
      {events.length > 0 && (
        <div className="bg-mc-surface-hover border border-mc-success/20 rounded mb-2">
          <div className="px-3 py-1.5 border-b border-mc-success/20">
            <span className="text-[10px] font-bold uppercase tracking-widest text-mc-success/60">Live</span>
          </div>
          <div className="divide-y divide-mc-border max-h-48 overflow-y-auto">
            {events.slice(0, 20).map((event, i) => (
              <div key={`${event.receivedAt}-${event.type}-${i}`} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                <span className="text-mc-success/60 font-mono text-[10px]">
                  {new Date(event.receivedAt).toLocaleTimeString()}
                </span>
                {event.agentId && (
                  <span className="text-mc-text font-semibold">{event.agentId}</span>
                )}
                <span className="text-mc-text-tertiary font-mono">{event.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
