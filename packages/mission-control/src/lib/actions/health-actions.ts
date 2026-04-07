'use server';

import { getDb } from '@/lib/mongodb';
import { getRedis } from '@/lib/redis';

interface HealthResult {
  ok: boolean;
  error?: string;
}

export async function checkMongoHealth(): Promise<HealthResult> {
  try {
    const db = await getDb();
    if (!db) return { ok: false, error: 'MongoDB not configured' };
    await db.command({ ping: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'MongoDB ping failed' };
  }
}

export async function checkRedisHealth(): Promise<HealthResult> {
  try {
    const redis = getRedis();
    if (!redis) return { ok: false, error: 'Redis not configured' };
    const pong = await redis.ping();
    return pong === 'PONG' ? { ok: true } : { ok: false, error: 'Redis ping returned unexpected response' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Redis ping failed' };
  }
}
