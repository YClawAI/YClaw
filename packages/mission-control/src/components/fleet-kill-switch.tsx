'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEventStream } from '@/lib/hooks/use-event-stream';
import { toggleFleet } from '@/lib/actions/fleet';
import { scaleEcsFleet } from '@/lib/actions/ecs-fleet';
import type { FleetStatus } from '@/lib/actions/fleet';
import type { EcsFleetStatus } from '@/lib/actions/ecs-fleet';

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!mounted || !onClose) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose!();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mounted, onClose]);

  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── FleetStatusBadge ──────────────────────────────────────────────────────────
// Clean badge: "Fleet Running" (or stopped/scaling/paused/error).
// Click opens a modal with ECS container status + task state + quick actions.

function FleetStatusBadge({
  ecsStatus,
  taskStatus,
  onEcsAction,
  onTaskAction,
  pending,
  error,
}: {
  ecsStatus: EcsFleetStatus;
  taskStatus: FleetStatus;
  onEcsAction: (action: 'start' | 'stop') => void;
  onTaskAction: (status: 'active' | 'paused') => void;
  pending: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);

  // ── Badge label + style ──────────────────────────────────────────────────
  const badge = (() => {
    switch (ecsStatus.status) {
      case 'running': {
        return {
          label: taskStatus === 'paused' ? 'Fleet Paused' : 'Fleet Running',
          style: taskStatus === 'paused'
            ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/40 hover:bg-yellow-400/20'
            : 'bg-terminal-green/10 text-terminal-green border-terminal-green/40 hover:bg-terminal-green/20',
        };
      }
      case 'stopped':
        return {
          label: 'Fleet Stopped',
          style: 'bg-terminal-red/10 text-terminal-red border-terminal-red/40 hover:bg-terminal-red/20 animate-pulse',
        };
      case 'scaling':
        return {
          label: 'Fleet Scaling...',
          style: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/40',
        };
      case 'error':
        return {
          label: 'ECS Error',
          style: 'bg-terminal-muted/50 text-terminal-dim border-terminal-border',
        };
    }
  })();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`px-3 py-1.5 text-xs font-mono rounded border transition-all ${badge.style}`}
      >
        {badge.label}
      </button>

      {open && (
        <ModalShell onClose={() => setOpen(false)}>
          <div className="w-96 bg-terminal-surface border border-terminal-border rounded-lg shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-terminal-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                  ecsStatus.status === 'running' ? 'bg-terminal-green shadow-[0_0_6px_#a6e3a1]'
                  : ecsStatus.status === 'stopped' ? 'bg-terminal-red shadow-[0_0_6px_#f38ba8] animate-pulse'
                  : 'bg-yellow-400 animate-pulse'
                }`} />
                <span className="font-mono text-sm font-bold text-terminal-text">Fleet Status</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-terminal-dim hover:text-terminal-text transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Container status */}
            <div className="px-5 py-3 border-b border-terminal-border/50">
              <div className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-2">Containers</div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-terminal-dim">Running / Desired</span>
                <span className="font-mono text-terminal-text">
                  {ecsStatus.runningCount ?? '?'} / {ecsStatus.desiredCount ?? '?'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-terminal-dim">Status</span>
                <span className={`font-mono capitalize ${
                  ecsStatus.status === 'running' ? 'text-terminal-green'
                  : ecsStatus.status === 'stopped' ? 'text-terminal-red'
                  : 'text-yellow-400'
                }`}>
                  {ecsStatus.status}
                </span>
              </div>
            </div>

            {/* Task state */}
            {ecsStatus.status === 'running' && (
              <div className="px-5 py-3 border-b border-terminal-border/50">
                <div className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-2">Task Queue</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-terminal-dim">State</span>
                  <span className={`font-mono capitalize ${
                    taskStatus === 'active' ? 'text-terminal-green'
                    : taskStatus === 'paused' ? 'text-terminal-red'
                    : 'text-yellow-400'
                  }`}>
                    {taskStatus}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="px-5 py-2 text-xs text-terminal-red bg-terminal-red/10 border-b border-terminal-red/20">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="px-5 py-4 space-y-2">
              {ecsStatus.status === 'running' ? (
                <>
                  {taskStatus === 'active' ? (
                    <button
                      onClick={() => { onTaskAction('paused'); setOpen(false); }}
                      disabled={pending}
                      className="w-full px-3 py-2 text-xs font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-muted disabled:opacity-40 transition-colors"
                    >
                      {pending ? 'Processing...' : 'Pause Tasks'}
                    </button>
                  ) : (
                    <button
                      onClick={() => { onTaskAction('active'); setOpen(false); }}
                      disabled={pending}
                      className="w-full px-3 py-2 text-xs font-mono rounded border border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
                    >
                      {pending ? 'Processing...' : 'Resume Tasks'}
                    </button>
                  )}
                  <button
                    onClick={() => { onEcsAction('stop'); setOpen(false); }}
                    disabled={pending}
                    className="w-full px-3 py-2 text-xs font-mono rounded border border-terminal-red/40 text-terminal-red hover:bg-terminal-red/10 disabled:opacity-40 transition-colors"
                  >
                    {pending ? 'Processing...' : 'Kill Fleet'}
                  </button>
                </>
              ) : ecsStatus.status === 'stopped' ? (
                <button
                  onClick={() => { onEcsAction('start'); setOpen(false); }}
                  disabled={pending}
                  className="w-full px-3 py-2 text-xs font-mono rounded border border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
                >
                  {pending ? 'Processing...' : 'Start Fleet'}
                </button>
              ) : null}
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}

// ── FleetKillSwitch ───────────────────────────────────────────────────────────

export function FleetKillSwitch({
  initialStatus,
  initialEcsStatus,
}: {
  initialStatus: FleetStatus;
  initialEcsStatus: EcsFleetStatus;
}) {
  const [taskStatus, setTaskStatus] = useState(initialStatus);
  const [ecsStatus, setEcsStatus] = useState(initialEcsStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEventStream({
    'fleet:status': (data) => {
      const d = data as { status: string };
      if (d.status === 'active' || d.status === 'paused') {
        setTaskStatus(d.status);
      }
    },
  });

  async function handleEcsAction(action: 'start' | 'stop') {
    setPending(true);
    setError(null);
    const result = await scaleEcsFleet(action);
    if (result.ok) {
      setEcsStatus(prev => ({
        ...prev,
        desiredCount: action === 'start' ? 1 : 0,
        status: 'scaling',
      }));
    } else {
      setError(result.error ?? 'ECS action failed');
    }
    setPending(false);
  }

  async function handleTaskAction(newStatus: 'active' | 'paused') {
    setPending(true);
    setError(null);
    const result = await toggleFleet(newStatus);
    if (!result.ok) {
      setError(result.error ?? 'Toggle failed');
    }
    setPending(false);
  }

  return (
    <FleetStatusBadge
      ecsStatus={ecsStatus}
      taskStatus={taskStatus}
      onEcsAction={handleEcsAction}
      onTaskAction={handleTaskAction}
      pending={pending}
      error={error}
    />
  );
}
