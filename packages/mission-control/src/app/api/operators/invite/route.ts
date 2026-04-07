export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

export async function POST(req: Request) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // Only root can invite operators
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const result = await fetchCoreApi<unknown>('/v1/operators/invite', {
    method: 'POST',
    body: JSON.stringify(body),
    operatorId: auth.session.user.operatorId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to create invite' },
      { status: result.status || 502 },
    );
  }

  return NextResponse.json(result.data, { status: 201 });
}
