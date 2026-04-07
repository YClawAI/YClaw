import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { YClawEvent } from '../src/types/events.js';

// ─── Mock Logger ────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ────────────────────────────────────────────────────

const { EventStream } = await import('../src/services/event-stream.js');
const { createEvent } = await import('../src/types/events.js');

// ─── Mock Redis Factory ────────────────────────────────────────────────────

function createMockRedis() {
  return {
    xadd: vi.fn().mockResolvedValue('1-0'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xgroup: vi.fn().mockResolvedValue('OK'),
    xpending: vi.fn().mockResolvedValue([0, null, null, null]),
    duplicate: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
  } as any;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<Parameters<typeof createEvent>[0]> = {}) {
  return createEvent({
    type: 'coord.task.requested',
    source: 'strategist',
    correlation_id: 'corr-1',
    payload: { task_id: 't-1', project_id: 'p-1', status: 'requested' },
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('EventStream', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockReader: ReturnType<typeof createMockRedis>;
  let stream: InstanceType<typeof EventStream>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockReader = createMockRedis();
    mockRedis.duplicate.mockReturnValue(mockReader);
    stream = new EventStream(mockRedis);
  });

  afterEach(async () => {
    await stream.shutdown();
  });

  // ─── publishEvent ───────────────────────────────────────────────────────

  describe('publishEvent', () => {
    it('writes event to correct stream key with MAXLEN cap', async () => {
      const event = makeEvent();
      const id = await stream.publishEvent(event);

      expect(id).toBe('1-0');
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'yclaw:stream:coord',
        'MAXLEN', '~', '10000',
        '*',
        'data', JSON.stringify(event),
      );
    });

    it('derives stream key from event type prefix', async () => {
      const event = makeEvent({ type: 'github.pr.merged' });
      await stream.publishEvent(event);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'yclaw:stream:github',
        expect.any(String), expect.any(String), expect.any(String),
        '*',
        'data', expect.any(String),
      );
    });

    it('returns stream entry ID', async () => {
      mockRedis.xadd.mockResolvedValue('1709000000000-0');
      const event = makeEvent();
      const id = await stream.publishEvent(event);
      expect(id).toBe('1709000000000-0');
    });
  });

  // ─── subscribeStream ──────────────────────────────────────────────────

  describe('subscribeStream', () => {
    it('creates consumer group with MKSTREAM', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      stream.subscribeStream('coord', 'coord-workers', handler);

      // Wait for async readLoop to execute ensureGroup
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockRedis.xgroup).toHaveBeenCalledWith(
        'CREATE', 'yclaw:stream:coord', 'coord-workers', '0', 'MKSTREAM',
      );
    });

    it('tolerates existing consumer group (BUSYGROUP)', async () => {
      mockRedis.xgroup.mockRejectedValue(new Error('BUSYGROUP Consumer Group name already exists'));
      const handler = vi.fn().mockResolvedValue(undefined);

      // Should not throw
      stream.subscribeStream('coord', 'coord-workers', handler);
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockRedis.xgroup).toHaveBeenCalled();
    });

    it('publish → consume → ACK cycle', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const event = makeEvent();

      // Configure reader mock:
      // - PEL check (last arg '0') → no pending
      // - First new-entry read (last arg '>') → one event
      // - Subsequent reads → null
      let newReadCount = 0;
      mockReader.xreadgroup.mockImplementation(async (...args: any[]) => {
        const lastArg = args[args.length - 1];
        if (lastArg === '0') return null;
        if (lastArg === '>') {
          newReadCount++;
          if (newReadCount === 1) {
            return [['yclaw:stream:coord', [['1-0', ['data', JSON.stringify(event)]]]]];
          }
        }
        return null;
      });

      stream.subscribeStream('coord', 'coord-workers', handler);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
      expect(mockReader.xack).toHaveBeenCalledWith(
        'yclaw:stream:coord', 'coord-workers', '1-0',
      );
    });

    it('replays pending entries from PEL before reading new', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const pendingEvent = makeEvent({ type: 'coord.task.started' });
      const newEvent = makeEvent({ type: 'coord.task.completed' });

      const callOrder: string[] = [];
      let newReadCount = 0;

      mockReader.xreadgroup.mockImplementation(async (...args: any[]) => {
        const lastArg = args[args.length - 1];
        if (lastArg === '0') {
          callOrder.push('pending');
          return [['yclaw:stream:coord', [['0-1', ['data', JSON.stringify(pendingEvent)]]]]];
        }
        if (lastArg === '>') {
          newReadCount++;
          if (newReadCount === 1) {
            callOrder.push('new');
            return [['yclaw:stream:coord', [['1-0', ['data', JSON.stringify(newEvent)]]]]];
          }
        }
        return null;
      });

      stream.subscribeStream('coord', 'coord-workers', handler);
      await new Promise(resolve => setTimeout(resolve, 100));

      // PEL processed before new entries
      expect(callOrder[0]).toBe('pending');
      expect(callOrder[1]).toBe('new');
      expect(handler).toHaveBeenCalledTimes(2);

      // Both entries ACKed
      expect(mockReader.xack).toHaveBeenCalledWith(
        'yclaw:stream:coord', 'coord-workers', '0-1',
      );
      expect(mockReader.xack).toHaveBeenCalledWith(
        'yclaw:stream:coord', 'coord-workers', '1-0',
      );
    });

    it('does not ACK when handler throws (stays in PEL for retry)', async () => {
      const event = makeEvent();
      const handler = vi.fn().mockRejectedValue(new Error('processing failed'));

      let newReadCount = 0;
      mockReader.xreadgroup.mockImplementation(async (...args: any[]) => {
        const lastArg = args[args.length - 1];
        if (lastArg === '0') return null;
        if (lastArg === '>') {
          newReadCount++;
          if (newReadCount === 1) {
            return [['yclaw:stream:coord', [['1-0', ['data', JSON.stringify(event)]]]]];
          }
        }
        return null;
      });

      stream.subscribeStream('coord', 'coord-workers', handler);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledTimes(1);
      // xack should NOT have been called — entry stays in PEL
      expect(mockReader.xack).not.toHaveBeenCalled();
    });
  });

  // ─── pendingCount ───────────────────────────────────────────────────────

  describe('pendingCount', () => {
    it('returns pending count for a specific stream', async () => {
      // Subscribe first so the stream/group mapping is tracked
      const handler = vi.fn().mockResolvedValue(undefined);
      stream.subscribeStream('coord', 'coord-workers', handler);

      // XPENDING summary: [count, minId, maxId, [[consumer, count]]]
      mockRedis.xpending.mockResolvedValue([5, '1-0', '5-0', [['worker-1', '5']]]);

      const count = await stream.pendingCount('coord');
      expect(count).toBe(5);
      expect(mockRedis.xpending).toHaveBeenCalledWith(
        'yclaw:stream:coord', 'coord-workers',
      );
    });

    it('returns 0 for unknown stream prefix', async () => {
      const count = await stream.pendingCount('unknown');
      expect(count).toBe(0);
    });

    it('sums across all subscribed streams when no prefix given', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      stream.subscribeStream('coord', 'coord-workers', handler);
      stream.subscribeStream('github', 'github-workers', handler);

      mockRedis.xpending
        .mockResolvedValueOnce([3, '1-0', '3-0', [['worker-1', '3']]])
        .mockResolvedValueOnce([2, '1-0', '2-0', [['worker-1', '2']]]);

      const count = await stream.pendingCount();
      expect(count).toBe(5);
    });
  });

  // ─── shutdown ─────────────────────────────────────────────────────────

  describe('shutdown', () => {
    it('stops the read loop and disconnects readers', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      stream.subscribeStream('coord', 'coord-workers', handler);

      await stream.shutdown();
      expect(mockReader.disconnect).toHaveBeenCalled();
    });
  });
});
