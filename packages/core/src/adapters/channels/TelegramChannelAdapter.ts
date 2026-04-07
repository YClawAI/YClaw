/**
 * TelegramChannelAdapter — Telegram adapter for IChannel.
 *
 * Wraps the existing TelegramExecutor to implement the IChannel interface.
 */

import type {
  IChannel,
  ChannelConfig,
  ChannelTarget,
  ChannelMessage,
  MessageResult,
  InboundMessageHandler,
} from '../../interfaces/IChannel.js';
import { TelegramExecutor } from '../../actions/telegram.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('telegram-channel-adapter');

export class TelegramChannelAdapter implements IChannel {
  readonly name = 'telegram';
  private executor: TelegramExecutor | null = null;

  async connect(_config: ChannelConfig): Promise<void> {
    this.executor = new TelegramExecutor();
    logger.info('TelegramChannelAdapter connected');
  }

  async disconnect(): Promise<void> {
    this.executor = null;
    logger.info('TelegramChannelAdapter disconnected');
  }

  async healthy(): Promise<boolean> {
    if (!this.executor) return false;
    return this.executor.healthCheck();
  }

  async send(target: ChannelTarget, message: ChannelMessage): Promise<MessageResult> {
    if (!this.executor) {
      return { success: false, error: 'Telegram adapter not connected' };
    }

    const params: Record<string, unknown> = {
      chatId: target.userId || target.channelId,
      text: message.text,
    };

    let action = 'message';

    if (message.replyTo) {
      action = 'reply';
      params.replyToMessageId = Number(message.replyTo.messageId);
    }

    const result = await this.executor.execute(action, params);

    return {
      success: result.success,
      messageId: result.data?.messageId != null ? String(result.data.messageId) : undefined,
      error: result.error,
    };
  }

  async listen(_handler: InboundMessageHandler): Promise<void> {
    // No-op: Telegram inbound handled by webhook/polling
  }

  supportsInboundListening(): boolean { return false; }
  supportsReactions(): boolean { return false; }
  // Thread and file upload not implemented yet — report accurately (#9)
  supportsThreads(): boolean { return false; }
  supportsFileUpload(): boolean { return false; }
  supportsIdentityOverride(): boolean { return false; }

  /** Get the underlying executor for action registry registration. */
  getExecutor(): TelegramExecutor | null {
    return this.executor;
  }
}
