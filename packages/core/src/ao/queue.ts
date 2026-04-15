import { Redis } from 'ioredis';
import { createLogger } from '../logging/logger.js';
import type { AoSpawnRequest } from './types.js';

const logger = createLogger('ao-directive-queue');

// ─── Constants ──────────────────────────────────────────────────────────────

/** Redis list key for pending AO directives. */
export const PENDING_DIRECTIVES_KEY = 'yclaw:ao:pending_directives';

/** Maximum number of directives that can be queued before rejecting new entries. */
const MAX_QUEUE_DEPTH = 50;

/** TTL for the queue key in seconds (1 hour). Stale directives are not replayed. */
const QUEUE_TTL_SECONDS = 3600;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueuedDirective {
  request: AoSpawnRequest;
  enqueuedAt: string;
}

// ─── DirectiveQueue ──────────────────────────────────────────────────────────

/**
 * Persistent fallback queue for AO directives issued while the circuit breaker
 * is open. Directives are stored in a Redis list (`yclaw:ao:pending_directives`)
 * with a 1-hour TTL so they are automatically discarded if not replayed.
 *
 * Callers should:
 * 1. Call `enqueue()` when `AoBridge.spawn()` returns `null` (circuit open).
 * 2. Call `drain()` when `AoBridge` fires its circuit-closed callback to
 *    re-dispatch all pending directives.
 *
 * The queue enforces a max depth of 50 entries to prevent unbounded growth.
 * Beyond this limit, `enqueue()` returns `false` and the directive is dropped
 * with a warning log.
 */
export class DirectiveQueue {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Push a directive onto the pending queue.
   *
   * @returns `true` if enqueued, `false` if the queue is full or Redis is unreachable.
   */
  async enqueue(request: AoSpawnRequest): Promise<boolean> {
    try {
      const depth = await this.redis.llen(PENDING_DIRECTIVES_KEY);
      if (depth >= MAX_QUEUE_DEPTH) {
        logger.warn('[DirectiveQueue] queue full — dropping directive', {
          depth,
          maxDepth: MAX_QUEUE_DEPTH,
          repo: request.repo,
          issueNumber: request.issueNumber,
        });
        return false;
      }

      const entry: QueuedDirective = {
        request,
        enqueuedAt: new Date().toISOString(),
      };

      await this.redis.rpush(PENDING_DIRECTIVES_KEY, JSON.stringify(entry));
      // Reset TTL on every write so the key lives at least 1 hour from last push.
      await this.redis.expire(PENDING_DIRECTIVES_KEY, QUEUE_TTL_SECONDS);

      logger.info('[DirectiveQueue] directive queued for replay', {
        repo: request.repo,
        issueNumber: request.issueNumber,
        queueDepth: depth + 1,
      });
      return true;
    } catch (err) {
      logger.error('[DirectiveQueue] enqueue failed — directive dropped', {
        error: err instanceof Error ? err.message : String(err),
        repo: request.repo,
        issueNumber: request.issueNumber,
      });
      return false;
    }
  }

  /**
   * Pop and return all pending directives from the queue for replay.
   * The queue is atomically drained via LPOP to prevent double-dispatch.
   *
   * @returns Array of queued directives (oldest first), or empty array on failure.
   */
  async drain(): Promise<QueuedDirective[]> {
    const directives: QueuedDirective[] = [];
    try {
      const depth = await this.redis.llen(PENDING_DIRECTIVES_KEY);
      if (depth === 0) return directives;

      logger.info('[DirectiveQueue] draining pending directives', { count: depth });

      // Pop all items atomically (one at a time; Redis 6.2+ supports LPOP count,
      // but we use a loop for broad compat with Redis 5.x).
      for (let i = 0; i < depth; i++) {
        const raw = await this.redis.lpop(PENDING_DIRECTIVES_KEY);
        if (!raw) break;
        try {
          directives.push(JSON.parse(raw) as QueuedDirective);
        } catch (parseErr) {
          logger.warn('[DirectiveQueue] failed to parse queued directive — skipping', {
            error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            raw: raw.slice(0, 200),
          });
        }
      }

      logger.info('[DirectiveQueue] drained directives', { count: directives.length });
    } catch (err) {
      logger.error('[DirectiveQueue] drain failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return directives;
  }

  /**
   * Return the current queue depth without modifying the queue.
   * Returns 0 on any Redis error.
   */
  async depth(): Promise<number> {
    try {
      return await this.redis.llen(PENDING_DIRECTIVES_KEY);
    } catch {
      return 0;
    }
  }
}
