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

// Per-check timeout so a slow dependency can't hang past the ALB 5s window.
const CHECK_TIMEOUT_MS = 2500;

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function GET() {
  // Run all checks in parallel so total wall time is max(individual) not sum.
  // Each check also has a per-check timeout cap to keep the route under the
  // ALB 5s health check timeout even if a dep hangs.
  const [mongoResult, redisResult, gatewayResult, operatorsResult] = await Promise.allSettled([
    withTimeout((async () => {
      const db = await getDb();
      if (!db) return { name: 'mongodb', status: 'down' as const, message: 'Not configured or unreachable' };
      await db.command({ ping: 1 });
      return { name: 'mongodb', status: 'ok' as const };
    })(), CHECK_TIMEOUT_MS, 'mongodb'),

    withTimeout((async () => {
      const pong = await redisPing();
      if (pong) return { name: 'redis', status: 'ok' as const };
      const state = getRedisConnectionState();
      return {
        name: 'redis',
        status: state === 'reconnecting' ? 'degraded' as const : 'down' as const,
        message: `Connection state: ${state}`,
      };
    })(), CHECK_TIMEOUT_MS, 'redis'),

    withTimeout((async () => {
      const gateway = getGateway();
      return gateway.connected
        ? { name: 'gateway', status: 'ok' as const }
        : { name: 'gateway', status: 'degraded' as const, message: 'Not connected' };
    })(), CHECK_TIMEOUT_MS, 'gateway'),

    withTimeout((async () => {
      const result = await fetchCoreApi<unknown>('/v1/operators', { cache: 'no-store' });
      if (result.ok) return { name: 'operators', status: 'ok' as const };
      if (result.status === 503) {
        return { name: 'operators', status: 'degraded' as const, message: result.error ?? 'Service unavailable' };
      }
      return { name: 'operators', status: 'down' as const, message: result.error ?? `HTTP ${result.status}` };
    })(), CHECK_TIMEOUT_MS, 'operators'),
  ]);

  const checks: HealthCheck[] = [
    mongoResult.status === 'fulfilled'
      ? mongoResult.value
      : { name: 'mongodb', status: 'down', message: mongoResult.reason instanceof Error ? mongoResult.reason.message : 'Unreachable' },
    redisResult.status === 'fulfilled'
      ? redisResult.value
      : { name: 'redis', status: 'down', message: redisResult.reason instanceof Error ? redisResult.reason.message : 'Unreachable' },
    gatewayResult.status === 'fulfilled'
      ? gatewayResult.value
      : { name: 'gateway', status: 'down', message: gatewayResult.reason instanceof Error ? gatewayResult.reason.message : 'Unavailable' },
    operatorsResult.status === 'fulfilled'
      ? operatorsResult.value
      : { name: 'operators', status: 'down', message: operatorsResult.reason instanceof Error ? operatorsResult.reason.message : 'Unreachable' },
  ];

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
