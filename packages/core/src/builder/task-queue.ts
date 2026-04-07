/**
 * Redis-backed Priority Task Queue for the Builder Dispatcher.
 *
 * Uses separate Redis sorted sets (ZSET) per priority level to eliminate
 * the score overflow problem from the original single-ZSET design.
 *
 * Priority levels map to dedicated keys:
 *   builder:task_queue:P0 — safety/error fixes
 *   builder:task_queue:P1 — code reviews
 *   builder:task_queue:P2 — implementation
 *   builder:task_queue:P3 — background
 *
 * Within each priority ZSET, scores are timestamp-based (FIFO ordering).
 * Dequeue checks P0 first, then P1, P2, P3 — guaranteeing priority
 * ordering without score overflow.
 *
 * When Redis is null, an in-memory fallback queue is used so tasks are
 * not silently dropped.
 */

import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import {
  type BuilderTask,
  type DispatcherConfig,
  type DlqEntry,
  TaskState,
  Priority,
  DEFAULT_DISPATCHER_CONFIG,
} from './types.js';

const logger = createLogger('builder-queue');

/** Per-process monotonic counter to break same-ms score ties. */
let scoreCounter = 0;

/** All priority levels in dequeue order (highest priority first). */
const PRIORITY_LEVELS = [
  Priority.P0_SAFETY,
  Priority.P1_REVIEW,
  Priority.P2_IMPLEMENTATION,
  Priority.P3_BACKGROUND,
] as const;

const NON_RETRYABLE_ERRORS = [
  'model not found',
  '401',
  '403',
  'excluded_repo',
  'missing required',
];

function isRetryable(error: string): boolean {
  const normalized = error.toLowerCase();
  return !NON_RETRYABLE_ERRORS.some(pattern => normalized.includes(pattern));
}

export class TaskQueue {
  private readonly queueKeyPrefix: string;
  private readonly taskKeyPrefix: string;
  private readonly completedTtl: number;
  private readonly promotionAgeMs: number;
  private readonly dlqKey: string;
  private readonly dlqMaxSize: number;

  /** In-memory fallback queue when Redis is null. Sorted by priority then timestamp. */
  private readonly memQueue: Array<{ task: BuilderTask; score: number }> = [];
  /** In-memory task store when Redis is null. */
  private readonly memTasks = new Map<string, BuilderTask>();

  constructor(
    private readonly redis: Redis | null,
    config?: Partial<DispatcherConfig>,
  ) {
    this.queueKeyPrefix = config?.queueKey ?? DEFAULT_DISPATCHER_CONFIG.queueKey;
    this.taskKeyPrefix = config?.taskKeyPrefix ?? DEFAULT_DISPATCHER_CONFIG.taskKeyPrefix;
    this.completedTtl = config?.completedTaskTtlSecs ?? DEFAULT_DISPATCHER_CONFIG.completedTaskTtlSecs;
    this.promotionAgeMs = config?.promotionAgeMs ?? DEFAULT_DISPATCHER_CONFIG.promotionAgeMs;
    this.dlqKey = config?.dlqKey ?? DEFAULT_DISPATCHER_CONFIG.dlqKey;
    this.dlqMaxSize = config?.dlqMaxSize ?? DEFAULT_DISPATCHER_CONFIG.dlqMaxSize;
  }

  /** Get the Redis ZSET key for a given priority level. */
  private priorityKey(priority: Priority): string {
    return `${this.queueKeyPrefix}:P${priority}`;
  }

