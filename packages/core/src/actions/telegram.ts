import { Telegraf } from 'telegraf';
import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('telegram-executor');

// ─── Telegram Action Executor ───────────────────────────────────────────────
//
// Actions:
//   telegram:message        - Send a message to a channel or group
//   telegram:reply          - Reply to a specific message
//   telegram:pin            - Pin a message in a chat
//   telegram:delete         - Delete a message
//   telegram:dm             - Send a direct message to a user
//   telegram:announce          - Post to the announcement channel
//   telegram:ban               - Ban a user from a chat
//   telegram:restrict          - Restrict a user's permissions
//   telegram:set_chat_photo    - Update a chat's photo
//   telegram:set_title         - Update a chat's title
//   telegram:set_description   - Update a chat's description
//   telegram:set_permissions   - Set default chat permissions
//   telegram:export_invite     - Export/create invite link
//

export class TelegramExecutor implements ActionExecutor {
  readonly name = 'telegram';
  private bot: Telegraf | null = null;

  constructor() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      logger.warn(
        'Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN environment variable.',
      );
      return;
    }

    this.bot = new Telegraf(botToken);
  }

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'telegram:message',
        description: 'Send a message to a Telegram channel or group',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          text: { type: 'string', description: 'Message text content', required: true },
          parseMode: { type: 'string', description: 'Parse mode: HTML, Markdown, or MarkdownV2' },
        },
      },
      {
        name: 'telegram:reply',
        description: 'Reply to a specific message in a Telegram chat',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          text: { type: 'string', description: 'Reply text content', required: true },
          replyToMessageId: { type: 'number', description: 'Message ID to reply to', required: true },
          parseMode: { type: 'string', description: 'Parse mode: HTML, Markdown, or MarkdownV2' },
        },
      },
      {
        name: 'telegram:pin',
        description: 'Pin a message in a Telegram chat',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          messageId: { type: 'number', description: 'Message ID to pin', required: true },
          disableNotification: { type: 'boolean', description: 'Disable notification for pin (default: false)' },
        },
      },
      {
        name: 'telegram:delete',
        description: 'Delete a message from a Telegram chat',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          messageId: { type: 'number', description: 'Message ID to delete', required: true },
        },
      },
      {
        name: 'telegram:dm',
        description: 'Send a direct message to a Telegram user',
        parameters: {
          userId: { type: 'string', description: 'Telegram user ID', required: true },
          text: { type: 'string', description: 'Message text content', required: true },
          parseMode: { type: 'string', description: 'Parse mode: HTML, Markdown, or MarkdownV2' },
        },
      },
      {
        name: 'telegram:announce',
        description: 'Post to the configured announcement channel',
        parameters: {
          text: { type: 'string', description: 'Announcement text content', required: true },
          parseMode: { type: 'string', description: 'Parse mode: HTML, Markdown, or MarkdownV2 (default: HTML)' },
        },
      },
      {
        name: 'telegram:ban',
        description: 'Ban a user from a Telegram chat',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          userId: { type: 'number', description: 'User ID to ban', required: true },
          untilDate: { type: 'number', description: 'Unix timestamp when the ban expires (0 = permanent)' },
        },
      },
      {
        name: 'telegram:restrict',
        description: 'Restrict a user\'s permissions in a Telegram chat',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          userId: { type: 'number', description: 'User ID to restrict', required: true },
          permissions: { type: 'object', description: 'Permission flags: { can_send_messages, can_send_photos, ... }' },
          untilDate: { type: 'number', description: 'Unix timestamp when restrictions expire' },
        },
      },
      {
        name: 'telegram:set_chat_photo',
        description: 'Update a Telegram chat\'s photo',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          photoPath: { type: 'string', description: 'File path to the photo', required: true },
        },
      },
      {
        name: 'telegram:set_title',
        description: 'Update a Telegram chat\'s title',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          title: { type: 'string', description: 'New chat title', required: true },
        },
      },
      {
        name: 'telegram:set_description',
        description: 'Update a Telegram chat\'s description',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          description: { type: 'string', description: 'New chat description', required: true },
        },
      },
      {
        name: 'telegram:set_permissions',
        description: 'Set default permissions for all members of a Telegram chat',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
          permissions: { type: 'object', description: 'Default permission flags for all members', required: true },
        },
      },
      {
        name: 'telegram:export_invite',
        description: 'Export or create an invite link for a Telegram chat',
        parameters: {
          chatId: { type: 'string', description: 'Chat ID or @channel_username', required: true },
        },
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.bot) {
      return { success: false, error: 'Telegram bot not initialized: missing TELEGRAM_BOT_TOKEN' };
    }

    switch (action) {
      case 'message':
        return this.sendMessage(params);
      case 'reply':
        return this.replyToMessage(params);
      case 'pin':
        return this.pinMessage(params);
      case 'delete':
        return this.deleteMessage(params);
      case 'dm':
        return this.sendDM(params);
      case 'announce':
        return this.announce(params);
      case 'ban':
        return this.ban(params);
      case 'restrict':
        return this.restrict(params);
      case 'set_chat_photo':
        return this.setChatPhoto(params);
      case 'set_title':
        return this.setTitle(params);
      case 'set_description':
        return this.setDescription(params);
      case 'set_permissions':
        return this.setPermissions(params);
      case 'export_invite':
        return this.exportInvite(params);
      default:
        return { success: false, error: `Unknown Telegram action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.bot) return false;
    try {
      const me = await this.bot.telegram.getMe();
      return !!me.id;
    } catch (err) {
      logger.error('Telegram health check failed', { error: (err as Error).message });
      return false;
    }
  }

  // ─── Send message to a channel or group ───────────────────────────────────

  private async sendMessage(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const text = params.text as string | undefined;
    const parseMode = (params.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2') || undefined;

    if (!chatId || !text) {
      return { success: false, error: 'Missing required parameters: chatId, text' };
    }

    logger.info('Sending Telegram message', { chatId, textLength: text.length });

    try {
      const message = await this.bot!.telegram.sendMessage(chatId, text, {
        parse_mode: parseMode,
      });

      logger.info('Telegram message sent', { chatId, messageId: message.message_id });
      return {
        success: true,
        data: { messageId: message.message_id, chatId },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send Telegram message', { error: errorMsg, chatId });
      return { success: false, error: `Failed to send message: ${errorMsg}` };
    }
  }

  // ─── Reply to a specific message ──────────────────────────────────────────

  private async replyToMessage(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const text = params.text as string | undefined;
    const replyToMessageId = params.replyToMessageId as number | undefined;
    const parseMode = (params.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2') || undefined;

    if (!chatId || !text || !replyToMessageId) {
      return { success: false, error: 'Missing required parameters: chatId, text, replyToMessageId' };
    }

    logger.info('Replying to Telegram message', { chatId, replyToMessageId });

    try {
      const message = await this.bot!.telegram.sendMessage(chatId, text, {
        parse_mode: parseMode,
        reply_parameters: { message_id: replyToMessageId },
      });

      logger.info('Telegram reply sent', { chatId, messageId: message.message_id, replyTo: replyToMessageId });
      return {
        success: true,
        data: { messageId: message.message_id, chatId, replyTo: replyToMessageId },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to reply to Telegram message', { error: errorMsg, chatId, replyToMessageId });
      return { success: false, error: `Failed to reply: ${errorMsg}` };
    }
  }

  // ─── Pin a message ────────────────────────────────────────────────────────

  private async pinMessage(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const messageId = params.messageId as number | undefined;
    const disableNotification = (params.disableNotification as boolean) ?? false;

    if (!chatId || !messageId) {
      return { success: false, error: 'Missing required parameters: chatId, messageId' };
    }

    logger.info('Pinning Telegram message', { chatId, messageId });

    try {
      await this.bot!.telegram.pinChatMessage(chatId, messageId, {
        disable_notification: disableNotification,
      });

      logger.info('Telegram message pinned', { chatId, messageId });
      return {
        success: true,
        data: { chatId, messageId, pinned: true },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to pin Telegram message', { error: errorMsg, chatId, messageId });
      return { success: false, error: `Failed to pin message: ${errorMsg}` };
    }
  }

  // ─── Delete a message ─────────────────────────────────────────────────────

  private async deleteMessage(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const messageId = params.messageId as number | undefined;

    if (!chatId || !messageId) {
      return { success: false, error: 'Missing required parameters: chatId, messageId' };
    }

    logger.info('Deleting Telegram message', { chatId, messageId });

    try {
      await this.bot!.telegram.deleteMessage(chatId, messageId);

      logger.info('Telegram message deleted', { chatId, messageId });
      return {
        success: true,
        data: { chatId, messageId, deleted: true },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to delete Telegram message', { error: errorMsg, chatId, messageId });
      return { success: false, error: `Failed to delete message: ${errorMsg}` };
    }
  }

  // ─── Post to announcement channel ────────────────────────────────────────

  private async announce(params: Record<string, unknown>): Promise<ActionResult> {
    const text = params.text as string | undefined;
    const parseMode = (params.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2') || 'HTML';
    const announcementChatId = process.env.TELEGRAM_ANNOUNCEMENT_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

    if (!text) {
      return { success: false, error: 'Missing required parameter: text' };
    }

    if (!announcementChatId) {
      return { success: false, error: 'TELEGRAM_ANNOUNCEMENT_CHAT_ID or TELEGRAM_CHAT_ID not configured' };
    }

    logger.info('Posting to announcement channel', { textLength: text.length });

    try {
      const message = await this.bot!.telegram.sendMessage(announcementChatId, text, {
        parse_mode: parseMode,
      });

      logger.info('Announcement posted', { messageId: message.message_id });
      return {
        success: true,
        data: { messageId: message.message_id, chatId: announcementChatId },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to post announcement', { error: errorMsg });
      return { success: false, error: `Failed to post announcement: ${errorMsg}` };
    }
  }

  // ─── Ban a user from a chat ────────────────────────────────────────────

  private async ban(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const userId = params.userId as number | undefined;
    const untilDate = params.untilDate as number | undefined;

    if (!chatId || !userId) {
      return { success: false, error: 'Missing required parameters: chatId, userId' };
    }

    logger.info('Banning user', { chatId, userId });

    try {
      await this.bot!.telegram.banChatMember(chatId, userId, untilDate);

      logger.info('User banned', { chatId, userId });
      return { success: true, data: { chatId, userId, banned: true } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to ban user', { error: errorMsg, chatId, userId });
      return { success: false, error: `Failed to ban user: ${errorMsg}` };
    }
  }

  // ─── Restrict a user's permissions ─────────────────────────────────────

  private async restrict(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const userId = params.userId as number | undefined;
    const permissions = params.permissions as Record<string, boolean> | undefined;
    const untilDate = params.untilDate as number | undefined;

    if (!chatId || !userId) {
      return { success: false, error: 'Missing required parameters: chatId, userId' };
    }

    // Default: mute (no messages, no media, no polls)
    const chatPermissions = {
      can_send_messages: permissions?.can_send_messages ?? false,
      can_send_audios: permissions?.can_send_audios ?? false,
      can_send_documents: permissions?.can_send_documents ?? false,
      can_send_photos: permissions?.can_send_photos ?? false,
      can_send_videos: permissions?.can_send_videos ?? false,
      can_send_video_notes: permissions?.can_send_video_notes ?? false,
      can_send_voice_notes: permissions?.can_send_voice_notes ?? false,
      can_send_polls: permissions?.can_send_polls ?? false,
      can_send_other_messages: permissions?.can_send_other_messages ?? false,
      can_add_web_page_previews: permissions?.can_add_web_page_previews ?? false,
    };

    logger.info('Restricting user', { chatId, userId, permissions: chatPermissions });

    try {
      await this.bot!.telegram.restrictChatMember(chatId, userId, {
        permissions: chatPermissions,
        until_date: untilDate,
      });

      logger.info('User restricted', { chatId, userId });
      return { success: true, data: { chatId, userId, restricted: true, permissions: chatPermissions } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to restrict user', { error: errorMsg, chatId, userId });
      return { success: false, error: `Failed to restrict user: ${errorMsg}` };
    }
  }

  // ─── Set chat photo ────────────────────────────────────────────────────

  private async setChatPhoto(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const photoPath = params.photoPath as string | undefined;

    if (!chatId || !photoPath) {
      return { success: false, error: 'Missing required parameters: chatId, photoPath' };
    }

    logger.info('Setting chat photo', { chatId });

    try {
      await this.bot!.telegram.setChatPhoto(chatId, { source: photoPath });

      logger.info('Chat photo updated', { chatId });
      return { success: true, data: { chatId, updated: true } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to set chat photo', { error: errorMsg, chatId });
      return { success: false, error: `Failed to set chat photo: ${errorMsg}` };
    }
  }

  // ─── Set chat title ─────────────────────────────────────────────────────

  private async setTitle(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const title = params.title as string | undefined;

    if (!chatId || !title) {
      return { success: false, error: 'Missing required parameters: chatId, title' };
    }

    logger.info('Setting chat title', { chatId, title });

    try {
      await this.bot!.telegram.setChatTitle(chatId, title);
      logger.info('Chat title updated', { chatId, title });
      return { success: true, data: { chatId, title } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to set chat title', { error: errorMsg, chatId });
      return { success: false, error: `Failed to set title: ${errorMsg}` };
    }
  }

  // ─── Set chat description ──────────────────────────────────────────────

  private async setDescription(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const description = params.description as string | undefined;

    if (!chatId || description === undefined) {
      return { success: false, error: 'Missing required parameters: chatId, description' };
    }

    logger.info('Setting chat description', { chatId });

    try {
      await this.bot!.telegram.setChatDescription(chatId, description);
      logger.info('Chat description updated', { chatId });
      return { success: true, data: { chatId, updated: true } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to set chat description', { error: errorMsg, chatId });
      return { success: false, error: `Failed to set description: ${errorMsg}` };
    }
  }

  // ─── Set default chat permissions ──────────────────────────────────────

  private async setPermissions(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;
    const permissions = params.permissions as Record<string, boolean> | undefined;

    if (!chatId || !permissions) {
      return { success: false, error: 'Missing required parameters: chatId, permissions' };
    }

    logger.info('Setting chat permissions', { chatId, permissions });

    try {
      await this.bot!.telegram.setChatPermissions(chatId, {
        can_send_messages: permissions.can_send_messages,
        can_send_audios: permissions.can_send_audios,
        can_send_documents: permissions.can_send_documents,
        can_send_photos: permissions.can_send_photos,
        can_send_videos: permissions.can_send_videos,
        can_send_video_notes: permissions.can_send_video_notes,
        can_send_voice_notes: permissions.can_send_voice_notes,
        can_send_polls: permissions.can_send_polls,
        can_send_other_messages: permissions.can_send_other_messages,
        can_add_web_page_previews: permissions.can_add_web_page_previews,
        can_change_info: permissions.can_change_info,
        can_invite_users: permissions.can_invite_users,
        can_pin_messages: permissions.can_pin_messages,
        can_manage_topics: permissions.can_manage_topics,
      });
      logger.info('Chat permissions updated', { chatId });
      return { success: true, data: { chatId, permissions } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to set chat permissions', { error: errorMsg, chatId });
      return { success: false, error: `Failed to set permissions: ${errorMsg}` };
    }
  }

  // ─── Export/create invite link ─────────────────────────────────────────

  private async exportInvite(params: Record<string, unknown>): Promise<ActionResult> {
    const chatId = params.chatId as string | number | undefined;

    if (!chatId) {
      return { success: false, error: 'Missing required parameter: chatId' };
    }

    logger.info('Exporting invite link', { chatId });

    try {
      const link = await this.bot!.telegram.exportChatInviteLink(chatId);
      logger.info('Invite link exported', { chatId, link });
      return { success: true, data: { chatId, inviteLink: link } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to export invite link', { error: errorMsg, chatId });
      return { success: false, error: `Failed to export invite link: ${errorMsg}` };
    }
  }

  // ─── Send DM to a user ────────────────────────────────────────────────────

  private async sendDM(params: Record<string, unknown>): Promise<ActionResult> {
    const userId = params.userId as string | number | undefined;
    const text = params.text as string | undefined;
    const parseMode = (params.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2') || undefined;

    if (!userId || !text) {
      return { success: false, error: 'Missing required parameters: userId, text' };
    }

    logger.info('Sending Telegram DM', { userId, textLength: text.length });

    try {
      // DMs in Telegram are just messages sent to the user's chat ID
      const message = await this.bot!.telegram.sendMessage(userId, text, {
        parse_mode: parseMode,
      });

      logger.info('Telegram DM sent', { userId, messageId: message.message_id });
      return {
        success: true,
        data: { messageId: message.message_id, userId },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send Telegram DM', { error: errorMsg, userId });
      return { success: false, error: `Failed to send DM: ${errorMsg}` };
    }
  }
}
