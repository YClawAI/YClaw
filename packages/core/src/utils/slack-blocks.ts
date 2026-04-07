import type { YClawEvent, CoordReviewPayload } from '../types/events.js';

// ─── Agent Emoji Map ────────────────────────────────────────────────────────

const AGENT_EMOJI: Record<string, string> = {
  strategist: '\u{1F9E0}',       // 🧠
  builder: '\u{1F6E0}\uFE0F',    // 🛠️
  architect: '\u{1F4D0}',        // 📐
  designer: '\u{1F3A8}',         // 🎨
  deployer: '\u{1F680}',         // 🚀
  reviewer: '\u{1F4CB}',         // 📋
  scout: '\u{1F50D}',            // 🔍
  ember: '\u{1F525}',            // 🔥
  forge: '\u2692\uFE0F',         // ⚒️
  sentinel: '\u{1F6E1}\uFE0F',   // 🛡️
  treasurer: '\u{1F4B0}',        // 💰
  keeper: '\u{1F3E0}',           // 🏠
  guide: '\u{1F4DA}',            // 📚
  signal: '\u{1F4E1}',           // 📡
};

// ─── Agent → Department Mapping ─────────────────────────────────────────────

const AGENT_DEPARTMENT: Record<string, string> = {
  strategist: 'executive',
  reviewer: 'executive',
  architect: 'development',
  builder: 'development',
  deployer: 'development',
  designer: 'development',
  ember: 'marketing',
  forge: 'marketing',
  scout: 'marketing',
  sentinel: 'operations',
  signal: 'operations',
  treasurer: 'finance',
  guide: 'support',
  keeper: 'support',
};

// ─── Department → Slack Channel ID ──────────────────────────────────────────
// Hard-coded channel IDs avoid API lookups at runtime.

const DEPARTMENT_CHANNEL: Record<string, string> = {
  executive: 'C0000000001',   // #yclaw-executive
  development: 'C0000000002', // #yclaw-development
  marketing: 'C0000000003',   // #yclaw-marketing
  operations: 'C0000000004',  // #yclaw-operations
  finance: 'C0000000005',     // #yclaw-finance
  support: 'C0000000006',     // #yclaw-support
  alerts: 'C0000000007',      // #yclaw-alerts
};

const FALLBACK_CHANNEL = 'C0000000008'; // #yclaw-general

/** Alerts channel ID for escalations/blockers. */
export const ALERTS_CHANNEL = DEPARTMENT_CHANNEL.alerts!;

// ─── Public Helpers ─────────────────────────────────────────────────────────

/** Get the emoji for an agent. Returns 🔔 for unknown agents. */
export function getAgentEmoji(agent: string): string {
  return AGENT_EMOJI[agent] || '\u{1F514}'; // 🔔
}

/** Get the Slack channel ID for an agent's department. */
export function getChannelForAgent(agent: string): string {
  const dept = AGENT_DEPARTMENT[agent];
  if (!dept) return FALLBACK_CHANNEL;
  return DEPARTMENT_CHANNEL[dept] || FALLBACK_CHANNEL;
}

/** Get the department name for an agent. */
export function getDepartmentForAgent(agent: string): string | undefined {
  return AGENT_DEPARTMENT[agent];
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
