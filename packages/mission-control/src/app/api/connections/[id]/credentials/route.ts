export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import {
  getSession,
  updateSession,
  storeSecret,
  deleteSecret,
  DatabaseUnavailableError,
} from '@/lib/connections';
import { getIntegration } from '@/lib/integration-registry';
import { sanitize } from '@/lib/log-sanitizer';
import { requireSession, checkTier } from '@/lib/require-permission';

/** Security headers for credential endpoints — prevent caching and mark sensitive */
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'x-sensitive': 'true',
};

/**
 * POST /api/connections/[id]/credentials — Submit credentials
 *
 * CRITICAL SECURITY:
 * - Request body is NOT logged
 * - Credentials are encrypted with AES-256-GCM before storage
 * - Only the secret reference (UUID) is saved to the ConnectionSession
 * - Raw credentials are never returned in any response
 * - Response includes no-store cache headers
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  // Credential storage requires department_head+
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  let session;
  try {
    session = await getSession(params.id);
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json(
        { error: 'Database unavailable' },
        { status: 503, headers: SECURITY_HEADERS },
      );
    }
    throw err;
  }

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404, headers: SECURITY_HEADERS },
    );
  }

  // Accept credentials from 'collecting_credentials' (manual flow) or 'wiring' (OpenClaw flow)
  const acceptableStatuses = new Set(['collecting_credentials', 'wiring']);
  if (!acceptableStatuses.has(session.status)) {
    return NextResponse.json(
      { error: `Session is in '${session.status}' state, expected 'collecting_credentials' or 'wiring'` },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  const def = getIntegration(session.integration);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown integration: ${session.integration}` },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  let body: { fields?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  if (!body.fields || typeof body.fields !== 'object') {
    return NextResponse.json(
      { error: 'Missing required field: fields' },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  // Validate all required credential fields are present (skip optional fields)
  for (const field of def.credentialFields) {
    if (field.optional) continue;
    const val = body.fields[field.key];
    if (!val || typeof val !== 'string' || val.trim().length === 0) {
      return NextResponse.json(
        { error: `Missing required credential: ${field.label}` },
        { status: 400, headers: SECURITY_HEADERS },
      );
    }
  }

  // Transition to storing state first (guards against duplicate submissions)
  try {
    const steps = session.steps.map((s) =>
      s.id === 'credentials'
        ? { ...s, status: 'complete' as const }
        : s.id === 'store'
          ? { ...s, status: 'active' as const }
          : s,
    );
    await updateSession(params.id, { status: 'storing', steps });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json(
        { error: 'Database unavailable' },
        { status: 503, headers: SECURITY_HEADERS },
      );
    }
    throw err;
  }

  // Store encrypted credentials + update session atomically (with rollback)
  let secretRef: string | null = null;
  try {
    const stored = await storeSecret(session.integration, body.fields);
    secretRef = stored.groupId;

    const stepsAfterStore = session.steps.map((s) =>
      s.id === 'credentials'
        ? { ...s, status: 'complete' as const }
        : s.id === 'store'
          ? { ...s, status: 'complete' as const }
          : s.id === 'verify'
            ? { ...s, status: 'active' as const }
            : s,
    );
    await updateSession(params.id, {
      status: 'verifying',
      steps: stepsAfterStore,
      credentials: {
        secretRef: stored.groupId,
        fieldRefs: stored.fieldRefs,
        storedAt: new Date(),
      },
    });

    return NextResponse.json(
      { ok: true, status: 'verifying' },
      { headers: SECURITY_HEADERS },
    );
  } catch (err) {
    // Rollback: delete orphaned secret if it was created
    if (secretRef) {
      await deleteSecret(secretRef).catch(() => {});
    }

    const rawMsg = err instanceof Error ? err.message : 'Failed to store credentials';
    const msg = sanitize(rawMsg);
    const failedSteps = session.steps.map((s) =>
      s.id === 'store' ? { ...s, status: 'failed' as const, detail: msg } : s,
    );
    await updateSession(params.id, {
      status: 'failed',
      steps: failedSteps,
      error: msg,
    }).catch(() => {});

    const status = err instanceof DatabaseUnavailableError ? 503 : 500;
    return NextResponse.json(
      { error: msg },
      { status, headers: SECURITY_HEADERS },
    );
  }
}
