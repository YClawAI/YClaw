export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { redisPing, getRedisConnectionState } from '@/lib/redis';
import { getGateway } from '@/lib/gateway-ws';
import { fetchCoreApi } from '@/lib/core-api';

interface HealthCheck {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  message?: string;
}

export async function GET() {
  const checks: HealthCheck[] = [];

  // ── MongoDB ──────────────────────────────────────────────────────
  try {
    const db = await getDb();
    if (db) {
      await db.command({ ping: 1 });
      checks.push({ name: 'mongodb', status: 'ok' });
    } else {
      checks.push({ name: 'mongodb', status: 'down', message: 'Not configured or unreachable' });
    }
  } catch (err) {
    checks.push({
      name: 'mongodb',
      status: 'down',
      message: err instanceof Error ? err.message : 'Unreachable',
    });
  }

  // ── Redis ────────────────────────────────────────────────────────
  try {
    const pong = await redisPing();
    if (pong) {
      checks.push({ name: 'redis', status: 'ok' });
    } else {
      const state = getRedisConnectionState();
      checks.push({
        name: 'redis',
        status: state === 'reconnecting' ? 'degraded' : 'down',
        message: `Connection state: ${state}`,
      });
    }
  } catch (err) {
    checks.push({
      name: 'redis',
      status: 'down',
      message: err instanceof Error ? err.message : 'Unreachable',
    });
  }

  // ── Gateway (WebSocket) ──────────────────────────────────────────
  try {
    const gateway = getGateway();
    if (gateway.connected) {
      checks.push({ name: 'gateway', status: 'ok' });
    } else {
      checks.push({ name: 'gateway', status: 'degraded', message: 'Not connected' });
    }
  } catch (err) {
    checks.push({
      name: 'gateway',
      status: 'down',
      message: err instanceof Error ? err.message : 'Unavailable',
    });
  }

  // ── Operator subsystem (core API) ────────────────────────────────
  try {
    const result = await fetchCoreApi<unknown>('/v1/operators', { cache: 'no-store' });
    if (result.ok) {
      checks.push({ name: 'operators', status: 'ok' });
    } else if (result.status === 503) {
      checks.push({ name: 'operators', status: 'degraded', message: result.error ?? 'Service unavailable' });
    } else {
      checks.push({ name: 'operators', status: 'down', message: result.error ?? `HTTP ${result.status}` });
    }
  } catch (err) {
    checks.push({
      name: 'operators',
      status: 'down',
      message: err instanceof Error ? err.message : 'Unreachable',
    });
  }

  // ── Aggregate ────────────────────────────────────────────────────
  // Core deps (mongodb, redis) must be up for a healthy ALB response.
  // Optional deps (gateway, operators) can be down without failing the
  // health check — they degrade functionality but the app still serves.
  const CORE_DEPS = new Set(['mongodb', 'redis']);
  const coreDown = checks.some((c) => CORE_DEPS.has(c.name) && c.status === 'down');
  const hasDown = checks.some((c) => c.status === 'down');
  const hasDegraded = checks.some((c) => c.status === 'degraded');

  const overallStatus: 'ok' | 'degraded' | 'down' = hasDown
    ? 'down'
    : hasDegraded
      ? 'degraded'
      : 'ok';

  const httpStatus = coreDown ? 503 : 200;

  return NextResponse.json({ status: overallStatus, checks }, { status: httpStatus });
}
