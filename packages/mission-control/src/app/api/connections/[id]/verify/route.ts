export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSession, updateSession, getSecret, DatabaseUnavailableError } from '@/lib/connections';
import { getIntegration } from '@/lib/integration-registry';
import { sanitize } from '@/lib/log-sanitizer';

/** POST /api/connections/[id]/verify — Verify the connection */
export async function POST(
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

  const def = getIntegration(session.integration);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown integration: ${session.integration}` },
      { status: 400 },
    );
  }

  if (!session.credentials.secretRef) {
    return NextResponse.json(
      { error: 'No credentials stored for this session' },
      { status: 400 },
    );
  }

  // Read credential from secret store
  let fields;
  try {
    fields = await getSecret(session.credentials.secretRef);
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }
    throw err;
  }

  if (!fields) {
    await updateSession(params.id, {
      status: 'failed',
      error: 'Credential not found in secret store',
      steps: session.steps.map((s) =>
        s.id === 'verify'
          ? { ...s, status: 'failed' as const, detail: 'Credential not found' }
          : s,
      ),
    });
    return NextResponse.json(
      { error: 'Credential not found in secret store' },
      { status: 500 },
    );
  }

  if (!def.verifyEndpoint) {
    // No verification endpoint — mark verify step complete but check for remaining steps
    const steps = session.steps.map((s) =>
      s.id === 'verify'
        ? { ...s, status: 'complete' as const, detail: 'No verification endpoint configured' }
        : s,
    );
    const hasRemainingSteps = steps.some(
      (s) => s.status === 'pending' || s.status === 'active',
    );
    const sessionStatus = hasRemainingSteps ? 'verifying' as const : 'connected' as const;
    await updateSession(params.id, {
      status: sessionStatus,
      steps,
      credentials: { ...session.credentials, verified: true },
    });
    return NextResponse.json({ ok: true, verified: true, status: sessionStatus });
  }

  // Build verification request headers based on authStyle
  const apiKey = fields['api_key'] ?? Object.values(fields)[0];
  if (!apiKey) {
    await updateSession(params.id, {
      status: 'failed',
      error: 'No API key found in stored credentials',
    });
    return NextResponse.json(
      { error: 'No API key found in stored credentials' },
      { status: 500 },
    );
  }

  const headers: Record<string, string> = {
    ...(def.verifyHeaders ?? {}),
  };

  const authStyle = def.authStyle ?? 'bearer';
  switch (authStyle) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'x-api-key':
      headers['x-api-key'] = apiKey;
      break;
    case 'custom-header':
      if (def.authHeader) {
        headers[def.authHeader] = apiKey;
      }
      break;
    // query-param handled below
  }

  let verifyUrl = def.verifyEndpoint;
  if (authStyle === 'query-param') {
    const sep = verifyUrl.includes('?') ? '&' : '?';
    verifyUrl = `${verifyUrl}${sep}key=${encodeURIComponent(apiKey)}`;
  }

  try {
    const fetchOpts: RequestInit = {
      method: def.verifyMethod ?? 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    };
    // Support POST verification with body (e.g., GraphQL queries)
    if (def.verifyBody) {
      fetchOpts.body = def.verifyBody;
    }
    const res = await fetch(verifyUrl, fetchOpts);

    if (res.ok) {
      // For Slack-style APIs that return 200 with ok: false in body
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        try {
          const body = await res.json();
          if (body && typeof body === 'object' && 'ok' in body && body.ok === false) {
            const errMsg = body.error ?? 'API returned ok: false';
            const failSteps = session.steps.map((s) =>
              s.id === 'verify'
                ? { ...s, status: 'failed' as const, detail: errMsg }
                : s,
            );
            await updateSession(params.id, {
              status: 'failed',
              steps: failSteps,
              credentials: { ...session.credentials, verified: false },
              error: `Verification failed: ${errMsg}`,
            });
            return NextResponse.json(
              { ok: false, verified: false, error: errMsg },
              { status: 422 },
            );
          }
        } catch {
          // JSON parse failed — treat HTTP 2xx as success
        }
      }

      // Mark verify step complete
      const steps = session.steps.map((s) =>
        s.id === 'verify'
          ? { ...s, status: 'complete' as const, detail: `HTTP ${res.status}` }
          : s,
      );

      // Only mark session 'connected' if ALL steps are complete (or skipped)
      // Post-verify steps (e.g., discover_repos) remain pending for async processing
      const hasRemainingSteps = steps.some(
        (s) => s.status === 'pending' || s.status === 'active',
      );
      const sessionStatus = hasRemainingSteps ? 'verifying' as const : 'connected' as const;

      await updateSession(params.id, {
        status: sessionStatus,
        steps,
        credentials: { ...session.credentials, verified: true },
      });
      return NextResponse.json({ ok: true, verified: true, status: sessionStatus });
    }

    // Verification failed — return 422 so clients can distinguish from transport errors
    const errText = await res.text().catch(() => '');
    const detail = sanitize(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    const steps = session.steps.map((s) =>
      s.id === 'verify'
        ? { ...s, status: 'failed' as const, detail }
        : s,
    );
    await updateSession(params.id, {
      status: 'failed',
      steps,
      credentials: { ...session.credentials, verified: false },
      error: `Verification failed: ${detail}`,
    });
    return NextResponse.json(
      { ok: false, verified: false, error: detail },
      { status: 422 },
    );
  } catch (err) {
    const msg = sanitize(err instanceof Error ? err.message : 'Verification request failed');
    const steps = session.steps.map((s) =>
      s.id === 'verify'
        ? { ...s, status: 'failed' as const, detail: msg }
        : s,
    );
    await updateSession(params.id, {
      status: 'failed',
      steps,
      credentials: { ...session.credentials, verified: false },
      error: msg,
    });
    return NextResponse.json(
      { ok: false, verified: false, error: msg },
      { status: 502 },
    );
  }
}
