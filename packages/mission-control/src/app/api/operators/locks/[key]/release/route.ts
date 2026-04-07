export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

export async function POST(
  _req: Request,
  { params }: { params: { key: string } },
) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // department_head+ can release locks
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  const result = await fetchCoreApi<unknown>(
    `/v1/locks/${encodeURIComponent(params.key)}/release`,
    { method: 'POST', operatorId: auth.session.user.operatorId },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to release lock' },
      { status: result.status || 502 },
    );
  }

  return NextResponse.json(result.data);
}
