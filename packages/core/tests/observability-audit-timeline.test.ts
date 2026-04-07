import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditTimeline, type TimelineEvent, type TimelineQuery } from '../src/observability/audit-timeline.js';
import type { OperatorAuditLogger, OperatorAuditEntry } from '../src/operators/audit-logger.js';
import type { AuditLog } from '../src/logging/audit.js';

function createMockOperatorAudit(entries: OperatorAuditEntry[] = []): OperatorAuditLogger {
  return {
    queryFiltered: vi.fn().mockResolvedValue(entries),
  } as unknown as OperatorAuditLogger;
}

function createMockAuditLog(executions: Record<string, unknown>[] = [], hasDb = true): AuditLog {
  const collection = {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(executions),
        }),
      }),
    }),
  };
  return {
    getDb: vi.fn().mockReturnValue(hasDb ? {
      collection: vi.fn().mockReturnValue(collection),
    } : null),
  } as unknown as AuditLog;
}

function makeOpEntry(overrides: Partial<OperatorAuditEntry> = {}): OperatorAuditEntry {
  return {
    timestamp: new Date('2026-04-01T10:00:00Z'),
    operatorId: 'op_troy',
    action: 'task.create',
    resource: { type: 'task', id: 'task_1' },
    request: { method: 'POST', path: '/v1/tasks', ip: '127.0.0.1' },
    decision: 'allowed',
    ...overrides,
  };
}

function makeExecEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: 'exec_1',
    createdAt: '2026-04-01T09:00:00Z',
    agent: 'architect',
    flag: 'code_review',
    status: 'failed',
    error: 'LLM timeout',
    correlationId: 'corr_abc',
    ...overrides,
  };
}

describe('AuditTimeline', () => {
  it('merges events from both stores sorted by timestamp desc', async () => {
    const opEntries = [
      makeOpEntry({ timestamp: new Date('2026-04-01T12:00:00Z') }),
      makeOpEntry({ timestamp: new Date('2026-04-01T10:00:00Z') }),
    ];
    const execEntries = [
      makeExecEntry({ createdAt: '2026-04-01T11:00:00Z', _id: 'exec_1' }),
    ];

    const opAudit = createMockOperatorAudit(opEntries);
    const auditLog = createMockAuditLog(execEntries);
    const timeline = new AuditTimeline(opAudit, auditLog);

    const result = await timeline.query({});
    expect(result.events.length).toBe(3);
    // First event should be the newest
    expect(result.events[0]!.timestamp).toBe('2026-04-01T12:00:00.000Z');
    expect(result.events[0]!.source).toBe('operator');
    expect(result.events[1]!.timestamp).toBe('2026-04-01T11:00:00Z');
    expect(result.events[1]!.source).toBe('execution');
  });

  it('respects limit and reports hasMore', async () => {
    const opEntries = [
      makeOpEntry({ timestamp: new Date('2026-04-01T12:00:00Z') }),
      makeOpEntry({ timestamp: new Date('2026-04-01T11:00:00Z') }),
      makeOpEntry({ timestamp: new Date('2026-04-01T10:00:00Z') }),
    ];
    const opAudit = createMockOperatorAudit(opEntries);
    const auditLog = createMockAuditLog([]);
    const timeline = new AuditTimeline(opAudit, auditLog);

    const result = await timeline.query({ limit: 2 });
    expect(result.events.length).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBeDefined();
  });

  it('returns cursor as null when no events', async () => {
    const opAudit = createMockOperatorAudit([]);
    const auditLog = createMockAuditLog([]);
    const timeline = new AuditTimeline(opAudit, auditLog);

    const result = await timeline.query({});
    expect(result.events.length).toBe(0);
    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('filters by operatorId — skips execution store', async () => {
    const opEntries = [makeOpEntry()];
    const opAudit = createMockOperatorAudit(opEntries);
    const auditLog = createMockAuditLog([makeExecEntry()]);
    const timeline = new AuditTimeline(opAudit, auditLog);

    const result = await timeline.query({ operatorId: 'op_troy' });
    // Should only have operator events (execution skipped for operatorId filter)
    expect(result.events.every(e => e.source === 'operator')).toBe(true);
  });

  it('filters by agentId — skips operator store', async () => {
    const execEntries = [makeExecEntry({ agent: 'builder' })];
    const opAudit = createMockOperatorAudit([makeOpEntry()]);
    const auditLog = createMockAuditLog(execEntries);
    const timeline = new AuditTimeline(opAudit, auditLog);

    const result = await timeline.query({ agentId: 'builder' });
    // Should only have execution events (operator skipped for agentId filter)
    expect(result.events.every(e => e.source === 'execution')).toBe(true);
  });

  it('caps limit at 200', async () => {
    const opAudit = createMockOperatorAudit([]);
    const auditLog = createMockAuditLog([]);
    const timeline = new AuditTimeline(opAudit, auditLog);

    await timeline.query({ limit: 999 });
    // The internal fetchLimit should be 201 (200+1), not 1000
    expect((opAudit.queryFiltered as ReturnType<typeof vi.fn>).mock.calls[0]![0].limit).toBe(201);
  });

  it('handles operator audit failure gracefully', async () => {
    const opAudit = {
      queryFiltered: vi.fn().mockRejectedValue(new Error('DB timeout')),
    } as unknown as OperatorAuditLogger;
    const execEntries = [makeExecEntry()];
    const auditLog = createMockAuditLog(execEntries);
    const timeline = new AuditTimeline(opAudit, auditLog);

    // Should not throw — returns only execution events
    const result = await timeline.query({});
    expect(result.events.length).toBe(1);
    expect(result.events[0]!.source).toBe('execution');
  });

  it('handles execution audit failure gracefully', async () => {
    const opEntries = [makeOpEntry()];
    const opAudit = createMockOperatorAudit(opEntries);
    const auditLog = {
      getDb: vi.fn().mockReturnValue({
        collection: vi.fn().mockReturnValue({
          find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                toArray: vi.fn().mockRejectedValue(new Error('DB error')),
              }),
            }),
          }),
        }),
      }),
    } as unknown as AuditLog;
    const timeline = new AuditTimeline(opAudit, auditLog);

    // Should not throw — returns only operator events
    const result = await timeline.query({});
    expect(result.events.length).toBe(1);
    expect(result.events[0]!.source).toBe('operator');
  });

  it('passes before parameter to both stores', async () => {
    const opAudit = createMockOperatorAudit([]);
    const auditLog = createMockAuditLog([]);
    const timeline = new AuditTimeline(opAudit, auditLog);

    await timeline.query({ before: '2026-04-01T10:00:00Z' });

    // Operator audit should receive `to` parameter with -1ms for exclusive cursor
    const opCall = (opAudit.queryFiltered as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opCall.to).toEqual(new Date(new Date('2026-04-01T10:00:00Z').getTime() - 1));
  });

  it('stable sort tiebreaker uses source then id', async () => {
    const opEntries = [
      makeOpEntry({ timestamp: new Date('2026-04-01T10:00:00Z') }),
    ];
    const execEntries = [
      makeExecEntry({ createdAt: '2026-04-01T10:00:00.000Z', _id: 'exec_same_time' }),
    ];
    const opAudit = createMockOperatorAudit(opEntries);
    const auditLog = createMockAuditLog(execEntries);
    const timeline = new AuditTimeline(opAudit, auditLog);

    const result = await timeline.query({});
    expect(result.events.length).toBe(2);
    // Stable sort: 'execution' < 'operator' alphabetically
    expect(result.events[0]!.source).toBe('execution');
    expect(result.events[1]!.source).toBe('operator');
  });
});
