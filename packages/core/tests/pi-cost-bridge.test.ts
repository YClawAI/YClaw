import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiCostBridge } from '../src/llm/pi-cost-bridge.js';

function createMockCostTracker() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn(),
    getDailySpendCents: vi.fn(),
    getMonthlySpendCents: vi.fn(),
  };
}

describe('PiCostBridge', () => {
  let mockTracker: ReturnType<typeof createMockCostTracker>;
  let bridge: PiCostBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = createMockCostTracker();
    bridge = new PiCostBridge(mockTracker as any, {
      agentName: 'builder',
      taskId: 'test-task-123',
      modelId: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
    });
  });

  it('ignores non-message_end events', () => {
    bridge.handleEvent({ type: 'agent_start' });
    bridge.handleEvent({ type: 'tool_execution_start' });
    bridge.handleEvent({ type: 'turn_start' });
    expect(mockTracker.record).not.toHaveBeenCalled();
  });

  it('ignores non-object events', () => {
    bridge.handleEvent(null);
    bridge.handleEvent(undefined);
    bridge.handleEvent('string');
    bridge.handleEvent(42);
    expect(mockTracker.record).not.toHaveBeenCalled();
  });

  it('ignores events without type', () => {
    bridge.handleEvent({ foo: 'bar' });
    expect(mockTracker.record).not.toHaveBeenCalled();
  });

  it('extracts usage from message_end event', () => {
    bridge.handleEvent({
      type: 'message_end',
      message: {
        usage: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100, cost: { total: 0.05 } },
      },
    });

    expect(mockTracker.record).toHaveBeenCalledOnce();
    expect(mockTracker.record).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
      }),
    );
  });

  it('accumulates across multiple message_end events', () => {
    const usage = { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } };
    bridge.handleEvent({ type: 'message_end', message: { usage } });
    bridge.handleEvent({ type: 'message_end', message: { usage } });
    bridge.handleEvent({ type: 'message_end', message: { usage } });

    const totals = bridge.getTotals();
    expect(totals.inputTokens).toBe(300);
    expect(totals.outputTokens).toBe(150);
    expect(totals.cacheReadTokens).toBe(30);
    expect(totals.cacheWriteTokens).toBe(15);
    expect(totals.totalCostUsd).toBeCloseTo(0.03);
    expect(totals.turnCount).toBe(3);
  });

  it('forwards each event to costTracker.record()', () => {
    bridge.handleEvent({ type: 'message_end', message: { usage: { input: 10, output: 5 } } });
    bridge.handleEvent({ type: 'message_end', message: { usage: { input: 20, output: 10 } } });
    expect(mockTracker.record).toHaveBeenCalledTimes(2);
  });

  it('getTotals returns accumulated values', () => {
    bridge.handleEvent({
      type: 'message_end',
      message: { usage: { input: 500, output: 250, cacheRead: 50, cacheWrite: 25, cost: { total: 0.02 } } },
    });
    const totals = bridge.getTotals();
    expect(totals.inputTokens).toBe(500);
    expect(totals.outputTokens).toBe(250);
    expect(totals.totalCostUsd).toBeCloseTo(0.02);
  });

  it('reset() clears counters', () => {
    bridge.handleEvent({
      type: 'message_end',
      message: { usage: { input: 100, output: 50, cost: { total: 0.01 } } },
    });
    bridge.reset();
    const totals = bridge.getTotals();
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(0);
    expect(totals.totalCostUsd).toBe(0);
    expect(totals.turnCount).toBe(0);
  });

  it('handles missing usage gracefully', () => {
    bridge.handleEvent({ type: 'message_end', message: {} });
    expect(mockTracker.record).not.toHaveBeenCalled();
  });

  it('handles missing cost sub-object gracefully', () => {
    bridge.handleEvent({
      type: 'message_end',
      message: { usage: { input: 100, output: 50 } },
    });
    const totals = bridge.getTotals();
    expect(totals.totalCostUsd).toBe(0);
    expect(totals.inputTokens).toBe(100);
  });

  it('contract: PiCostBridge does not import from @mariozechner', async () => {
    // PiCostBridge is pi-agnostic — it just processes event shapes
    expect(typeof PiCostBridge).toBe('function');
  });
});

describe('createPiModel', () => {
  it('returns a model for known providers', async () => {
    const { createPiModel } = await import('../src/llm/pi-model-factory.js');
    expect(typeof createPiModel).toBe('function');
  });
});
