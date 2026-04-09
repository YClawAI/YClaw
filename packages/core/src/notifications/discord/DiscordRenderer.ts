/**
 * DiscordRenderer — Transforms NotificationEvents into Discord embeds.
 *
 * Mapping from Slack Block Kit concepts:
 *   Slack header       → Embed title
 *   Slack section text → Embed description
 *   Slack fields       → Embed addFields() with inline: true
 *   Slack context      → Embed footer
 *   Slack divider      → Separate embeds or --- in description
 *   Slack button       → ActionRowBuilder + ButtonBuilder (future)
 *   Color sidebar      → Embed setColor()
 *   Bot identity       → Webhook username + avatarURL
 *
 * Discord embed limits:
 *   title: 256 chars, description: 4096 chars, field name: 256 chars,
 *   field value: 1024 chars, footer text: 2048 chars, max fields: 25.
 */

import type { NotificationEvent, Severity } from '../types.js';

// ─── Severity → Color Mapping ────────────────────────────────────────────────

const SEVERITY_COLORS: Record<Severity, number> = {
  info:     0x3B82F6,  // blue
  success:  0x22C55E,  // green
  warning:  0xEAB308,  // yellow
  error:    0xEF4444,  // red
  critical: 0x991B1B,  // dark red
};

// ─── Embed Shape (plain object, no discord.js dependency) ────────────────────

/**
 * Discord embed object matching the Discord API shape. We build this as a
 * plain object so the renderer has zero runtime dependencies on discord.js.
 * The DiscordChannel passes it directly to webhook.send({ embeds: [embed] })
 * or channel.send({ embeds: [embed] }).
 */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  footer?: { text: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

export class DiscordRenderer {
  render(event: NotificationEvent): DiscordEmbed {
    const agentColor = (event.metadata?.agentColor as number | undefined) ?? 0x6B7280;

    const embed: DiscordEmbed = {
      title: truncate(`${event.agent.emoji} ${event.title}`, 256),
      description: truncate(event.summary, 4096),
      color: event.severity === 'info' ? agentColor : SEVERITY_COLORS[event.severity],
      timestamp: event.timestamp.toISOString(),
      footer: { text: `${event.kind} \u2022 ${event.agent.name}` },
    };

    // Fields
    if (event.fields && event.fields.length > 0) {
      embed.fields = [];
      for (const field of event.fields.slice(0, 25)) {
        embed.fields.push({
          name: truncate(field.name, 256),
          value: truncate(field.value || '\u200B', 1024),
          inline: field.inline ?? true,
        });
      }
    }

    // Links as a single field
    if (event.links && event.links.length > 0) {
      const linkText = event.links
        .map(l => `[${l.label}](${l.url})`)
        .join(' \u2022 ');
      embed.fields = embed.fields ?? [];
      embed.fields.push({
        name: 'Links',
        value: truncate(linkText, 1024),
        inline: false,
      });
    }

    return embed;
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}
