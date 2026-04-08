import type { Redis } from 'ioredis';
import type { EventStream } from '../services/event-stream.js';
import type { IChannel, MessageResult } from '../interfaces/IChannel.js';
import type { YClawEvent } from '../types/events.js';
import { isEscalation } from '../utils/slack-blocks.js';
import {
  getChannelForAgent,
  getAlertsChannel,
  type ChannelPlatform,
} from '../utils/channel-routing.js';
import {
  formatSlackMessage,
  formatDiscordMessage,
} from '../utils/message-formatter.js';
import { createLogger } from '../logging/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const THREAD_KEY_PREFIX = 'channel:thread:';
const THREAD_TTL_S = 7 * 24 * 60 * 60; // 7 days
const RATE_LIMIT_MS = 1000;            // 1 message per second per channel

// ─── Types ──────────────────────────────────────────────────────────────────

interface QueueItem {
  /** Composite key used for rate limiting: `${platform}:${channelId}`. */
  key: string;
  fn: () => Promise<void>;
}

// ─── ChannelNotifier ────────────────────────────────────────────────────────

/**
 * Unified, multi-platform replacement for `SlackNotifier`. Subscribes once
 * to `coord.*` events and fans each event out to every enabled channel
 * adapter (Slack, Discord, etc.) using platform-specific routing and
 * formatting.
 *
 * Behaviour that matches the old SlackNotifier:
 *   - Thread grouping per `correlation_id` (scoped per platform so a
 *     Slack thread and a Discord thread can coexist without clashing).
 *   - Escalation events (`coord.task.blocked`, `coord.task.failed`,
 *     `coord.project.completed`) are also posted to the alerts channel
 *     as a top-level message.
 *   - Per-channel rate limiting: max 1 message per second.
 *
 * Channels are looked up in the injected Map. Only adapters that the
 * caller chose to include are used — if the caller omits Slack, nothing
 * is posted to Slack.
 */
export class ChannelNotifier {
  private readonly log = createLogger('channel-notifier');
  private readonly lastPostAt = new Map<string, number>();
  private readonly queue: QueueItem[] = [];
  private processing = false;

  constructor(
    private readonly redis: Redis,
    private readonly eventStream: EventStream,
    private readonly channels: Map<string, IChannel>,
  ) {}

  /** Start consuming coord.* events from Redis Streams. */
  async start(): Promise<void> {
    if (this.channels.size === 0) {
      this.log.info('ChannelNotifier has no channels — skipping subscription');
      return;
    }
    this.eventStream.subscribeStream('coord', 'channel-notifier', async (event) => {
      await this.handleEvent(event);
    });
    this.log.info('ChannelNotifier started', {
      platforms: Array.from(this.channels.keys()),
    });
  }

  // ─── Event Handling ─────────────────────────────────────────────────────

