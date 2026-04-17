'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnectionSession } from '@/hooks/use-connection-session';
import { ConnectionProgress } from '@/components/connection-progress';
import type { IntegrationDef } from '@/lib/integration-registry';

// ── Types ──────────────────────────────────────────────────────────────────

interface StepState {
  id: string;
  label: string;
  actor?: string;
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped';
  detail?: string;
}

type FlowStage = 'input' | 'saving' | 'verifying' | 'connected' | 'failed'
  | 'tier2_init' | 'tier2_polling' | 'tier2_fallback'
  | 'tier3_init' | 'tier3_wiring' | 'tier3_fallback';

// ── Icons ──────────────────────────────────────────────────────────────────

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

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeSlashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-3.5 h-3.5'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

// ── Actor Label ────────────────────────────────────────────────────────────

const ACTOR_LABELS: Record<string, { label: string; color: string }> = {
  human: { label: 'You', color: 'text-mc-accent' },
  // Pre-flip used purple for openclaw + cyan for human; mechanical flip collapsed
  // both to mc-accent. Route openclaw → mc-dept-finance (only iOS-palette purple)
  // to preserve the "OpenClaw actor" branding vs. human/system.
  openclaw: { label: 'OpenClaw', color: 'text-mc-dept-finance' },
  system: { label: 'System', color: 'text-mc-text-tertiary' },
  fleet: { label: 'Fleet', color: 'text-mc-blocked' },
};

// ── Step Indicator ─────────────────────────────────────────────────────────

