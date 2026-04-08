import type { EventBus } from './event.js';
import type { DiscordChannelAdapter } from '../adapters/channels/DiscordChannelAdapter.js';
import type { InboundMessage } from '../interfaces/IChannel.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('discord-event-handler');

/** Max recent message IDs retained for dedup. */
const MAX_EVENT_CACHE = 1000;

// ─── Secret Redaction ──────────────────────────────────────────────────────
// Match obvious token shapes and replace with [REDACTED] before publishing.
// Keep patterns conservative — false positives on normal chat text are worse
// than missing a clever leak (the inbound handler is defense-in-depth, not
// a guarantee).

/** Apply conservative secret-redaction patterns to message text. */
function redact(text: string): string {
  return text
    // OpenAI keys (`sk-...`)
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED]')
    // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
    .replace(/gh[psour]_[a-zA-Z0-9]{36,}/g, '[REDACTED]')
    .replace(/github_pat_[a-zA-Z0-9_]{20,}/g, '[REDACTED]')
    // AWS access keys
    .replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED]')
    // Discord bot tokens (Mxxx.xxx.xxx and Nxxx.xxx.xxx)
    .replace(/[MN][A-Za-z\d]{23,}\.[\w-]{6,}\.[\w-]{27,}/g, '[REDACTED]')
    // Generic high-entropy bearer-shaped tokens (40+ chars, mixed case + digits)
    .replace(/\b[a-zA-Z0-9_-]{40,}\b/g, (match) => {
      const hasLower = /[a-z]/.test(match);
      const hasUpper = /[A-Z]/.test(match);
      const hasDigit = /\d/.test(match);
      return (hasLower && hasUpper && hasDigit) ? '[REDACTED]' : match;
    });
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Bridges inbound Discord messages from the shared DiscordChannelAdapter to
 * the internal EventBus. Publishes `discord:message` for normal messages
 * and `discord:mention` when the bot user is @mentioned.
 *
 * Security layers:
 *   1. Bot filter (defense in depth — adapter already drops bots, but we
 *      re-check here so a future adapter change can't leak bot messages).
 *   2. Optional DISCORD_ALLOWED_CHANNEL_IDS allowlist — fail-open if unset.
 *   3. Message-ID dedup (bounded in-memory cache).
 *   4. Secret redaction on message text before publishing.
 *
 * This is NOT a webhook route — Discord uses a persistent gateway
 * connection via discord.js. The handler registers via adapter.listen().
 */
export class DiscordEventHandler {
  private recentMessageIds = new Set<string>();
  private readonly allowedChannels: Set<string> | null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly adapter: DiscordChannelAdapter,
  ) {
    const raw = process.env.DISCORD_ALLOWED_CHANNEL_IDS;
    this.allowedChannels = raw
      ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
      : null;

    logger.info('DiscordEventHandler initialized', {
      allowedChannels: this.allowedChannels?.size ?? 'all',
    });
  }

  /** Register the inbound listener with the shared adapter. */
  async start(): Promise<void> {
    await this.adapter.listen(async (inbound) => {
      try {
        await this.handleMessage(inbound);
      } catch (err) {
        // Never let a handler exception propagate into the discord.js event
        // loop — it would kill the gateway reader.
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Discord event handler threw', {
          messageId: inbound.messageId,
          error: msg,
        });
      }
    });
    logger.info('DiscordEventHandler listener registered');
  }

  // ─── Core pipeline ──────────────────────────────────────────────────────

  private async handleMessage(inbound: InboundMessage): Promise<void> {
    const raw = inbound.raw as
      | {
          author?: { bot?: boolean; id?: string; username?: string };
          guildId?: string | null;
          channel?: { parentId?: string | null; isThread?: () => boolean };
          mentions?: {
            users?: { has: (id: string) => boolean; size?: number };
            has?: (user: unknown) => boolean;
          };
          client?: { user?: { id?: string } };
        }
      | undefined;

    // 1. Belt-and-suspenders bot filter.
    if (raw?.author?.bot === true) {
      logger.debug('Dropping Discord bot message', { messageId: inbound.messageId });
      return;
    }

    // 2. Dedup by message ID.
    if (this.recentMessageIds.has(inbound.messageId)) {
      logger.debug('Dropping duplicate Discord message', { messageId: inbound.messageId });
      return;
    }
    this.recentMessageIds.add(inbound.messageId);
    if (this.recentMessageIds.size > MAX_EVENT_CACHE * 2) {
      const entries = [...this.recentMessageIds];
      this.recentMessageIds = new Set(entries.slice(-MAX_EVENT_CACHE));
    }

    // 3. Determine thread context and parent channel.
    const threadId = inbound.threadId ?? null;
    const parentChannelId = raw?.channel?.parentId ?? null;
    const isThread = threadId !== null && threadId !== undefined;
    // For thread messages, the effective "channel" for allowlist purposes
    // is the parent text channel, not the thread itself.
    const effectiveChannelId = isThread && parentChannelId
      ? parentChannelId
      : inbound.channelId;

    // 4. Channel allowlist — fail-open if unset.
    if (this.allowedChannels && !this.allowedChannels.has(effectiveChannelId)) {
      logger.debug('Dropping Discord message from non-allowed channel', {
        messageId: inbound.messageId,
        channelId: inbound.channelId,
        effectiveChannelId,
      });
      return;
    }

    // 5. Mention detection — check if the bot user is in the mention list.
    let isMention = false;
    const botUserId = raw?.client?.user?.id;
    if (botUserId && raw?.mentions?.users?.has) {
      try {
        isMention = raw.mentions.users.has(botUserId);
      } catch {
        isMention = false;
      }
    }

    // 6. Secret redaction.
    const redactedText = redact(inbound.text ?? '');

    // 7. Build event payload.
    const payload: Record<string, unknown> = {
      channel: inbound.channelId, // no reverse map; the raw ID doubles as name
      channelId: inbound.channelId,
      threadId,
      parentChannelId,
      isThread,
      user: inbound.displayName ?? raw?.author?.username ?? 'unknown',
      userId: inbound.userId,
      text: redactedText,
      messageId: inbound.messageId,
      isMention,
      guildId: raw?.guildId ?? null,
      timestamp: inbound.timestamp,
    };

    // 8. Publish to EventBus.
    const eventType = isMention ? 'mention' : 'message';
    logger.info('Publishing discord event', {
      type: `discord:${eventType}`,
      channelId: inbound.channelId,
      isThread,
    });
    await this.eventBus.publish('discord', eventType, payload);
  }
}
