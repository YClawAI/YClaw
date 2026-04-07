import { describe, it, expect } from 'vitest';
import {
  createEvent,
  COORD_TASK_REQUESTED,
  COORD_TASK_ACCEPTED,
  COORD_TASK_STARTED,
  COORD_TASK_BLOCKED,
  COORD_TASK_COMPLETED,
  COORD_TASK_FAILED,
  COORD_REVIEW_REQUESTED,
  COORD_REVIEW_COMPLETED,
  COORD_DELIVERABLE_SUBMITTED,
  COORD_DELIVERABLE_APPROVED,
  COORD_DELIVERABLE_CHANGES_REQUESTED,
  COORD_PROJECT_KICKED_OFF,
  COORD_PROJECT_PHASE_COMPLETED,
  COORD_PROJECT_COMPLETED,
} from '../src/types/events.js';
import type {
  YClawEvent,
  CoordTaskPayload,
  CoordReviewPayload,
  CoordDeliverablePayload,
  CoordProjectPayload,
} from '../src/types/events.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// ─── createEvent ────────────────────────────────────────────────────────────

describe('createEvent', () => {
  it('generates a valid envelope with auto-populated fields', () => {
    const evt = createEvent<CoordTaskPayload>({
      type: COORD_TASK_REQUESTED,
      source: 'strategist',
      correlation_id: 'corr-1',
      payload: {
        task_id: 't-1',
        project_id: 'p-1',
        status: 'requested',
        description: 'Build the widget',
      },
    });

    expect(evt.id).toMatch(UUID_RE);
    expect(evt.timestamp).toMatch(ISO_RE);
    expect(evt.schema_version).toBe(1);
    expect(evt.type).toBe('coord.task.requested');
    expect(evt.source).toBe('strategist');
    expect(evt.target).toBeNull();
    expect(evt.correlation_id).toBe('corr-1');
    expect(evt.causation_id).toBeNull();
    expect(evt.payload.task_id).toBe('t-1');
    expect(evt.payload.status).toBe('requested');
    expect(evt.metadata).toBeUndefined();
  });

  it('generates unique IDs across calls', () => {
    const a = createEvent({ type: 'x', source: 's', correlation_id: 'c', payload: {} });
    const b = createEvent({ type: 'x', source: 's', correlation_id: 'c', payload: {} });
    expect(a.id).not.toBe(b.id);
  });

  it('propagates correlation_id and causation_id', () => {
    const parent = createEvent<CoordTaskPayload>({
      type: COORD_TASK_REQUESTED,
      source: 'strategist',
      correlation_id: 'workflow-42',
      payload: { task_id: 't-1', project_id: 'p-1', status: 'requested' },
    });

    const child = createEvent<CoordTaskPayload>({
      type: COORD_TASK_ACCEPTED,
      source: 'builder',
      correlation_id: parent.correlation_id,
      causation_id: parent.id,
      payload: { task_id: 't-1', project_id: 'p-1', status: 'accepted', assignee: 'builder' },
    });

    expect(child.correlation_id).toBe('workflow-42');
    expect(child.causation_id).toBe(parent.id);
  });

  it('accepts explicit target', () => {
    const evt = createEvent({
      type: COORD_TASK_REQUESTED,
      source: 'strategist',
      target: 'builder',
      correlation_id: 'c',
      payload: {},
    });
    expect(evt.target).toBe('builder');
  });

  it('accepts broadcast target', () => {
    const evt = createEvent({
      type: COORD_PROJECT_KICKED_OFF,
      source: 'strategist',
      target: '*',
      correlation_id: 'c',
      payload: {},
    });
    expect(evt.target).toBe('*');
  });

  it('includes metadata when provided', () => {
    const evt = createEvent({
      type: 'coord.task.requested',
      source: 'strategist',
      correlation_id: 'c',
      payload: {},
      metadata: { priority: 'high', retry_count: 0 },
    });
    expect(evt.metadata).toEqual({ priority: 'high', retry_count: 0 });
  });

  it('omits metadata key when not provided', () => {
    const evt = createEvent({
      type: 'coord.task.requested',
      source: 'strategist',
      correlation_id: 'c',
      payload: {},
    });
    expect('metadata' in evt).toBe(false);
  });
});

