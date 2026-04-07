export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSession, updateSession, DatabaseUnavailableError } from '@/lib/connections';
import type { ConnectionStep } from '@/lib/connections';

/** GET /api/connections/[id] — Get session status */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let session;
  try {
    session = await getSession(params.id);
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    throw err;
  }

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Never return raw credential references in GET
  return NextResponse.json({
    _id: session._id,
    integration: session.integration,
    tier: session.tier,
    status: session.status,
    steps: session.steps,
    credentials: {
      storedAt: session.credentials.storedAt,
      verified: session.credentials.verified,
    },
    metadata: session.metadata,
    error: session.error,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

/**
 * PATCH /api/connections/[id] — Update session steps and status
 *
 * Used by OpenClaw (via gateway) to advance session state during
 * guided connection flows. Accepts partial updates to steps and status.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  let session;
  try {
    session = await getSession(params.id);
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    throw err;
  }

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Only allow updates on active sessions
  const terminalStatuses = new Set(['connected', 'failed']);
  if (terminalStatuses.has(session.status)) {
    return NextResponse.json(
      { error: `Session is in terminal state '${session.status}'` },
      { status: 409 },
    );
  }

  let body: {
    status?: string;
    steps?: { id: string; status?: string; detail?: string }[];
    metadata?: Record<string, unknown>;
    error?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: {
    status?: ConnectionStep['status'] extends string ? typeof session.status : never;
    steps?: ConnectionStep[];
    error?: string;
  } = {};

  // Apply step-level updates (merge with existing steps)
  if (body.steps && Array.isArray(body.steps)) {
    const stepUpdates = new Map(body.steps.map((s) => [s.id, s]));
    update.steps = session.steps.map((existing) => {
      const patch = stepUpdates.get(existing.id);
      if (!patch) return existing;
      return {
        ...existing,
        status: (patch.status as ConnectionStep['status']) ?? existing.status,
        detail: patch.detail ?? existing.detail,
      };
    });
  }

  // Apply status update (validated against allowed transitions)
  if (body.status && typeof body.status === 'string') {
    const validStatuses = new Set([
      'pending', 'collecting_credentials', 'storing', 'wiring',
      'verifying', 'connected', 'failed',
    ]);
    if (!validStatuses.has(body.status)) {
      return NextResponse.json(
        { error: `Invalid status: ${body.status}` },
        { status: 400 },
      );
    }
    update.status = body.status as typeof session.status;
  }

  if (body.error !== undefined) {
    update.error = body.error;
  }

  // Merge metadata updates (shallow merge with existing)
  if (body.metadata && typeof body.metadata === 'object') {
    (update as any).metadata = { ...(session.metadata ?? {}), ...body.metadata };
  }

  try {
    await updateSession(params.id, update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    const msg = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
