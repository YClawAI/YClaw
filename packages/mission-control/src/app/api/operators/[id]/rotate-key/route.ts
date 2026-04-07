export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { getAuthFacade } from '@yclaw/core/auth';
import { requireSession, checkSelfOrRoot } from '@/lib/require-permission';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // Root OR self can rotate keys
  const denied = checkSelfOrRoot(auth.session, params.id);
  if (denied) return denied;

  const result = await fetchCoreApi<unknown>(
    `/v1/operators/${encodeURIComponent(params.id)}/rotate-key`,
    { method: 'POST', operatorId: auth.session.user.operatorId },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to rotate key' },
      { status: result.status || 502 },
    );
  }

  // Invalidate Redis cache so new key takes effect immediately
  try {
    const facade = await getAuthFacade();
    await facade.invalidateOperatorCache(params.id);
  } catch {
    // Best-effort — rotation already persisted in core
  }

  return NextResponse.json(result.data);
}
