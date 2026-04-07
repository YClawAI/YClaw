import { randomUUID } from 'node:crypto';

// ─── Event Envelope ─────────────────────────────────────────────────────────

/**
 * YClawEvent<T> — standard envelope for ALL coordination events in the system.
 *
 * Every event flowing through the coordination layer is wrapped in this
 * envelope. The generic parameter T constrains the payload shape.
 */
export interface YClawEvent<T> {
  /** Unique event identifier (UUID v4). */
  id: string;
  /** Dot-namespaced event type (e.g. "coord.task.requested"). */
  type: string;
  /** Agent name that emitted this event. */
  source: string;
  /** Target agent name, '*' for broadcast, or null for untargeted. */
  target: string | null;
  /** Ties all events in a workflow/project together. */
  correlation_id: string;
  /** ID of the parent event that caused this one. */
  causation_id: string | null;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  /** Envelope schema version. */
  schema_version: 1;
  /** Typed event payload. */
  payload: T;
  /** Optional arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export interface CreateEventOptions<T> {
  type: string;
  source: string;
  payload: T;
  target?: string | null;
  correlation_id: string;
  causation_id?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Creates a YClawEvent with auto-generated id, timestamp, and sensible defaults.
 */
export function createEvent<T>(opts: CreateEventOptions<T>): YClawEvent<T> {
  return {
    id: randomUUID(),
    type: opts.type,
    source: opts.source,
    target: opts.target ?? null,
    correlation_id: opts.correlation_id,
    causation_id: opts.causation_id ?? null,
    timestamp: new Date().toISOString(),
    schema_version: 1,
    payload: opts.payload,
    ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
  };
}

// ─── Coordination Payloads ──────────────────────────────────────────────────

export type CoordTaskStatus =
  | 'requested'
  | 'accepted'
  | 'started'
  | 'blocked'
  | 'completed'
  | 'failed';

export interface CoordTaskPayload {
  task_id: string;
  project_id: string;
  status: CoordTaskStatus;
  description?: string;
  assignee?: string;
  artifact_url?: string;
  message?: string;
}

export type CoordReviewStatus =
  | 'requested'
  | 'approved'
  | 'changes_requested';

export interface CoordReviewPayload {
  task_id: string;
  reviewer: string;
  status: CoordReviewStatus;
  feedback?: string;
}

export type CoordDeliverableArtifactType = 'pr' | 'doc' | 'design' | 'report';

export interface CoordDeliverablePayload {
  task_id: string;
  submitter: string;
  artifact_type: CoordDeliverableArtifactType;
  artifact_url: string;
}

export type CoordProjectStatus =
  | 'kicked_off'
  | 'phase_completed'
  | 'completed';

export interface CoordProjectPayload {
  project_id: string;
  status: CoordProjectStatus;
  phase?: string;
  agents?: string[];
  summary?: string;
}

// ─── Event Type Constants ───────────────────────────────────────────────────

// Task lifecycle
export const COORD_TASK_REQUESTED = 'coord.task.requested' as const;
export const COORD_TASK_ACCEPTED = 'coord.task.accepted' as const;
export const COORD_TASK_STARTED = 'coord.task.started' as const;
export const COORD_TASK_BLOCKED = 'coord.task.blocked' as const;
export const COORD_TASK_COMPLETED = 'coord.task.completed' as const;
export const COORD_TASK_FAILED = 'coord.task.failed' as const;

// Review lifecycle
export const COORD_REVIEW_REQUESTED = 'coord.review.requested' as const;
export const COORD_REVIEW_COMPLETED = 'coord.review.completed' as const;

// Deliverable lifecycle
export const COORD_DELIVERABLE_SUBMITTED = 'coord.deliverable.submitted' as const;
export const COORD_DELIVERABLE_APPROVED = 'coord.deliverable.approved' as const;
export const COORD_DELIVERABLE_CHANGES_REQUESTED = 'coord.deliverable.changes_requested' as const;

// Project lifecycle
export const COORD_PROJECT_KICKED_OFF = 'coord.project.kicked_off' as const;
export const COORD_PROJECT_PHASE_COMPLETED = 'coord.project.phase_completed' as const;
export const COORD_PROJECT_COMPLETED = 'coord.project.completed' as const;
