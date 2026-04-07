import { NextResponse } from 'next/server';
import { getDepartmentData } from '@/lib/department-data';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = await getDepartmentData(['sentinel']);

  // Fleet status
  let fleetStatus = 'unknown';
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get('fleet:status');
      fleetStatus = raw === 'active' ? 'active' : raw === 'paused' ? 'paused' : 'unknown';
    } catch { /* graceful */ }
  }

  return NextResponse.json({ ...base, fleetStatus });
}