  /**
   * Enqueue a new task. Creates the task record and adds it to the
   * priority-specific sorted set.
   */
  async enqueue(params: {
    taskName: string;
    priority: Priority;
    sourceEvent: string;
    triggerPayload: Record<string, unknown>;
    correlationId?: string;
    timeoutMs?: number;
    dlqRetryCount?: number;
    timeoutRetryCount?: number;
    modelOverride?: import('../config/schema.js').ModelConfig;
    // ACP session fields
    sessionId?: string;
    threadId?: string;
    executorHint?: 'pi' | 'cli' | 'auto';
    harness?: import('./types.js').BuilderTask['harness'];
    sessionModel?: string;
    prompt?: string;
    repoPath?: string;
    steerInstruction?: string;
    steerContext?: Record<string, unknown>;
  }): Promise<BuilderTask> {
    const task: BuilderTask = {
      id: randomUUID(),
      priority: params.priority,
      state: TaskState.QUEUED,
      taskName: params.taskName,
      triggerPayload: params.triggerPayload,
      sourceEvent: params.sourceEvent,
      correlationId: params.correlationId ?? randomUUID(),
      createdAt: new Date().toISOString(),
      timeoutMs: params.timeoutMs ?? DEFAULT_DISPATCHER_CONFIG.defaultTimeoutMs,
      ...(params.dlqRetryCount !== undefined ? { dlqRetryCount: params.dlqRetryCount } : {}),
      ...(params.timeoutRetryCount !== undefined ? { timeoutRetryCount: params.timeoutRetryCount } : {}),
      ...(params.modelOverride ? { modelOverride: params.modelOverride } : {}),
      // ACP session fields (all optional)
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.threadId ? { threadId: params.threadId } : {}),
      ...(params.executorHint ? { executorHint: params.executorHint } : {}),
      ...(params.harness ? { harness: params.harness } : {}),
      ...(params.sessionModel ? { sessionModel: params.sessionModel } : {}),
      ...(params.prompt ? { prompt: params.prompt } : {}),
      ...(params.repoPath ? { repoPath: params.repoPath } : {}),
      ...(params.steerInstruction ? { steerInstruction: params.steerInstruction } : {}),
      ...(params.steerContext ? { steerContext: params.steerContext } : {}),
    };

    const score = this.computeScore();

    if (this.redis) {
      const taskKey = this.taskKeyPrefix + task.id;
      const zsetKey = this.priorityKey(task.priority);

      // Store task data + add to sorted set atomically via pipeline
      const pipeline = this.redis.pipeline();
      pipeline.hset(taskKey, this.serializeTask(task));
      pipeline.zadd(zsetKey, score.toString(), task.id);
      await pipeline.exec();
    } else {
      // In-memory fallback: insert sorted by priority then score
      this.memTasks.set(task.id, { ...task });
      this.memQueue.push({ task, score });
      this.memQueue.sort((a, b) => {
        if (a.task.priority !== b.task.priority) return a.task.priority - b.task.priority;
        return a.score - b.score;
      });
    }

    logger.info(`Task enqueued: ${task.id} [${Priority[task.priority]}] ${task.taskName}`, {
      correlationId: task.correlationId,
      sourceEvent: task.sourceEvent,
    });

