import type { Redis } from 'ioredis';
import type { EventStream } from '../services/event-stream.js';
import type { SlackExecutor } from '../actions/slack.js';
import type { YClawEvent } from '../types/events.js';
import {
  buildCoordBlock,
  getChannelForAgent,
  getAgentEmoji,
  isEscalation,
  ALERTS_CHANNEL,
} from '../utils/slack-blocks.js';
import { createLogger } from '../logging/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const THREAD_KEY_PREFIX = 'slack:thread:';
const THREAD_TTL_S = 7 * 24 * 60 * 60; // 7 days
const RATE_LIMIT_MS = 1000; // 1 message per second per channel

// ─── Types ──────────────────────────────────────────────────────────────────

interface QueueItem {
  channel: string;
  fn: () => Promise<void>;
}

// ─── SlackNotifier ──────────────────────────────────────────────────────────

/**
 * Subscribes to coord.* events via Redis Streams and posts Block Kit
 * notifications to the appropriate Slack department channels.
 *
 * Features:
 * - Thread grouping: events with the same correlation_id are threaded
 * - Channel routing: agent → department → Slack channel
 * - Escalation double-post: blockers/failures also go to #yclaw-alerts
 * - Rate limiting: max 1 message per second per channel
 */
export class SlackNotifier {
  private readonly log = createLogger('slack-notifier');
  private readonly lastPostAt = new Map<string, number>();
  private readonly queue: QueueItem[] = [];
  private processing = false;

  constructor(
    private readonly redis: Redis,
    private readonly eventStream: EventStream,
    private readonly slack: SlackExecutor,
  ) {}

  /** Start consuming coord.* events from Redis Streams. */
  async start(): Promise<void> {
    this.eventStream.subscribeStream('coord', 'slack-notifier', async (event) => {
      await this.handleEvent(event);
    });
    this.log.info('SlackNotifier started, subscribed to coord.* events');
  }

  // ─── Event Handling ─────────────────────────────────────────────────────

  private async handleEvent(event: YClawEvent<unknown>): Promise<void> {
    // Skip coord.status.* events (heartbeats, etc.)
    if (event.type.startsWith('coord.status.')) return;

    try {
      const channel = getChannelForAgent(event.source);
      const blocks = buildCoordBlock(event);
      const emoji = getAgentEmoji(event.source);
      const agentName = event.source.charAt(0).toUpperCase() + event.source.slice(1);
      const fallbackText = `${emoji} [${agentName}] ${event.type}`;

      // Post to department channel (threaded by correlation_id)
      await this.enqueuePost(channel, event, fallbackText, blocks);

      // Escalations also go to #yclaw-alerts as a top-level message
      if (isEscalation(event) && channel !== ALERTS_CHANNEL) {
        await this.enqueuePost(ALERTS_CHANNEL, null, fallbackText, blocks);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('Failed to process event for Slack', {
        type: event.type, correlation_id: event.correlation_id, error: msg,
      });
    }
  }

  // ─── Thread Grouping ──────────────────────────────────────────────────

  private threadKey(correlationId: string): string {
    return `${THREAD_KEY_PREFIX}${correlationId}`;
  }

  private async getThreadTs(correlationId: string): Promise<string | null> {
    const key = this.threadKey(correlationId);
    return this.redis.get(key);
  }

  private async saveThreadTs(correlationId: string, ts: string): Promise<void> {
    const key = this.threadKey(correlationId);
    await this.redis.set(key, ts, 'EX', THREAD_TTL_S);
  }

  // ─── Rate-Limited Post Queue ──────────────────────────────────────────

  /**
   * Enqueue a Slack post. If `event` is provided, thread grouping is applied
   * using the event's correlation_id. If `event` is null, post as a
   * top-level message (used for escalation cross-posts).
   */
  private async enqueuePost(
    channel: string,
    event: YClawEvent<unknown> | null,
    fallbackText: string,
    blocks: Record<string, unknown>[],
  ): Promise<void> {
    this.queue.push({
      channel,
      fn: async () => {
        await this.rateLimitForChannel(channel);
        await this.postToSlack(channel, event, fallbackText, blocks);
      },
    });

    if (!this.processing) {
      void this.processQueue();
    }
  }

  private async postToSlack(
    channel: string,
    event: YClawEvent<unknown> | null,
    fallbackText: string,
    blocks: Record<string, unknown>[],
  ): Promise<void> {
    const correlationId = event?.correlation_id;

    // Check for existing thread
    let threadTs: string | null = null;
    if (correlationId) {
      threadTs = await this.getThreadTs(correlationId);
    }

    try {
      if (threadTs) {
        // Reply in existing thread
        const result = await this.slack.execute('thread_reply', {
          channel,
          threadTs,
          text: fallbackText,
          blocks,
        });
        if (!result.success) {
          this.log.warn('Thread reply failed, posting as new message', {
            channel, error: result.error,
          });
          // Fall through to new message
          threadTs = null;
        } else {
          return;
        }
      }

      // New message (or thread reply failed)
      const result = await this.slack.execute('message', {
        channel,
        text: fallbackText,
        blocks,
      });

      if (result.success && result.data?.ts && correlationId) {
        await this.saveThreadTs(correlationId, result.data.ts as string);
      }

      if (!result.success) {
        this.log.error('Failed to post Slack message', {
          channel, error: result.error,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('Slack post exception', { channel, error: msg });
    }
  }

  private async rateLimitForChannel(channel: string): Promise<void> {
    const lastPost = this.lastPostAt.get(channel) ?? 0;
    const elapsed = Date.now() - lastPost;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
    }
    this.lastPostAt.set(channel, Date.now());
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await item.fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error('Queue task failed', { channel: item.channel, error: msg });
      }
    }
    this.processing = false;
  }
}
