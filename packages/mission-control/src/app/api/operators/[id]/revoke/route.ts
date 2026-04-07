export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { getAuthFacade } from '@yclaw/core/auth';
import { requireSession, checkTier } from '@/lib/require-permission';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // Only root can revoke operators
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  // Cannot revoke self
  if (auth.session.user.operatorId === params.id) {
    return NextResponse.json(
      { error: 'Cannot revoke your own operator account' },
      { status: 400 },
    );
  }

  let body: { reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    // reason is optional
  }

  const result = await fetchCoreApi<unknown>(
    `/v1/operators/${encodeURIComponent(params.id)}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: body.reason || 'Revoked via Mission Control' }),
      operatorId: auth.session.user.operatorId,
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to revoke operator' },
      { status: result.status || 502 },
    );
  }

  // Invalidate Redis cache so revocation takes effect immediately
  try {
    const facade = await getAuthFacade();
    await facade.invalidateOperatorCache(params.id);
  } catch {
    // Best-effort — revocation already persisted in core
  }

  return NextResponse.json(result.data ?? { success: true });
}
