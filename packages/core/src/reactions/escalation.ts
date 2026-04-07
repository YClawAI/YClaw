/**
 * Escalation Timer Manager — durable timers via Redis ZSET + Hash.
 *
 * Stores escalation due times in a sorted set keyed by `ruleId:resource`,
 * with full entry data in a companion hash. This ensures deduplication:
 * scheduling the same ruleId + resource replaces the previous entry.
 *
 * A poller runs every 30s to check for due escalations and execute them.
 * Survives ECS task restarts because all state is in Redis.
 */

import type { Redis } from 'ioredis';
import type { ReactionAction, ReactionContext } from './types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('reaction-escalation');

const ESCALATION_ZSET = 'reaction:escalations';
const ESCALATION_HASH = 'reaction:escalation_data';
const POLL_INTERVAL_MS = 30_000; // 30 seconds

interface EscalationEntry {
  ruleId: string;
  action: ReactionAction;
  context: ReactionContext;
  scheduledAt: number;
}

export class EscalationManager {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private actionExecutor: ((action: ReactionAction, ctx: ReactionContext) => Promise<void>) | null = null;

  constructor(private redis: Redis) {}

  /**
   * Register the action executor callback — called when an escalation fires.
   * This avoids circular dependency with ReactionsManager.
   */
  onEscalation(executor: (action: ReactionAction, ctx: ReactionContext) => Promise<void>): void {
    this.actionExecutor = executor;
  }

  /**
   * Schedule an escalation: action fires after `afterMs` milliseconds.
   * If the same ruleId + resource already has a pending escalation, it's replaced.
   */
  async schedule(
    ruleId: string,
    afterMs: number,
    action: ReactionAction,
    ctx: ReactionContext,
  ): Promise<void> {
    const dueAt = Date.now() + afterMs;
    const resource = ctx.prNumber ? `pr:${ctx.prNumber}` : `issue:${ctx.issueNumber || 'unknown'}`;
    const member = `${ruleId}:${resource}`;

    const entry: EscalationEntry = {
      ruleId,
      action,
      context: ctx,
      scheduledAt: Date.now(),
    };

    // ZSET member is the dedup key; score is the due time.
    // Re-scheduling the same member replaces the score (and we overwrite the hash entry).
    await this.redis.zadd(ESCALATION_ZSET, dueAt.toString(), member);
    await this.redis.hset(ESCALATION_HASH, member, JSON.stringify(entry));

    logger.info('Escalation scheduled', {
      ruleId,
      resource,
      member,
      dueAt: new Date(dueAt).toISOString(),
      afterMs,
    });
  }

  /**
   * Cancel a pending escalation (e.g., when the issue is resolved before timeout).
   */
  async cancel(ruleId: string, ctx: ReactionContext): Promise<void> {
    const resource = ctx.prNumber ? `pr:${ctx.prNumber}` : `issue:${ctx.issueNumber || 'unknown'}`;
    const member = `${ruleId}:${resource}`;

    const removed = await this.redis.zrem(ESCALATION_ZSET, member);
    await this.redis.hdel(ESCALATION_HASH, member);

    if (removed > 0) {
      logger.info('Escalation cancelled', { ruleId, resource, member });
    }
  }

  /**
   * Start the escalation poller. Should be called once at startup.
   */
  start(): void {
    if (this.pollTimer) return;

    logger.info('Escalation poller starting', { intervalMs: POLL_INTERVAL_MS });
    this.pollTimer = setInterval(() => this.processDue().catch(err => {
      logger.error('Escalation poll error', { error: String(err) });
    }), POLL_INTERVAL_MS);

    // Also run immediately on start to catch any stale escalations
    this.processDue().catch(err => {
      logger.error('Escalation initial poll error', { error: String(err) });
    });
  }

  /**
   * Stop the escalation poller.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.info('Escalation poller stopped');
    }
  }

  /**
   * Process all due escalations (score <= now).
   */
  private async processDue(): Promise<void> {
    const now = Date.now();
    const dueMembers = await this.redis.zrangebyscore(ESCALATION_ZSET, '-inf', now.toString());

    if (dueMembers.length === 0) return;

    logger.info('Processing due escalations', { count: dueMembers.length });

    for (const member of dueMembers) {
      try {
        // Remove from ZSET first (at-most-once delivery)
        await this.redis.zrem(ESCALATION_ZSET, member);

        // Read entry data from companion hash
        const entryJson = await this.redis.hget(ESCALATION_HASH, member);
        await this.redis.hdel(ESCALATION_HASH, member);

        if (!entryJson) {
          logger.warn('Escalation entry missing from hash, skipping', { member });
          continue;
        }

        const entry: EscalationEntry = JSON.parse(entryJson);

        if (this.actionExecutor) {
          logger.info('Firing escalation', {
            ruleId: entry.ruleId,
            actionType: entry.action.type,
            member,
            scheduledAt: new Date(entry.scheduledAt).toISOString(),
          });
          await this.actionExecutor(entry.action, entry.context);
        } else {
          logger.warn('No action executor registered, escalation dropped', {
            ruleId: entry.ruleId,
            member,
          });
        }
      } catch (err) {
        logger.error('Failed to process escalation', { error: String(err), member });
        // Clean up hash entry on failure to avoid orphans
        await this.redis.hdel(ESCALATION_HASH, member).catch(() => {});
      }
    }
  }
}