function StepIndicator({ steps, showActors }: { steps: StepState[]; showActors?: boolean }) {
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div key={step.id} className="flex items-center gap-2.5">
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            {step.status === 'complete' ? (
              <CheckIcon className="w-4 h-4 text-mc-success" />
            ) : step.status === 'active' ? (
              <SpinnerIcon className="w-4 h-4 text-mc-accent" />
            ) : step.status === 'failed' ? (
              <XIcon className="w-4 h-4 text-mc-danger" />
            ) : step.status === 'skipped' ? (
              <span className="w-2 h-2 rounded-full bg-mc-text-tertiary/20" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-mc-text-tertiary/30" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs block ${
                  step.status === 'complete'
                    ? 'text-mc-success'
                    : step.status === 'active'
                      ? 'text-mc-text'
                      : step.status === 'failed'
                        ? 'text-mc-danger'
                        : 'text-mc-text-tertiary'
                }`}
              >
                {step.label}
              </span>
              {showActors && step.actor && ACTOR_LABELS[step.actor] && (
                <span className={`text-[9px] font-mono ${ACTOR_LABELS[step.actor]!.color}`}>
                  {ACTOR_LABELS[step.actor]!.label}
                </span>
              )}
            </div>
            {step.detail && (
              <span className="text-[10px] text-mc-text-tertiary block truncate">{step.detail}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tier 1 Connect Flow (paste-key-and-verify) ────────────────────────────

function Tier1Flow({
  integration,
  onStageChange,
  onStepsChange,
  onError,
}: {
  integration: IntegrationDef;
  onStageChange: (stage: FlowStage) => void;
  onStepsChange: (steps: StepState[]) => void;
  onError: (error: string | null) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const allFieldsFilled = integration.credentialFields.every(
    (f) => f.optional || fields[f.key]?.trim(),
  );

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    onError(null);

    let sid: string | undefined;

    try {
      // 1. Create session
      const createRes = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration: integration.id }),
      });
      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({ error: 'Failed to create session' }));
        throw new Error(data.error);
      }
      const createData = await createRes.json();
      sid = createData.sessionId;

      // 2. Submit credentials
      onStageChange('saving');
      onStepsChange([
        { id: 'credentials', label: 'Enter Credentials', status: 'complete' },
        { id: 'store', label: 'Save Credentials', status: 'active' },
        { id: 'verify', label: 'Verify Connection', status: 'pending' },
      ]);

      const credRes = await fetch(`/api/connections/${sid}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!credRes.ok) {
        const data = await credRes.json().catch(() => ({ error: 'Failed to store credentials' }));
        throw new Error(data.error);
      }

      // 3. Verify
      onStageChange('verifying');
      onStepsChange([
        { id: 'credentials', label: 'Enter Credentials', status: 'complete' },
        { id: 'store', label: 'Save Credentials', status: 'complete' },
        { id: 'verify', label: 'Verifying connection...', status: 'active' },
      ]);

      const verifyRes = await fetch(`/api/connections/${sid}/verify`, {
        method: 'POST',
      });
      const verifyData = await verifyRes.json();

      if (verifyData.ok && verifyData.verified) {
        onStageChange('connected');
        onStepsChange([
          { id: 'credentials', label: 'Enter Credentials', status: 'complete' },
          { id: 'store', label: 'Save Credentials', status: 'complete' },
          { id: 'verify', label: 'Connection verified', status: 'complete' },
        ]);
      } else {
        throw new Error(verifyData.error ?? verifyData.detail ?? 'Verification failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      onError(msg);
      onStageChange('failed');
    } finally {
      setSubmitting(false);
    }
  }, [fields, integration.id, submitting, onStageChange, onStepsChange, onError]);

  return (
    <>
      <div className="text-[10px] text-mc-text-tertiary uppercase tracking-widest">
        Step 1 of 3: Enter Credentials
      </div>
      <div className="space-y-4">
        {integration.credentialFields.map((field) => (
          <div key={field.key}>
            <label className="text-[10px] text-mc-text-tertiary uppercase tracking-widest block mb-1.5">
              {field.label}
            </label>
            <div className="flex items-center gap-1">
              <input
                type={visibility[field.key] ? 'text' : 'password'}
                value={fields[field.key] ?? ''}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                autoFocus={integration.credentialFields[0] === field}
                autoComplete="off"
                className="flex-1 bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info placeholder:text-mc-text-tertiary/30"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibility((prev) => ({
                    ...prev,
                    [field.key]: !prev[field.key],
                  }))
                }
                className="p-2 text-mc-text-tertiary hover:text-mc-text transition-colors"
                aria-label={visibility[field.key] ? 'Hide' : 'Show'}
              >
                {visibility[field.key] ? <EyeSlashIcon /> : <EyeIcon />}
              </button>
            </div>
            {field.helpUrl && (
              <a
                href={field.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-mc-info hover:text-mc-text transition-colors mt-1 inline-block"
              >
                Need a key? Get one here
              </a>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end pt-1">
        <button
          onClick={handleSubmit}
          disabled={!allFieldsFilled || submitting}
          className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
            allFieldsFilled && !submitting
              ? 'border-mc-info/40 text-mc-info hover:bg-mc-info/10'
              : 'border-mc-border text-mc-text-tertiary cursor-not-allowed'
          }`}
        >
          {submitting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </>
  );
}

// ── Tier 2 Connect Flow (OpenClaw guided + fallback) ──────────────────────

function Tier2Flow({
  integration,
  initialSessionId,
  onStageChange,
  onStepsChange,
  onError,
}: {
  integration: IntegrationDef;
  initialSessionId?: string;
  onStageChange: (stage: FlowStage) => void;
  onStepsChange: (steps: StepState[]) => void;
  onError: (error: string | null) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [recipeSteps, setRecipeSteps] = useState<StepState[]>([]);
  const [starting, setStarting] = useState(false);
  const [openclawConnected, setOpenclawConnected] = useState<boolean | null>(initialSessionId ? true : null);
  const [fallbackMode, setFallbackMode] = useState(false);
  const { session } = useConnectionSession(
    openclawConnected || initialSessionId ? sessionId : null,
  );

  // Sync polled session steps to parent
  useEffect(() => {
    if (!session) return;
    const mappedSteps: StepState[] = session.steps.map((s) => ({
      id: s.id,
      label: s.label,
      actor: s.actor,
      status: s.status,
      detail: s.detail,
    }));
    setRecipeSteps(mappedSteps);
    onStepsChange(mappedSteps);

    if (session.status === 'connected') {
      onStageChange('connected');
    } else if (session.status === 'failed') {
      onError(session.error ?? 'Connection failed');
      onStageChange('failed');
    }
  }, [session, onStageChange, onStepsChange, onError]);

  const handleCreateAndStart = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    onError(null);

    try {
      // 1. Create session
      const createRes = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration: integration.id }),
      });
      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({ error: 'Failed to create session' }));
        throw new Error(data.error);
      }
      const createData = await createRes.json();
      const sid = createData.sessionId;
      setSessionId(sid);

      // Set initial steps from server response
      if (createData.steps) {
        const initialSteps: StepState[] = createData.steps.map((s: { id: string; label: string; actor?: string; status: string }) => ({
          id: s.id,
          label: s.label,
          actor: s.actor,
          status: s.status,
        }));
        setRecipeSteps(initialSteps);
        onStepsChange(initialSteps);
      }

      // 2. Try to start with OpenClaw
      const startRes = await fetch(`/api/connections/${sid}/start`, {
        method: 'POST',
      });
      const startData = await startRes.json();

      if (startData.ok && startData.openclawConnected) {
        setOpenclawConnected(true);
        onStageChange('tier2_polling');
      } else {
        // OpenClaw unavailable — fall back to manual credential input
        setOpenclawConnected(false);
        setFallbackMode(true);
        onStageChange('tier2_fallback');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start connection';
      onError(msg);
      onStageChange('failed');
    } finally {
      setStarting(false);
    }
  }, [integration.id, starting, onStageChange, onStepsChange, onError]);

  // Fallback: manual credential submission (reuses Tier1-style flow)
  const [fields, setFields] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const allFieldsFilled = integration.credentialFields.every(
    (f) => f.optional || fields[f.key]?.trim(),
  );

  const handleFallbackSubmit = useCallback(async () => {
    if (submitting || !sessionId) return;
    setSubmitting(true);
    onError(null);

    try {
      const credRes = await fetch(`/api/connections/${sessionId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!credRes.ok) {
        const data = await credRes.json().catch(() => ({ error: 'Failed to store credentials' }));
        throw new Error(data.error);
      }

      onStageChange('verifying');

      const verifyRes = await fetch(`/api/connections/${sessionId}/verify`, {
        method: 'POST',
      });
      const verifyData = await verifyRes.json();

      if (verifyData.ok && verifyData.verified) {
        if (verifyData.status === 'verifying') {
          // Post-verify steps remain (e.g., discover_repos) — start polling
          setOpenclawConnected(true);
          onStageChange('tier2_polling');
        } else {
          onStageChange('connected');
        }
      } else {
        throw new Error(verifyData.error ?? 'Verification failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      onError(msg);
      onStageChange('failed');
    } finally {
      setSubmitting(false);
    }
  }, [fields, sessionId, submitting, onStageChange, onError]);

  // Initial view: show recipe description + step checklist + Start button
  if (!sessionId) {
    return (
      <>
        {integration.description && (
          <p className="text-xs text-mc-text-tertiary leading-relaxed">
            {integration.description}
          </p>
        )}
        {recipeSteps.length === 0 && (
          <div className="text-[10px] text-mc-text-tertiary uppercase tracking-widest">
            This integration requires guided setup
          </div>
        )}
        <div className="flex justify-end pt-1">
          <button
            onClick={handleCreateAndStart}
            disabled={starting}
            className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
              !starting
                ? 'border-mc-dept-finance/40 text-mc-dept-finance hover:bg-mc-dept-finance/10'
                : 'border-mc-border text-mc-text-tertiary cursor-not-allowed'
            }`}
          >
            {starting ? 'Starting...' : 'Start with OpenClaw'}
          </button>
        </div>
      </>
    );
  }

  // Polling view: OpenClaw is driving
  if (openclawConnected && !fallbackMode) {
    return (
      <>
        <StepIndicator steps={recipeSteps} showActors />
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-mc-dept-finance/10 border border-mc-dept-finance/30">
          <SpinnerIcon className="w-3 h-3 text-mc-dept-finance" />
          <span className="text-[10px] text-mc-dept-finance font-mono">
            OpenClaw is guiding this connection...
          </span>
        </div>
      </>
    );
  }

  // Fallback view: manual credential input
  if (fallbackMode) {
    return (
      <>
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-mc-blocked/10 border border-mc-blocked/30 mb-2">
          <span className="text-[10px] text-mc-blocked font-mono">
            OpenClaw unavailable — enter credentials manually
          </span>
        </div>
        <div className="space-y-4">
          {integration.credentialFields.map((field) => (
            <div key={field.key}>
              <label className="text-[10px] text-mc-text-tertiary uppercase tracking-widest block mb-1.5">
                {field.label}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type={visibility[field.key] ? 'text' : 'password'}
                  value={fields[field.key] ?? ''}
                  onChange={(e) =>
                    setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  autoFocus={integration.credentialFields[0] === field}
                  autoComplete="off"
                  className="flex-1 bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info placeholder:text-mc-text-tertiary/30"
                />
                <button
                  type="button"
                  onClick={() =>
                    setVisibility((prev) => ({
                      ...prev,
                      [field.key]: !prev[field.key],
                    }))
                  }
                  className="p-2 text-mc-text-tertiary hover:text-mc-text transition-colors"
                  aria-label={visibility[field.key] ? 'Hide' : 'Show'}
                >
                  {visibility[field.key] ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
              {field.helpUrl && (
                <a
                  href={field.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-mc-info hover:text-mc-text transition-colors mt-1 inline-block"
                >
                  Need a key? Get one here
                </a>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end pt-1">
          <button
            onClick={handleFallbackSubmit}
            disabled={!allFieldsFilled || submitting}
            className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
              allFieldsFilled && !submitting
                ? 'border-mc-info/40 text-mc-info hover:bg-mc-info/10'
                : 'border-mc-border text-mc-text-tertiary cursor-not-allowed'
            }`}
          >
            {submitting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </>
    );
  }

  return null;
}

// ── Tier 3 Connect Flow (full self-wiring — Strategist + Builder) ────────

function Tier3Flow({
  integration,
  initialSessionId,
  onStageChange,
  onStepsChange,
  onError,
}: {
  integration: IntegrationDef;
  initialSessionId?: string;
  onStageChange: (stage: FlowStage) => void;
  onStepsChange: (steps: StepState[]) => void;
  onError: (error: string | null) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [recipeSteps, setRecipeSteps] = useState<StepState[]>([]);
  const [starting, setStarting] = useState(false);
  const [openclawConnected, setOpenclawConnected] = useState<boolean | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [wiringStarted, setWiringStarted] = useState(false);
  const [metadataFields, setMetadataFields] = useState<Record<string, string>>({});

  // On resume, fetch session state to determine the correct view
  useEffect(() => {
    if (!initialSessionId) return;
    (async () => {
      try {
        const res = await fetch(`/api/connections/${initialSessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        const mapped: StepState[] = data.steps.map((s: any) => ({
          id: s.id, label: s.label, actor: s.actor, status: s.status, detail: s.detail,
        }));
        setRecipeSteps(mapped);
        onStepsChange(mapped);
        if (data.status === 'wiring') {
          setWiringStarted(true);
          onStageChange('tier3_wiring');
        } else if (data.status === 'collecting_credentials') {
          setFallbackMode(true);
          onStageChange('tier3_fallback');
        } else if (data.status === 'verifying') {
          setOpenclawConnected(true);
          onStageChange('tier3_init');
        } else if (data.status === 'connected') {
          onStageChange('connected');
        } else if (data.status === 'failed') {
          onError(data.error ?? 'Connection failed');
          onStageChange('failed');
        }
      } catch { /* ignore */ }
    })();
  }, [initialSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { session } = useConnectionSession(
    (openclawConnected && !wiringStarted) ? sessionId : null,
  );

  const triggerWiring = useCallback(async (sid: string) => {
    setWiringStarted(true);
    onStageChange('tier3_wiring');
    try {
      const res = await fetch(`/api/connections/${sid}/wire`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        onError(data.error ?? 'Failed to trigger wiring');
        onStageChange('failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger wiring';
      onError(msg);
      onStageChange('failed');
    }
  }, [onStageChange, onError]);

  // Sync polled session steps to parent (pre-wiring phase: OpenClaw driving creds)
  useEffect(() => {
    if (!session) return;
    const mappedSteps: StepState[] = session.steps.map((s) => ({
      id: s.id,
      label: s.label,
      actor: s.actor,
      status: s.status,
      detail: s.detail,
    }));
    setRecipeSteps(mappedSteps);
    onStepsChange(mappedSteps);

    // If OpenClaw has finished creds + verify, trigger wiring for fleet steps
    if (session.status === 'verifying' || session.status === 'wiring') {
      const hasFleetSteps = session.steps.some(
        (s) => s.actor === 'fleet' && (s.status === 'pending' || s.status === 'active'),
      );
      const credsVerified = session.credentials?.verified;

      if (hasFleetSteps && credsVerified && !wiringStarted) {
        triggerWiring(session._id);
      }
    }

    if (session.status === 'connected') {
      onStageChange('connected');
    } else if (session.status === 'failed') {
      onError(session.error ?? 'Connection failed');
      onStageChange('failed');
    }
  }, [session, onStageChange, onStepsChange, onError, wiringStarted, triggerWiring]);

  const handleCreateAndStart = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    onError(null);

    try {
      // 1. Create session (include metadata for custom integrations)
      const createBody: Record<string, unknown> = { integration: integration.id };
      if (integration.id === 'custom' && metadataFields.provider_name) {
        createBody.metadata = {
          provider_name: metadataFields.provider_name,
          base_url: metadataFields.base_url,
          auth_type: metadataFields.auth_type ?? 'bearer',
          docs_url: metadataFields.docs_url,
        };
      }
      const createRes = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({ error: 'Failed to create session' }));
        throw new Error(data.error);
      }
      const createData = await createRes.json();
      const sid = createData.sessionId;
      setSessionId(sid);

      // Set initial steps from server response
      if (createData.steps) {
        const initialSteps: StepState[] = createData.steps.map((s: { id: string; label: string; actor?: string; status: string }) => ({
          id: s.id,
          label: s.label,
          actor: s.actor,
          status: s.status,
        }));
        setRecipeSteps(initialSteps);
        onStepsChange(initialSteps);
      }

      // 2. Try to start with OpenClaw
      const startRes = await fetch(`/api/connections/${sid}/start`, {
        method: 'POST',
      });
      const startData = await startRes.json();

      if (startData.ok && startData.openclawConnected) {
        setOpenclawConnected(true);
        onStageChange('tier3_init');
      } else {
        // OpenClaw unavailable — fall back to manual credential input
        setOpenclawConnected(false);
        setFallbackMode(true);
        onStageChange('tier3_fallback');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start connection';
      onError(msg);
      onStageChange('failed');
    } finally {
      setStarting(false);
    }
  }, [integration.id, starting, onStageChange, onStepsChange, onError, metadataFields]);

  // Fallback: manual credential submission
  const [fields, setFields] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const allFieldsFilled = integration.credentialFields.every(
    (f) => f.optional || fields[f.key]?.trim(),
  );

  const handleFallbackSubmit = useCallback(async () => {
    if (submitting || !sessionId) return;
    setSubmitting(true);
    onError(null);

    try {
      const credRes = await fetch(`/api/connections/${sessionId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!credRes.ok) {
        const data = await credRes.json().catch(() => ({ error: 'Failed to store credentials' }));
        throw new Error(data.error);
      }

      onStageChange('verifying');

      const verifyRes = await fetch(`/api/connections/${sessionId}/verify`, {
        method: 'POST',
      });
      const verifyData = await verifyRes.json();

      if (verifyData.ok && verifyData.verified) {
        // After verify, trigger wiring for fleet steps
        await triggerWiring(sessionId);
      } else {
        throw new Error(verifyData.error ?? 'Verification failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      onError(msg);
      onStageChange('failed');
    } finally {
      setSubmitting(false);
    }
  }, [fields, sessionId, submitting, onStageChange, onError, triggerWiring]);

  // Pre-session: show recipe description + step preview + Start button
  if (!sessionId) {
    const isCustom = integration.id === 'custom';
    const canStart = isCustom ? !!(metadataFields.provider_name?.trim() && metadataFields.base_url?.trim()) : true;

    return (
      <>
        {integration.description && (
          <p className="text-xs text-mc-text-tertiary leading-relaxed">
            {integration.description}
          </p>
        )}
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-mc-blocked/10 border border-mc-blocked/30 mb-1">
          <span className="text-[10px] text-mc-blocked font-mono">
            Tier 3 — requires code changes via Builder agents
          </span>
        </div>
        {isCustom && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-mc-text-tertiary uppercase tracking-widest block mb-1.5">
                Provider Name
              </label>
              <input
                type="text"
                value={metadataFields.provider_name ?? ''}
                onChange={(e) => setMetadataFields((prev) => ({ ...prev, provider_name: e.target.value }))}
                placeholder="e.g., Acme CRM"
                autoFocus
                autoComplete="off"
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info placeholder:text-mc-text-tertiary/30"
              />
            </div>
            <div>
              <label className="text-[10px] text-mc-text-tertiary uppercase tracking-widest block mb-1.5">
                Base API URL
              </label>
              <input
                type="url"
                value={metadataFields.base_url ?? ''}
                onChange={(e) => setMetadataFields((prev) => ({ ...prev, base_url: e.target.value }))}
                placeholder="https://api.example.com/v1"
                autoComplete="off"
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info placeholder:text-mc-text-tertiary/30"
              />
            </div>
            <div>
              <label className="text-[10px] text-mc-text-tertiary uppercase tracking-widest block mb-1.5">
                Auth Type
              </label>
              <select
                value={metadataFields.auth_type ?? 'bearer'}
                onChange={(e) => setMetadataFields((prev) => ({ ...prev, auth_type: e.target.value }))}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info"
              >
                <option value="bearer">Bearer Token</option>
                <option value="x-api-key">X-API-Key Header</option>
                <option value="query-param">Query Parameter</option>
                <option value="custom-header">Custom Header</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-mc-text-tertiary uppercase tracking-widest block mb-1.5">
                API Docs / OpenAPI Spec URL (optional)
              </label>
              <input
                type="url"
                value={metadataFields.docs_url ?? ''}
                onChange={(e) => setMetadataFields((prev) => ({ ...prev, docs_url: e.target.value }))}
                placeholder="https://docs.example.com/api"
                autoComplete="off"
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info placeholder:text-mc-text-tertiary/30"
              />
            </div>
          </div>
        )}
        {isCustom && (
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={async () => {
                // Quick connect: create session then transition to collecting_credentials
                if (!metadataFields.provider_name?.trim() || !metadataFields.base_url?.trim()) return;
                try {
                  const createRes = await fetch('/api/connections', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      integration: 'custom',
                      metadata: {
                        provider_name: metadataFields.provider_name,
                        base_url: metadataFields.base_url,
                        auth_type: metadataFields.auth_type ?? 'bearer',
                        docs_url: metadataFields.docs_url,
                        quick_connect: true,
                      },
                    }),
                  });
                  if (!createRes.ok) {
                    const err = await createRes.json().catch(() => ({ error: 'Failed' }));
                    onError(err.error);
                    return;
                  }
                  const data = await createRes.json();
                  const sid = data.sessionId;
                  setSessionId(sid);
                  // Transition to collecting_credentials so /credentials accepts the session
                  await fetch(`/api/connections/${sid}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'collecting_credentials' }),
                  });
                  setFallbackMode(true);
                  onStageChange('tier3_fallback');
                } catch (err) {
                  onError(err instanceof Error ? err.message : 'Quick connect failed');
                }
              }}
              disabled={!metadataFields.provider_name?.trim() || !metadataFields.base_url?.trim()}
              className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
                metadataFields.provider_name?.trim() && metadataFields.base_url?.trim()
                  ? 'border-mc-info/40 text-mc-info hover:bg-mc-info/10'
                  : 'border-mc-border text-mc-text-tertiary cursor-not-allowed'
              }`}
            >
              Quick Connect (API Key)
            </button>
            <button
              onClick={handleCreateAndStart}
              disabled={starting || !canStart}
              className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
                !starting && canStart
                  ? 'border-mc-dept-finance/40 text-mc-dept-finance hover:bg-mc-dept-finance/10'
                  : 'border-mc-border text-mc-text-tertiary cursor-not-allowed'
              }`}
            >
              {starting ? 'Starting...' : 'Full Wiring (OpenClaw)'}
            </button>
          </div>
        )}
        {!isCustom && (
          <div className="flex justify-end pt-1">
            <button
              onClick={handleCreateAndStart}
              disabled={starting}
              className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
                !starting
                  ? 'border-mc-dept-finance/40 text-mc-dept-finance hover:bg-mc-dept-finance/10'
                  : 'border-mc-border text-mc-text-tertiary cursor-not-allowed'
              }`}
            >
              {starting ? 'Starting...' : 'Start with OpenClaw'}
            </button>
          </div>
        )}
      </>
    );
  }

  // Wiring phase: show ConnectionProgress with SSE updates
  if (wiringStarted && sessionId) {
    return (
      <ConnectionProgress
        sessionId={sessionId}
        integrationName={integration.name}
        initialSteps={recipeSteps}
        onComplete={() => onStageChange('connected')}
        onFailed={(err) => {
          onError(err ?? 'Wiring failed');
          onStageChange('failed');
        }}
      />
    );
  }

  // OpenClaw driving creds (pre-wiring)
  if (openclawConnected && !fallbackMode) {
    return (
      <>
        <StepIndicator steps={recipeSteps} showActors />
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-mc-dept-finance/10 border border-mc-dept-finance/30">
          <SpinnerIcon className="w-3 h-3 text-mc-dept-finance" />
          <span className="text-[10px] text-mc-dept-finance font-mono">
            OpenClaw is guiding credential setup...
          </span>
        </div>
      </>
    );
  }

  // Fallback: manual credential input
  if (fallbackMode) {
    return (
      <>
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-mc-blocked/10 border border-mc-blocked/30 mb-2">
          <span className="text-[10px] text-mc-blocked font-mono">
            OpenClaw unavailable — enter credentials manually
          </span>
        </div>
        <div className="space-y-4">
          {integration.credentialFields.map((field) => (
            <div key={field.key}>
              <label className="text-[10px] text-mc-text-tertiary uppercase tracking-widest block mb-1.5">
                {field.label}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type={visibility[field.key] ? 'text' : 'password'}
                  value={fields[field.key] ?? ''}
                  onChange={(e) =>
                    setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  autoFocus={integration.credentialFields[0] === field}
                  autoComplete="off"
                  className="flex-1 bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text font-mono focus:outline-none focus:border-mc-info placeholder:text-mc-text-tertiary/30"
                />
                <button
                  type="button"
                  onClick={() =>
                    setVisibility((prev) => ({
                      ...prev,
                      [field.key]: !prev[field.key],
                    }))
                  }
                  className="p-2 text-mc-text-tertiary hover:text-mc-text transition-colors"
                  aria-label={visibility[field.key] ? 'Hide' : 'Show'}
                >
                  {visibility[field.key] ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
              {field.helpUrl && (
                <a
                  href={field.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-mc-info hover:text-mc-text transition-colors mt-1 inline-block"
                >
                  Need a key? Get one here
                </a>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end pt-1">
          <button
            onClick={handleFallbackSubmit}
            disabled={!allFieldsFilled || submitting}
            className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
              allFieldsFilled && !submitting
                ? 'border-mc-info/40 text-mc-info hover:bg-mc-info/10'
                : 'border-mc-border text-mc-text-tertiary cursor-not-allowed'
            }`}
          >
            {submitting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </>
    );
  }

  return null;
}

// ── Connect Flow Modal ─────────────────────────────────────────────────────

export function ConnectFlow({
  integration,
  resumeSessionId,
  onClose,
  onConnected,
}: {
  integration: IntegrationDef;
  resumeSessionId?: string | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [stage, setStage] = useState<FlowStage>(
    resumeSessionId
      ? (integration.tier >= 3 ? 'tier3_wiring' : integration.tier >= 2 ? 'tier2_polling' : 'input')
      : (integration.tier >= 3 ? 'tier3_init' : integration.tier >= 2 ? 'tier2_init' : 'input'),
  );
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>(
    integration.tier >= 2
      ? []
      : [
          { id: 'credentials', label: 'Enter Credentials', status: 'active' },
          { id: 'store', label: 'Save Credentials', status: 'pending' },
          { id: 'verify', label: 'Verify Connection', status: 'pending' },
        ],
  );

  const isTier3 = integration.tier >= 3;
  const backdropRef = useRef<HTMLDivElement>(null);

  const isInProgress = stage === 'saving' || stage === 'verifying' || stage === 'tier2_polling' || stage === 'tier3_wiring';
  const isTier2 = integration.tier === 2;

  // Close handler — always refreshes parent state to update connection statuses
  const handleClose = useCallback(() => {
    if (isInProgress) return;
    onConnected(); // Refresh parent connection statuses on any close
    onClose();
  }, [isInProgress, onConnected, onClose]);

  // Close on backdrop click (blocked during in-progress)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) handleClose();
    },
    [handleClose],
  );

  // Close on Escape (blocked during in-progress)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleClose]);

  const handleRetry = useCallback(() => {
    setError(null);
    if (isTier3) {
      setStage('tier3_init');
      setSteps([]);
    } else if (isTier2) {
      setStage('tier2_init');
      setSteps([]);
    } else {
      setStage('input');
      setSteps([
        { id: 'credentials', label: 'Enter Credentials', status: 'active' },
        { id: 'store', label: 'Save Credentials', status: 'pending' },
        { id: 'verify', label: 'Verify Connection', status: 'pending' },
      ]);
    }
  }, [isTier2, isTier3]);

  const showStepIndicator = isTier3
    ? false // Tier3 uses ConnectionProgress which has its own indicator
    : isTier2
      ? stage === 'tier2_polling'
      : stage !== 'input';

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-mc-surface-hover border border-mc-border rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-mc-border">
          <h2 className="text-sm font-bold text-mc-text">
            Connect {integration.name}
          </h2>
          {!isInProgress && (
            <button
              onClick={handleClose}
              className="text-mc-text-tertiary hover:text-mc-text transition-colors p-1"
              aria-label="Close"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">
          {/* Tier 1 input stage */}
          {!isTier2 && stage === 'input' && (
            <Tier1Flow
              integration={integration}
              onStageChange={setStage}
              onStepsChange={setSteps}
              onError={setError}
            />
          )}

          {/* Tier 2 flow */}
          {isTier2 && (stage === 'tier2_init' || stage === 'tier2_polling' || stage === 'tier2_fallback' || stage === 'verifying') && (
            <Tier2Flow
              integration={integration}
              initialSessionId={resumeSessionId ?? undefined}
              onStageChange={setStage}
              onStepsChange={setSteps}
              onError={setError}
            />
          )}

          {/* Tier 3 flow */}
          {isTier3 && (stage === 'tier3_init' || stage === 'tier3_wiring' || stage === 'tier3_fallback' || stage === 'verifying') && (
            <Tier3Flow
              integration={integration}
              initialSessionId={resumeSessionId ?? undefined}
              onStageChange={setStage}
              onStepsChange={setSteps}
              onError={setError}
            />
          )}

          {/* Step indicator for tier 1 post-input / tier 2 polling */}
          {showStepIndicator && steps.length > 0 && (
            <StepIndicator steps={steps} showActors={isTier2} />
          )}

          {/* Connected banner */}
          {stage === 'connected' && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded bg-mc-success/10 border border-mc-success/30">
              <CheckIcon className="w-4 h-4 text-mc-success shrink-0" />
              <span className="text-xs text-mc-success font-mono">
                {integration.name} connected!
              </span>
            </div>
          )}

          {/* Failed banner */}
          {stage === 'failed' && error && (
            <div className="px-3 py-2.5 rounded bg-mc-danger/10 border border-mc-danger/30">
              <span className="text-[10px] text-mc-danger font-mono block">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-mc-border">
          {!isInProgress ? (
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs font-mono border border-mc-border rounded text-mc-text-tertiary hover:text-mc-text hover:border-mc-border transition-colors"
            >
              {stage === 'connected' ? 'Close' : 'Cancel'}
            </button>
          ) : (
            <div />
          )}

          {stage === 'connected' && (
            <button
              onClick={() => {
                onConnected();
                onClose();
              }}
              className="px-4 py-1.5 text-xs font-mono rounded border border-mc-success/40 text-mc-success hover:bg-mc-success/10 transition-colors"
            >
              Done
            </button>
          )}

          {stage === 'failed' && (
            <button
              onClick={handleRetry}
              className="px-4 py-1.5 text-xs font-mono rounded border border-mc-blocked/40 text-mc-blocked hover:bg-mc-blocked/10 transition-colors"
            >
              Retry
            </button>
          )}

          {isInProgress && !isTier2 && (
            <span className="text-[10px] text-mc-text-tertiary font-mono flex items-center gap-1.5">
              <SpinnerIcon className="w-3 h-3" />
              {stage === 'saving' ? 'Saving...' : 'Verifying...'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
