export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

/** GET: List artifacts for a session. */
export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const result = await fetchCoreApi<unknown>(`/v1/onboarding/artifacts?sessionId=${sessionId}`);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }
  return NextResponse.json(result.data);
}

/** POST: Approve or reject an artifact. */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const action = req.nextUrl.searchParams.get('action');
  const body = await req.json();
  const artifactId = body.artifactId;

  if (!artifactId || !['approve', 'reject'].includes(action ?? '')) {
    return NextResponse.json({ error: 'artifactId and action (approve/reject) required' }, { status: 400 });
  }

  const result = await fetchCoreApi<unknown>(`/v1/onboarding/artifacts/${artifactId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: body.sessionId }),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }
  return NextResponse.json(result.data);
}
