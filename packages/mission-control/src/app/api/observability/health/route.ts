export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const result = await fetchCoreApi<unknown>('/v1/observability/health');
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to fetch health' },
      { status: result.status || 502 },
    );
  }
  return NextResponse.json(result.data);
}
