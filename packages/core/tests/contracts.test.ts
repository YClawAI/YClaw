/**
 * Tests for Phase 0 shared contracts.
 *
 * Verifies:
 * - Zod schema parse/rejection for each contract type
 * - Serialization round-trips (parse → JSON → parse)
 * - computeThreadKey determinism and uniqueness
 */

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  SessionRecordSchema,
  RunRecordSchema,
  EventEnvelopeSchema,
  ApprovalSchema,
  ThreadKeyInputSchema,
  computeThreadKey,
} from '../src/contracts/index.js';

// ─── SessionRecord ────────────────────────────────────────────────────────────

describe('SessionRecord', () => {
  const THREAD_KEY = 'a'.repeat(32); // 32-char hex placeholder

  const valid = {
    sessionId: 'ses_abc123',
    threadKey: THREAD_KEY,
    state: 'active',
    model: 'claude-sonnet-4-6',
    harness: 'claude-code',
    turnCount: 3,
    createdAt: '2026-03-02T00:00:00.000Z',
    lastActiveAt: '2026-03-02T01:00:00.000Z',
  };

  it('parses a valid session record', () => {
    const result = SessionRecordSchema.parse(valid);
    expect(result.sessionId).toBe('ses_abc123');
    expect(result.state).toBe('active');
    expect(result.turnCount).toBe(3);
    expect(result.ownerWorkerId).toBeUndefined();
  });

  it('round-trips through JSON serialization', () => {
    const parsed = SessionRecordSchema.parse(valid);
    const restored = SessionRecordSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  it('defaults turnCount to 0 when absent', () => {
    const { turnCount: _omitted, ...withoutTurnCount } = valid;
    const result = SessionRecordSchema.parse(withoutTurnCount);
    expect(result.turnCount).toBe(0);
  });

  it('accepts all valid state values', () => {
    const states = ['creating', 'active', 'detached', 'completed', 'failed', 'expired'] as const;
    for (const state of states) {
      const result = SessionRecordSchema.parse({ ...valid, state });
      expect(result.state).toBe(state);
    }
  });

  it('rejects invalid state', () => {
    expect(() =>
      SessionRecordSchema.parse({ ...valid, state: 'unknown' }),
    ).toThrow();
  });

  it('rejects threadKey that is not 32 chars', () => {
    expect(() =>
      SessionRecordSchema.parse({ ...valid, threadKey: 'tooshort' }),
    ).toThrow();
  });

  it('accepts optional tokenUsage', () => {
    const withUsage = {
      ...valid,
      tokenUsage: { input: 1000, output: 500 },
    };
    const result = SessionRecordSchema.parse(withUsage);
    expect(result.tokenUsage?.input).toBe(1000);
    expect(result.tokenUsage?.output).toBe(500);
  });

  it('accepts tokenUsage with cache fields', () => {
    const withCache = {
      ...valid,
      tokenUsage: { input: 2000, output: 800, cacheReadTokens: 1200, cacheCreationTokens: 400 },
    };
    const result = SessionRecordSchema.parse(withCache);
    expect(result.tokenUsage?.cacheReadTokens).toBe(1200);
  });

  it('accepts all valid harness values', () => {
    const harnesses = ['claude-code', 'codex', 'opencode', 'gemini-cli', 'pi'] as const;
    for (const harness of harnesses) {
      const result = SessionRecordSchema.parse({ ...valid, harness });
      expect(result.harness).toBe(harness);
    }
  });
});

// ─── RunRecord ────────────────────────────────────────────────────────────────

describe('RunRecord', () => {
  const valid = {
    runId: '550e8400-e29b-41d4-a716-446655440000',
    agentId: 'builder',
    taskType: 'implement_issue',
    status: 'completed',
    startedAt: '2026-03-02T00:00:00.000Z',
    completedAt: '2026-03-02T01:00:00.000Z',
  };

  it('parses a valid run record', () => {
    const result = RunRecordSchema.parse(valid);
    expect(result.runId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.agentId).toBe('builder');
    expect(result.status).toBe('completed');
  });

  it('round-trips through JSON serialization', () => {
    const parsed = RunRecordSchema.parse(valid);
    const restored = RunRecordSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  it('defaults modifiedFiles to empty array', () => {
    const result = RunRecordSchema.parse(valid);
    expect(result.modifiedFiles).toEqual([]);
  });

  it('accepts modifiedFiles list', () => {
    const withFiles = { ...valid, modifiedFiles: ['src/foo.ts', 'src/bar.ts'] };
    const result = RunRecordSchema.parse(withFiles);
    expect(result.modifiedFiles).toHaveLength(2);
  });

  it('accepts optional sessionId', () => {
    const withSession = { ...valid, sessionId: 'ses_xyz' };
    const result = RunRecordSchema.parse(withSession);
    expect(result.sessionId).toBe('ses_xyz');
  });

  it('accepts optional cost', () => {
    const withCost = { ...valid, cost: { inputUsd: 0.01, outputUsd: 0.03, totalUsd: 0.04 } };
    const result = RunRecordSchema.parse(withCost);
    expect(result.cost?.totalUsd).toBe(0.04);
  });

  it('rejects non-UUID runId', () => {
    expect(() =>
      RunRecordSchema.parse({ ...valid, runId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() =>
      RunRecordSchema.parse({ ...valid, status: 'unknown' }),
    ).toThrow();
  });

  it('accepts all valid status values', () => {
    const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
    for (const status of statuses) {
      const result = RunRecordSchema.parse({ ...valid, status });
      expect(result.status).toBe(status);
    }
  });
});

// ─── EventEnvelope ────────────────────────────────────────────────────────────

describe('EventEnvelope', () => {
  const valid = {
    timestamp: '2026-03-02T00:00:00.000Z',
    agentId: 'builder',
    eventType: 'builder:pr_ready',
    payload: { pr_number: 42, repo: 'my-app' },
  };

  it('parses a valid event envelope', () => {
    const result = EventEnvelopeSchema.parse(valid);
    expect(result.agentId).toBe('builder');
    expect(result.eventType).toBe('builder:pr_ready');
    expect(result.payload['pr_number']).toBe(42);
  });

  it('round-trips through JSON serialization', () => {
    const parsed = EventEnvelopeSchema.parse(valid);
    const restored = EventEnvelopeSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  it('accepts all optional fields', () => {
    const full = {
      ...valid,
      runId: '550e8400-e29b-41d4-a716-446655440000',
      sessionId: 'ses_abc123',
      threadKey: 'b'.repeat(32),
      correlationId: 'corr_xyz',
    };
    const result = EventEnvelopeSchema.parse(full);
    expect(result.sessionId).toBe('ses_abc123');
    expect(result.correlationId).toBe('corr_xyz');
    expect(result.runId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('accepts real-world event types from the system', () => {
    const eventTypes = [
      'github:issue_assigned',
      'builder:pr_ready',
      'strategist:builder_directive',
      'github:ci_fail',
      'claudeception:reflect',
    ];
    for (const eventType of eventTypes) {
      const result = EventEnvelopeSchema.parse({ ...valid, eventType });
      expect(result.eventType).toBe(eventType);
    }
  });

  it('rejects threadKey that is not 32 chars', () => {
    expect(() =>
      EventEnvelopeSchema.parse({ ...valid, threadKey: 'short' }),
    ).toThrow();
  });

  it('accepts nested payload objects', () => {
    const nested = {
      ...valid,
      payload: { issue: { number: 42, title: 'Fix bug' }, meta: { urgent: true } },
    };
    const result = EventEnvelopeSchema.parse(nested);
    expect(result.payload['issue']).toEqual({ number: 42, title: 'Fix bug' });
  });
});

// ─── Approval ─────────────────────────────────────────────────────────────────

describe('Approval', () => {
  const valid = {
    proposalId: '550e8400-e29b-41d4-a716-446655440001',
    type: 'config_change',
    status: 'pending',
    proposedBy: 'builder',
    payload: { key: 'model', newValue: 'claude-opus-4-6' },
    createdAt: '2026-03-02T00:00:00.000Z',
  };

  it('parses a valid approval', () => {
    const result = ApprovalSchema.parse(valid);
    expect(result.proposalId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.status).toBe('pending');
    expect(result.reviewedBy).toBeUndefined();
  });

  it('round-trips through JSON serialization', () => {
    const parsed = ApprovalSchema.parse(valid);
    const restored = ApprovalSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  it('accepts a resolved approval with reviewer and timestamp', () => {
    const resolved = {
      ...valid,
      status: 'approved',
      reviewedBy: 'architect',
      resolvedAt: '2026-03-02T00:05:00.000Z',
      reason: 'Approved: model upgrade is safe',
    };
    const result = ApprovalSchema.parse(resolved);
    expect(result.reviewedBy).toBe('architect');
    expect(result.reason).toBe('Approved: model upgrade is safe');
  });

  it('accepts all valid approval types', () => {
    const types = [
      'config_change',
      'prompt_change',
      'code_change',
      'tool_add',
      'agent_spawn',
      'deploy',
      'external_publish',
    ] as const;
    for (const type of types) {
      const result = ApprovalSchema.parse({ ...valid, type });
      expect(result.type).toBe(type);
    }
  });

  it('accepts all valid approval status values', () => {
    const statuses = ['pending', 'approved', 'rejected', 'applied', 'expired'] as const;
    for (const status of statuses) {
      const result = ApprovalSchema.parse({ ...valid, status });
      expect(result.status).toBe(status);
    }
  });

  it('rejects non-UUID proposalId', () => {
    expect(() =>
      ApprovalSchema.parse({ ...valid, proposalId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects invalid approval type', () => {
    expect(() =>
      ApprovalSchema.parse({ ...valid, type: 'mystery_op' }),
    ).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() =>
      ApprovalSchema.parse({ ...valid, status: 'unknown' }),
    ).toThrow();
  });
});

// ─── ThreadKey ────────────────────────────────────────────────────────────────

describe('computeThreadKey', () => {
  const base = {
    repoUrl: 'https://github.com/yclaw-ai/my-app',
    prNumber: 42,
    taskType: 'implement_issue',
  };

  it('produces a 32-char lowercase hex string', () => {
    const key = computeThreadKey(base);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic: same inputs → same key', () => {
    expect(computeThreadKey(base)).toBe(computeThreadKey(base));
    expect(computeThreadKey(base)).toBe(computeThreadKey({ ...base }));
  });

  it('differs for different repoUrls', () => {
    const other = { ...base, repoUrl: 'https://github.com/yclaw-ai/other-app' };
    expect(computeThreadKey(base)).not.toBe(computeThreadKey(other));
  });

  it('differs for different prNumbers', () => {
    const other = { ...base, prNumber: 43 };
    expect(computeThreadKey(base)).not.toBe(computeThreadKey(other));
  });

  it('differs for different taskTypes', () => {
    const other = { ...base, taskType: 'fix_ci_failure' };
    expect(computeThreadKey(base)).not.toBe(computeThreadKey(other));
  });

  it('handles absent prNumber (maps to empty string)', () => {
    const noPr = { repoUrl: 'https://github.com/yclaw-ai/my-app', taskType: 'daily_standup' };
    const key = computeThreadKey(noPr);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is consistent with the dispatcher algorithm (no regression)', () => {
    // Verify our output matches the same algorithm used in builder/dispatcher.ts
    const stable = JSON.stringify({
      repoUrl: base.repoUrl,
      prNumber: String(base.prNumber),
      taskType: base.taskType,
    });
    const expected = createHash('sha256').update(stable).digest('hex').slice(0, 32);
    expect(computeThreadKey(base)).toBe(expected);
  });

  it('prNumber coercion: numeric and string forms produce the same key', () => {
    const withNumber = { ...base, prNumber: 42 };
    const withString = { ...base, prNumber: '42' };
    expect(computeThreadKey(withNumber)).toBe(computeThreadKey(withString));
  });
});

// ─── ThreadKeyInput schema ────────────────────────────────────────────────────

describe('ThreadKeyInputSchema', () => {
  it('rejects empty repoUrl', () => {
    expect(() =>
      ThreadKeyInputSchema.parse({ repoUrl: '', taskType: 'implement_issue' }),
    ).toThrow();
  });

  it('rejects empty taskType', () => {
    expect(() =>
      ThreadKeyInputSchema.parse({ repoUrl: 'https://github.com/yclaw-ai/app', taskType: '' }),
    ).toThrow();
  });

  it('accepts prNumber as a number', () => {
    const result = ThreadKeyInputSchema.parse({
      repoUrl: 'https://github.com/yclaw-ai/app',
      prNumber: 7,
      taskType: 'implement_issue',
    });
    expect(result.prNumber).toBe(7);
  });

  it('accepts prNumber as a string', () => {
    const result = ThreadKeyInputSchema.parse({
      repoUrl: 'https://github.com/yclaw-ai/app',
      prNumber: '7',
      taskType: 'implement_issue',
    });
    expect(result.prNumber).toBe('7');
  });

  it('accepts absent prNumber', () => {
    const result = ThreadKeyInputSchema.parse({
      repoUrl: 'https://github.com/yclaw-ai/app',
      taskType: 'daily_standup',
    });
    expect(result.prNumber).toBeUndefined();
  });
});