// ─── Typed Payloads ─────────────────────────────────────────────────────────

describe('typed payloads', () => {
  it('creates a CoordTaskPayload event with all optional fields', () => {
    const evt = createEvent<CoordTaskPayload>({
      type: COORD_TASK_COMPLETED,
      source: 'builder',
      correlation_id: 'c',
      payload: {
        task_id: 't-1',
        project_id: 'p-1',
        status: 'completed',
        description: 'Widget built',
        assignee: 'builder',
        artifact_url: 'https://github.com/org/repo/pull/42',
        message: 'All checks passing',
      },
    });
    expect(evt.payload.status).toBe('completed');
    expect(evt.payload.artifact_url).toBe('https://github.com/org/repo/pull/42');
  });

  it('creates a CoordReviewPayload event', () => {
    const evt = createEvent<CoordReviewPayload>({
      type: COORD_REVIEW_COMPLETED,
      source: 'architect',
      correlation_id: 'c',
      payload: {
        task_id: 't-1',
        reviewer: 'architect',
        status: 'approved',
        feedback: 'LGTM',
      },
    });
    expect(evt.payload.reviewer).toBe('architect');
    expect(evt.payload.status).toBe('approved');
  });

  it('creates a CoordDeliverablePayload event', () => {
    const evt = createEvent<CoordDeliverablePayload>({
      type: COORD_DELIVERABLE_SUBMITTED,
      source: 'builder',
      correlation_id: 'c',
      payload: {
        task_id: 't-1',
        submitter: 'builder',
        artifact_type: 'pr',
        artifact_url: 'https://github.com/org/repo/pull/42',
      },
    });
    expect(evt.payload.artifact_type).toBe('pr');
  });

  it('creates a CoordProjectPayload event', () => {
    const evt = createEvent<CoordProjectPayload>({
      type: COORD_PROJECT_KICKED_OFF,
      source: 'strategist',
      target: '*',
      correlation_id: 'c',
      payload: {
        project_id: 'p-1',
        status: 'kicked_off',
        phase: 'design',
        agents: ['architect', 'designer', 'builder'],
        summary: 'Starting the YClaw landing page redesign',
      },
    });
    expect(evt.payload.agents).toEqual(['architect', 'designer', 'builder']);
    expect(evt.target).toBe('*');
  });
});

// ─── Event Type Constants ───────────────────────────────────────────────────

describe('event type constants', () => {
  it('uses dot-namespaced format', () => {
    const allTypes = [
      COORD_TASK_REQUESTED,
      COORD_TASK_ACCEPTED,
      COORD_TASK_STARTED,
      COORD_TASK_BLOCKED,
      COORD_TASK_COMPLETED,
      COORD_TASK_FAILED,
      COORD_REVIEW_REQUESTED,
      COORD_REVIEW_COMPLETED,
      COORD_DELIVERABLE_SUBMITTED,
      COORD_DELIVERABLE_APPROVED,
      COORD_DELIVERABLE_CHANGES_REQUESTED,
      COORD_PROJECT_KICKED_OFF,
      COORD_PROJECT_PHASE_COMPLETED,
      COORD_PROJECT_COMPLETED,
    ];

    for (const t of allTypes) {
      expect(t).toMatch(/^coord\.\w+\.\w+$/);
    }
    expect(allTypes).toHaveLength(14);
  });

  it('maps to correct string values', () => {
    expect(COORD_TASK_REQUESTED).toBe('coord.task.requested');
    expect(COORD_REVIEW_REQUESTED).toBe('coord.review.requested');
    expect(COORD_DELIVERABLE_SUBMITTED).toBe('coord.deliverable.submitted');
    expect(COORD_PROJECT_KICKED_OFF).toBe('coord.project.kicked_off');
  });
});
