export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // department_head+ can reject cross-dept requests
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  let body: { note?: string } = {};
  try {
    body = await req.json();
  } catch {
    // note is optional
  }

  const result = await fetchCoreApi<unknown>(
    `/v1/approvals/cross-dept/${encodeURIComponent(params.id)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ note: body.note }),
      operatorId: auth.session.user.operatorId,
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to reject request' },
      { status: result.status || 502 },
    );
  }

  return NextResponse.json(result.data);
}
