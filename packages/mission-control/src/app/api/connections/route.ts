export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createSession, listSessions, isIntegrationAllowed, isIntegrationEnabled, DatabaseUnavailableError } from '@/lib/connections';
import { getIntegration } from '@/lib/integration-registry';
import type { ConnectionStep } from '@/lib/connections';

/** POST /api/connections — Create a new ConnectionSession */
export async function POST(req: Request) {
  let body: { integration?: string; metadata?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const integrationId = body.integration;
  if (!integrationId || typeof integrationId !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: integration' },
      { status: 400 },
    );
  }

  const def = getIntegration(integrationId);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown integration: ${integrationId}` },
      { status: 400 },
    );
  }

  // Safety gate: integration allowlist
  const allowed = await isIntegrationAllowed(integrationId);
  if (!allowed) {
    return NextResponse.json(
      { error: `Integration '${integrationId}' is not in the allowed list` },
      { status: 403 },
    );
  }

  // Safety gate: circuit breaker
  const enabled = await isIntegrationEnabled(integrationId);
  if (!enabled) {
    return NextResponse.json(
      { error: `Integration '${integrationId}' is currently disabled` },
      { status: 403 },
    );
  }

  let steps: ConnectionStep[];
  let initialStatus: 'collecting_credentials' | 'pending';

  if (def.tier >= 2) {
    // Tier 2+: load recipe steps and convert to ConnectionSteps
    try {
      const { loadRecipe } = await import('@yclaw/core');
      const recipe = loadRecipe(integrationId);
      if (recipe) {
        steps = recipe.steps.map((s, i) => ({
          id: s.id,
          label: s.label,
          actor: s.actor as ConnectionStep['actor'],
          status: i === 0 ? 'active' as const : 'pending' as const,
        }));
      } else {
        // Recipe not found — fall back to default 3-step flow
        steps = [
          { id: 'credentials', label: 'Enter Credentials', actor: 'human', status: 'active' },
          { id: 'store', label: 'Save Credentials', actor: 'system', status: 'pending' },
          { id: 'verify', label: 'Verify Connection', actor: 'system', status: 'pending' },
        ];
      }
    } catch {
      // Recipe loader unavailable — fall back to default
      steps = [
        { id: 'credentials', label: 'Enter Credentials', actor: 'human', status: 'active' },
        { id: 'store', label: 'Save Credentials', actor: 'system', status: 'pending' },
        { id: 'verify', label: 'Verify Connection', actor: 'system', status: 'pending' },
      ];
    }
    initialStatus = 'pending';
  } else {
    // Tier 1: hardcoded 3-step flow
    steps = [
      { id: 'credentials', label: 'Enter Credentials', actor: 'human', status: 'active' },
      { id: 'store', label: 'Save Credentials', actor: 'human', status: 'pending' },
      { id: 'verify', label: 'Verify Connection', actor: 'human', status: 'pending' },
    ];
    initialStatus = 'collecting_credentials';
  }

  try {
    const session = await createSession(integrationId, def.tier, steps, initialStatus, body.metadata);
    return NextResponse.json(
      { sessionId: session._id, tier: session.tier, steps: session.steps },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    const msg = err instanceof Error ? err.message : 'Failed to create session';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET /api/connections — List all connection sessions */
export async function GET() {
  try {
    const sessions = await listSessions();
    // Strip credential references from list response
    const safe = sessions.map((s) => ({
      _id: s._id,
      integration: s.integration,
      tier: s.tier,
      status: s.status,
      steps: s.steps,
      credentials: {
        storedAt: s.credentials.storedAt,
        verified: s.credentials.verified,
      },
      error: s.error,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    return NextResponse.json(safe);
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
