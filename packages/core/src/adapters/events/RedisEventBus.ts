/**
 * RedisEventBus — Redis adapter for IEventBus.
 *
 * Wraps the existing EventBus class (triggers/event.ts) to implement
 * the IEventBus interface. Also provides the KV and sorted-set operations
 * that were previously spread across raw ioredis calls throughout the codebase.
 *
 * The existing EventBus class remains unchanged — this adapter delegates
 * pub/sub to it and adds the KV/queue operations on top.
 */

import { Redis } from 'ioredis';
import type { IEventBus, EventHandler } from '../../interfaces/IEventBus.js';
import { EventBus } from '../../triggers/event.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('redis-event-bus');

export class RedisEventBus implements IEventBus {
  /** The existing EventBus handles pub/sub. */
  private readonly eventBus: EventBus;
  /** Dedicated Redis connection for KV/queue operations. */
  private redis: Redis | null = null;
  private readonly redisUrl: string | undefined;
  private connected = false;

  constructor(redisUrl?: string) {
    this.redisUrl = redisUrl || process.env.REDIS_URL;
    // EventBus handles its own Redis connections for pub/sub
    this.eventBus = new EventBus(this.redisUrl);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;

    const url = this.redisUrl;
    if (url && (url.startsWith('redis://') || url.startsWith('rediss://'))) {
      try {
        this.redis = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          connectTimeout: 15000,
        });
        await this.redis.connect();
        this.connected = true;
        logger.info('RedisEventBus KV connection established');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`RedisEventBus KV connection failed: ${msg}`);
        this.redis = null;
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.eventBus.close();
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
    this.connected = false;
    logger.info('RedisEventBus disconnected');
  }

  healthy(): boolean {
    // Both pub/sub AND kv connections must be operational (#6, M2).
    // Check the KV redis connection status directly — isHealthy() only
    // checks degraded/closed flags, not actual connection readiness.
    const kvReady = this.redis !== null
      && this.connected
      && this.redis.status === 'ready';
    return this.eventBus.isHealthy() && kvReady;
  }

  // ─── Pub/Sub (delegates to EventBus) ────────────────────────────────────

  async publish(
    source: string,
    type: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    await this.eventBus.publish(source, type, payload, correlationId);
  }

  subscribe(eventPattern: string, handler: EventHandler): void {
    this.eventBus.subscribe(eventPattern, handler);
  }

  unsubscribe(eventPattern: string, handler?: EventHandler): void {
    this.eventBus.unsubscribe(eventPattern, handler);
  }

  // ─── Sorted Set Operations ──────────────────────────────────────────────

  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.zadd(key, score, member);
  }

  async zrem(key: string, member: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.zrem(key, member);
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    if (!this.redis) return [];
    return this.redis.zrangebyscore(key, min, max);
  }

  // ─── Hash Operations ────────────────────────────────────────────────────

  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (!this.redis) return null;
    return this.redis.hget(key, field);
  }

  async hdel(key: string, field: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hdel(key, field);
  }

  // ─── Key-Value Operations ───────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    if (!this.redis) return null;
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.redis) return;
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async setnx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    // Fail-closed: when Redis is absent, locks and dedup MUST deny (return false)
    // to prevent duplicate work and broken mutual exclusion (#6).
    if (!this.redis) return false;
    if (ttlSeconds) {
      const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
      return result !== null;
    } else {
      const result = await this.redis.setnx(key, value);
      return result === 1;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.del(key);
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.redis) return 1;
    const val = await this.redis.incr(key);
    if (ttlSeconds && val === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return val;
  }

  async exists(key: string): Promise<number> {
    if (!this.redis) return 0;
    return this.redis.exists(key);
  }

  // ─── Accessors ──────────────────────────────────────────────────────────

  /**
   * Get the underlying EventBus instance for backward compatibility.
   * Used during migration — modules that need the existing EventBus API
   * (setEventStream, publishCoordEvent) can access it directly.
   *
   * @deprecated New code should use IEventBus interface methods.
   */
  getInnerEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Get the raw Redis connection for backward compatibility.
   * Used by modules that need raw Redis operations not covered by IEventBus.
   *
   * @deprecated New code should use IEventBus interface methods.
   */
  getRawRedis(): Redis | null {
    return this.redis;
  }
}
