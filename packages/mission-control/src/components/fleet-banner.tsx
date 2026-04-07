'use client';

import { useState, useEffect, useCallback } from 'react';
import { scaleEcsFleet, getEcsFleetStatus } from '@/lib/actions/ecs-fleet';
import type { EcsFleetStatus } from '@/lib/actions/ecs-fleet';

interface FleetBannerProps {
  initialEcsStatus: EcsFleetStatus;
}

const POLL_INTERVAL_MS = 15000;

export function FleetBanner({ initialEcsStatus }: FleetBannerProps) {
  const [ecsStatus, setEcsStatus] = useState(initialEcsStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync when server re-renders with new initialEcsStatus
  useEffect(() => {
    setEcsStatus(initialEcsStatus);
  }, [initialEcsStatus]);

  // Poll ECS status when in a transitional state (scaling) or after user action
  const refreshStatus = useCallback(async () => {
    try {
      const fresh = await getEcsFleetStatus();
      setEcsStatus(fresh);
    } catch { /* keep current */ }
  }, []);

  useEffect(() => {
    // Poll while scaling to detect transition to running/stopped
    if (ecsStatus.status !== 'scaling') return;
    const id = setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ecsStatus.status, refreshStatus]);

  async function handleStart() {
    setPending(true);
    setError(null);
    try {
      const result = await scaleEcsFleet('start');
      if (result.ok) {
        setEcsStatus((prev) => ({
          ...prev,
          desiredCount: 1,
          status: 'scaling',
        }));
      } else {
        setError(result.error ?? 'Failed to start fleet');
      }
    } catch {
      setError('Failed to start fleet');
    }
    setPending(false);
  }

  if (ecsStatus.status === 'running') {
    return (
      <div className="shrink-0 bg-terminal-green/10 border-b border-terminal-green/30 px-4 py-2 flex items-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-terminal-green shadow-[0_0_6px_#a6e3a1]" />
        <span className="text-xs font-mono text-terminal-green">Fleet Running</span>
        <span className="text-[10px] font-mono text-terminal-green/60">
          {ecsStatus.runningCount}/{ecsStatus.desiredCount} containers
        </span>
      </div>
    );
  }

  if (ecsStatus.status === 'scaling') {
    return (
      <div className="shrink-0 bg-yellow-400/10 border-b border-yellow-400/30 px-4 py-2 flex items-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-xs font-mono text-yellow-400">Fleet Scaling...</span>
        <span className="text-[10px] font-mono text-yellow-400/60">
          {ecsStatus.runningCount}/{ecsStatus.desiredCount} containers
        </span>
      </div>
    );
  }

  if (ecsStatus.status === 'stopped') {
    return (
      <div className="shrink-0 bg-terminal-red/10 border-b border-terminal-red/30 px-4 py-2 flex items-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-terminal-red shadow-[0_0_6px_#f38ba8] animate-pulse" />
        <span className="text-xs font-mono text-terminal-red font-bold">Fleet Stopped</span>
        <span className="text-[10px] font-mono text-terminal-dim">All agents offline</span>
        <button
          onClick={handleStart}
          disabled={pending}
          className="ml-auto px-3 py-1 text-xs font-mono rounded border border-terminal-green/40 bg-terminal-green/20 text-terminal-green hover:bg-terminal-green/30 disabled:opacity-40 transition-colors"
        >
          {pending ? 'Starting...' : 'Start Fleet'}
        </button>
        {error && (
          <span className="text-[10px] font-mono text-terminal-red">{error}</span>
        )}
      </div>
    );
  }

  // status === 'error' — ECS unreachable
  return (
    <div className="shrink-0 bg-terminal-muted/30 border-b border-terminal-border px-4 py-2 flex items-center gap-3">
      <span className="inline-block w-2 h-2 rounded-full bg-terminal-dim" />
      <span className="text-xs font-mono text-terminal-dim">Fleet status unavailable</span>
    </div>
  );
}
