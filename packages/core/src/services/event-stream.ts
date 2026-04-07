import type { Redis } from 'ioredis';
import { hostname } from 'node:os';
import { createLogger } from '../logging/logger.js';
import type { YClawEvent } from '../types/events.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const STREAM_PREFIX = 'yclaw:stream:';
const MAX_STREAM_LEN = 10000;
const BLOCK_MS = 5000;
const BATCH_SIZE = 10;

// ─── Types ──────────────────────────────────────────────────────────────────

type StreamEntries = [key: string, entries: [id: string, fields: string[]][]][];

// ─── EventStream ────────────────────────────────────────────────────────────

/**
 * Redis Streams layer for durable event consumption and replay.
 *
 * Publishes YClawEvent envelopes via XADD and consumes them with XREADGROUP
 * consumer groups. Unacknowledged entries survive restarts via the PEL
 * (Pending Entries List) — on boot, pending entries are replayed before
 * reading new ones.
 */
export class EventStream {
  private readonly log = createLogger('event-stream');
  private readonly consumerName: string;
  private readers: Redis[] = [];
  private shutdownRequested = false;
  private readonly subscriptions = new Map<string, string>(); // streamKey → group

  constructor(private readonly redis: Redis) {
    this.consumerName = hostname() || 'worker-1';
    this.log.info('EventStream initialized', { consumer: this.consumerName });
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Publish a YClawEvent to the appropriate Redis Stream.
   * Stream key is derived from the event type prefix (e.g. coord.task.requested → yclaw:stream:coord).
   * Uses MAXLEN ~ 10000 to cap stream size and prevent OOM.
   */
  async publishEvent(event: YClawEvent<unknown>): Promise<string> {
    const key = this.streamKey(this.typePrefix(event.type));
    const data = JSON.stringify(event);
    const id = await this.redis.xadd(
      key, 'MAXLEN', '~', String(MAX_STREAM_LEN), '*', 'data', data,
    ) as string;
    this.log.info('Event published to stream', {
      type: event.type, streamKey: key, entryId: id,
    });
    return id;
  }

  /**
   * Subscribe to a stream using a consumer group. On startup, processes any
   * pending (unacked) entries before reading new ones.
   *
   * Consumer name defaults to container hostname for single-container deployments.
   */
  subscribeStream(
    typePrefix: string,
    group: string,
    handler: (event: YClawEvent<unknown>) => Promise<void>,
  ): void {
    const key = this.streamKey(typePrefix);
    this.subscriptions.set(key, group);

    // Dedicated reader connection — XREADGROUP BLOCK ties up the connection
    const reader = this.redis.duplicate();
    this.readers.push(reader);
    void this.readLoop(reader, key, group, handler);
  }

  /**
   * Count pending (unacked) entries. If typePrefix is given, counts for that
   * stream only; otherwise sums across all subscribed streams.
   */
  async pendingCount(typePrefix?: string): Promise<number> {
    if (typePrefix) {
      const key = this.streamKey(typePrefix);
      const group = this.subscriptions.get(key);
      if (!group) return 0;
      return this.pendingForGroup(key, group);
    }
    let total = 0;
    for (const [key, group] of this.subscriptions) {
      total += await this.pendingForGroup(key, group);
    }
    return total;
  }

  /**
   * Graceful shutdown: stop reading new messages, finish current batch,
   * disconnect reader connections.
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    for (const reader of this.readers) {
      reader.disconnect();
    }
    this.readers = [];
    this.log.info('EventStream shut down');
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private streamKey(typePrefix: string): string {
    return `${STREAM_PREFIX}${typePrefix}`;
  }

  private typePrefix(eventType: string): string {
    return eventType.split('.')[0] ?? eventType;
  }

  private async pendingForGroup(key: string, group: string): Promise<number> {
    try {
      const result = await this.redis.xpending(key, group) as [number, ...unknown[]];
      return Number(result[0]) || 0;
    } catch {
      return 0;
    }
  }

  private async ensureGroup(key: string, group: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', key, group, '0', 'MKSTREAM');
      this.log.info('Consumer group created', { key, group });
    } catch (err) {
      // BUSYGROUP means group already exists — safe to ignore
      if (err instanceof Error && err.message.includes('BUSYGROUP')) {
        this.log.info('Consumer group already exists', { key, group });
      } else {
        throw err;
      }
    }
  }

  private async readLoop(
    reader: Redis,
    key: string,
    group: string,
    handler: (event: YClawEvent<unknown>) => Promise<void>,
  ): Promise<void> {
    try {
      await this.ensureGroup(key, group);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('Failed to ensure consumer group', { key, group, error: msg });
      return;
    }

    // Phase 1: Replay pending entries from PEL (crash recovery)
    await this.processPending(reader, key, group, handler);

    // Phase 2: Read new entries with BLOCK for efficient polling
    while (!this.shutdownRequested) {
      try {
        const results = await reader.xreadgroup(
          'GROUP', group, this.consumerName,
          'COUNT', String(BATCH_SIZE),
          'BLOCK', String(BLOCK_MS),
          'STREAMS', key, '>',
        ) as StreamEntries | null;

        if (!results) {
          // Yield to event loop — in production BLOCK handles the pause, but
          // this prevents tight spinning if BLOCK returns immediately (tests, Redis issues)
          await new Promise(resolve => setTimeout(resolve, 0));
          continue;
        }

        for (const [, entries] of results) {
          for (const [entryId, fields] of entries) {
            await this.processEntry(reader, key, group, entryId, fields, handler);
          }
        }
      } catch (err) {
        if (this.shutdownRequested) break;
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error('Stream read error', { key, group, error: msg });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processPending(
    reader: Redis,
    key: string,
    group: string,
    handler: (event: YClawEvent<unknown>) => Promise<void>,
  ): Promise<void> {
    try {
      const results = await reader.xreadgroup(
        'GROUP', group, this.consumerName,
        'COUNT', String(BATCH_SIZE),
        'STREAMS', key, '0',
      ) as StreamEntries | null;

      if (!results) return;

      for (const [, entries] of results) {
        for (const [entryId, fields] of entries) {
          await this.processEntry(reader, key, group, entryId, fields, handler);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('PEL replay error', { key, group, error: msg });
    }
  }

  private async processEntry(
    reader: Redis,
    key: string,
    group: string,
    entryId: string,
    fields: string[],
    handler: (event: YClawEvent<unknown>) => Promise<void>,
  ): Promise<void> {
    // Stream fields are [key, value, key, value, ...] — we store as ['data', json]
    const dataIdx = fields.indexOf('data');
    if (dataIdx === -1 || dataIdx + 1 >= fields.length) {
      this.log.warn('Stream entry missing data field', { key, entryId });
      await reader.xack(key, group, entryId);
      return;
    }

    const json = fields[dataIdx + 1]!;
    let event: YClawEvent<unknown>;
    try {
      event = JSON.parse(json) as YClawEvent<unknown>;
    } catch {
      this.log.warn('Failed to parse stream entry', { key, entryId });
      await reader.xack(key, group, entryId);
      return;
    }

    try {
      await handler(event);
      await reader.xack(key, group, entryId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('Handler failed — entry stays in PEL for retry', {
        key, entryId, error: msg,
      });
      // Don't ACK — entry remains in PEL for replay on next boot
    }
  }
}
