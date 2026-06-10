/**
 * TwitterChannelAdapter — Twitter/X adapter for IChannel.
 *
 * Wraps the existing TwitterExecutor to implement the IChannel interface.
 */

import type {
  IChannel,
  ChannelConfig,
  ChannelTarget,
  ChannelMessage,
  MessageResult,
  InboundMessageHandler,
} from '../../interfaces/IChannel.js';
import { TwitterExecutor } from '../../actions/twitter.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('twitter-channel-adapter');

export class TwitterChannelAdapter implements IChannel {
  readonly name = 'twitter';
  private executor: TwitterExecutor | null = null;

  async connect(_config: ChannelConfig): Promise<void> {
    this.executor = new TwitterExecutor();
    logger.info('TwitterChannelAdapter connected');
  }

  async disconnect(): Promise<void> {
    this.executor = null;
    logger.info('TwitterChannelAdapter disconnected');
  }

  async healthy(): Promise<boolean> {
    if (!this.executor) return false;
    return this.executor.healthCheck();
  }

  async send(target: ChannelTarget, message: ChannelMessage): Promise<MessageResult> {
    if (!this.executor) {
      return { success: false, error: 'Twitter adapter not connected' };
    }

    const params: Record<string, unknown> = {
      text: message.text,
    };

    let action = 'post';

    // Reply to a specific tweet
    if (message.replyTo) {
      action = 'reply';
      params.tweetId = message.replyTo.messageId;
    }

    // DM to a specific user — executor expects participantId, not userId (#5)
    if (target.userId) {
      action = 'dm';
      params.participantId = target.userId;
    }

    const result = await this.executor.execute(action, params);

    return {
      success: result.success,
      messageId: result.data?.tweetId as string | undefined,
      error: result.error,
    };
  }

  async listen(_handler: InboundMessageHandler): Promise<void> {
    // No-op: Twitter inbound requires streaming API
  }

  supportsInboundListening(): boolean { return false; }
  supportsReactions(): boolean { return false; }
  supportsThreads(): boolean { return false; }
  supportsFileUpload(): boolean { return false; }
  supportsIdentityOverride(): boolean { return false; }

  /** Get the underlying executor for action registry registration. */
  getExecutor(): TwitterExecutor | null {
    return this.executor;
  }
}
