export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSession, updateSession, DatabaseUnavailableError } from '@/lib/connections';
import { getIntegration } from '@/lib/integration-registry';
import { sanitize } from '@/lib/log-sanitizer';

/**
 * POST /api/connections/[id]/wire — Trigger Strategist for Tier 3 self-wiring.
 *
 * Called by OpenClaw after credentials are stored and verified.
 * Makes POST /api/trigger to YClaw Agents to invoke the Strategist.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let session;
  try {
    session = await getSession(id);
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    throw err;
  }

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Only wire from verifying or wiring status
  const allowedStatuses = new Set(['verifying', 'wiring']);
  if (!allowedStatuses.has(session.status)) {
    return NextResponse.json(
      { error: `Cannot wire from status '${session.status}'` },
      { status: 409 },
    );
  }

  // Credentials must be verified before triggering fleet wiring
  if (!session.credentials.verified) {
    return NextResponse.json(
      { error: 'Credentials must be verified before wiring' },
      { status: 400 },
    );
  }

  const def = getIntegration(session.integration);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown integration: ${session.integration}` },
      { status: 400 },
    );
  }

  // Load the full recipe for context
  let recipe;
  try {
    const { loadRecipe } = await import('@yclaw/core');
    recipe = loadRecipe(session.integration);
  } catch {
    // Recipe loader unavailable
  }

  // Find remaining fleet steps
  const fleetSteps = session.steps.filter(
    (s) => s.actor === 'fleet' && (s.status === 'pending' || s.status === 'active'),
  );

  if (fleetSteps.length === 0) {
    // No fleet work needed — mark connected
    await updateSession(id, { status: 'connected' });
    return NextResponse.json({ ok: true, status: 'connected', executionId: null });
  }

  // Trigger the Strategist via YClaw Agents /api/trigger
  const agentsUrl = process.env.YCLAW_AGENTS_URL ?? 'http://localhost:3000';

  try {
    const triggerRes = await fetch(`${agentsUrl}/api/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'strategist',
        task: 'wire_integration',
        context: {
          sessionId: id,
          integration: session.integration,
          recipe: recipe ?? null,
          fieldRefs: session.credentials.fieldRefs ?? {},
          metadata: session.metadata ?? {},
          currentStep: fleetSteps[0]?.id,
          tier: session.tier,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!triggerRes.ok) {
      const errText = await triggerRes.text().catch(() => '');
      const detail = sanitize(`Strategist trigger failed (${triggerRes.status}): ${errText.slice(0, 200)}`);

      // Mark first fleet step as failed
      const steps = session.steps.map((s) =>
        s.id === fleetSteps[0]?.id
          ? { ...s, status: 'failed' as const, detail }
          : s,
      );
      await updateSession(id, { status: 'failed', steps, error: detail });
      return NextResponse.json({ ok: false, error: detail }, { status: 502 });
    }

    const triggerData = await triggerRes.json().catch(() => ({}));
    const executionId = triggerData.executionId ?? triggerData.id ?? null;

    // Transition to wiring — Strategist is now driving fleet steps
    const steps = session.steps.map((s) =>
      s.id === fleetSteps[0]?.id
        ? { ...s, status: 'active' as const, detail: 'Strategist assigned' }
        : s,
    );
    await updateSession(id, { status: 'wiring', steps });

    return NextResponse.json({ ok: true, status: 'wiring', executionId });
  } catch (err) {
    // Graceful degradation: if YClaw Agents is unreachable, skip fleet steps
    // and mark the connection as connected (credentials-only mode).
    const isNetworkError = err instanceof TypeError || (err instanceof Error && err.message.includes('fetch'));
    if (isNetworkError) {
      const steps = session.steps.map((s) =>
        s.actor === 'fleet'
          ? { ...s, status: 'skipped' as const, detail: 'YClaw Agents unavailable — skipped' }
          : s,
      );
      // Mark as connected but with error noting degradation so UI can distinguish
      await updateSession(id, {
        status: 'connected',
        steps,
        error: 'Connected in degraded mode: fleet wiring skipped (YClaw Agents unavailable). No codegen, deploy, or smoke test was performed.',
      });
      return NextResponse.json({
        ok: true,
        status: 'connected',
        executionId: null,
        degraded: true,
        message: 'Connected without fleet wiring (YClaw Agents unavailable)',
      });
    }

    const msg = sanitize(err instanceof Error ? err.message : 'Failed to trigger Strategist');
    const steps = session.steps.map((s) =>
      s.id === fleetSteps[0]?.id
        ? { ...s, status: 'failed' as const, detail: msg }
        : s,
    );
    await updateSession(id, { status: 'failed', steps, error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
