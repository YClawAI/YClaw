import type { Redis } from 'ioredis';
import { createLogger } from '../logging/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const TASK_KEY_PREFIX = 'task:';
const TASK_AGENT_INDEX_PREFIX = 'task:agent:';
const LAST_FULL_KEY = 'heartbeat:last_full';
const METRICS_KEY = 'heartbeat:metrics:latest';
const STALE_THRESHOLD_MS = 60 * 60 * 1000;      // 1 hour
const FAILSAFE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SCAN_BATCH = 100;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HeartbeatMetrics {
  pending_tasks: number;
  unprocessed_events: number;
  stale_items: number;
  last_full_heartbeat_ms: number;
}

export interface HeartbeatCheckResult {
  trigger: boolean;
  reason: string;
  metrics: HeartbeatMetrics;
}

/**
 * Optional EventStream interface — only the method we need.
 * Avoids hard dependency on event-stream.ts which may not be merged yet.
 */
interface EventStreamLike {
  pendingCount(typePrefix?: string): Promise<number>;
}

// ─── HeartbeatChecker ───────────────────────────────────────────────────────

const log = createLogger('heartbeat-checker');

/**
 * Lightweight pre-flight check for the Strategist heartbeat cron.
 *
 * Queries Redis to determine if there is actual work pending before invoking
 * the full LLM execution. This saves ~170k context tokens per skipped
 * heartbeat by moving the "is there work?" check outside the LLM.
 *
 * Decision logic:
 *   1. pending_tasks > 0 OR unprocessed_events > 0 OR stale_items > 0 → trigger
 *   2. last_full_heartbeat > 12 hours ago → trigger (failsafe)
 *   3. Otherwise → skip
 */
export async function shouldTriggerHeartbeat(
  redis: Redis | null,
  eventStream?: EventStreamLike | null,
): Promise<HeartbeatCheckResult> {
  // No Redis → always trigger (can't check state)
  if (!redis) {
    return {
      trigger: true,
      reason: 'No Redis — cannot check state, triggering as fallback',
      metrics: { pending_tasks: 0, unprocessed_events: 0, stale_items: 0, last_full_heartbeat_ms: 0 },
    };
  }

  try {
    const [taskCounts, unprocessedEvents, lastFullMs] = await Promise.all([
      scanTaskCounts(redis),
      getUnprocessedEvents(eventStream),
      getLastFullHeartbeat(redis),
    ]);

    const metrics: HeartbeatMetrics = {
      pending_tasks: taskCounts.pending,
      unprocessed_events: unprocessedEvents,
      stale_items: taskCounts.stale,
      last_full_heartbeat_ms: lastFullMs,
    };

    // Persist metrics for monitoring
    await persistMetrics(redis, metrics);

    // Decision logic
    if (metrics.pending_tasks > 0) {
      return { trigger: true, reason: `${metrics.pending_tasks} pending task(s)`, metrics };
    }
    if (metrics.unprocessed_events > 0) {
      return { trigger: true, reason: `${metrics.unprocessed_events} unprocessed event(s)`, metrics };
    }
    if (metrics.stale_items > 0) {
      return { trigger: true, reason: `${metrics.stale_items} stale task(s) (>1h in_progress)`, metrics };
    }

    // Failsafe: trigger if last full heartbeat was > 12 hours ago (or never)
    const timeSinceLast = lastFullMs > 0 ? Date.now() - lastFullMs : Infinity;
    if (timeSinceLast > FAILSAFE_INTERVAL_MS) {
      return { trigger: true, reason: 'Failsafe — last full heartbeat >12h ago', metrics };
    }

    return { trigger: false, reason: 'No pending work', metrics };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Heartbeat check failed — triggering as fallback', { error: msg });
    return {
      trigger: true,
      reason: `Check failed (${msg}) — triggering as fallback`,
      metrics: { pending_tasks: 0, unprocessed_events: 0, stale_items: 0, last_full_heartbeat_ms: 0 },
    };
  }
}

/**
 * Record that a full Strategist heartbeat has completed.
 * Called after executor.execute() returns for a heartbeat task.
 */
export async function recordFullHeartbeat(redis: Redis | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(LAST_FULL_KEY, String(Date.now()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Failed to record heartbeat timestamp', { error: msg });
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

interface TaskCounts {
  pending: number;
  stale: number;
}

/**
 * SCAN for task:* hashes (excluding task:agent:* indexes) and count
 * active (pending/in_progress) and stale tasks.
 */
async function scanTaskCounts(redis: Redis): Promise<TaskCounts> {
  let pending = 0;
  let stale = 0;
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor, 'MATCH', `${TASK_KEY_PREFIX}*`, 'COUNT', String(SCAN_BATCH),
    );
    cursor = nextCursor;

    for (const key of keys) {
      // Skip agent index ZSETs (task:agent:builder, etc.)
      if (key.startsWith(TASK_AGENT_INDEX_PREFIX)) continue;

      const [status, updatedAt] = await redis.hmget(key, 'status', 'updatedAt');
      if (!status) continue;

      if (status === 'pending' || status === 'in_progress') {
        pending++;
      }

      if (status === 'in_progress' && updatedAt) {
        const elapsed = Date.now() - parseInt(updatedAt, 10);
        if (elapsed > STALE_THRESHOLD_MS) {
          stale++;
        }
      }
    }
  } while (cursor !== '0');

  return { pending, stale };
}

async function getUnprocessedEvents(
  eventStream?: EventStreamLike | null,
): Promise<number> {
  if (!eventStream) return 0;
  try {
    return await eventStream.pendingCount();
  } catch {
    return 0;
  }
}

async function getLastFullHeartbeat(redis: Redis): Promise<number> {
  try {
    const val = await redis.get(LAST_FULL_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

async function persistMetrics(redis: Redis, metrics: HeartbeatMetrics): Promise<void> {
  try {
    const data = JSON.stringify({
      ...metrics,
      checked_at: new Date().toISOString(),
      checked_at_ms: Date.now(),
    });
    await redis.set(METRICS_KEY, data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Failed to persist heartbeat metrics', { error: msg });
  }
}
