export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSession, updateSession, DatabaseUnavailableError } from '@/lib/connections';
import { getGateway } from '@/lib/gateway-ws';
import { getIntegration } from '@/lib/integration-registry';

/** POST /api/connections/[id]/start — Trigger OpenClaw-guided connection flow */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Only allow starting from pending or collecting_credentials
    if (session.status !== 'pending' && session.status !== 'collecting_credentials') {
      return NextResponse.json(
        { error: `Cannot start from status '${session.status}'` },
        { status: 409 },
      );
    }

    const def = getIntegration(session.integration);
    if (!def) {
      return NextResponse.json(
        { error: `Unknown integration: ${session.integration}` },
        { status: 400 },
      );
    }

    // Try to invoke the gateway
    const gateway = getGateway();
    if (!gateway.connected) {
      // OpenClaw unavailable — transition to collecting_credentials for manual fallback
      await updateSession(id, { status: 'collecting_credentials' });
      return NextResponse.json(
        { ok: false, openclawConnected: false },
        { status: 200 },
      );
    }

    try {
      await gateway.invoke('connection.start', {
        sessionId: id,
        integration: session.integration,
        tier: session.tier,
        steps: session.steps,
      });

      // Update session to wiring — OpenClaw is now driving
      await updateSession(id, { status: 'wiring' });

      return NextResponse.json({ ok: true, openclawConnected: true });
    } catch {
      // Gateway invoke failed — transition to collecting_credentials for manual fallback
      await updateSession(id, { status: 'collecting_credentials' });
      return NextResponse.json(
        { ok: false, openclawConnected: false },
        { status: 200 },
      );
    }
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
