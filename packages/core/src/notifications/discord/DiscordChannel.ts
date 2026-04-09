/**
 * DiscordChannel — INotificationChannel implementation for Discord.
 *
 * Routes NotificationEvents to Discord using per-department webhooks for
 * agent identity (username + avatar override). Falls back to the shared
 * DiscordChannelAdapter bot if no webhook is configured for a department.
 *
 * Webhook env vars:
 *   DISCORD_WEBHOOK_EXECUTIVE, DISCORD_WEBHOOK_DEVELOPMENT, etc.
 *
 * Thread grouping:
 *   Uses ThreadRegistry for correlation-key → thread mapping. Events with
 *   a threadKey that should be threaded get grouped into Discord threads.
 */

import type { INotificationChannel } from '../INotificationChannel.js';
import type { NotificationEvent, PublishResult, Department } from '../types.js';
import type { IChannel } from '../../interfaces/IChannel.js';
import { DiscordRenderer, type DiscordEmbed } from './DiscordRenderer.js';
import type { ThreadRegistry } from '../state/ThreadRegistry.js';
import { getAgentIdentity } from '../AgentRegistry.js';
import {
  getChannelForDepartment,
} from '../../utils/channel-routing.js';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('discord-notification-channel');

// ─── Webhook Client (lazy dynamic import of discord.js) ──────────────────────

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

/** Departments that support webhook-based routing. */
const WEBHOOK_DEPARTMENTS: Department[] = [
  'executive', 'development', 'operations', 'marketing',
  'finance', 'support', 'audit', 'alerts', 'general',
];

/** Thread-worthy notification kinds. */
const THREADABLE_KINDS = new Set([
  'lifecycle', 'pr_status', 'ci_status', 'alert',
  'deployment', 'support', 'audit_log',
]);

export class DiscordChannel implements INotificationChannel {
  readonly platform = 'discord';

  private readonly renderer = new DiscordRenderer();
  private readonly webhookClients = new Map<string, any>();
  private discordModule: any = null;
  private initialized = false;

  constructor(
    private readonly botAdapter: IChannel | null,
    private readonly threadRegistry: ThreadRegistry | null,
  ) {}

  /** Initialize webhook clients from env vars. Call once at startup. */
  async init(): Promise<void> {
    if (this.initialized) return;

    for (const dept of WEBHOOK_DEPARTMENTS) {
      const envKey = `DISCORD_WEBHOOK_${dept.toUpperCase()}`;
      const url = process.env[envKey]?.trim();
      if (!url) continue;

      try {
        if (!this.discordModule) {
          this.discordModule = await dynamicImport('discord.js');
        }
        const { WebhookClient } = this.discordModule;
        this.webhookClients.set(dept, new WebhookClient({ url }));
        log.info('Discord webhook configured', { department: dept });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Failed to create Discord webhook client', {
          department: dept, error: msg,
        });
      }
    }

    this.initialized = true;
    log.info('DiscordChannel initialized', {
      webhooks: this.webhookClients.size,
      hasBotFallback: this.botAdapter !== null,
    });
  }

  isEnabled(): boolean {
    return this.webhookClients.size > 0
      || (this.botAdapter !== null);
  }

  healthy(): boolean {
    return this.isEnabled();
  }

  async send(event: NotificationEvent): Promise<PublishResult> {
    if (!this.initialized) await this.init();

    const embed = this.renderer.render({
      ...event,
      metadata: {
        ...event.metadata,
        agentColor: getAgentIdentity(event.agent.id).color,
      },
    });
    const agent = getAgentIdentity(event.agent.id);

    // Resolve thread if applicable
    const threadId = await this.resolveThread(event);

    // Try webhook first (per-department identity)
    const webhook = this.webhookClients.get(event.agent.department);
    if (webhook) {
      return this.sendViaWebhook(webhook, embed, agent, event, threadId);
    }

    // Fall back to bot adapter
    if (this.botAdapter) {
      return this.sendViaBotAdapter(embed, event, threadId);
    }

    log.warn('No webhook or bot adapter available', {
      department: event.agent.department,
      kind: event.kind,
    });
    return { messageId: '', platform: 'discord' };
  }

  private async sendViaWebhook(
    webhook: any,
    embed: DiscordEmbed,
    agent: { name: string; emoji: string; avatarUrl?: string },
    event: NotificationEvent,
    threadId: string | undefined,
  ): Promise<PublishResult> {
    try {
      const sendOptions: Record<string, unknown> = {
        username: `${agent.emoji} ${agent.name}`,
        embeds: [embed],
      };

      if (agent.avatarUrl) {
        sendOptions.avatarURL = agent.avatarUrl;
      }

      if (threadId) {
        sendOptions.threadId = threadId;
      }

      const msg = await webhook.send(sendOptions);

      // Create thread for new threadable events
      if (!threadId && event.threadKey && THREADABLE_KINDS.has(event.kind)) {
        await this.createAndSaveThread(msg, event);
      }

      return {
        messageId: msg.id,
        threadId: threadId ?? undefined,
        platform: 'discord',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Discord webhook send failed', {
        department: event.agent.department,
        error: msg,
      });
      // Fall back to bot adapter on webhook failure
      if (this.botAdapter) {
        return this.sendViaBotAdapter(embed, event, threadId);
      }
      throw err;
    }
  }

  private async sendViaBotAdapter(
    embed: DiscordEmbed,
    event: NotificationEvent,
    threadId: string | undefined,
  ): Promise<PublishResult> {
    const channelId = getChannelForDepartment(
      event.agent.department,
      'discord',
    );
    if (!channelId) {
      log.debug('No Discord channel configured for department', {
        department: event.agent.department,
      });
      return { messageId: '', platform: 'discord' };
    }

    // Build a text fallback with embed info (bot adapter uses IChannel.send)
    const text = `${event.agent.emoji} **${event.agent.name}** \u2014 ${event.title}\n${event.summary}`;

    const result = await this.botAdapter!.send(
      { channelId, ...(threadId ? { threadId } : {}) },
      { text, ...(threadId ? { threadId } : {}) },
    );

    return {
      messageId: result.messageId ?? '',
      threadId: result.threadId,
      platform: 'discord',
    };
  }

  // ─── Thread Management ─────────────────────────────────────────────────────

  private async resolveThread(
    event: NotificationEvent,
  ): Promise<string | undefined> {
    if (!event.threadKey || !this.threadRegistry) return undefined;
    if (!THREADABLE_KINDS.has(event.kind)) return undefined;

    return (await this.threadRegistry.get(event.threadKey)) ?? undefined;
  }

  private async createAndSaveThread(
    rootMessage: any,
    event: NotificationEvent,
  ): Promise<void> {
    if (!this.threadRegistry || !event.threadKey) return;

    try {
      // Webhook messages returned by discord.js support startThread
      if (typeof rootMessage.startThread === 'function') {
        const thread = await rootMessage.startThread({
          name: truncate(`${event.agent.emoji} ${event.title}`, 100),
          autoArchiveDuration: 1440, // 24 hours
        });
        await this.threadRegistry.set(
          event.threadKey,
          rootMessage.channelId ?? '',
          thread.id,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.debug('Thread creation skipped', { error: msg });
    }
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}
