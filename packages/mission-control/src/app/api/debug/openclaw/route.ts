export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireSession, checkTier } from '@/lib/require-permission';

// This route must never be reachable in production.
if (process.env.NODE_ENV === 'production') {
  exports.GET = () => NextResponse.json({ error: 'Not Found' }, { status: 404 });
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // Root only — debug endpoint
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const BASE_URL = process.env.OPENCLAW_URL || 'http://localhost:53847';
  const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    config: {
      OPENCLAW_URL: BASE_URL,
      tokenSet: !!TOKEN,
      tokenLength: TOKEN.length,
    },
    tests: {} as Record<string, unknown>,
  };

  const tests = results.tests as Record<string, unknown>;

  // Test 1: Basic TCP connectivity (health endpoint)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    tests.health = {
      status: res.status,
      ok: res.ok,
      body: await res.text().catch(() => 'read-error'),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    tests.health = {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }

  // Test 2: Authenticated tools/invoke
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'x-openclaw-agent-id': 'main',
      },
      body: JSON.stringify({ tool: 'session_status', args: {}, sessionKey: 'main' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const body = await res.text().catch(() => 'read-error');
    tests.toolsInvoke = {
      status: res.status,
      ok: res.ok,
      bodyPreview: body.slice(0, 500),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    tests.toolsInvoke = {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }

  // Test 3: Chat completions
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        model: 'openclaw:main',
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const body = await res.text().catch(() => 'read-error');
    tests.chatCompletions = {
      status: res.status,
      ok: res.ok,
      bodyPreview: body.slice(0, 500),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    tests.chatCompletions = {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }

  return NextResponse.json(results, { status: 200 });
}
