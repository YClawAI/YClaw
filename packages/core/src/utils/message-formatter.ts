/**
 * message-formatter — Per-platform formatting for coordination events.
 *
 * ChannelNotifier uses these helpers to produce the right message shape
 * for each platform: Slack gets rich Block Kit, Discord gets plain
 * markdown. Both formats share the same underlying content derived from
 * the YClawEvent envelope.
 */

import type { YClawEvent, CoordReviewPayload } from '../types/events.js';
import { buildCoordBlock, type SlackBlock } from './slack-blocks.js';
import { getAgentEmoji } from './channel-routing.js';

// ─── Slack ──────────────────────────────────────────────────────────────────

export interface FormattedSlackMessage {
  text: string;
  blocks: SlackBlock[];
}

/** Build the Slack Block Kit payload + plain-text fallback for an event. */
export function formatSlackMessage(event: YClawEvent<unknown>): FormattedSlackMessage {
  const blocks = buildCoordBlock(event);
  const emoji = getAgentEmoji(event.source);
  const agentName = capitalize(event.source);
  return {
    text: `${emoji} [${agentName}] ${event.type}`,
    blocks,
  };
}

// ─── Discord ────────────────────────────────────────────────────────────────

export interface FormattedDiscordMessage {
  text: string;
}

/**
 * Build a Discord markdown message for an event. Intentionally plain text
 * (no embeds) — simpler to reason about, renders nicely in mobile, and
 * avoids hitting Discord's embed field limits on long descriptions.
 */
export function formatDiscordMessage(event: YClawEvent<unknown>): FormattedDiscordMessage {
  const source = event.source || 'system';
  const emoji = getAgentEmoji(source);
  const agentName = capitalize(source);
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  const target = event.target && event.target !== '*'
    ? ` → **[${capitalize(event.target)}]**`
    : '';

  const lines: string[] = [
    `${emoji} **${agentName}** — ${describeAction(event)}${target}`,
  ];

  const description = payload.description as string | undefined;
  if (description) {
    lines.push(`> ${description}`);
  }

  // Review feedback quote
  if (event.type === 'coord.review.completed') {
    const review = payload as unknown as CoordReviewPayload;
    if (review.feedback) lines.push(`> ${review.feedback}`);
  }

  // Blocked event — show what's needed
  if (event.type === 'coord.task.blocked' && payload.message) {
    lines.push(`🚨 **Needs:** ${payload.message as string}`);
  }

  // Artifact link
  const artifactUrl = payload.artifact_url as string | undefined;
  if (artifactUrl) {
    lines.push(`🔗 <${artifactUrl}>`);
  }

  // Context footer: project + task ids, only if present
  const footerParts: string[] = [];
  if (event.correlation_id) footerParts.push(`Project: \`${event.correlation_id}\``);
  const taskId = payload.task_id as string | undefined;
  if (taskId) footerParts.push(`Task: \`${taskId}\``);
  if (footerParts.length) {
    lines.push(`-# ${footerParts.join(' · ')}`);
  }

  return { text: lines.join('\n') };
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describeAction(event: YClawEvent<unknown>): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const desc = (payload.description as string) || '';

  switch (event.type) {
    case 'coord.deliverable.submitted':
      return `submitted deliverable — ${desc || (payload.artifact_type as string) || 'artifact'}`;
    case 'coord.deliverable.approved':
      return 'approved deliverable';
    case 'coord.deliverable.changes_requested':
      return 'requested changes on deliverable';
    case 'coord.review.completed': {
      const status = (payload as unknown as CoordReviewPayload).status;
      return status === 'approved' ? 'approved review' : `review — ${status}`;
    }
    case 'coord.task.requested':
      return `requested task — ${desc || 'new task'}`;
    case 'coord.task.accepted':
      return 'accepted task';
    case 'coord.task.started':
      return 'started task';
    case 'coord.task.blocked':
      return `task blocked — ${desc || 'awaiting resolution'}`;
    case 'coord.task.completed':
      return `completed task — ${desc || 'done'}`;
    case 'coord.task.failed':
      return `task failed — ${(payload.message as string) || desc || 'error'}`;
    case 'coord.project.kicked_off':
      return 'kicked off project';
    case 'coord.project.phase_completed':
      return `completed phase — ${(payload.phase as string) || ''}`;
    case 'coord.project.completed':
      return 'completed project';
    default:
      return event.type.split('.').pop() || 'event';
  }
}
