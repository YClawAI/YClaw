'use server';

import { redisSet, redisPublish, redisGet } from '@/lib/redis';
import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/with-auth';

export type FleetStatus = 'active' | 'paused' | 'unknown';

export async function getFleetStatus(): Promise<FleetStatus> {
  try {
    const status = await redisGet('fleet:status');
    if (status === 'active') return 'active';
    if (status === 'paused') return 'paused';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export const toggleFleet = withAuth('root', async (
  _session,
  newStatus: 'active' | 'paused',
): Promise<{ ok: boolean; error?: string }> => {
  if (newStatus !== 'active' && newStatus !== 'paused') {
    return { ok: false, error: 'Invalid status' };
  }

  const ok = await redisSet('fleet:status', newStatus);
  if (!ok) {
    return { ok: false, error: 'Redis unavailable' };
  }
  await redisSet('fleet:mode', newStatus);

  await redisPublish(
    'fleet:status',
    JSON.stringify({ status: newStatus, at: new Date().toISOString() })
  );

  // Audit log
  const db = await getDb();
  if (db) {
    try {
      await db.collection('audit_log').insertOne({
        action: 'fleet:toggle',
        newStatus,
        timestamp: new Date().toISOString(),
        source: 'mission-control',
      });
    } catch {
      // best-effort audit
    }
  }

  await redisPublish('audit:events', JSON.stringify({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type: 'governance',
    severity: 'info',
    title: newStatus === 'active' ? 'Fleet tasks resumed' : 'Fleet tasks paused',
    detail: `Task execution is now ${newStatus}.`,
    actor: 'human',
    metadata: { action: 'fleet:toggle', newStatus },
  }));

  return { ok: true };
});
