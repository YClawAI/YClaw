/**
 * Deploy State — Graceful shutdown, circuit breaker safety, and startup cleanup.
 *
 * Three standalone functions for managing task state during ECS deploys:
 *   1. classifyDrainTermination — Decide terminal state for in-flight tasks on SIGTERM
 *   2. isCountableFailure — Filter SIGTERM kills from circuit breaker failure counts
 *   3. flushStaleTaskState — Startup cleanup of zombie tasks from previous deploys
 */

import type { Redis } from 'ioredis';
import { TaskState, type TaskFailureReason } from './types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('deploy-state');

// ─── Terminal state set ─────────────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  TaskState.COMPLETED,
  TaskState.FAILED,
  TaskState.TIMEOUT,
  TaskState.SKIPPED,
  TaskState.REQUEUED,
]);

// ─── 1. classifyDrainTermination ────────────────────────────────────────────

/**
 * Decide the terminal state for a task when the worker is draining (SIGTERM).
 *
 * If the task is already terminal, preserve its state (no-op).
 * If still in-flight (RUNNING/ASSIGNED/QUEUED), mark as REQUEUED with
 * failureReason 'sigterm' so it can be retried after restart.
 */
export function classifyDrainTermination(currentState: TaskState): {
  newState: TaskState;
  failureReason: TaskFailureReason | undefined;
} {
  if (TERMINAL_STATES.has(currentState)) {
    return { newState: currentState, failureReason: undefined };
  }

  // In-flight task interrupted by SIGTERM — mark for re-queue
  return { newState: TaskState.REQUEUED, failureReason: 'sigterm' };
}

// ─── 2. isCountableFailure ──────────────────────────────────────────────────

/**
 * Determine whether a task result should count toward circuit breaker thresholds.
 *
 * Only FAILED and TIMEOUT count as real failures. SIGTERM-caused failures
 * (failureReason === 'sigterm') are excluded — they represent infrastructure
 * events, not code/task problems, and should never trip circuit breakers.
 */
export function isCountableFailure(
  state: TaskState,
  failureReason?: TaskFailureReason,
): boolean {
  if (failureReason === 'sigterm') return false;
  return state === TaskState.FAILED || state === TaskState.TIMEOUT;
}

// ─── 3. flushStaleTaskState ─────────────────────────────────────────────────

export interface FlushResult {
  tasksDeleted: number;
  queueEntriesRemoved: number;
  dlqEntriesRemoved: number;
}

/**
 * Startup cleanup: scan Redis for zombie tasks from previous deploys.
 *
 * - SCAN all task hashes matching the prefix
 * - Find non-terminal tasks (QUEUED/ASSIGNED/RUNNING) older than staleAgeMs
 * - Delete their task hashes
 * - Remove from queue ZSETs (P0-P3)
 * - Remove stale DLQ entries (parse failedAt, discard if older than cutoff)
 */
export async function flushStaleTaskState(
  redis: Redis,
  taskKeyPrefix: string,
  queueKeyPrefix: string,
  dlqKey: string,
  staleAgeMs: number,
): Promise<FlushResult> {
  const cutoff = Date.now() - staleAgeMs;
  let tasksDeleted = 0;
  let queueEntriesRemoved = 0;
  let dlqEntriesRemoved = 0;

  // ─── Scan task hashes ───────────────────────────────────────────────────
  let cursor = '0';
  const staleTaskIds: string[] = [];

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH', `${taskKeyPrefix}*`,
      'COUNT', '100',
    );
    cursor = nextCursor;

    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (!data?.state) continue;

      const state = data.state as TaskState;
      // Only clean up non-terminal tasks
      if (TERMINAL_STATES.has(state)) continue;

      // Check age via createdAt
      const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;
      if (createdAt > 0 && createdAt < cutoff) {
        const taskId = key.slice(taskKeyPrefix.length);
        staleTaskIds.push(taskId);
        await redis.del(key);
        tasksDeleted++;
      }
    }
  } while (cursor !== '0');

  // ─── Remove from queue ZSETs ────────────────────────────────────────────
  if (staleTaskIds.length > 0) {
    for (const priority of ['P0', 'P1', 'P2', 'P3']) {
      const queueKey = `${queueKeyPrefix}:${priority}`;
      for (const taskId of staleTaskIds) {
        const removed = await redis.zrem(queueKey, taskId);
        queueEntriesRemoved += removed;
      }
    }
  }

  // ─── Prune stale DLQ entries ────────────────────────────────────────────
  const dlqLen = await redis.llen(dlqKey);
  if (dlqLen > 0) {
    const allRaw = await redis.lrange(dlqKey, 0, -1);
    const keep: string[] = [];

    for (const raw of allRaw) {
      try {
        const entry = JSON.parse(raw) as { failedAt?: string };
        const failedAt = entry.failedAt ? new Date(entry.failedAt).getTime() : 0;
        if (failedAt > 0 && failedAt < cutoff) {
          dlqEntriesRemoved++;
          continue; // discard
        }
        keep.push(raw);
      } catch {
        keep.push(raw); // Keep unparseable entries
      }
    }

    if (dlqEntriesRemoved > 0) {
      // Atomic replace: delete + re-push
      const multi = redis.multi();
      multi.del(dlqKey);
      if (keep.length > 0) {
        multi.rpush(dlqKey, ...keep);
      }
      await multi.exec();
    }
  }

  if (tasksDeleted > 0 || queueEntriesRemoved > 0 || dlqEntriesRemoved > 0) {
    logger.info('Stale task state flushed on startup', {
      tasksDeleted,
      queueEntriesRemoved,
      dlqEntriesRemoved,
      staleAgeMs,
    });
  }

  return { tasksDeleted, queueEntriesRemoved, dlqEntriesRemoved };
}
