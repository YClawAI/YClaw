export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

/** GET: Fetch onboarding status. */
export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const orgId = req.nextUrl.searchParams.get('orgId') ?? 'default';

  const path = sessionId
    ? `/v1/onboarding/status?sessionId=${sessionId}`
    : `/v1/onboarding/status?orgId=${orgId}`;

  const result = await fetchCoreApi<unknown>(path);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to fetch status' },
      { status: result.status || 502 },
    );
  }
  return NextResponse.json(result.data);
}

/** POST: Start new onboarding session. */
export async function POST() {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const result = await fetchCoreApi<unknown>('/v1/onboarding/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: 'default' }),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to start onboarding' },
      { status: result.status || 502 },
    );
  }
  return NextResponse.json(result.data, { status: 201 });
}
