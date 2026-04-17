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
      <div className="shrink-0 bg-mc-success/10 border-b border-mc-success/40 px-4 py-2 flex items-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-mc-success animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-success" />
        <span className="font-sans text-xs uppercase tracking-label text-mc-success">Fleet Running</span>
        <span className="font-mono tabular-nums text-[10px] text-mc-success/70">
          {ecsStatus.runningCount}/{ecsStatus.desiredCount} containers
        </span>
      </div>
    );
  }

  if (ecsStatus.status === 'scaling') {
    return (
      <div className="shrink-0 bg-mc-warning/10 border-b border-mc-warning/40 px-4 py-2 flex items-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-mc-warning animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-warning" />
        <span className="font-sans text-xs uppercase tracking-label text-mc-warning">Fleet Scaling...</span>
        <span className="font-mono tabular-nums text-[10px] text-mc-warning/70">
          {ecsStatus.runningCount}/{ecsStatus.desiredCount} containers
        </span>
      </div>
    );
  }

  if (ecsStatus.status === 'stopped') {
    return (
      <div className="shrink-0 bg-mc-danger/10 border-b border-mc-danger/40 px-4 py-2 flex items-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-mc-danger animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-danger" />
        <span className="font-sans text-xs font-medium uppercase tracking-label text-mc-danger">Fleet Stopped</span>
        <span className="font-sans text-[10px] text-mc-text-tertiary">All agents offline</span>
        <button
          onClick={handleStart}
          disabled={pending}
          className="ml-auto px-3 py-1 font-sans text-[11px] uppercase tracking-label rounded-panel border border-mc-success/40 bg-mc-success/10 text-mc-success hover:bg-mc-success/20 disabled:opacity-40 transition-colors duration-mc ease-mc-out"
        >
          {pending ? 'Starting...' : 'Start Fleet'}
        </button>
        {error && (
          <span className="font-sans text-[10px] text-mc-danger">{error}</span>
        )}
      </div>
    );
  }

  // status === 'error' — ECS unreachable
  return (
    <div className="shrink-0 bg-mc-surface/50 border-b border-mc-border px-4 py-2 flex items-center gap-3">
      <span className="inline-block w-2 h-2 rounded-full bg-mc-text-tertiary" />
      <span className="font-sans text-xs uppercase tracking-label text-mc-text-tertiary">Fleet status unavailable</span>
    </div>
  );
}
