import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';
import { validateEventPayload } from './event-schemas.js';
import { checkEventAcl } from './event-acl.js';
import { createEvent } from '../types/events.js';
import type { YClawEvent } from '../types/events.js';
import type { EventStream } from '../services/event-stream.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const CHANNEL = 'agent:events';

/** Redis Stream key prefix for dead-letter queue entries. */
export const DLQ_STREAM_PREFIX = 'yclaw:dlq:';
/** Redis key prefix for consumer heartbeat tracking. */
export const HEARTBEAT_KEY_PREFIX = 'yclaw:heartbeat:';
/** TTL (seconds) for heartbeat keys — alert fires if a key expires. */
export const HEARTBEAT_TTL_SEC = 120;
/** Initial backoff before first DLQ retry (1 minute). */
export const DLQ_INITIAL_RETRY_DELAY_MS = 60_000;

// ─── Internal Types ──────────────────────────────────────────────────────────

interface HandlerEntry {
  fn: (event: AgentEvent) => Promise<void>;
  /** Optional agent name — used for heartbeat tracking. */
  agentName?: string;
}

// ─── EventBus ───────────────────────────────────────────────────────────────

/**
 * Redis pub/sub event bus for inter-agent communication. Each agent publishes
 * and subscribes to structured events on a shared `agent:events` channel.
 * Pattern matching filters events by `source:type` format.
 */
export class EventBus {
  private readonly log = createLogger('event-bus');
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, HandlerEntry[]>();
  private connected = false;
  private closed = false;
  /**
   * True when the EventBus is running in local-only (no-Redis) mode.
   * This happens when REDIS_URL is absent or invalid in non-production environments.
   * In production, the constructor throws instead of setting this flag.
   */
  private degraded = false;

  /**
   * Optional Streams layer for dual-mode publishing. When set, every event
   * published via pub/sub is also written to Redis Streams for durability.
   *
   * Phase 2 — migrate remaining pub/sub consumers to Streams. For now,
   * coord.* subscribers should use EventStream.subscribeStream(), while
   * existing domain event subscribers (ReactionsManager, agent routing)
   * keep using EventBus.subscribe().
   */
  private eventStream: EventStream | null = null;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || '';
    const isProduction = process.env.NODE_ENV === 'production';
    // Validate URL has a protocol — ioredis needs redis:// or rediss://
    const isValidUrl = url.startsWith('redis://') || url.startsWith('rediss://');

    if (!isValidUrl) {
      if (isProduction) {
        throw new Error(
          'REDIS_URL is required in production but is missing or invalid. ' +
          'Set REDIS_URL to a valid redis:// or rediss:// connection string. ' +
          'The EventBus cannot run without Redis in production.',
        );
      }
      this.degraded = true;
      this.log.warn('No valid REDIS_URL — event bus running in local-only mode (no cross-agent events)');
      this.log.info('EventBus initialized (disabled — no Redis)');
      return;
    }

