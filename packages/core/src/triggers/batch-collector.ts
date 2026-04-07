import type { AgentConfig, AgentEvent, ModelConfig } from '../config/schema.js';
import type { AgentExecutor } from '../agent/executor.js';
import type { SettingsOverlay } from '../config/settings-overlay.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('batch-collector');

interface BatchConfig {
  /** Agent config that owns this batch trigger */
  agentConfig: AgentConfig;
  /** Task to fire when batch completes */
  task: string;
  /** Event patterns to collect (supports wildcards via EventBus matching) */
  events: string[];
  /** Minimum events before firing (fires early if timeout hits first) */
  minCount: number;
  /** Max time to wait before firing with whatever we have (ms) */
  timeoutMs: number;
  /** Optional model override for the batch task */
  model?: ModelConfig;
}

interface PendingBatch {
  config: BatchConfig;
  collected: AgentEvent[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Date key to prevent cross-day accumulation */
  dateKey: string;
}

/**
 * Collects events over time and fires a task when either:
 * - min_count events have been collected, OR
 * - timeout_ms has elapsed since the first event
 *
 * Designed for standup aggregation but works for any batch pattern.
 */
export class BatchCollector {
  private batches = new Map<string, PendingBatch>();
  private settingsOverlay: SettingsOverlay | null = null;

  constructor(private executor: AgentExecutor) {}

  setSettingsOverlay(overlay: SettingsOverlay): void {
    this.settingsOverlay = overlay;
  }

  /**
   * Register a batch trigger. Returns the event patterns that need
   * to be subscribed on the EventBus.
   */
  register(config: BatchConfig): string[] {
    const key = `${config.agentConfig.name}:${config.task}`;
    logger.info(`Registered batch trigger: ${key}`, {
      events: config.events,
      minCount: config.minCount,
      timeoutMs: config.timeoutMs,
    });
    // Store config but don't create a pending batch until first event arrives
    this.batches.set(key, {
      config,
      collected: [],
      timer: null,
      dateKey: this.todayKey(),
    });
    return config.events;
  }

  /**
   * Called when a matching event arrives. Accumulates the event
   * and fires the task if threshold is met.
   */
  async onEvent(event: AgentEvent): Promise<void> {
    const eventKey = `${event.source}:${event.type}`;

    for (const [batchKey, batch] of this.batches) {
      // Check if this event matches any of the batch's event patterns
      if (!batch.config.events.some(pattern => this.matchesPattern(eventKey, pattern))) {
        continue;
      }

      // Check MC settings overlay — skip accumulating events that are disabled
      if (this.settingsOverlay) {
        const overrides = await this.settingsOverlay.getAgentOverrides(
          batch.config.agentConfig.department,
          batch.config.agentConfig.name,
        );
        if (overrides?.eventEnabled?.[eventKey] === false) {
          logger.info(`Batch ${batchKey}: event ${eventKey} disabled via MC, skipping`);
          continue;
        }
      }

      // Reset if day rolled over
      const today = this.todayKey();
      if (batch.dateKey !== today) {
        this.resetBatch(batch);
        batch.dateKey = today;
      }

      // Add event to collection
      batch.collected.push(event);
      logger.info(`Batch ${batchKey}: collected ${batch.collected.length}/${batch.config.minCount}`, {
        from: event.source,
        type: event.type,
      });

      // Start timer on first event
      if (batch.collected.length === 1 && !batch.timer) {
        batch.timer = setTimeout(async () => {
          logger.info(`Batch ${batchKey}: timeout reached with ${batch.collected.length} events`);
          await this.fireBatch(batchKey, batch);
        }, batch.config.timeoutMs);
      }

      // Fire immediately if min_count reached
      if (batch.collected.length >= batch.config.minCount) {
        logger.info(`Batch ${batchKey}: min_count reached (${batch.collected.length})`);
        await this.fireBatch(batchKey, batch);
      }
    }
  }

  /**
   * Fire the batch task with all collected events as payload.
   */
  private async fireBatch(batchKey: string, batch: PendingBatch): Promise<void> {
    // Clear timer
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    const events = [...batch.collected];
    const count = events.length;

    // Reset collection for next batch
    batch.collected = [];

    if (count === 0) {
      logger.info(`Batch ${batchKey}: no events to process, skipping`);
      return;
    }

    logger.info(`Batch ${batchKey}: firing task "${batch.config.task}" with ${count} events`);

    // Build payload with all collected events
    const payload: Record<string, unknown> = {
      batch: true,
      event_count: count,
      events: events.map(e => ({
        source: e.source,
        type: e.type,
        payload: e.payload,
        timestamp: e.timestamp,
      })),
      collected_from: [...new Set(events.map(e => e.source))],
      date: this.todayKey(),
    };

    try {
      await this.executor.execute(
        batch.config.agentConfig,
        batch.config.task,
        'batch_event',
        payload,
        batch.config.model,
      );
    } catch (err) {
      logger.error(`Batch execution failed: ${batchKey}`, { error: err });
    }
  }

  private resetBatch(batch: PendingBatch): void {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    batch.collected = [];
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private matchesPattern(eventKey: string, pattern: string): boolean {
    if (pattern === '*' || pattern === '*:*') return true;
    const [patSource, patType] = pattern.split(':');
    const [evtSource, evtType] = eventKey.split(':');
    const sourceMatch = patSource === '*' || patSource === evtSource;
    const typeMatch = !patType || patType === '*' || patType === evtType;
    return sourceMatch && typeMatch;
  }

  /**
   * Clean up all timers.
   */
  close(): void {
    for (const [, batch] of this.batches) {
      if (batch.timer) clearTimeout(batch.timer);
    }
    this.batches.clear();
  }
}
