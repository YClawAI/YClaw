export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { setIntegrationEnabled, isIntegrationEnabled, DatabaseUnavailableError } from '@/lib/connections';

/**
 * POST /api/connections/[id]/toggle — Toggle circuit breaker for an integration.
 *
 * Body: { enabled: boolean }
 *
 * This allows disabling a problematic integration from MC without a deploy.
 * The [id] here is the integration ID (e.g., 'linear'), not a session ID.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: integrationId } = await params;

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'Missing required field: enabled (boolean)' },
      { status: 400 },
    );
  }

  try {
    await setIntegrationEnabled(integrationId, body.enabled);
    return NextResponse.json({ ok: true, integrationId, enabled: body.enabled });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to toggle integration';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/connections/[id]/toggle — Check circuit breaker status.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: integrationId } = await params;

  try {
    const enabled = await isIntegrationEnabled(integrationId);
    return NextResponse.json({ integrationId, enabled });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
