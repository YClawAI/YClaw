import type { YClawEvent, CoordReviewPayload } from '../types/events.js';
import {
  getAgentEmoji as routingGetAgentEmoji,
  getChannelForAgent as routingGetChannelForAgent,
  getAlertsChannel,
  getDepartmentForAgent as routingGetDepartmentForAgent,
} from './channel-routing.js';

// ─── Public Helpers ─────────────────────────────────────────────────────────
// This module used to own hard-coded department/channel maps. Canonical
// routing now lives in ./channel-routing.ts so every notifier (Slack,
// Discord, …) shares the same source. These wrappers keep the legacy
// single-argument shape for SlackNotifier and any other Slack-specific
// callers that predate the multi-platform work.

/** Alerts channel ID for escalations/blockers. Reads SLACK_CHANNEL_ALERTS. */
export const ALERTS_CHANNEL: string =
  getAlertsChannel('slack') ?? '#yclaw-alerts';

/** Get the emoji for an agent. Returns 🔔 for unknown agents. */
export function getAgentEmoji(agent: string): string {
  return routingGetAgentEmoji(agent);
}

/** Get the Slack channel ID for an agent's department. */
export function getChannelForAgent(agent: string): string {
  return routingGetChannelForAgent(agent, 'slack') ?? '#yclaw-general';
}

/** Get the department name for an agent. */
export function getDepartmentForAgent(agent: string): string | undefined {
  return routingGetDepartmentForAgent(agent);
}

// ─── Slack Block Kit Types ──────────────────────────────────────────────────
// Minimal types for the Block Kit shapes we produce.

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
  [key: string]: unknown;
}

// ─── Block Kit Builder ──────────────────────────────────────────────────────

/** Build Block Kit blocks for a coordination event. */
export function buildCoordBlock(event: YClawEvent<unknown>): SlackBlock[] {
  const source = event.source || 'system';
  const emoji = getAgentEmoji(source);
  const agentName = source.charAt(0).toUpperCase() + source.slice(1);
  const action = describeAction(event);
  const payload = event.payload as Record<string, unknown>;

  // Target agent display
  const targetStr = event.target && event.target !== '*'
    ? ` \u2192 *[${event.target.charAt(0).toUpperCase() + event.target.slice(1)}]*`
    : '';

  // Main section: agent + action + target + description
  const lines: string[] = [`${emoji} *[${agentName}]* ${action}${targetStr}`];

  if (payload.description) {
    lines.push(`*${payload.description as string}*`);
  }
  if (payload.artifact_url) {
    lines.push(`<${payload.artifact_url as string}|View>`);
  }

  // Review feedback quote
  if (event.type === 'coord.review.completed') {
    const review = payload as unknown as CoordReviewPayload;
    if (review.feedback) {
      lines.push(`> ${review.feedback}`);
    }
  }

  // Blocked event — show what's needed
  if (event.type === 'coord.task.blocked' && payload.message) {
    lines.push(`\u{1F6A8} *Needs:* ${payload.message as string}`);
  }

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    },
  ];

  // Context block: correlation + task IDs
  const contextParts: string[] = [];
  if (event.correlation_id) {
    contextParts.push(`Project: \`${event.correlation_id}\``);
  }
  if (payload.task_id) {
    contextParts.push(`Task: \`${payload.task_id as string}\``);
  }

  if (contextParts.length) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextParts.join(' | ') }],
    });
  }

  return blocks;
}

/** Whether an event is an escalation/blocker that should also go to #yclaw-alerts. */
export function isEscalation(event: YClawEvent<unknown>): boolean {
  return event.type === 'coord.task.blocked'
    || event.type === 'coord.task.failed'
    || event.type === 'coord.project.completed';
}

// ─── Action Descriptions ────────────────────────────────────────────────────

function describeAction(event: YClawEvent<unknown>): string {
  const payload = event.payload as Record<string, unknown>;
  const desc = (payload.description as string) || '';

  switch (event.type) {
    case 'coord.deliverable.submitted':
      return `submitted deliverable \u2014 ${desc || (payload.artifact_type as string) || 'artifact'}`;
    case 'coord.deliverable.approved':
      return 'approved deliverable';
    case 'coord.deliverable.changes_requested':
      return 'requested changes on deliverable';
    case 'coord.review.completed': {
      const status = (payload as unknown as CoordReviewPayload).status;
      return status === 'approved' ? 'approved review' : `review \u2014 ${status}`;
    }
    case 'coord.task.requested':
      return `requested task \u2014 ${desc || 'new task'}`;
    case 'coord.task.accepted':
      return 'accepted task';
    case 'coord.task.started':
      return 'started task';
    case 'coord.task.blocked':
      return `task blocked \u2014 ${desc || 'awaiting resolution'}`;
    case 'coord.task.completed':
      return `completed task \u2014 ${desc || 'done'}`;
    case 'coord.task.failed':
      return `task failed \u2014 ${(payload.message as string) || desc || 'error'}`;
    case 'coord.project.kicked_off':
      return 'kicked off project';
    case 'coord.project.phase_completed':
      return `completed phase \u2014 ${(payload.phase as string) || ''}`;
    case 'coord.project.completed':
      return 'completed project';
    default:
      return event.type.split('.').pop() || 'event';
  }
}
