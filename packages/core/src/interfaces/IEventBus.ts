/**
 * IEventBus — Abstract interface for the event transport layer.
 *
 * Replaces direct Redis pub/sub, ZSET, and key-value usage. Combines
 * three capabilities into one interface:
 * 1. Pub/sub event publishing and subscription
 * 2. Queue operations (for escalation timers, task queues)
 * 3. Key-value operations (for checkpoints, locks, dedup, rate limiting)
 *
 * The default implementation (RedisEventBus) wraps existing ioredis logic.
 */

import type { AgentEvent } from '../config/schema.js';

// ─── Queue Types ────────────────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  data: Record<string, unknown>;
  /** Score for priority/time-ordered queues (e.g., epoch ms for scheduled items). */
  score?: number;
}

// ─── Event Handler ──────────────────────────────────────────────────────────

export type EventHandler = (event: AgentEvent) => Promise<void>;

// ─── IEventBus ──────────────────────────────────────────────────────────────

/**
 * Event transport interface. Combines pub/sub messaging with ephemeral
 * key-value storage — both are typically backed by the same in-memory
 * store (Redis) but could be split across providers.
 *
 * Pattern matching: subscribe('forge:*') matches all events from forge.
 * See EventBus.matches() for the full wildcard spec.
 */
export interface IEventBus {
  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /** Connect to the backing transport. */
  connect(): Promise<void>;

  /** Disconnect gracefully. Subsequent publish() calls become no-ops. */
  disconnect(): Promise<void>;

  /** Returns true if the transport is connected and operational. */
  healthy(): boolean;

  // ─── Pub/Sub ────────────────────────────────────────────────────────────

  /**
   * Publish an event to all matching subscribers.
   *
   * @param source - Publishing agent/subsystem (e.g., 'forge')
   * @param type - Event type (e.g., 'asset_ready')
   * @param payload - Arbitrary event data
   * @param correlationId - Optional trace ID for end-to-end correlation
   */
  publish(
    source: string,
    type: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void>;

  /**
   * Subscribe to events matching a pattern (e.g., 'forge:asset_ready', 'forge:*', '*:*').
   */
  subscribe(eventPattern: string, handler: EventHandler): void;

  /**
   * Remove a handler for an event pattern. If handler is omitted, removes all
   * handlers for the pattern.
   */
  unsubscribe(eventPattern: string, handler?: EventHandler): void;

  // ─── Sorted Set / Queue Operations ──────────────────────────────────────

  /**
   * Add an item to a sorted set (priority queue / scheduled items).
   * Score determines ordering (e.g., epoch ms for time-based scheduling).
   */
  zadd(key: string, score: number, member: string): Promise<void>;

  /** Remove a member from a sorted set. */
  zrem(key: string, member: string): Promise<void>;

  /** Get members with scores in range [min, max], ordered by score ascending. */
  zrangebyscore(key: string, min: number, max: number): Promise<string[]>;

  // ─── Hash Operations ────────────────────────────────────────────────────

  /** Set a field in a hash. */
  hset(key: string, field: string, value: string): Promise<void>;

  /** Get a field from a hash. */
  hget(key: string, field: string): Promise<string | null>;

  /** Delete a field from a hash. */
  hdel(key: string, field: string): Promise<void>;

  // ─── Key-Value Operations ───────────────────────────────────────────────

  /** Get a string value by key. */
  get(key: string): Promise<string | null>;

  /** Set a string value with optional TTL in seconds. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Set a value only if the key does not exist (NX).
   * Returns true if the key was set, false if it already existed.
   * Used for distributed locks and dedup.
   */
  setnx(key: string, value: string, ttlSeconds?: number): Promise<boolean>;

  /** Delete a key. */
  del(key: string): Promise<void>;

  /** Increment a numeric key, returning the new value. */
  increment(key: string, ttlSeconds?: number): Promise<number>;

  /**
   * Check if a key exists.
   * Returns the number of existing keys (0 or 1 for a single key).
   */
  exists(key: string): Promise<number>;
}
