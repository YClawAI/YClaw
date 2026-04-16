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

// ── FleetStatusBadge ────────────────────────────────────────────────
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

  // ── Badge label + style ─────────────────────────────────────────────
  const badge = (() => {
    switch (ecsStatus.status) {
      case 'running': {
        return {
          label: taskStatus === 'paused' ? 'Fleet Paused' : 'Fleet Running',
          style: taskStatus === 'paused'
            ? 'bg-mc-warning/10 text-mc-warning border-mc-warning/40 hover:bg-mc-warning/20'
            : 'bg-mc-success/10 text-mc-success border-mc-success/40 hover:bg-mc-success/20',
        };
      }
      case 'stopped':
        return {
          label: 'Fleet Stopped',
          style: 'bg-mc-danger/10 text-mc-danger border-mc-danger/40 hover:bg-mc-danger/20 animate-mc-pulse',
        };
      case 'scaling':
        return {
          label: 'Fleet Scaling...',
          style: 'bg-mc-warning/10 text-mc-warning border-mc-warning/40',
        };
      case 'error':
        return {
          label: 'ECS Error',
          style: 'bg-mc-surface/50 text-mc-text-tertiary border-mc-border',
        };
    }
  })();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`px-3 py-1.5 font-sans text-[11px] uppercase tracking-label rounded-panel border transition-all duration-mc ease-mc-out ${badge.style}`}
      >
        {badge.label}
      </button>

      {open && (
        <ModalShell onClose={() => setOpen(false)}>
          <div className="w-96 bg-mc-bg/95 backdrop-blur-sm border border-mc-border rounded-panel shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-mc-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-full animate-mc-pulse shadow-[0_0_6px_currentColor] ${
                  ecsStatus.status === 'running' ? 'bg-mc-success text-mc-success'
                  : ecsStatus.status === 'stopped' ? 'bg-mc-danger text-mc-danger'
                  : 'bg-mc-warning text-mc-warning'
                }`} />
                <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">Fleet Status</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-mc-text-tertiary hover:text-mc-text transition-colors duration-mc ease-mc-out text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Container status */}
            <div className="px-5 py-3 border-b border-mc-border">
              <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-tertiary mb-2">Containers</div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-sans text-mc-text-tertiary">Running / Desired</span>
                <span className="font-mono tabular-nums text-mc-text">
                  {ecsStatus.runningCount ?? '?'} / {ecsStatus.desiredCount ?? '?'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="font-sans text-mc-text-tertiary">Status</span>
                <span className={`font-sans capitalize uppercase tracking-label text-[11px] ${
                  ecsStatus.status === 'running' ? 'text-mc-success'
                  : ecsStatus.status === 'stopped' ? 'text-mc-danger'
                  : 'text-mc-warning'
                }`}>
                  {ecsStatus.status}
                </span>
              </div>
            </div>

            {/* Task state */}
            {ecsStatus.status === 'running' && (
              <div className="px-5 py-3 border-b border-mc-border">
                <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-tertiary mb-2">Task Queue</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-sans text-mc-text-tertiary">State</span>
                  <span className={`font-sans capitalize uppercase tracking-label text-[11px] ${
                    taskStatus === 'active' ? 'text-mc-success'
                    : taskStatus === 'paused' ? 'text-mc-danger'
                    : 'text-mc-warning'
                  }`}>
                    {taskStatus}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="px-5 py-2 font-sans text-xs text-mc-danger bg-mc-danger/10 border-b border-mc-danger/40">
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
                      className="w-full px-3 py-2 font-sans text-[11px] uppercase tracking-label rounded-panel border border-mc-border text-mc-text-tertiary hover:text-mc-text hover:border-mc-border-hover disabled:opacity-40 transition-colors duration-mc ease-mc-out"
                    >
                      {pending ? 'Processing...' : 'Pause Tasks'}
                    </button>
                  ) : (
                    <button
                      onClick={() => { onTaskAction('active'); setOpen(false); }}
                      disabled={pending}
                      className="w-full px-3 py-2 font-sans text-[11px] uppercase tracking-label rounded-panel border border-mc-success/40 text-mc-success hover:bg-mc-success/10 disabled:opacity-40 transition-colors duration-mc ease-mc-out"
                    >
                      {pending ? 'Processing...' : 'Resume Tasks'}
                    </button>
                  )}
                  <button
                    onClick={() => { onEcsAction('stop'); setOpen(false); }}
                    disabled={pending}
                    className="w-full px-3 py-2 font-sans text-[11px] uppercase tracking-label rounded-panel border border-mc-danger/40 text-mc-danger hover:bg-mc-danger/10 disabled:opacity-40 transition-colors duration-mc ease-mc-out"
                  >
                    {pending ? 'Processing...' : 'Kill Fleet'}
                  </button>
                </>
              ) : ecsStatus.status === 'stopped' ? (
                <button
                  onClick={() => { onEcsAction('start'); setOpen(false); }}
                  disabled={pending}
                  className="w-full px-3 py-2 font-sans text-[11px] uppercase tracking-label rounded-panel border border-mc-success/40 text-mc-success hover:bg-mc-success/10 disabled:opacity-40 transition-colors duration-mc ease-mc-out"
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

// ── FleetKillSwitch ────────────────────────────────────────────────

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