    return task;
  }

  /**
   * Dequeue the highest-priority task. Checks P0 first, then P1, P2, P3.
   * Within each level, dequeues the oldest task (FIFO).
   *
   * Returns null if all queues are empty.
   */
  async dequeue(): Promise<BuilderTask | null> {
    if (this.redis) {
      return this.dequeueRedis();
    }
    return this.dequeueMemory();
  }

  private async dequeueRedis(): Promise<BuilderTask | null> {
    // Check if a starved P3 task should be promoted ahead of P1/P2
    const promoted = await this.checkP3Promotion();
    if (promoted) return promoted;

    // Check each priority level in order (P0 → P3)
    for (const priority of PRIORITY_LEVELS) {
      const zsetKey = this.priorityKey(priority);
      const result = await this.redis!.zpopmin(zsetKey);
      if (!result || result.length < 2) continue; // Empty at this level

      const taskId = result[0]!;
      const taskKey = this.taskKeyPrefix + taskId;

      const data = await this.redis!.hgetall(taskKey);
      if (!data || Object.keys(data).length === 0) {
        // Task hash is missing after ZPOPMIN — log and retry
        logger.warn(`Dequeued task ${taskId} but no data found in hash — task is unrecoverable, skipping`);
        return this.dequeueRedis();
      }

      const task = this.deserializeTask(data);
      task.state = TaskState.ASSIGNED;
      task.assignedAt = new Date().toISOString();

      await this.redis!.hset(taskKey, {
        state: task.state,
        assignedAt: task.assignedAt,
      });

      logger.debug(`Task dequeued: ${task.id} [${Priority[task.priority]}] ${task.taskName}`);
      return task;
    }

    return null; // All queues empty
  }

  private dequeueMemory(): BuilderTask | null {
    const entry = this.memQueue.shift();
    if (!entry) return null;

    const task = entry.task;
    task.state = TaskState.ASSIGNED;
    task.assignedAt = new Date().toISOString();
    this.memTasks.set(task.id, { ...task });

    logger.debug(`Task dequeued (memory): ${task.id} [${Priority[task.priority]}] ${task.taskName}`);
    return task;
  }

  /**
   * Peek at the next task without removing it from the queue.
   */
  async peek(): Promise<BuilderTask | null> {
    if (!this.redis) {
      const entry = this.memQueue[0];
      return entry ? { ...entry.task } : null;
    }

    // Check each priority level for the first available task
    for (const priority of PRIORITY_LEVELS) {
      const zsetKey = this.priorityKey(priority);
      const members = await this.redis.zrange(zsetKey, 0, 0);
      if (members && members.length > 0) {
        const taskId = members[0]!;
        return this.getTask(taskId);
      }
    }

    return null;
  }

  /**
   * Get a task by ID.
   */
  async getTask(id: string): Promise<BuilderTask | null> {
    if (!this.redis) {
      const task = this.memTasks.get(id);
      return task ? { ...task } : null;
    }

    const data = await this.redis.hgetall(this.taskKeyPrefix + id);
    if (!data || Object.keys(data).length === 0) return null;

    return this.deserializeTask(data);
  }

  /**
   * Update a task's state. Sets completedAt for terminal states and
   * applies TTL for cleanup.
   */
  async updateTask(id: string, updates: Partial<BuilderTask>): Promise<void> {
    if (!this.redis) {
      // In-memory fallback
      const task = this.memTasks.get(id);
      if (task) {
        if (updates.state !== undefined) task.state = updates.state;
        if (updates.workerId !== undefined) task.workerId = updates.workerId;
        if (updates.error !== undefined) task.error = updates.error;
        if (updates.assignedAt !== undefined) task.assignedAt = updates.assignedAt;
        if (updates.completedAt !== undefined) task.completedAt = updates.completedAt;
      }
      return;
    }

    const taskKey = this.taskKeyPrefix + id;
    const fields: Record<string, string> = {};

    if (updates.state !== undefined) fields.state = updates.state;
    if (updates.workerId !== undefined) fields.workerId = updates.workerId;
    if (updates.error !== undefined) fields.error = updates.error;
    if (updates.assignedAt !== undefined) fields.assignedAt = updates.assignedAt;
    if (updates.completedAt !== undefined) fields.completedAt = updates.completedAt;

    if (Object.keys(fields).length > 0) {
      await this.redis.hset(taskKey, fields);
    }

    // Set TTL on completed/failed/timeout tasks for auto-cleanup
    const isTerminal = updates.state === TaskState.COMPLETED
      || updates.state === TaskState.FAILED
      || updates.state === TaskState.TIMEOUT;

    if (isTerminal) {
      await this.redis.expire(taskKey, this.completedTtl);
    }
  }

  /**
   * Get the total number of tasks across all priority queues.
   */
  async size(): Promise<number> {
    if (!this.redis) return this.memQueue.length;

    let total = 0;
    for (const priority of PRIORITY_LEVELS) {
      total += await this.redis.zcard(this.priorityKey(priority));
    }
    return total;
  }

  /**
   * Remove a task from the queue (e.g., for cancellation).
   * Checks all priority ZSETs since caller may not know the priority.
   */
  async remove(id: string): Promise<boolean> {
    if (!this.redis) {
      const idx = this.memQueue.findIndex(e => e.task.id === id);
      if (idx === -1) return false;
      this.memQueue.splice(idx, 1);
      return true;
    }
    // Try removing from each priority ZSET
    for (const priority of PRIORITY_LEVELS) {
      const removed = await this.redis.zrem(this.priorityKey(priority), id);
      if (removed > 0) return true;
    }
    return false;
  }

  /**
   * List all queued task IDs in priority order.
   */
  async listQueued(): Promise<string[]> {
    if (!this.redis) return this.memQueue.map(e => e.task.id);

    const allIds: string[] = [];
    for (const priority of PRIORITY_LEVELS) {
      const ids = await this.redis.zrange(this.priorityKey(priority), 0, -1);
      allIds.push(...ids);
    }
    return allIds;
  }

  /**
   * Get the queue depth broken down by each priority level.
   */
  async sizeByPriority(): Promise<{ P0: number; P1: number; P2: number; P3: number }> {
    if (!this.redis) {
      const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
      for (const entry of this.memQueue) {
        const key = `P${entry.task.priority}` as keyof typeof counts;
        counts[key]++;
      }
      return counts;
    }

    const [p0, p1, p2, p3] = await Promise.all([
      this.redis.zcard(this.priorityKey(Priority.P0_SAFETY)),
      this.redis.zcard(this.priorityKey(Priority.P1_REVIEW)),
      this.redis.zcard(this.priorityKey(Priority.P2_IMPLEMENTATION)),
      this.redis.zcard(this.priorityKey(Priority.P3_BACKGROUND)),
    ]);
    return { P0: p0, P1: p1, P2: p2, P3: p3 };
  }

  /**
   * Push a failed task entry to the dead-letter queue.
   * Uses LPUSH (newest first) and LTRIM to cap at dlqMaxSize entries.
   * No-op when Redis is null.
   */
  async pushToDlq(entry: DlqEntry): Promise<void> {
    if (!this.redis) return;
    const payload = JSON.stringify(entry);
    await this.redis.lpush(this.dlqKey, payload);
    await this.redis.ltrim(this.dlqKey, 0, this.dlqMaxSize - 1);
  }

  /**
   * Read the most recent DLQ entries (newest first).
   * Returns an empty array when Redis is null.
   */
  async getDlqEntries(limit = 10): Promise<DlqEntry[]> {
    if (!this.redis) return [];
    const raw = await this.redis.lrange(this.dlqKey, 0, limit - 1);
    const entries: DlqEntry[] = [];
    for (const s of raw) {
      try {
        entries.push(JSON.parse(s) as DlqEntry);
      } catch {
        logger.warn('Skipping malformed DLQ entry', { preview: s.slice(0, 100) });
      }
    }
    return entries;
  }

  /**
   * Get the total number of entries in the dead-letter queue.
   * Returns 0 when Redis is null.
   */
  async getDlqDepth(): Promise<number> {
    if (!this.redis) return 0;
    return this.redis.llen(this.dlqKey);
  }

  // ─── Phase 6: Startup Recovery ───────────────────────────────────────────

  /**
   * Scan Redis for orphaned tasks (QUEUED with no ZSET membership, or
   * ASSIGNED/RUNNING from a dead process) and re-enqueue them.
   *
   * Tasks older than `completedTtl` are discarded rather than recovered.
   *
   * Returns the number of tasks recovered.
   */
  async recoverOrphaned(
    getTimeoutForTask?: (taskName: string) => number,
  ): Promise<number> {
    if (!this.redis) return 0;

    let recovered = 0;
    let cursor = '0';
    const maxAgeMs = this.completedTtl * 1000; // completedTtl is in seconds

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.taskKeyPrefix}*`,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const data = await this.redis.hgetall(key);
        if (!data || Object.keys(data).length === 0) continue;

        const state = data.state as TaskState | undefined;
        if (!state) continue;

        // Only recover non-terminal tasks
        if (
          state !== TaskState.QUEUED
          && state !== TaskState.ASSIGNED
          && state !== TaskState.RUNNING
        ) {
          continue;
        }

        // Discard tasks older than completedTtl
        const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;
        if (Date.now() - createdAt > maxAgeMs) {
          logger.info('Discarding stale orphaned task', {
            taskId: data.id,
            state,
            ageMs: Date.now() - createdAt,
          });
          await this.redis.expire(key, 60); // Expire soon
          continue;
        }

        const task = this.deserializeTask(data);
        const priority = task.priority;
        const zsetKey = this.priorityKey(priority);

        if (state === TaskState.QUEUED) {
          // Verify it's actually in the ZSET
          const score = await this.redis.zscore(zsetKey, task.id);
          if (score !== null) continue; // Already in ZSET, nothing to do
        }

        // Reset to QUEUED and re-add to the priority ZSET.
        // Apply current timeout config so recovered tasks don't carry stale values.
        task.state = TaskState.QUEUED;
        task.workerId = undefined;
        task.assignedAt = undefined;
        if (getTimeoutForTask) {
          task.timeoutMs = getTimeoutForTask(task.taskName);
        }

        const score = this.computeScore();
        const pipeline = this.redis.pipeline();
        pipeline.hset(key, {
          state: TaskState.QUEUED,
          workerId: '',
          assignedAt: '',
          ...(getTimeoutForTask ? { timeoutMs: String(task.timeoutMs) } : {}),
        });
        pipeline.zadd(zsetKey, score.toString(), task.id);
        await pipeline.exec();

        recovered++;
        logger.info('Recovered orphaned task', {
          taskId: task.id,
          taskName: task.taskName,
          previousState: state,
          priority: Priority[priority],
        });
      }
    } while (cursor !== '0');

    if (recovered > 0) {
      logger.info(`Startup recovery complete: ${recovered} tasks re-enqueued`);
    }

    return recovered;
  }

  // ─── Phase 6: DLQ Auto-Retry ───────────────────────────────────────────

  /**
   * Scan DLQ entries eligible for retry (retryCount < maxRetries AND
   * nextRetryAt <= now). For each: remove from DLQ, create a new task
   * with the same parameters, re-enqueue it.
   *
   * Entries that have exhausted retries are marked permanent.
   *
   * Returns the number of entries retried.
   */
  async retryEligibleDlqEntries(
    dlqMaxRetries: number,
    getTimeoutForTask?: (taskName: string) => number,
  ): Promise<number> {
    if (!this.redis) return 0;

    const now = new Date().toISOString();
    const allRaw = await this.redis.lrange(this.dlqKey, 0, -1);
    if (allRaw.length === 0) return 0;

    let retried = 0;
    let rebuildNeeded = false;
    const keep: string[] = [];

    for (const raw of allRaw) {
      let entry: DlqEntry;
      try {
        entry = JSON.parse(raw) as DlqEntry;
      } catch {
        keep.push(raw);
        continue;
      }

      // Default missing fields for pre-Phase6 entries
      const retryCount = entry.retryCount ?? 0;
      const maxRetries = entry.maxRetries ?? dlqMaxRetries;
      const nextRetryAt = entry.nextRetryAt ?? entry.failedAt;
      const permanent = entry.permanent ?? false;
      const errorMessage = entry.error ?? 'unknown';

      if (permanent || retryCount >= maxRetries) {
        // Auto-purge permanent entries older than 24 hours — they're just noise
        const failedAtMs = entry.failedAt ? new Date(entry.failedAt).getTime() : 0;
        const ageMs = failedAtMs > 0 ? Date.now() - failedAtMs : 0;
        if (permanent && ageMs > 24 * 60 * 60 * 1000) {
          rebuildNeeded = true;
          logger.info('DLQ entry purged (permanent + >24h old)', {
            taskId: entry.taskId,
            taskName: entry.taskName,
            ageHours: Math.round(ageMs / (60 * 60 * 1000)),
          });
          // Don't add to keep[] — entry is dropped
          continue;
        }
        // Mark permanent if not already
        if (!permanent) {
          entry.permanent = true;
          entry.retryCount = retryCount;
          entry.maxRetries = maxRetries;
          entry.nextRetryAt = nextRetryAt;
          keep.push(JSON.stringify(entry));
          rebuildNeeded = true;
        } else {
          keep.push(raw);
        }
        continue;
      }

      if (!isRetryable(errorMessage)) {
        entry.permanent = true;
        entry.retryCount = retryCount;
        entry.maxRetries = maxRetries;
        entry.nextRetryAt = nextRetryAt;
        keep.push(JSON.stringify(entry));
        rebuildNeeded = true;
        continue;
      }

      // Phase 7: Expire stale correlation IDs in DLQ
      // Check 1: Timestamp-encoded correlations (e.g., owner/repo:context:1234567890)
      if (entry.correlationId) {
        const corrParts = entry.correlationId.split(':');
        const corrTs = Number(corrParts[corrParts.length - 1]);
        if (!isNaN(corrTs) && corrTs > 1_704_067_200_000 && corrTs < 1_893_456_000_000) {
          const ageMs = Date.now() - corrTs;
          if (ageMs > 2 * 60 * 60 * 1000) { // 2 hours
            entry.permanent = true;
            entry.error = `${entry.error ?? 'unknown'} [EXPIRED: correlation >2h old]`;
            entry.retryCount = retryCount;
            entry.maxRetries = maxRetries;
            keep.push(JSON.stringify(entry));
            rebuildNeeded = true;
            logger.info('DLQ entry expired (stale correlation)', {
              taskId: entry.taskId,
              taskName: entry.taskName,
              correlationId: entry.correlationId,
              ageMinutes: Math.round(ageMs / 60_000),
            });
            continue;
          }
        }
      }

      // Check 2: For ALL correlations (including UUIDs), expire based on failedAt age.
      // This catches poison pill correlations that don't have embedded timestamps.
      // Uses the same max age as the correlation check (default 2h, configurable via
      // BUILDER_CORRELATION_MAX_AGE_MS env var) for consistency.
      const maxAgeMs = dlqMaxRetries > 0 ? (Number(process.env.BUILDER_CORRELATION_MAX_AGE_MS) || 2 * 60 * 60 * 1000) : 2 * 60 * 60 * 1000;
      if (entry.failedAt) {
        const failedAtMs = new Date(entry.failedAt).getTime();
        const failedAgeMs = Date.now() - failedAtMs;
        if (failedAgeMs > maxAgeMs) { // configurable, defaults to 2 hours
          entry.permanent = true;
          entry.error = `${entry.error ?? 'unknown'} [EXPIRED: failedAt >2h old]`;
          entry.retryCount = retryCount;
          entry.maxRetries = maxRetries;
          keep.push(JSON.stringify(entry));
          rebuildNeeded = true;
          logger.info('DLQ entry expired (old failure)', {
            taskId: entry.taskId,
            taskName: entry.taskName,
            failedAt: entry.failedAt,
            ageMinutes: Math.round(failedAgeMs / 60_000),
          });
          continue;
        }
      }

      if (nextRetryAt > now) {
        keep.push(raw);
        continue;
      }

      // Eligible for retry — re-enqueue as a new task
      const priority = entry.priority as Priority;
      const payload = entry.triggerPayload ?? {};

      // Use current timeout config (via resolver) so DLQ retries pick up
      // any timeout increases deployed since the task originally failed.
      const resolvedTimeout = getTimeoutForTask
        ? getTimeoutForTask(entry.taskName)
        : undefined;

      await this.enqueue({
        taskName: entry.taskName,
        priority,
        sourceEvent: entry.sourceEvent,
        triggerPayload: payload,
        correlationId: entry.correlationId,
        dlqRetryCount: retryCount + 1,
        ...(resolvedTimeout !== undefined ? { timeoutMs: resolvedTimeout } : {}),
      });

      // Increment retry count for observability
      const newRetryCount = retryCount + 1;
      if (newRetryCount >= maxRetries) {
        // This was the last retry — if it fails again, it'll go to DLQ as permanent
        logger.info('DLQ entry retried (final attempt)', {
          taskId: entry.taskId,
          taskName: entry.taskName,
          retryCount: newRetryCount,
        });
      } else {
        logger.info('DLQ entry retried', {
          taskId: entry.taskId,
          taskName: entry.taskName,
          retryCount: newRetryCount,
        });
      }

      retried++;
      // Don't keep this entry — it's been re-enqueued
    }

    if (retried > 0 || rebuildNeeded) {
      // Rebuild the DLQ with only the entries we're keeping
      const pipeline = this.redis.pipeline();
      pipeline.del(this.dlqKey);
      if (keep.length > 0) {
        pipeline.rpush(this.dlqKey, ...keep);
      }
      await pipeline.exec();
    }

    return retried;
  }

  // ─── Phase 6: Re-enqueue helper ────────────────────────────────────────

  /**
   * Re-add an existing task back to its priority ZSET.
   * Used by graceful shutdown to re-queue incomplete tasks.
   */
  async addToQueue(task: BuilderTask): Promise<void> {
    const score = this.computeScore();

    if (this.redis) {
      const zsetKey = this.priorityKey(task.priority);
      await this.redis.zadd(zsetKey, score.toString(), task.id);
    } else {
      this.memQueue.push({ task: { ...task }, score });
      this.memQueue.sort((a, b) => {
        if (a.task.priority !== b.task.priority) return a.task.priority - b.task.priority;
        return a.score - b.score;
      });
    }
  }

  /**
   * Alias for size() — spec calls it totalSize() in some places.
   */
  async totalSize(): Promise<number> {
    return this.size();
  }

  // ─── Phase 6: One-Time DLQ Drain ────────────────────────────────────────

  /**
   * Drain the current DLQ intelligently:
   *  - Timeout errors with retryCount < maxRetries → re-enqueue at P3
   *  - Entries older than 48h → archive
   *  - Permanent errors → archive
   *
   * Archived entries are moved to builder:dlq:archive with a 7d TTL.
   */
  async drainDlq(options: {
    retryAll?: boolean;
    purgeBefore?: string;
    dryRun?: boolean;
    maxRetries?: number;
    getTimeoutForTask?: (taskName: string) => number;
  }): Promise<{ retried: number; purged: number }> {
    if (!this.redis) return { retried: 0, purged: 0 };

    const allRaw = await this.redis.lrange(this.dlqKey, 0, -1);
    if (allRaw.length === 0) return { retried: 0, purged: 0 };

    const maxRetries = options.maxRetries ?? 3;
    const purgeThresholdMs = 48 * 60 * 60 * 1000;
    const purgeBeforeMs = options.purgeBefore
      ? new Date(options.purgeBefore).getTime()
      : Date.now() - purgeThresholdMs;

    let retried = 0;
    let purged = 0;
    const keep: string[] = [];
    const archive: string[] = [];

    for (const raw of allRaw) {
      let entry: DlqEntry;
      try {
        entry = JSON.parse(raw) as DlqEntry;
      } catch {
        archive.push(raw);
        purged++;
        continue;
      }

      const failedAtMs = new Date(entry.failedAt).getTime();
      const retryCount = entry.retryCount ?? 0;
      const isPermanentError = /missing repo|auth fail|not found|forbidden/i.test(entry.error);

      // Purge old entries
      if (failedAtMs < purgeBeforeMs) {
        archive.push(raw);
        purged++;
        continue;
      }

      // Purge permanent errors
      if (isPermanentError || entry.permanent) {
        archive.push(raw);
        purged++;
        continue;
      }

      // Retry timeout errors (or all if retryAll)
      const isTimeout = /timeout/i.test(entry.error);
      if ((isTimeout || options.retryAll) && retryCount < maxRetries) {
        if (!options.dryRun) {
          const resolvedTimeout = options.getTimeoutForTask
            ? options.getTimeoutForTask(entry.taskName)
            : undefined;
          await this.enqueue({
            taskName: entry.taskName,
            priority: Priority.P3_BACKGROUND,
            sourceEvent: entry.sourceEvent,
            triggerPayload: entry.triggerPayload ?? {},
            correlationId: entry.correlationId,
            ...(resolvedTimeout !== undefined ? { timeoutMs: resolvedTimeout } : {}),
          });
        }
        retried++;
        continue; // Don't keep — it's been re-enqueued
      }

      keep.push(raw);
    }

    if (!options.dryRun && (retried > 0 || purged > 0)) {
      const pipeline = this.redis.pipeline();
      pipeline.del(this.dlqKey);
      if (keep.length > 0) {
        pipeline.rpush(this.dlqKey, ...keep);
      }
      if (archive.length > 0) {
        pipeline.rpush(`${this.dlqKey}:archive`, ...archive);
        pipeline.expire(`${this.dlqKey}:archive`, 7 * 24 * 60 * 60); // 7d TTL
      }
      await pipeline.exec();
    }

    logger.info('DLQ drain complete', { retried, purged, kept: keep.length, dryRun: options.dryRun });
    return { retried, purged };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * If the oldest P3 task has been waiting longer than `promotionAgeMs`,
   * pop it from the P3 ZSET and return it ahead of P1/P2 tasks.
   * Returns null when promotion is disabled, P3 is empty, or the oldest
   * task has not yet exceeded the promotion threshold.
   */
  private async checkP3Promotion(): Promise<BuilderTask | null> {
    if (!this.redis || !this.promotionAgeMs) return null;

    const p3Key = this.priorityKey(Priority.P3_BACKGROUND);

    // Peek at the oldest P3 entry without removing it
    const result = await this.redis.zrange(p3Key, 0, 0, 'WITHSCORES');
    if (result.length < 2) return null;

    const scoreStr = result[1];
    if (!scoreStr) return null;

    // Score = timestamp_ms * 1000 + counter, so score / 1000 ≈ timestamp_ms
    const ageMs = Date.now() - Number(scoreStr) / 1000;
    if (ageMs < this.promotionAgeMs) return null;

    // Promote: remove from P3 and return the task
    const popped = await this.redis.zpopmin(p3Key);
    if (!popped || popped.length < 2) return null;

    const taskId = popped[0];
    if (!taskId) return null;

    const data = await this.redis.hgetall(this.taskKeyPrefix + taskId);
    if (!data || Object.keys(data).length === 0) return null;

    const task = this.deserializeTask(data);
    task.state = TaskState.ASSIGNED;
    task.assignedAt = new Date().toISOString();

    await this.redis.hset(this.taskKeyPrefix + taskId, {
      state: task.state,
      assignedAt: task.assignedAt,
    });

    logger.info(`P3 task promoted after ${Math.round(ageMs / 1000)}s wait`, {
      taskId,
      taskName: task.taskName,
    });

    return task;
  }

  /**
   * Compute sorted set score for FIFO ordering within a priority level.
   * Score = unix_ms * 1000 + monotonic_counter
   *
   * The monotonic counter ensures unique scores even when Date.now()
   * returns the same value for multiple enqueues, preserving FIFO order.
   * No overflow risk since priority is no longer encoded in the score.
   */
  private computeScore(): number {
    return Date.now() * 1000 + (scoreCounter++);
  }

  private serializeTask(task: BuilderTask): Record<string, string> {
    return {
      id: task.id,
      priority: String(task.priority),
      state: task.state,
      taskName: task.taskName,
      triggerPayload: JSON.stringify(task.triggerPayload),
      sourceEvent: task.sourceEvent,
      correlationId: task.correlationId,
      createdAt: task.createdAt,
      timeoutMs: String(task.timeoutMs),
      ...(task.workerId ? { workerId: task.workerId } : {}),
      ...(task.assignedAt ? { assignedAt: task.assignedAt } : {}),
      ...(task.completedAt ? { completedAt: task.completedAt } : {}),
      ...(task.error ? { error: task.error } : {}),
      ...(task.dlqRetryCount !== undefined ? { dlqRetryCount: String(task.dlqRetryCount) } : {}),
      ...(task.timeoutRetryCount !== undefined ? { timeoutRetryCount: String(task.timeoutRetryCount) } : {}),
      ...(task.modelOverride ? { modelOverride: JSON.stringify(task.modelOverride) } : {}),
      // ACP session fields
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      ...(task.threadId ? { threadId: task.threadId } : {}),
      ...(task.executorHint ? { executorHint: task.executorHint } : {}),
      ...(task.harness ? { harness: task.harness } : {}),
      ...(task.sessionModel ? { sessionModel: task.sessionModel } : {}),
      ...(task.prompt ? { prompt: task.prompt } : {}),
      ...(task.repoPath ? { repoPath: task.repoPath } : {}),
      ...(task.steerInstruction ? { steerInstruction: task.steerInstruction } : {}),
      ...(task.steerContext ? { steerContext: JSON.stringify(task.steerContext) } : {}),
    };
  }

  private deserializeTask(data: Record<string, string>): BuilderTask {
    return {
      id: data.id!,
      priority: Number(data.priority) as Priority,
      state: data.state as TaskState,
      taskName: data.taskName!,
      triggerPayload: JSON.parse(data.triggerPayload || '{}') as Record<string, unknown>,
      sourceEvent: data.sourceEvent!,
      correlationId: data.correlationId!,
      createdAt: data.createdAt!,
      timeoutMs: Number(data.timeoutMs || DEFAULT_DISPATCHER_CONFIG.defaultTimeoutMs),
      ...(data.workerId ? { workerId: data.workerId } : {}),
      ...(data.assignedAt ? { assignedAt: data.assignedAt } : {}),
      ...(data.completedAt ? { completedAt: data.completedAt } : {}),
      ...(data.error ? { error: data.error } : {}),
      ...(data.dlqRetryCount ? { dlqRetryCount: Number(data.dlqRetryCount) } : {}),
      ...(data.timeoutRetryCount ? { timeoutRetryCount: Number(data.timeoutRetryCount) } : {}),
      ...(data.modelOverride ? { modelOverride: JSON.parse(data.modelOverride) as import('../config/schema.js').ModelConfig } : {}),
      // ACP session fields
      ...(data.sessionId ? { sessionId: data.sessionId } : {}),
      ...(data.threadId ? { threadId: data.threadId } : {}),
      ...(data.executorHint ? { executorHint: data.executorHint as 'pi' | 'cli' | 'auto' } : {}),
      ...(data.harness ? { harness: data.harness as import('./types.js').BuilderTask['harness'] } : {}),
      ...(data.sessionModel ? { sessionModel: data.sessionModel } : {}),
      ...(data.prompt ? { prompt: data.prompt } : {}),
      ...(data.repoPath ? { repoPath: data.repoPath } : {}),
      ...(data.steerInstruction ? { steerInstruction: data.steerInstruction } : {}),
      ...(data.steerContext ? { steerContext: JSON.parse(data.steerContext) as Record<string, unknown> } : {}),
    };
  }
}
