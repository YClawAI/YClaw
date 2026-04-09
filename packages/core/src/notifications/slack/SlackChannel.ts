/**
 * SlackChannel — INotificationChannel implementation for Slack.
 *
 * Routes NotificationEvents to Slack using the existing IChannel adapter
 * (SlackChannelAdapter). Renders events as Block Kit via SlackRenderer.
 * Thread grouping uses ThreadRegistry keyed with 'slack:' prefix.
 */

import type { INotificationChannel } from '../INotificationChannel.js';
import type { NotificationEvent, PublishResult } from '../types.js';
import type { IChannel } from '../../interfaces/IChannel.js';
import { SlackRenderer } from './SlackRenderer.js';
import type { ThreadRegistry } from '../state/ThreadRegistry.js';
import {
  getChannelForDepartment,
} from '../../utils/channel-routing.js';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('slack-notification-channel');

export class SlackChannel implements INotificationChannel {
  readonly platform = 'slack';

  private readonly renderer = new SlackRenderer();

  constructor(
    private readonly adapter: IChannel,
    private readonly threadRegistry: ThreadRegistry | null,
  ) {}

  isEnabled(): boolean {
    return true; // Slack adapter is always enabled if injected
  }

  healthy(): boolean {
    return true;
  }

  async send(event: NotificationEvent): Promise<PublishResult> {
    const channelId = getChannelForDepartment(
      event.agent.department,
      'slack',
    );
    if (!channelId) {
      log.debug('No Slack channel for department', {
        department: event.agent.department,
      });
      return { messageId: '', platform: 'slack' };
    }

    const { text, blocks } = this.renderer.render(event);

    // Resolve existing thread for this correlation key
    let threadId: string | undefined;
    if (event.threadKey && this.threadRegistry) {
      threadId = (await this.threadRegistry.get(`slack:${event.threadKey}`)) ?? undefined;
    }

    const result = await this.adapter.send(
      { channelId, ...(threadId ? { threadId } : {}) },
      {
        text,
        ...(threadId ? { threadId } : {}),
        ...({ blocks } as Record<string, unknown>),
      },
    );

    // Save thread root for future events in this correlation
    if (event.threadKey && this.threadRegistry && !threadId) {
      const newThread = result.threadId ?? result.messageId;
      if (newThread) {
        await this.threadRegistry.set(
          `slack:${event.threadKey}`,
          channelId,
          newThread,
        );
      }
    }

    return {
      messageId: result.messageId ?? '',
      threadId: result.threadId,
      platform: 'slack',
    };
  }
}
