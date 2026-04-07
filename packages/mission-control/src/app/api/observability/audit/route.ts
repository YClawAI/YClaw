export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  // Forward all query params to core
  const params = req.nextUrl.searchParams.toString();
  const path = params ? `/v1/observability/audit?${params}` : '/v1/observability/audit';

  const result = await fetchCoreApi<unknown>(path);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to fetch audit timeline' },
      { status: result.status || 502 },
    );
  }
  return NextResponse.json(result.data);
}
