/**
 * DiscordChannelAdapter — Discord adapter for IChannel.
 *
 * NEW implementation (not wrapping an existing executor).
 * Uses discord.js for Discord bot API integration.
 * Validates that the IChannel interface works for fresh implementations.
 *
 * Requires: discord.js (optional peer dependency).
 */

import type {
  IChannel,
  ChannelConfig,
  ChannelTarget,
  ChannelMessage,
  MessageResult,
  MessageRef,
  ThreadRef,
  FileUpload,
  FileResult,
  InboundMessage,
  InboundMessageHandler,
} from '../../interfaces/IChannel.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('discord-channel-adapter');

/**
 * Dynamic import helper that bypasses TypeScript module resolution.
 * Used for optional peer dependencies that may not be installed.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export class DiscordChannelAdapter implements IChannel {
  readonly name = 'discord';
  private client: any = null;
  private discordModule: any = null;
  private readonly handlers: InboundMessageHandler[] = [];
  private connected = false;

  async connect(config: ChannelConfig): Promise<void> {
    const token = (config.token as string) || process.env.DISCORD_BOT_TOKEN;

    if (!token) {
      logger.warn('Discord bot token not configured. Set DISCORD_BOT_TOKEN environment variable.');
      return;
    }

    try {
      this.discordModule = await dynamicImport('discord.js');
      const { Client, GatewayIntentBits, Events } = this.discordModule;

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });

      // Set up inbound message handling
      this.client.on(Events.MessageCreate, async (message: any) => {
        // Ignore bot messages to prevent loops
        if (message.author.bot) return;

        const inbound: InboundMessage = {
          messageId: message.id,
          channelId: message.channelId,
          userId: message.author.id,
          displayName: message.author.displayName || message.author.username,
          text: message.content,
          threadId: message.thread?.id,
          timestamp: message.createdAt.toISOString(),
          raw: message,
        };

        for (const handler of this.handlers) {
          try {
            await handler(inbound);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Discord message handler failed', { error: msg });
          }
        }
      });

      this.client.on(Events.ClientReady, () => {
        logger.info('Discord bot connected', { user: this.client.user?.tag });
        this.connected = true;
      });

      this.client.on('error', (err: Error) => {
        logger.error('Discord client error', { error: err.message });
      });

      // Wait for the Ready event before returning — login() resolves before
      // the WebSocket handshake completes, which causes health checks to see
      // an "unhealthy" adapter if they run immediately after connect().
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Discord login timed out after 15 s')),
          15_000,
        );
        this.client!.once(Events.ClientReady, () => {
          clearTimeout(timeout);
          resolve();
        });
        this.client!.login(token).catch((err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      logger.info('DiscordChannelAdapter connected');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to initialize Discord adapter', { error: msg });
      this.client = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.connected = false;
      logger.info('DiscordChannelAdapter disconnected');
    }
  }

  async healthy(): Promise<boolean> {
    return this.connected && this.client?.isReady() === true;
  }

  async send(target: ChannelTarget, message: ChannelMessage): Promise<MessageResult> {
    if (!this.client || !this.connected) {
      return { success: false, error: 'Discord adapter not connected' };
    }

    try {
      let channel: any;

      if (target.userId) {
        // Send DM
        const user = await this.client.users.fetch(target.userId);
        channel = await user.createDM();
      } else {
        if (!target.channelId) {
          return { success: false, error: 'No channelId or userId provided' };
        }
        channel = await this.requireNonDmChannel(target.channelId);
      }

      if (!channel) {
        return { success: false, error: `Channel not found: ${target.channelId ?? '(none)'}` };
      }

      const sendOptions: any = { content: message.text };

      // Thread support — fetch explicitly, don't rely on cache (M3)
      if (message.threadId) {
        try {
          const thread = await this.client.channels.fetch(message.threadId);
          if (thread) {
            channel = thread;
          } else {
            return {
              success: false,
              error: `Thread not found: ${message.threadId}`,
            };
          }
        } catch {
          return {
            success: false,
            error: `Failed to fetch thread: ${message.threadId}`,
          };
        }
      }

      // Reply to message
      if (message.replyTo) {
        sendOptions.reply = { messageReference: message.replyTo.messageId };
      }

      // File attachments
      if (message.attachments?.length) {
        sendOptions.files = message.attachments.map((a: FileUpload) => ({
          attachment: a.content,
          name: a.filename,
        }));
      }

      const sent = await channel.send(sendOptions);

      return {
        success: true,
        messageId: sent.id,
        threadId: sent.thread?.id,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send Discord message', {
        error: errorMsg,
        channelId: target.channelId,
      });
      return { success: false, error: `Failed to send message: ${errorMsg}` };
    }
  }

  async listen(handler: InboundMessageHandler): Promise<void> {
    this.handlers.push(handler);
    logger.info('Discord message handler registered', {
      totalHandlers: this.handlers.length,
    });
  }

  supportsInboundListening(): boolean { return true; }
  supportsReactions(): boolean { return true; }
  supportsThreads(): boolean { return true; }
  supportsFileUpload(): boolean { return true; }
  supportsIdentityOverride(): boolean { return false; }

  async react(target: MessageRef, emoji: string): Promise<void> {
    if (!this.client || !this.connected) return;

    try {
      const channel = await this.requireNonDmChannel(target.channelId);
      const message = await channel.messages.fetch(target.messageId);
      await message.react(emoji);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to add Discord reaction', { error: msg });
    }
  }

  async createThread(target: MessageRef, threadName: string): Promise<ThreadRef> {
    if (!this.client || !this.connected) {
      throw new Error('Discord adapter not connected');
    }

    const channel = await this.requireNonDmChannel(target.channelId);
    const message = await channel.messages.fetch(target.messageId);
    const thread = await message.startThread({ name: threadName });

    return {
      threadId: thread.id,
      channelId: target.channelId,
    };
  }

  async uploadFile(target: ChannelTarget, file: FileUpload): Promise<FileResult> {
    const result = await this.send(target, {
      text: '',
      attachments: [file],
    });

    return {
      success: result.success,
      error: result.error,
    };
  }

  // ─── Additional helpers (not part of IChannel) ──────────────────────────
  // Exposed for DiscordExecutor which needs history fetches beyond what the
  // shared interface supports. Kept as named methods on the concrete adapter
  // so we don't widen IChannel with Discord-specific affordances.

  /**
   * Fetch recent messages from a channel (or thread). Returns a plain array
   * of normalized message objects. Throws on failure (caller handles).
   */
  async fetchChannelHistory(channelId: string, limit = 50): Promise<Array<{
    id: string;
    author: { id: string; username: string; bot: boolean };
    content: string;
    createdAt: string;
    threadId: string | null;
  }>> {
    if (!this.client || !this.connected) {
      throw new Error('Discord adapter not connected');
    }
    const channel = await this.requireNonDmChannel(channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    if (typeof channel.messages?.fetch !== 'function') {
      throw new Error(`Channel ${channelId} is not a text channel`);
    }

    const collection = await channel.messages.fetch({ limit: Math.min(Math.max(limit, 1), 100) });
    const messages: Array<{
      id: string;
      author: { id: string; username: string; bot: boolean };
      content: string;
      createdAt: string;
      threadId: string | null;
    }> = [];
    // discord.js returns a Collection; iterate with .values()
    for (const msg of collection.values()) {
      messages.push({
        id: msg.id,
        author: {
          id: msg.author?.id ?? '',
          username: msg.author?.username ?? '',
          bot: msg.author?.bot === true,
        },
        content: msg.content ?? '',
        createdAt: msg.createdAt?.toISOString?.() ?? new Date().toISOString(),
        threadId: msg.thread?.id ?? null,
      });
    }
    return messages;
  }

  /**
   * Fetch messages from a thread by thread id. Threads are channels in
   * Discord, so this delegates to fetchChannelHistory under the hood.
   */
  async fetchThreadReplies(threadId: string, limit = 50): Promise<Array<{
    id: string;
    author: { id: string; username: string; bot: boolean };
    content: string;
    createdAt: string;
    threadId: string | null;
  }>> {
    return this.fetchChannelHistory(threadId, limit);
  }

  /** Expose readiness flag for the executor's health check. */
  isConnected(): boolean {
    return this.connected;
  }

  private async requireNonDmChannel(channelId: string): Promise<any> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    if (channel.isDMBased?.() === true) {
      throw new Error(`Discord DMs are not supported: ${channelId}`);
    }
    return channel;
  }
}
