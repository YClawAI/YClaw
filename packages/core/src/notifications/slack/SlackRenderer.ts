/**
 * SlackRenderer — Transforms NotificationEvents into Slack Block Kit payloads.
 *
 * Wraps the existing Block Kit building logic from slack-blocks.ts but
 * operates on NotificationEvents instead of raw YClawEvents. This allows
 * the NotificationRouter to treat Slack and Discord identically.
 */

import type { NotificationEvent } from '../types.js';
import type { SlackBlock } from '../../utils/slack-blocks.js';

export interface SlackPayload {
  text: string;
  blocks: SlackBlock[];
}

export class SlackRenderer {
  render(event: NotificationEvent): SlackPayload {
    const { agent } = event;

    // Main section: agent + title + summary
    const lines: string[] = [
      `${agent.emoji} *[${agent.name}]* ${event.title}`,
    ];

    if (event.summary && event.summary !== event.title) {
      lines.push(`*${event.summary}*`);
    }

    // Links
    if (event.links && event.links.length > 0) {
      for (const link of event.links) {
        lines.push(`<${link.url}|${link.label}>`);
      }
    }

    // Blocked/error details via fields
    if (event.severity === 'error' || event.severity === 'critical') {
      const messageField = event.fields?.find(f => f.name === 'Message' || f.name === 'Error');
      if (messageField) {
        lines.push(`\u{1F6A8} *Needs:* ${messageField.value}`);
      }
    }

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ];

    // Fields as section fields (inline pairs)
    if (event.fields && event.fields.length > 0) {
      const fieldElements = event.fields
        .filter(f => f.name !== 'Message' && f.name !== 'Error')
        .slice(0, 10)
        .map(f => ({ type: 'mrkdwn' as const, text: `*${f.name}*\n${f.value}` }));
      if (fieldElements.length > 0) {
        blocks.push({
          type: 'section',
          fields: fieldElements,
        } as SlackBlock);
      }
    }

    // Context block: kind + thread key
    const contextParts: string[] = [];
    if (event.threadKey) contextParts.push(`Project: \`${event.threadKey}\``);
    if (event.metadata?.taskId) {
      contextParts.push(`Task: \`${event.metadata.taskId as string}\``);
    }
    if (contextParts.length > 0) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: contextParts.join(' | ') }],
      });
    }

    return {
      text: `${agent.emoji} [${agent.name}] ${event.title}`,
      blocks,
    };
  }
}
