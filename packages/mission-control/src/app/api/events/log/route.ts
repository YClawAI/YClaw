export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { queryEventLog } from '@/lib/event-log-queries';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const agent = searchParams.get('agent') || undefined;
  const type = searchParams.get('type') || undefined;
  const status = searchParams.get('status') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '50', 10)));

  const result = await queryEventLog({ agent, type, status, from, to }, page, pageSize);

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