  private async handleEvent(event: YClawEvent<unknown>): Promise<void> {
    // Skip coord.status.* events (heartbeats, etc.)
    if (event.type.startsWith('coord.status.')) return;

    for (const [name, adapter] of this.channels.entries()) {
      const platform = name as ChannelPlatform;
      if (platform !== 'slack' && platform !== 'discord') continue;

      try {
        const channelId = getChannelForAgent(event.source, platform);
        if (!channelId) {
          this.log.debug('No channel configured — skipping event', {
            platform, source: event.source, type: event.type,
          });
          continue;
        }

        // Only Slack supports thread grouping by correlation_id. Discord
        // "threads" are full sub-channels that have to be created
        // explicitly, which is heavyweight and noisy for a notifier that
        // may fire dozens of events per project. Keep Discord flat.
        const threadable = platform === 'slack';
        await this.enqueuePost(platform, adapter, channelId, event, threadable);

        // Escalations also go to the platform's alerts channel as a new
        // top-level post, matching SlackNotifier semantics.
        if (isEscalation(event)) {
          const alertsId = getAlertsChannel(platform);
          if (alertsId && alertsId !== channelId) {
            await this.enqueuePost(platform, adapter, alertsId, event, /*threadable*/ false);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error('Failed to process event for channel', {
          platform: name,
          type: event.type,
          correlation_id: event.correlation_id,
          error: msg,
        });
      }
    }
  }

  // ─── Thread Grouping ──────────────────────────────────────────────────

  private threadKey(platform: ChannelPlatform, correlationId: string): string {
    return `${THREAD_KEY_PREFIX}${platform}:${correlationId}`;
  }

  private async getThreadId(
    platform: ChannelPlatform,
    correlationId: string,
  ): Promise<string | null> {
    return this.redis.get(this.threadKey(platform, correlationId));
  }

  private async saveThreadId(
    platform: ChannelPlatform,
    correlationId: string,
    threadId: string,
  ): Promise<void> {
    await this.redis.set(
      this.threadKey(platform, correlationId),
      threadId,
      'EX',
      THREAD_TTL_S,
    );
  }

  // ─── Rate-Limited Post Queue ──────────────────────────────────────────

  private async enqueuePost(
    platform: ChannelPlatform,
    adapter: IChannel,
    channelId: string,
    event: YClawEvent<unknown>,
    threadable: boolean,
  ): Promise<void> {
    const key = `${platform}:${channelId}`;
    this.queue.push({
      key,
      fn: async () => {
        await this.rateLimit(key);
        await this.postToChannel(platform, adapter, channelId, event, threadable);
      },
    });

    if (!this.processing) {
      void this.processQueue();
    }
  }

  private async postToChannel(
    platform: ChannelPlatform,
    adapter: IChannel,
    channelId: string,
    event: YClawEvent<unknown>,
    threadable: boolean,
  ): Promise<void> {
    const correlationId = threadable ? event.correlation_id : undefined;

    // Check for an existing thread on this platform
    let threadId: string | null = null;
    if (correlationId) {
      threadId = await this.getThreadId(platform, correlationId);
    }

    try {
      const result = await this.send(
        platform,
        adapter,
        channelId,
        event,
        threadId ?? undefined,
      );

      if (!result.success) {
        // If a thread reply failed, retry as a fresh top-level post once
        if (threadId) {
          this.log.warn('Thread reply failed, posting as new message', {
            platform, channelId, error: result.error,
          });
          const retry = await this.send(platform, adapter, channelId, event, undefined);
          if (retry.success && correlationId) {
            const newThread = retry.threadId ?? retry.messageId;
            if (newThread) {
              await this.saveThreadId(platform, correlationId, newThread);
            }
          } else if (!retry.success) {
            this.log.error('Failed to post channel message (after thread fallback)', {
              platform, channelId, error: retry.error,
            });
          }
          return;
        }
        this.log.error('Failed to post channel message', {
          platform, channelId, error: result.error,
        });
        return;
      }

      // Success — persist the thread root for future events with the
      // same correlation_id, using whichever identifier the adapter
      // returned (Slack ts, Discord thread id, etc.).
      if (correlationId) {
        const newThread = result.threadId ?? result.messageId;
        if (newThread) {
          await this.saveThreadId(platform, correlationId, newThread);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('Channel post exception', {
        platform, channelId, error: msg,
      });
    }
  }

  /** Platform-specific send + formatting. Thin wrapper around IChannel.send. */
  private async send(
    platform: ChannelPlatform,
    adapter: IChannel,
    channelId: string,
    event: YClawEvent<unknown>,
    threadId: string | undefined,
  ): Promise<MessageResult> {
    if (platform === 'slack') {
      const { text, blocks } = formatSlackMessage(event);
      // SlackChannelAdapter passes `blocks` through via extra fields.
      return adapter.send(
        { channelId, ...(threadId ? { threadId } : {}) },
        {
          text,
          ...(threadId ? { threadId } : {}),
          // `blocks` is a Slack-specific extension on the ChannelMessage
          // shape. The adapter picks it up if present; other adapters
          // ignore it.
          ...({ blocks } as Record<string, unknown>),
        },
      );
    }

    // discord
    const { text } = formatDiscordMessage(event);
    return adapter.send(
      { channelId, ...(threadId ? { threadId } : {}) },
      { text, ...(threadId ? { threadId } : {}) },
    );
  }

  private async rateLimit(key: string): Promise<void> {
    const last = this.lastPostAt.get(key) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
    }
    this.lastPostAt.set(key, Date.now());
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await item.fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error('Queue task failed', { key: item.key, error: msg });
      }
    }
    this.processing = false;
  }
}
