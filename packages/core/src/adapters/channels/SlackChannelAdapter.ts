/**
 * SlackChannelAdapter — Slack adapter for IChannel.
 *
 * Wraps the existing SlackExecutor to implement the IChannel interface.
 * The SlackExecutor remains unchanged and continues to serve the action
 * registry. This adapter provides the unified channel API.
 */

import type {
  IChannel,
  ChannelConfig,
  ChannelTarget,
  ChannelMessage,
  MessageResult,
  MessageRef,
  ThreadRef,
  InboundMessageHandler,
} from '../../interfaces/IChannel.js';
import { SlackExecutor } from '../../actions/slack.js';
import type { Redis } from 'ioredis';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('slack-channel-adapter');

export class SlackChannelAdapter implements IChannel {
  readonly name = 'slack';
  private executor: SlackExecutor | null = null;
  private redis: Redis | null = null;

  async connect(config: ChannelConfig): Promise<void> {
    this.redis = (config.redis as Redis) ?? null;
    this.executor = new SlackExecutor(this.redis);
    logger.info('SlackChannelAdapter connected');
  }

  async disconnect(): Promise<void> {
    this.executor = null;
    logger.info('SlackChannelAdapter disconnected');
  }

  async healthy(): Promise<boolean> {
    if (!this.executor) return false;
    return this.executor.healthCheck();
  }

  async send(target: ChannelTarget, message: ChannelMessage): Promise<MessageResult> {
    if (!this.executor) {
      return { success: false, error: 'Slack adapter not connected' };
    }

    const params: Record<string, unknown> = {
      channel: target.channelId,
      text: message.text,
    };

    // Slack Block Kit passthrough: callers (e.g. ChannelNotifier) can attach
    // a `blocks` array to the ChannelMessage for rich formatting. It lives
    // outside the IChannel contract so other adapters ignore it safely.
    const blocks = (message as unknown as { blocks?: unknown }).blocks;
    if (Array.isArray(blocks)) {
      params.blocks = blocks;
    }

    // Identity override
    if (message.identity?.displayName) {
      params.username = message.identity.displayName;
    }
    if (message.identity?.avatarEmoji) {
      params.icon_emoji = message.identity.avatarEmoji;
    }

    // DM: route to the dm action when userId is provided (#8)
    if (target.userId && !target.channelId) {
      const result = await this.executor.execute('dm', {
        userId: target.userId,
        text: message.text,
      });
      return {
        success: result.success,
        messageId: result.data?.ts as string | undefined,
        error: result.error,
      };
    }

    // Thread reply: use thread_reply action when replyTo or threadId present (#8)
    if (message.replyTo || message.threadId) {
      params.threadTs = message.replyTo?.messageId || message.threadId;
      const result = await this.executor.execute('thread_reply', params);
      return {
        success: result.success,
        messageId: result.data?.ts as string | undefined,
        threadId: (result.data?.threadTs as string) || message.threadId,
        error: result.error,
      };
    }

    // Standard message
    const result = await this.executor.execute('message', params);
    return {
      success: result.success,
      messageId: result.data?.ts as string | undefined,
      error: result.error,
    };
  }

  async listen(_handler: InboundMessageHandler): Promise<void> {
    // No-op: Slack inbound handled by webhook (triggers/slack-webhook.ts)
  }

  // Inbound handled externally by webhook, not via listen()
  supportsInboundListening(): boolean { return false; }
  // Only report capabilities that are actually implemented (#9)
  supportsReactions(): boolean { return false; }
  supportsThreads(): boolean { return true; }
  supportsFileUpload(): boolean { return false; }
  supportsIdentityOverride(): boolean { return true; }

  async createThread(target: MessageRef, _name: string): Promise<ThreadRef> {
    // In Slack, threads are implicit — reply to a message to create a thread
    return { threadId: target.messageId, channelId: target.channelId };
  }

  /** Get the underlying executor for action registry registration. */
  getExecutor(): SlackExecutor | null {
    return this.executor;
  }
}
