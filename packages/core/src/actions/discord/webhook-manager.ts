/**
 * Webhook management for Discord executor.
 *
 * Handles lazy initialization of per-department webhook clients, channel-to-
 * department reverse lookups, and raw REST webhook execution (the ?thread_id=
 * pattern used for reliable thread delivery — "OpenClaw pattern").
 */

import { createLogger } from '../../logging/logger.js';
import type { WebhookCredentials } from './types.js';
import { WEBHOOK_DEPARTMENTS } from './types.js';

const logger = createLogger('discord:webhook-manager');

/**
 * Minimal interface for a discord.js WebhookClient instance.
 * Typed locally to avoid a hard compile-time dependency on discord.js
 * (which is an optional peer dependency).
 */
interface WebhookClientLike {
  send(options: Record<string, unknown>): Promise<{ id: string }>;
}

export class WebhookManager {
  /** Per-department discord.js WebhookClient instances. */
  private readonly webhookClients = new Map<string, WebhookClientLike>();
  /** Raw webhook credentials per department for direct REST API calls. */
  private readonly webhookCredentials = new Map<string, WebhookCredentials>();
  /** Reverse map: channelId → department. */
  private readonly channelToDept = new Map<string, string>();
  private initialized = false;

  /**
   * Lazy-init webhook clients from DISCORD_WEBHOOK_* env vars.
   * Safe to call multiple times — only runs once.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Build reverse map: channelId → department
    for (const dept of WEBHOOK_DEPARTMENTS) {
      const channelId = process.env[`DISCORD_CHANNEL_${dept.toUpperCase()}`]?.trim();
      if (channelId) this.channelToDept.set(channelId, dept);
    }

    let hasAny = false;
    for (const dept of WEBHOOK_DEPARTMENTS) {
      const url = process.env[`DISCORD_WEBHOOK_${dept.toUpperCase()}`]?.trim();
      if (!url) continue;

      // Extract raw id/token from URL for direct REST calls
      const match = url.match(/\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)/);
      if (match) {
        this.webhookCredentials.set(dept, { id: match[1], token: match[2] });
      }

      try {
        const { WebhookClient } = await import('discord.js');
        this.webhookClients.set(dept, new WebhookClient({ url }) as unknown as WebhookClientLike);
        hasAny = true;
      } catch (err) {
        logger.error('Failed to create Discord webhook client', {
          department: dept,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (hasAny) {
      logger.info('Discord webhooks initialized', { departments: [...this.webhookClients.keys()] });
    }
  }

  /**
   * Find the discord.js WebhookClient for a target channel.
   * Returns undefined if no webhook is configured for that channel.
   */
  getWebhookForChannel(channelId: string): WebhookClientLike | undefined {
    const dept = this.channelToDept.get(channelId);
    return dept ? this.webhookClients.get(dept) : undefined;
  }

  /**
   * Get raw webhook credentials (id + token) for a channel.
   * Used for direct REST API calls (e.g. posting to threads via ?thread_id=).
   */
  getCredentialsForChannel(channelId: string): WebhookCredentials | undefined {
    const dept = this.channelToDept.get(channelId);
    return dept ? this.webhookCredentials.get(dept) : undefined;
  }

  /**
   * Execute a webhook via the Discord REST API.
   * Supports the ?thread_id= query parameter for reliable thread delivery
   * (the "OpenClaw pattern" — avoids the limitations of the JS WebhookClient
   * for thread posts).
   */
  async executeRaw(params: {
    webhookId: string;
    webhookToken: string;
    content: string;
    username?: string;
    avatarUrl?: string;
    threadId?: string;
  }): Promise<{ id: string; channel_id: string }> {
    const url = new URL(
      `https://discord.com/api/v10/webhooks/${encodeURIComponent(params.webhookId)}/${encodeURIComponent(params.webhookToken)}`,
    );
    url.searchParams.set('wait', 'true');
    if (params.threadId) url.searchParams.set('thread_id', params.threadId);

    const body: Record<string, unknown> = { content: params.content };
    if (params.username) body.username = params.username;
    if (params.avatarUrl) body.avatar_url = params.avatarUrl;

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(`Discord webhook execute failed (${response.status}): ${raw.slice(0, 200)}`);
    }

    return response.json() as Promise<{ id: string; channel_id: string }>;
  }
}
