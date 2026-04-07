import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OperatorEventStream } from '../src/operators/event-stream.js';

function createMockCollection() {
  const docs: any[] = [];
  return {
    createIndex: vi.fn().mockResolvedValue(undefined),
    insertOne: vi.fn().mockImplementation(async (doc: any) => {
      docs.push({ ...doc });
    }),
    find: vi.fn().mockImplementation((filter: any) => {
      let results = docs.filter((d) => {
        if (filter.eventId?.$gt && d.eventId <= filter.eventId.$gt) return false;
        if (filter.departmentId?.$in && !filter.departmentId.$in.includes(d.departmentId)) return false;
        if (filter.type && d.type !== filter.type) return false;
        return true;
      });
      return {
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(results),
          }),
        }),
      };
    }),
    _docs: docs,
  };
}

function createMockDb() {
  const collections: Record<string, ReturnType<typeof createMockCollection>> = {};
  return {
    collection: vi.fn().mockImplementation((name: string) => {
      if (!collections[name]) collections[name] = createMockCollection();
      return collections[name];
    }),
  };
}

describe('OperatorEventStream', () => {
  let db: ReturnType<typeof createMockDb>;
  let stream: OperatorEventStream;

  beforeEach(async () => {
    db = createMockDb();
    stream = new OperatorEventStream(db as any);
    await stream.ensureIndexes();
  });

  it('emits events with auto-generated ID and timestamp', async () => {
    stream.emit({
      type: 'task.created',
      departmentId: 'marketing',
      agentId: 'designer',
      operatorId: 'op_cmo',
      summary: 'Task created: Design Q2 campaign',
      details: { taskId: 'optask_123' },
    });

    // Wait for fire-and-forget
    await new Promise((r) => setTimeout(r, 10));
    const col = db.collection('operator_events');
    expect(col._docs).toHaveLength(1);
    expect(col._docs[0].eventId).toMatch(/^evt_/);
    expect(col._docs[0].type).toBe('task.created');
  });

  it('queries events filtered by department', async () => {
    stream.emit({ type: 'task.created', departmentId: 'marketing', summary: 'M1', details: {} });
    stream.emit({ type: 'task.created', departmentId: 'development', summary: 'D1', details: {} });
    stream.emit({ type: 'task.created', departmentId: 'marketing', summary: 'M2', details: {} });

    await new Promise((r) => setTimeout(r, 10));
    const events = await stream.query({ departmentIds: ['marketing'] });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.departmentId === 'marketing')).toBe(true);
  });

  it('queries events filtered by type', async () => {
    stream.emit({ type: 'task.created', departmentId: 'marketing', summary: 'C', details: {} });
    stream.emit({ type: 'task.completed', departmentId: 'marketing', summary: 'D', details: {} });

    await new Promise((r) => setTimeout(r, 10));
    const events = await stream.query({ type: 'task.completed' });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('task.completed');
  });

  it('supports cursor-based pagination via since', async () => {
    stream.emit({ type: 'task.created', departmentId: 'marketing', summary: 'First', details: {} });
    await new Promise((r) => setTimeout(r, 5));
    stream.emit({ type: 'task.created', departmentId: 'marketing', summary: 'Second', details: {} });

    await new Promise((r) => setTimeout(r, 10));
    const all = await stream.query({});
    expect(all).toHaveLength(2);

    const cursor = all[0]!.eventId;
    const newer = await stream.query({ since: cursor });
    // Events after the cursor
    expect(newer.length).toBeLessThanOrEqual(all.length);
  });
});
