'use client';

import { useState, useEffect } from 'react';
import { useEventStream } from '@/lib/hooks/use-event-stream';

/**
 * Displays today's LLM spend with a flash animation on new activity.
 *
 * Design:
 * - Server-rendered initial value is the source of truth
 * - SSE activity:update events trigger a visual flash but do NOT accumulate
 *   deltas (avoids drift on reconnect / double-counting)
 * - The displayed value resyncs on each full page reload (Next.js RSC)
 * - $/sec is computed as a rolling average from the server-provided total
 *   divided by elapsed wall-clock seconds since midnight UTC
 */
export function BurnVelocity({ initialDailySpendCents }: { initialDailySpendCents: number }) {
  const [spendCents] = useState(initialDailySpendCents);
  const [flash, setFlash] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(() => secondsSinceMidnightUTC());

  // Flash on new activity — purely visual, doesn't alter the total
  useEventStream({
    'activity:update': (data) => {
      const runs = data as Array<{ cost?: { totalUsd?: number } }>;
      if (!Array.isArray(runs) || runs.length === 0) return;
      const newest = runs[0];
      if (newest?.cost?.totalUsd && newest.cost.totalUsd > 0) {
        setFlash(true);
      }
    },
  });

  // Reset flash after animation
  useEffect(() => {
    if (flash) {
      const timer = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [flash]);

  // Update elapsed seconds every 10s for avg $/sec calculation
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSec(secondsSinceMidnightUTC());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const dollars = spendCents / 100;
  const avgPerSecond = elapsedSec > 60 ? (dollars / elapsedSec).toFixed(4) : '---';

  return (
    <div className="flex items-center gap-3 font-mono">
      <span className={`text-2xl font-bold transition-all duration-300 ${flash ? 'text-terminal-red scale-105' : 'text-terminal-text'}`}>
        ${dollars.toFixed(2)}
      </span>
      <span className="text-xs text-terminal-dim">today</span>
      {elapsedSec > 60 && (
        <div className="text-xs text-terminal-red/70 flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${flash ? 'bg-terminal-red animate-ping' : 'bg-terminal-red/50'}`} />
          <span>~${avgPerSecond}/sec</span>
          <span className="text-[10px] text-terminal-dim">avg since midnight</span>
        </div>
      )}
    </div>
  );
}

function secondsSinceMidnightUTC(): number {
  const now = new Date();
  return now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
}
