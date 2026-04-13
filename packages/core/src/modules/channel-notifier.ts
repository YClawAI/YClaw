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

// ─── Notification Router integration ─────────────────────────────────────────
import { NotificationRouter } from '../notifications/NotificationRouter.js';
import { toNotificationEvent } from '../notifications/event-converter.js';
import { DiscordChannel } from '../notifications/discord/DiscordChannel.js';
import { SlackChannel } from '../notifications/slack/SlackChannel.js';
import { ThreadRegistry } from '../notifications/state/ThreadRegistry.js';
import type { INotificationChannel } from '../notifications/INotificationChannel.js';

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
 * Now integrates the NotificationRouter for richer rendering:
 *   - Discord gets embeds (via DiscordRenderer) with agent-identity webhooks
 *   - Slack gets Block Kit (via SlackRenderer)
 *   - Both share thread grouping via ThreadRegistry
 *
 * The legacy direct-send path (formatSlackMessage/formatDiscordMessage)
 * is preserved as a fallback when the router is not available.
 */
export class ChannelNotifier {
  private readonly log = createLogger('channel-notifier');
  private readonly lastPostAt = new Map<string, number>();
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private router: NotificationRouter | null = null;
  private threadRegistry: ThreadRegistry | null = null;

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

    // Initialize the NotificationRouter with rich renderers
    await this.initRouter();

    this.eventStream.subscribeStream('coord', 'channel-notifier', async (event) => {
      await this.handleEvent(event);
    });
    this.log.info('ChannelNotifier started', {
      platforms: Array.from(this.channels.keys()),
      routerEnabled: this.router !== null,
    });
  }

  /**
   * Initialize the NotificationRouter with platform-specific channels.
   * Uses the injected IChannel adapters to create notification channels
   * with richer rendering (embeds, Block Kit) and thread grouping.
   */
  private async initRouter(): Promise<void> {
    try {
      this.threadRegistry = new ThreadRegistry(this.redis);
      this.router = new NotificationRouter();

      // Wire up Slack notification channel
      const slackAdapter = this.channels.get('slack');
      if (slackAdapter) {
        const slackChannel = new SlackChannel(slackAdapter, this.threadRegistry);
        this.router.register(slackChannel);
        this.log.info('Slack notification channel registered');
      }

      // Wire up Discord notification channel (with webhook support)
      const discordAdapter = this.channels.get('discord');
      const discordChannel = new DiscordChannel(
        discordAdapter ?? null,
        this.threadRegistry,
      );
      await discordChannel.init();
      if (discordChannel.isEnabled()) {
        this.router.register(discordChannel);
        this.log.info('Discord notification channel registered');
      }

      if (this.router.size === 0) {
        this.log.info('No notification channels registered — router disabled');
        this.router = null;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn('NotificationRouter init failed, using legacy path', { error: msg });
      this.router = null;
    }
  }

  // ─── Event Handling ─────────────────────────────────────────────────────

  private async handleEvent(event: YClawEvent<unknown>): Promise<void> {
    // Skip coord.status.* events (heartbeats, etc.)
    if (event.type.startsWith('coord.status.')) return;

    // Skip coord.task.requested — too similar to "started" for human consumption.
    // Keep only "started" + "completed/failed" as visible lifecycle updates.
    if (event.type === 'coord.task.requested') return;

    // Try the NotificationRouter first (richer rendering)
    if (this.router) {
      try {
        const notificationEvent = toNotificationEvent(event);
        await this.router.broadcast(notificationEvent);

        // Escalations also broadcast to alerts (with different department)
        if (isEscalation(event)) {
          const alertEvent = toNotificationEvent(event);
          alertEvent.agent = { ...alertEvent.agent, department: 'alerts' };
          alertEvent.threadKey = undefined; // top-level in alerts channel
          await this.router.broadcast(alertEvent);
        }

        return; // Router handled it — skip legacy path
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn('Router broadcast failed, falling back to legacy path', {
          type: event.type, error: msg,
        });
      }
    }

    // ─── Legacy path (direct adapter sends) ────────────────────────────
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

        const threadable = platform === 'slack';
        await this.enqueuePost(platform, adapter, channelId, event, threadable);

        if (isEscalation(event)) {
          const alertsId = getAlertsChannel(platform);
          if (alertsId && alertsId !== channelId) {
            await this.enqueuePost(platform, adapter, alertsId, event, false);
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

  // ─── Thread Grouping (legacy path) ─────────────────────────────────────

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

  // ─── Rate-Limited Post Queue (legacy path) ─────────────────────────────

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
      return adapter.send(
        { channelId, ...(threadId ? { threadId } : {}) },
        {
          text,
          ...(threadId ? { threadId } : {}),
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
