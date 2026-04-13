/**
 * event-converter — Converts YClawEvents into NotificationEvents.
 *
 * This bridges the existing coord.* event system with the new notification
 * layer. The ChannelNotifier calls toNotificationEvent() for each incoming
 * YClawEvent, then passes the result to the NotificationRouter.
 */

import type { YClawEvent, CoordReviewPayload } from '../types/events.js';
import type { NotificationEvent, NotificationKind, Severity, Department } from './types.js';
import { getAgentIdentity } from './AgentRegistry.js';
import { isEscalation } from '../utils/slack-blocks.js';

/** Convert a YClawEvent to a NotificationEvent for the router. */
export function toNotificationEvent(event: YClawEvent<unknown>): NotificationEvent {
  const agent = getAgentIdentity(event.source);
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  return {
    kind: resolveKind(event),
    severity: resolveSeverity(event),
    title: resolveTitle(event),
    summary: resolveSummary(event),
    agent: {
      id: agent.id,
      name: agent.name,
      emoji: agent.emoji,
      department: agent.department,
    },
    fields: resolveFields(event),
    links: resolveLinks(payload),
    threadKey: event.correlation_id || undefined,
    metadata: {
      ...event.metadata,
      taskId: payload.task_id,
      correlationId: event.correlation_id,
      causationId: event.causation_id,
      originalEventType: event.type,
      agentColor: agent.color,
    },
    timestamp: new Date(event.timestamp),
  };
}

// ─── Resolvers ───────────────────────────────────────────────────────────────

function resolveKind(event: YClawEvent<unknown>): NotificationKind {
  const type = event.type;
  if (type.startsWith('coord.task.') || type.startsWith('coord.deliverable.') || type.startsWith('coord.review.') || type.startsWith('coord.project.')) {
    return 'lifecycle';
  }
  if (type.includes('heartbeat') || type.includes('standup')) return 'heartbeat';
  if (type.includes('pr_')) return 'pr_status';
  if (type.includes('ci_')) return 'ci_status';
  if (type.includes('deploy')) return 'deployment';
  if (type.includes('alert')) return 'alert';
  if (type.includes('audit')) return 'audit_log';
  return 'lifecycle';
}

function resolveSeverity(event: YClawEvent<unknown>): Severity {
  if (event.type === 'coord.task.failed') return 'error';
  if (event.type === 'coord.task.blocked') return 'warning';
  if (event.type === 'coord.task.completed' || event.type === 'coord.project.completed') return 'success';
  // Deliverable events — these use their own payload shape (no .status field)
  if (event.type === 'coord.deliverable.approved') return 'success';
  if (event.type === 'coord.deliverable.changes_requested') return 'warning';
  // Review events — payload has .status field
  if (event.type === 'coord.review.completed') {
    const payload = event.payload as Record<string, unknown>;
    const status = (payload as unknown as CoordReviewPayload).status;
    if (status === 'approved') return 'success';
    if (status === 'changes_requested') return 'warning';
  }
  if (isEscalation(event)) return 'warning';
  return 'info';
}

function resolveTitle(event: YClawEvent<unknown>): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const desc = truncateStr((payload.description as string) || '', 150);

  switch (event.type) {
    case 'coord.deliverable.submitted':
      return `Submitted deliverable \u2014 ${desc || (payload.artifact_type as string) || 'artifact'}`;
    case 'coord.deliverable.approved':
      return 'Approved deliverable';
    case 'coord.deliverable.changes_requested':
      return 'Requested changes on deliverable';
    case 'coord.review.completed': {
      const status = (payload as unknown as CoordReviewPayload).status;
      return status === 'approved' ? 'Approved review' : `Review \u2014 ${status}`;
    }
    case 'coord.task.requested':
      return `Requested task \u2014 ${desc || 'new task'}`;
    case 'coord.task.accepted':
      return 'Accepted task';
    case 'coord.task.started':
      return 'Started task';
    case 'coord.task.blocked':
      return `Task blocked \u2014 ${desc || 'awaiting resolution'}`;
    case 'coord.task.completed':
      return `Completed task \u2014 ${desc || 'done'}`;
    case 'coord.task.failed':
      return `Task failed \u2014 ${truncateStr((payload.message as string) || '', 150) || desc || 'error'}`;
    case 'coord.project.kicked_off':
      return 'Kicked off project';
    case 'coord.project.phase_completed':
      return `Completed phase \u2014 ${(payload.phase as string) || ''}`;
    case 'coord.project.completed':
      return 'Completed project';
    case 'coord.review.requested':
      return `Review requested \u2014 ${desc || 'pending review'}`;
    default:
      return event.type.split('.').pop() || 'Event';
  }
}

function resolveSummary(event: YClawEvent<unknown>): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  // "Started" should be terse — no repeat of the task description
  if (event.type === 'coord.task.started') return '';

  if (event.type === 'coord.review.completed') {
    const review = payload as unknown as CoordReviewPayload;
    if (review.feedback) return truncateStr(review.feedback, 500);
  }

  if (event.type === 'coord.task.blocked' && payload.message) {
    return truncateStr(payload.message as string, 500);
  }

  const raw = (payload.summary as string) || (payload.description as string) || '';
  return truncateStr(raw, 500);
}

function resolveFields(event: YClawEvent<unknown>): Array<{ name: string; value: string; inline?: boolean }> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  if (event.target && event.target !== '*') {
    const targetName = event.target.charAt(0).toUpperCase() + event.target.slice(1);
    fields.push({ name: 'Target', value: targetName, inline: true });
  }

  if (payload.status) {
    fields.push({ name: 'Status', value: payload.status as string, inline: true });
  }

  if (event.type === 'coord.task.blocked' && payload.message) {
    fields.push({ name: 'Message', value: payload.message as string });
  }

  if (event.type === 'coord.task.failed' && payload.message) {
    fields.push({ name: 'Error', value: payload.message as string });
  }

  return fields;
}

function resolveLinks(payload: Record<string, unknown>): Array<{ label: string; url: string }> | undefined {
  const artifactUrl = payload.artifact_url as string | undefined;
  if (!artifactUrl) return undefined;
  return [{ label: 'View', url: artifactUrl }];
}

function truncateStr(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}