    try {
      // Exponential back-off capped at 30 s; give up after 20 retries (~10 min total).
      const retryStrategy = (times: number) => {
        if (times > 20) return null;              // Give up — surface permanent failure
        return Math.min(100 * Math.pow(2, times), 30_000); // 200ms → 400ms → … → 30s
      };

      const publisherOpts = {
        lazyConnect: true,
        maxRetriesPerRequest: 3,           // Command-level retries for regular commands
        connectTimeout: 15000,             // 15s connect timeout (Redis Cloud can be slow)
        retryStrategy,
        enableReadyCheck: true,
      };

      // Subscriber must use maxRetriesPerRequest: null — pub/sub commands should
      // wait indefinitely for a connection rather than fail fast during reconnect.
      const subscriberOpts = {
        ...publisherOpts,
        maxRetriesPerRequest: null,        // Infinite retries for pub/sub commands
      };

      this.publisher = new Redis(url, publisherOpts);
      this.subscriber = new Redis(url, subscriberOpts);

      this.publisher.on('error', (err: Error) => {
        this.log.error('Redis publisher error', { error: err.message });
      });

      this.subscriber.on('error', (err: Error) => {
        this.log.error('Redis subscriber error', { error: err.message });
      });

      this.subscriber.on('reconnecting', () => {
        this.log.info('Redis subscriber reconnecting...');
      });

      this.publisher.on('reconnecting', () => {
        this.log.info('Redis publisher reconnecting...');
      });

      // Clear connected state whenever a connection drops so that publish()
      // falls back to local dispatch rather than attempting Redis while down.
      this.publisher.on('close', () => {
        if (this.connected) {
          this.connected = false;
          this.log.warn('Redis publisher disconnected — falling back to local dispatch');
        }
      });

      this.subscriber.on('close', () => {
        if (this.connected) {
          this.connected = false;
          this.log.warn('Redis subscriber disconnected — falling back to local dispatch');
        }
      });

      // `end` fires when ioredis gives up reconnecting (retryStrategy returned null).
      this.publisher.on('end', () => {
        this.connected = false;
        this.log.error('Redis publisher connection ended permanently — event bus degraded');
      });

      this.subscriber.on('end', () => {
        this.connected = false;
        this.log.error('Redis subscriber connection ended permanently — event bus degraded');
      });

      this.subscriber.on('ready', () => {
        // Subscribe (or re-subscribe) whenever the subscriber connection is ready.
        // This handles both initial connection and reconnects after network issues.
        if (this.handlers.size > 0) {
          this.log.info('Redis subscriber ready — subscribing to channel', {
            handlerCount: this.handlers.size,
            patterns: [...this.handlers.keys()],
          });
          void this.subscriber!.subscribe(CHANNEL).catch((err: Error) => {
            this.log.error('Failed to subscribe after ready', { error: err.message });
          });
        }
      });

      this.subscriber.on('message', (_channel: string, message: string) => {
        void this.dispatch(message);
      });

      // Attempt connection in background — don't block startup.
      // ioredis retryStrategy handles reconnection, so we don't destroy clients on failure.
      void Promise.all([
        this.publisher.connect(),
        this.subscriber.connect(),
      ]).then(() => {
        this.connected = true;
        this.log.info('Redis connected — event bus active');
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Redis initial connection failed (will retry via retryStrategy): ${msg}`);
        // Don't destroy clients — let retryStrategy handle reconnection
      });

      // Mark as connected once publisher is ready.
      // This covers both the delayed initial connection and reconnections after
      // a `close` event cleared the connected flag.
      this.publisher.on('ready', () => {
        if (!this.connected) {
          this.connected = true;
          this.log.info('Redis connected — event bus active (after retry)');
        }
      });

      this.log.info('EventBus initialized', { url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isProduction) {
        throw new Error(`EventBus initialization failed: ${msg}. Redis is required in production.`);
      }
      this.degraded = true;
      this.log.warn(`EventBus initialization failed: ${msg} — running without event bus`);
    }
  }

  /**
   * Returns true when the EventBus has an active Redis connection and is
   * operating normally. Returns false when running in degraded (local-only)
   * mode or when the Redis connection has been permanently lost.
   */
  isHealthy(): boolean {
    if (this.degraded || this.closed) return false;
    // Check actual Redis connection readiness (not just flags)
    if (this.publisher && this.publisher.status !== 'ready') return false;
    if (this.subscriber && this.subscriber.status !== 'ready') return false;
    return this.connected;
  }

  /**
   * Enable dual-mode: all events published via pub/sub are also written to
   * Redis Streams for durability and replay.
   */
  setEventStream(stream: EventStream): void {
    this.eventStream = stream;
    this.log.info('EventBus dual-mode enabled — events also written to Streams');
  }

  /**
   * Publish a typed coordination event directly to Redis Streams.
   * Fire-and-forget — failures are logged, never thrown.
   */
  async publishCoordEvent(event: YClawEvent<unknown>): Promise<void> {
    if (!this.eventStream) return;
    try {
      await this.eventStream.publishEvent(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn('Failed to publish coord event (non-fatal)', {
        type: event.type, error: msg,
      });
    }
  }

  // ─── Publish ────────────────────────────────────────────────────────────

  /**
   * Publish an event to all subscribers. Validates the payload against the
   * registered schema for the event key (`source:type`), then publishes to
   * the shared Redis channel. Falls back to local dispatch when Redis is
   * unavailable. Also writes to Redis Streams when dual-mode is enabled.
   *
   * @param source - The publishing agent or subsystem (e.g. `forge`)
   * @param type - The event type (e.g. `asset_ready`)
   * @param payload - Arbitrary event data; validated against the event schema
   * @param correlationId - Optional trace ID propagated through the pipeline
   */
  async publish(
    source: string,
    type: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    if (this.closed) {
      this.log.warn('EventBus closed — dropping event', { source, type });
      return;
    }
    // Validate event payload before publishing
    const eventKey = `${source}:${type}`;
    const missing = validateEventPayload(eventKey, payload);
    if (missing) {
      this.log.warn(`Publishing malformed ${eventKey} event — missing fields: ${missing.join(', ')}`, {
        source,
        type,
        payloadKeys: Object.keys(payload),
        missing,
      });
    }

    // ACL check — fail-closed: deny unknown or unauthorized events
    if (!checkEventAcl(eventKey, source)) {
      this.log.error(`ACL BLOCKED publish of ${eventKey} from source "${source}"`, {
        source,
        type,
      });
      return;
    }

    const event: AgentEvent = {
      id: randomUUID(),
      source,
      type,
      payload,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    if (this.publisher && this.connected) {
      const serialized = JSON.stringify(event);
      await this.publisher.publish(CHANNEL, serialized);
      this.log.info('Event published', { source, type, id: event.id, correlationId });
    } else {
      // Local dispatch fallback — single-instance systems don't need Redis
      this.log.info('Event published (local)', { source, type, id: event.id, correlationId });
      await this.dispatch(JSON.stringify(event));
    }

    // Dual-mode: also write to Redis Streams for durability
    if (this.eventStream) {
      try {
        const yclawEvent = createEvent({
          type: `${source}.${type}`,
          source,
          correlation_id: correlationId || event.id,
          payload,
        });
        await this.eventStream.publishEvent(yclawEvent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn('Failed to write event to stream (non-fatal)', {
          source, type, error: msg,
        });
      }
    }
  }

  // ─── Subscribe ──────────────────────────────────────────────────────────

  /**
   * Subscribe to events matching a pattern. The pattern follows the format
   * `source:type` — for example `forge:asset_ready`. The subscriber connection
   * listens on the shared channel and dispatches only matching events.
   *
   * @param agentName - Optional agent name. When provided, a heartbeat key is
   *   refreshed in Redis on every event the handler receives so Sentinel can
   *   detect stalled agents.
   */
  subscribe(
    eventPattern: string,
    handler: (event: AgentEvent) => Promise<void>,
    agentName?: string,
  ): void {
    const isFirstSubscription = this.handlers.size === 0;
    const entry: HandlerEntry = { fn: handler, agentName };
    const existing = this.handlers.get(eventPattern);
    if (existing) {
      existing.push(entry);
    } else {
      this.handlers.set(eventPattern, [entry]);
    }
    this.log.info('Subscribed to event pattern', { pattern: eventPattern, handlerCount: (this.handlers.get(eventPattern)?.length ?? 0) });

    // Subscribe to the Redis channel when the first handler is registered.
    // The subscriber.on('ready') handler also subscribes on (re)connect,
    // so this covers the case where Redis is already connected.
    if (isFirstSubscription && this.subscriber) {
      // subscriber.subscribe() is safe to call even if not yet connected —
      // ioredis queues commands. But we also rely on the 'ready' handler
      // for reconnection scenarios.
      if (this.connected) {
        void this.subscriber.subscribe(CHANNEL);
      }
      // If not yet connected, the 'ready' handler will subscribe when Redis connects.
    }
  }

  // ─── Unsubscribe ────────────────────────────────────────────────────────

  /**
   * Remove a previously registered handler for an event pattern. If `handler`
   * is omitted, all handlers for the pattern are removed. Automatically
   * unsubscribes from the Redis channel when no handlers remain.
   *
   * @param eventPattern - The pattern that was passed to {@link subscribe}
   * @param handler - The specific handler to remove; omit to remove all
   */
  unsubscribe(eventPattern: string, handler?: (event: AgentEvent) => Promise<void>): void {
    if (handler) {
      const existing = this.handlers.get(eventPattern);
      if (existing) {
        const idx = existing.findIndex(e => e.fn === handler);
        if (idx !== -1) existing.splice(idx, 1);
        if (existing.length === 0) this.handlers.delete(eventPattern);
      }
    } else {
      this.handlers.delete(eventPattern);
    }
    this.log.info('Unsubscribed from event pattern', { pattern: eventPattern });

    if (this.handlers.size === 0 && this.subscriber) {
      void this.subscriber.unsubscribe(CHANNEL);
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Gracefully shut down the event bus. Clears all handlers, unsubscribes
   * from the Redis channel, and disconnects both publisher and subscriber
   * connections. After closing, any subsequent `publish` calls are no-ops.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
    if (this.subscriber) {
      try { await this.subscriber.unsubscribe(CHANNEL); } catch { /* ignore */ }
      this.subscriber.disconnect();
    }
    if (this.publisher) {
      this.publisher.disconnect();
    }
    this.connected = false;
    this.log.info('EventBus closed');
  }

  // ─── Internal Dispatch ──────────────────────────────────────────────────

  /**
   * Deserialize an incoming Redis message and fan it out to all handlers whose
   * pattern matches the event's `source:type` key. Handler errors are caught
   * and logged individually so one failing handler does not block others.
   *
   * On success, writes a heartbeat key for the handler's agent (if set).
   * On failure, writes a dead-letter queue (DLQ) entry to Redis Streams so the
   * event can be retried by the DLQ consumer. Both writes are fire-and-forget.
   */
  private async dispatch(message: string): Promise<void> {
    let event: AgentEvent;
    try {
      event = JSON.parse(message) as AgentEvent;
    } catch {
      this.log.warn('Failed to parse event message', { message });
      return;
    }

    const eventKey = `${event.source}:${event.type}`;

    for (const [pattern, entries] of this.handlers) {
      if (this.matches(eventKey, pattern)) {
        for (const entry of entries) {
          // Heartbeat: refresh on every event received, before the handler runs
          if (entry.agentName) {
            this.writeHeartbeat(entry.agentName);
          }
          try {
            await entry.fn(event);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.log.error('Event handler failed', { pattern, eventKey, error });
            // DLQ: write failed event for later retry — fire-and-forget
            this.writeToDlq(event, err);
          }
        }
      }
    }
  }

  // ─── DLQ Retry Dispatch ─────────────────────────────────────────────────────

  /**
   * Retry-dispatch an event directly to all matching handlers, bypassing Redis
   * pub/sub and DLQ fallback. Used exclusively by the DLQ consumer.
   *
   * Unlike the internal `dispatch()`, errors propagate to the caller so the
   * DLQ consumer can track retry counts and decide whether to park the event.
   *
   * @throws If any handler throws
   */
  async dispatchForRetry(event: AgentEvent): Promise<void> {
    const eventKey = `${event.source}:${event.type}`;
    for (const [pattern, entries] of this.handlers) {
      if (this.matches(eventKey, pattern)) {
        for (const entry of entries) {
          await entry.fn(event);
        }
      }
    }
  }

  // ─── DLQ & Heartbeat ───────────────────────────────────────────────────────

  /**
   * Write a failed event to the dead-letter queue Redis Stream.
   * Fire-and-forget — never throws, errors are only logged.
   */
  private writeToDlq(event: AgentEvent, err: unknown): void {
    if (!this.publisher || !this.connected) return;

    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    const streamKey = `${DLQ_STREAM_PREFIX}${event.source}:${event.type}`;
    const retryAfterMs = Date.now() + DLQ_INITIAL_RETRY_DELAY_MS;

    const fields: string[] = [
      'event_id', event.id,
      'source', event.source,
      'type', event.type,
      'payload', JSON.stringify(event.payload),
      'error', error,
      'stack', stack,
      'timestamp', new Date().toISOString(),
      'retry_count', '0',
      'retry_after', String(retryAfterMs),
    ];
    if (event.correlationId) {
      fields.push('correlation_id', event.correlationId);
    }

    // Cap DLQ stream size to prevent unbounded growth
    void this.publisher.xadd(streamKey, 'MAXLEN', '~', '5000', '*', ...fields)
      .then(() => {
        this.log.info('Event written to DLQ', {
          streamKey,
          eventId: event.id,
          source: event.source,
          type: event.type,
          error,
        });
      })
      .catch((dlqErr: unknown) => {
        const dlqMsg = dlqErr instanceof Error ? dlqErr.message : String(dlqErr);
        this.log.error('Failed to write to DLQ (event may be lost)', {
          streamKey,
          eventId: event.id,
          error: dlqMsg,
        });
      });
  }

  /**
   * Refresh the heartbeat key for an agent subscriber.
   * Fire-and-forget — never throws, errors are only logged.
   */
  private writeHeartbeat(agentName: string): void {
    if (!this.publisher || !this.connected) return;

    const key = `${HEARTBEAT_KEY_PREFIX}${agentName}`;
    void this.publisher.set(key, '1', 'EX', HEARTBEAT_TTL_SEC)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn('Failed to write agent heartbeat', { agentName, error: msg });
      });
  }

  /**
   * Checks whether an event key (e.g. `forge:asset_ready`) matches a
   * subscription pattern. Supports `*` as a wildcard for either segment:
   *   - `forge:asset_ready` matches `forge:asset_ready` exactly
   *   - `forge:*`           matches any type from `forge`
   *   - `*:asset_ready`     matches `asset_ready` from any source
   *   - `*:*` or `*`        matches everything
   */
  private matches(eventKey: string, pattern: string): boolean {
    if (pattern === '*' || pattern === '*:*') return true;

    const [patSource, patType] = pattern.split(':');
    const [evtSource, evtType] = eventKey.split(':');

    const sourceMatch = patSource === '*' || patSource === evtSource;
    const typeMatch = !patType || patType === '*' || patType === evtType;

    return sourceMatch && typeMatch;
  }
}
