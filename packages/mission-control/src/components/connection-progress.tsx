'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useConnectionEvents } from '@/hooks/use-connection-events';
import type { StepEvent, SessionEvent } from '@/hooks/use-connection-events';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProgressStep {
  id: string;
  label: string;
  actor?: string;
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped';
  detail?: string;
}

// ── Icons (shared with connect-flow) ────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? 'w-3.5 h-3.5'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  );
}

// ── Actor Label ──────────────────────────────────────────────────────────────

const ACTOR_LABELS: Record<string, { label: string; color: string }> = {
  human: { label: 'You', color: 'text-terminal-cyan' },
  openclaw: { label: 'OpenClaw', color: 'text-terminal-purple' },
  system: { label: 'System', color: 'text-terminal-dim' },
  fleet: { label: 'Fleet', color: 'text-terminal-orange' },
};

// ── PR link extractor ───────────────────────────────────────────────────────

function extractPrUrl(detail?: string): string | null {
  if (!detail) return null;
  const match = detail.match(/PR #(\d+)/);
  if (!match) return null;
  // Try to extract full URL if present
  const urlMatch = detail.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
  return urlMatch ? urlMatch[0] : null;
}

// ── Connection Progress ─────────────────────────────────────────────────────

export function ConnectionProgress({
  sessionId,
  integrationName,
  initialSteps,
  onComplete,
  onFailed,
}: {
  sessionId: string;
  integrationName: string;
  initialSteps: ProgressStep[];
  onComplete?: () => void;
  onFailed?: (error?: string) => void;
}) {
  const [steps, setSteps] = useState<ProgressStep[]>(initialSteps);
  const [sessionStatus, setSessionStatus] = useState<string>('wiring');
  const [error, setError] = useState<string | null>(null);
  const completedRef = useRef(false);

  // Calculate progress metrics
  const completedSteps = steps.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
  const totalSteps = steps.length;
  const activeStep = steps.find((s) => s.status === 'active');
  const fleetSteps = steps.filter((s) => s.actor === 'fleet');
  const estimateMinutes = fleetSteps.length * 5;

  const handleStepUpdate = useCallback((event: StepEvent) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === event.stepId
          ? {
              ...s,
              status: event.status as ProgressStep['status'],
              detail: event.detail ?? s.detail,
            }
          : s,
      ),
    );
  }, []);

  const handleSessionUpdate = useCallback((event: SessionEvent) => {
    setSessionStatus(event.status);
    if (event.error) setError(event.error);
  }, []);

  const handleComplete = useCallback((event: SessionEvent) => {
    setSessionStatus(event.status);
    if (completedRef.current) return;
    completedRef.current = true;

    if (event.status === 'connected') {
      onComplete?.();
    } else if (event.status === 'failed') {
      setError(event.error ?? 'Connection failed');
      onFailed?.(event.error);
    }
  }, [onComplete, onFailed]);

  const { connected } = useConnectionEvents(sessionId, {
    onStepUpdate: handleStepUpdate,
    onSessionUpdate: handleSessionUpdate,
    onComplete: handleComplete,
  });

  // Fallback: poll session if SSE not connected
  useEffect(() => {
    if (connected || completedRef.current) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/connections/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        setSteps(data.steps);
        setSessionStatus(data.status);
        if (data.error) setError(data.error);
        if (data.status === 'connected' || data.status === 'failed') {
          clearInterval(interval);
          if (!completedRef.current) {
            completedRef.current = true;
            if (data.status === 'connected') onComplete?.();
            else onFailed?.(data.error);
          }
        }
      } catch { /* skip */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [connected, sessionId, onComplete, onFailed]);

  return (
    <div className="space-y-4">
      {/* Step checklist */}
      <div className="space-y-2">
        {steps.map((step) => {
          const prUrl = extractPrUrl(step.detail);
          const actorInfo = step.actor ? ACTOR_LABELS[step.actor] : undefined;

          return (
            <div key={step.id} className="flex items-start gap-2.5">
              <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                {step.status === 'complete' ? (
                  <CheckIcon className="w-4 h-4 text-terminal-green" />
                ) : step.status === 'active' ? (
                  <SpinnerIcon className="w-4 h-4 text-terminal-cyan" />
                ) : step.status === 'failed' ? (
                  <XIcon className="w-4 h-4 text-terminal-red" />
                ) : step.status === 'skipped' ? (
                  <span className="w-2 h-2 rounded-full bg-terminal-dim/20" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-terminal-dim/30" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs block ${
                      step.status === 'complete'
                        ? 'text-terminal-green'
                        : step.status === 'active'
                          ? 'text-terminal-text'
                          : step.status === 'failed'
                            ? 'text-terminal-red'
                            : 'text-terminal-dim'
                    }`}
                  >
                    {step.label}
                  </span>
                  {actorInfo && (
                    <span className={`text-[9px] font-mono ${actorInfo.color}`}>
                      {actorInfo.label}
                    </span>
                  )}
                </div>
                {step.detail && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-terminal-dim block truncate">
                      {step.detail}
                    </span>
                    {prUrl && (
                      <a
                        href={prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-terminal-blue hover:text-terminal-text transition-colors shrink-0"
                        title="View PR"
                      >
                        <LinkIcon className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-terminal-border rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            sessionStatus === 'failed' ? 'bg-terminal-red' :
            sessionStatus === 'connected' ? 'bg-terminal-green' :
            'bg-terminal-cyan'
          }`}
          style={{ width: `${totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0}%` }}
        />
      </div>

      {/* Status message */}
      {sessionStatus === 'wiring' && activeStep && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-terminal-orange/10 border border-terminal-orange/30">
          <SpinnerIcon className="w-3 h-3 text-terminal-orange" />
          <span className="text-[10px] text-terminal-orange font-mono">
            {activeStep.actor === 'fleet'
              ? `Builder is working on: ${activeStep.label}`
              : `Processing: ${activeStep.label}`}
          </span>
        </div>
      )}

      {sessionStatus === 'wiring' && estimateMinutes > 0 && (
        <p className="text-[10px] text-terminal-dim font-mono">
          Estimated time: {estimateMinutes}-{estimateMinutes * 2} minutes
        </p>
      )}

      {sessionStatus === 'connected' && !error && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded bg-terminal-green/10 border border-terminal-green/30">
          <CheckIcon className="w-4 h-4 text-terminal-green shrink-0" />
          <span className="text-xs text-terminal-green font-mono">
            {integrationName} connected!
          </span>
        </div>
      )}

      {sessionStatus === 'connected' && error && (
        <div className="px-3 py-2.5 rounded bg-terminal-orange/10 border border-terminal-orange/30 space-y-1">
          <div className="flex items-center gap-2">
            <CheckIcon className="w-4 h-4 text-terminal-orange shrink-0" />
            <span className="text-xs text-terminal-orange font-mono">
              {integrationName} connected (degraded)
            </span>
          </div>
          <span className="text-[10px] text-terminal-dim font-mono block">{error}</span>
        </div>
      )}

      {sessionStatus === 'failed' && error && (
        <div className="px-3 py-2.5 rounded bg-terminal-red/10 border border-terminal-red/30">
          <span className="text-[10px] text-terminal-red font-mono block">{error}</span>
        </div>
      )}

      {/* SSE connection indicator */}
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-terminal-green' : 'bg-terminal-dim/40'}`} />
        <span className="text-[9px] text-terminal-dim font-mono">
          {connected ? 'Live updates' : 'Polling'}
        </span>
      </div>
    </div>
  );
}
