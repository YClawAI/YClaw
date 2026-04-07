import { Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventBus } from './event.js';
import { createLogger } from '../logging/logger.js';
import { getMemoryDir } from '../config/loader.js';

const logger = createLogger('telegram-webhook');

/**
 * Bridges incoming Telegram messages into the agent event bus.
 *
 * Telegraf receives updates from Telegram (via webhook or polling),
 * normalizes them into structured events, and publishes to the EventBus.
 * KEEPER agent subscribes to `telegram:message` events and processes them.
 */
export class TelegramWebhookHandler {
  private bot: Telegraf | null = null;
  private readonly chatId: string | number;
  private readonly allowedChatId: number | null;
  private botUsername: string | null = null;
  private botId: number | null = null;
  private readonly allowlist: TelegramAllowlist;
  private readonly adminIds: Set<number>;

  private readonly webhookSecret: string | undefined;

  constructor(
    private readonly eventBus: EventBus,
  ) {
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.allowedChatId = this.chatId ? Number(this.chatId) : null;
    this.webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
    this.allowlist = new TelegramAllowlist();
    this.adminIds = parseIdList(process.env.TELEGRAM_ADMIN_IDS);
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram webhook disabled');
      return;
    }

    this.bot = new Telegraf(botToken);
    this.setupHandlers();
    this.resolveBotIdentity();
    logger.info('TelegramWebhookHandler initialized');
  }

  /** Fetch the bot's own username and ID so we can detect mentions. */
  private async resolveBotIdentity(): Promise<void> {
    if (!this.bot) return;
    try {
      const me = await this.bot.telegram.getMe();
      this.botUsername = me.username || null;
      this.botId = me.id;
      logger.info('Bot identity resolved', { username: this.botUsername, id: this.botId });
    } catch (err) {
      logger.warn('Failed to resolve bot identity', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private setupHandlers(): void {
    if (!this.bot) return;

    // Text messages in groups/channels
    this.bot.on('text', (ctx) => this.handleTextMessage(ctx));

    // New member joins
    this.bot.on('new_chat_members', (ctx) => this.handleNewMembers(ctx));

    // Member leaves
    this.bot.on('left_chat_member', (ctx) => this.handleMemberLeft(ctx));
  }

  private async handleTextMessage(ctx: Context<Update.MessageUpdate<Message.TextMessage>>): Promise<void> {
    const msg = ctx.message;
    if (!msg || !msg.text) return;

    // Skip bot's own messages
    if (msg.from?.is_bot) return;

    // Enforce chat restriction if configured
    if (this.allowedChatId !== null && msg.chat.id !== this.allowedChatId) {
      logger.warn('Ignoring Telegram message from unauthorized chat', {
        chatId: msg.chat.id,
        allowedChatId: this.allowedChatId,
      });
      return;
    }

    const username = msg.from?.username || msg.from?.first_name || 'unknown';
    const isReply = !!msg.reply_to_message;
    const isCommand = msg.text.startsWith('/');
    const senderId = msg.from?.id;
    if (!senderId) return;

    // Detect bot mentions (@YClaw_Keeper_Bot or reply to bot's message)
    const botUsername = this.botUsername;
    const isBotMention = botUsername
      ? msg.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
      : false;
    const isReplyToBot = msg.reply_to_message?.from?.id === this.botId;

    // Check if sender is a chat admin (for management commands)
    let isAdmin = false;
    if ((isBotMention || isReplyToBot || isCommand) && senderId) {
      isAdmin = this.adminIds.has(senderId) || await this.checkAdmin(msg.chat.id, senderId);
    }

    // Pairing gate: require allowlist in production (or when TELEGRAM_PAIRING_REQUIRED=true)
    if (this.isPairingRequired()) {
      const command = isCommand ? msg.text.trim().split(/\s+/)[0].toLowerCase() : '';
      const isPaired = this.allowlist.isAllowed(senderId);

      if (!isPaired) {
        if (command === '/pair') {
          await this.handlePairingRequest(ctx, senderId);
          return;
        }
        if (command === '/approve' && isAdmin) {
          await this.handleApproveRequest(ctx);
          return;
        }

        await this.replyIfPossible(ctx, 'Pairing required. Ask an admin to /approve you, or use /pair <code> if provided.');
        logger.warn('Blocked unpaired Telegram sender', { senderId, chatId: msg.chat.id });
        return;
      }
    }

    logger.info('Incoming Telegram message', {
      from: username,
      chatId: msg.chat.id,
      isReply,
      isCommand,
      isBotMention,
      isReplyToBot,
      isAdmin,
      textLength: msg.text.length,
    });

    await this.eventBus.publish('telegram', 'message', {
      messageType: 'text',
      chatId: msg.chat.id,
      messageId: msg.message_id,
      from: {
        id: msg.from?.id,
        username,
        firstName: msg.from?.first_name,
        lastName: msg.from?.last_name,
        isBot: msg.from?.is_bot || false,
        isAdmin,
      },
      text: msg.text,
      isReply,
      isCommand,
      isBotMention,
      isReplyToBot,
      isAdmin,
      replyToMessageId: msg.reply_to_message?.message_id,
      chatType: msg.chat.type,
      timestamp: new Date(msg.date * 1000).toISOString(),
    });
  }

  /**
   * Check if a user is an admin (or creator) of a chat.
   * Caches results for 5 minutes to avoid hammering the API.
   */
  private adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();

  private async checkAdmin(chatId: number | string, userId: number): Promise<boolean> {
    const cacheKey = `${chatId}:${userId}`;
    const cached = this.adminCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.isAdmin;
    }

    try {
      const member = await this.bot!.telegram.getChatMember(chatId, userId);
      const isAdmin = member.status === 'administrator' || member.status === 'creator';
      this.adminCache.set(cacheKey, { isAdmin, expiresAt: Date.now() + 5 * 60 * 1000 });
      return isAdmin;
    } catch (err) {
      logger.warn('Failed to check admin status', {
        chatId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async handleNewMembers(ctx: Context<Update.MessageUpdate<Message.NewChatMembersMessage>>): Promise<void> {
    const msg = ctx.message;
    if (!msg?.new_chat_members) return;

    if (this.allowedChatId !== null && msg.chat.id !== this.allowedChatId) {
      return;
    }

    for (const member of msg.new_chat_members) {
      if (member.is_bot) continue;

      const username = member.username || member.first_name || 'unknown';

      logger.info('New Telegram member', {
        username,
        chatId: msg.chat.id,
      });

      await this.eventBus.publish('telegram', 'message', {
        messageType: 'new_member',
        chatId: msg.chat.id,
        messageId: msg.message_id,
        from: {
          id: member.id,
          username,
          firstName: member.first_name,
          lastName: member.last_name,
          isBot: false,
        },
        text: `New member joined: ${username}`,
        isReply: false,
        isCommand: false,
        chatType: msg.chat.type,
        timestamp: new Date(msg.date * 1000).toISOString(),
      });
    }
  }

  private async handleMemberLeft(ctx: Context<Update.MessageUpdate<Message.LeftChatMemberMessage>>): Promise<void> {
    const msg = ctx.message;
    if (!msg?.left_chat_member) return;

    if (this.allowedChatId !== null && msg.chat.id !== this.allowedChatId) {
      return;
    }

    const member = msg.left_chat_member;
    if (member.is_bot) return;

    logger.info('Telegram member left', {
      username: member.username || member.first_name,
      chatId: msg.chat.id,
    });

    // Don't fire agent for member leaving — just log it
  }

  /**
   * Start receiving updates via long polling (for development).
   * In production, use launchWebhook() instead.
   */
  async startPolling(): Promise<void> {
    if (!this.bot) {
      logger.warn('Cannot start polling — bot not initialized');
      return;
    }

    logger.info('Starting Telegram polling...');
    await this.bot.launch({ dropPendingUpdates: true });
    logger.info('Telegram polling started');
  }

  /**
   * Set up webhook mode for production (behind a reverse proxy / ALB).
   * The Express webhook server handles the HTTP endpoint; Telegraf just
   * processes the updates that come in.
   */
  getWebhookCallback(): ((req: any, res: any) => void) | null {
    if (!this.bot) return null;
    if (!this.webhookSecret) {
      // Fail-closed: never mount unverified webhook regardless of environment
      logger.error('TELEGRAM_WEBHOOK_SECRET not set — refusing to mount unverified webhook (fail-closed)');
      return null;
    }
    return this.bot.webhookCallback('/telegram/webhook', { secretToken: this.webhookSecret });
  }

  private isPairingRequired(): boolean {
    const flag = process.env.TELEGRAM_PAIRING_REQUIRED;
    if (typeof flag === 'string' && flag.length > 0) {
      return flag.toLowerCase() === 'true';
    }
    return process.env.NODE_ENV === 'production';
  }

  private async handlePairingRequest(ctx: Context<Update.MessageUpdate<Message.TextMessage>>, senderId: number): Promise<void> {
    const pairingCode = process.env.TELEGRAM_PAIRING_CODE;
    if (!pairingCode) {
      await this.replyIfPossible(ctx, 'Pairing is admin-only. Ask an admin to /approve you.');
      return;
    }

    const provided = ctx.message?.text?.trim().split(/\s+/)[1];
    if (!provided || provided !== pairingCode) {
      await this.replyIfPossible(ctx, 'Invalid pairing code.');
      return;
    }

    const added = this.allowlist.add(senderId);
    if (added) {
      await this.replyIfPossible(ctx, 'Paired successfully.');
      logger.info('Telegram sender paired via code', { senderId });
    } else {
      await this.replyIfPossible(ctx, 'You are already paired.');
    }
  }

  private async handleApproveRequest(ctx: Context<Update.MessageUpdate<Message.TextMessage>>): Promise<void> {
    const targetId = this.extractApproveTarget(ctx);
    if (!targetId) {
      await this.replyIfPossible(ctx, 'Usage: /approve <userId> (or reply to a user message).');
      return;
    }

    const added = this.allowlist.add(targetId);
    if (added) {
      await this.replyIfPossible(ctx, `Approved ${targetId}.`);
      logger.info('Telegram sender approved', { targetId });
    } else {
      await this.replyIfPossible(ctx, `${targetId} is already paired.`);
    }
  }

  private extractApproveTarget(ctx: Context<Update.MessageUpdate<Message.TextMessage>>): number | null {
    const replyId = ctx.message?.reply_to_message?.from?.id;
    if (replyId) return replyId;

    const parts = ctx.message?.text?.trim().split(/\s+/) || [];
    if (parts.length < 2) return null;
    const candidate = Number(parts[1]);
    if (!Number.isFinite(candidate)) return null;
    return candidate;
  }

  private async replyIfPossible(ctx: Context<Update.MessageUpdate<Message.TextMessage>>, text: string): Promise<void> {
    try {
      await ctx.reply(text);
    } catch (err) {
      logger.warn('Failed to reply to Telegram message', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop('SIGTERM');
      logger.info('Telegram webhook handler stopped');
    }
  }
}

type AllowlistData = {
  userIds: number[];
  updatedAt: string;
};

class TelegramAllowlist {
  private readonly filePath: string;
  private readonly userIds: Set<number>;

  constructor() {
    const baseDir = join(getMemoryDir(), 'telegram');
    this.filePath = join(baseDir, 'allowed_senders.json');
    try {
      ensureFile(baseDir, this.filePath);
    } catch (err) {
      logger.warn('Cannot initialize allowlist file (read-only filesystem?) — allowlist will be in-memory only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.userIds = new Set<number>();
    this.loadFromFile();

    const seed = parseIdList(process.env.TELEGRAM_ALLOWED_SENDER_IDS);
    if (seed.size > 0) {
      let changed = false;
      for (const id of seed) {
        if (!this.userIds.has(id)) {
          this.userIds.add(id);
          changed = true;
        }
      }
      if (changed) this.persist();
    }
  }

  isAllowed(userId: number): boolean {
    return this.userIds.has(userId);
  }

  add(userId: number): boolean {
    if (this.userIds.has(userId)) return false;
    this.userIds.add(userId);
    this.persist();
    return true;
  }

  private loadFromFile(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as AllowlistData;
      if (Array.isArray(parsed.userIds)) {
        for (const id of parsed.userIds) {
          if (Number.isFinite(id)) this.userIds.add(Number(id));
        }
      }
    } catch (err) {
      logger.warn('Failed to read Telegram allowlist, starting empty', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private persist(): void {
    try {
      const data: AllowlistData = {
        userIds: Array.from(this.userIds.values()),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to persist Telegram allowlist', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function ensureFile(baseDir: string, filePath: string): void {
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    const empty: AllowlistData = { userIds: [], updatedAt: new Date().toISOString() };
    writeFileSync(filePath, JSON.stringify(empty, null, 2), 'utf-8');
  }
}

function parseIdList(raw?: string): Set<number> {
  const result = new Set<number>();
  if (!raw) return result;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const id = Number(trimmed);
    if (Number.isFinite(id)) result.add(id);
  }
  return result;
}
