import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';
import { validateEventPayload } from './event-schemas.js';
import { createEvent } from '../types/events.js';
import type { YClawEvent } from '../types/events.js';
import type { EventStream } from '../services/event-stream.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const CHANNEL = 'agent:events';

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
  private readonly handlers = new Map<string, Array<(event: AgentEvent) => Promise<void>>>();
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
      const redisOpts = {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 15000,            // 15s connect timeout (Redis Cloud can be slow)
        retryStrategy: (times: number) => {
          if (times > 10) return null;     // Give up after 10 retries
          return Math.min(times * 500, 30000); // Exponential backoff, max 30s
        },
        enableReadyCheck: true,
      };
      this.publisher = new Redis(url, redisOpts);
      this.subscriber = new Redis(url, redisOpts);

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
   */
  subscribe(eventPattern: string, handler: (event: AgentEvent) => Promise<void>): void {
    const isFirstSubscription = this.handlers.size === 0;
    const existing = this.handlers.get(eventPattern);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(eventPattern, [handler]);
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
        const idx = existing.indexOf(handler);
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

    for (const [pattern, handlers] of this.handlers) {
      if (this.matches(eventKey, pattern)) {
        for (const handler of handlers) {
          try {
            await handler(event);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.log.error('Event handler failed', { pattern, eventKey, error });
          }
        }
      }
    }
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
