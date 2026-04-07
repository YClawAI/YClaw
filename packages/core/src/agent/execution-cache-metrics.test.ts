import { describe, it, expect } from 'vitest';
import {
  ExecutionCacheTracker,
  formatCacheMetricsForReport,
  toTokenUsage,
} from './execution-cache-metrics.js';
import type { LLMResponse } from '../llm/types.js';

function makeResponse(overrides: Partial<LLMResponse['usage']> = {}): LLMResponse {
  return {
    content: 'test',
    toolCalls: [],
    usage: {
      inputTokens: 10000,
      outputTokens: 500,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
      ...overrides,
    },
    stopReason: 'end_turn',
  };
}

describe('ExecutionCacheTracker', () => {
  it('should start with zero rounds', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');
    expect(tracker.roundCount).toBe(0);
  });

  it('should record a single round', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');
    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      outputTokens: 500,
      cacheCreationInputTokens: 8000,
      cacheReadInputTokens: 0,
    }));
    expect(tracker.roundCount).toBe(1);
  });

  it('should accumulate metrics across multiple rounds', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');

    // Round 1: Cache creation (first call)
    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      outputTokens: 500,
      cacheCreationInputTokens: 8000,
      cacheReadInputTokens: 0,
    }));

    // Round 2: Cache hit (subsequent call)
    tracker.recordRound(makeResponse({
      inputTokens: 10500,
      outputTokens: 300,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 8000,
    }));

    // Round 3: Cache hit again
    tracker.recordRound(makeResponse({
      inputTokens: 11000,
      outputTokens: 400,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 8000,
    }));

    const result = tracker.finalize();

    expect(result.totalRounds).toBe(3);
    expect(result.totalInputTokens).toBe(31500);
    expect(result.totalOutputTokens).toBe(1200);
    expect(result.cacheMetrics.totalCacheCreationTokens).toBe(8000);
    expect(result.cacheMetrics.totalCacheReadTokens).toBe(16000);
    expect(result.cacheMetrics.cacheHitRate).toBeGreaterThan(0);
    expect(result.cacheMetrics.estimatedSavingsRate).toBeGreaterThan(0);
  });

  it('should handle rounds with no cache activity', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');

    tracker.recordRound(makeResponse({
      inputTokens: 5000,
      outputTokens: 200,
    }));

    const result = tracker.finalize();

    expect(result.totalRounds).toBe(1);
    expect(result.cacheMetrics.totalCacheCreationTokens).toBe(0);
    expect(result.cacheMetrics.totalCacheReadTokens).toBe(0);
    expect(result.cacheMetrics.cacheHitRate).toBe(0);
    expect(result.cacheMetrics.estimatedSavingsRate).toBe(0);
  });

  it('should finalize with zero rounds', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');
    const result = tracker.finalize();

    expect(result.totalRounds).toBe(0);
    expect(result.totalInputTokens).toBe(0);
    expect(result.cacheMetrics.cacheHitRate).toBe(0);
  });

  it('should estimate cost savings', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');

    // 1M cached read tokens → ~$2.70 savings
    tracker.recordRound(makeResponse({
      inputTokens: 1000000,
      outputTokens: 1000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1000000,
    }));

    const result = tracker.finalize();
    expect(result.estimatedSavingsDollars).toBeCloseTo(2.7, 1);
  });

  it('should provide current metrics without finalizing', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');

    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 8000,
    }));

    const metrics = tracker.getCurrentMetrics();
    expect(metrics.totalCacheReadTokens).toBe(8000);
    expect(metrics.cacheHitRate).toBeGreaterThan(0);

    // Can still record more rounds
    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 8000,
    }));

    expect(tracker.roundCount).toBe(2);
  });

  it('should include per-round details in result', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');

    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      cacheCreationInputTokens: 8000,
      cacheReadInputTokens: 0,
    }));

    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 8000,
    }));

    const result = tracker.finalize();
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]!.roundNumber).toBe(1);
    expect(result.rounds[0]!.cacheCreationTokens).toBe(8000);
    expect(result.rounds[1]!.roundNumber).toBe(2);
    expect(result.rounds[1]!.cacheReadTokens).toBe(8000);
  });
});

describe('formatCacheMetricsForReport', () => {
  it('should format a human-readable summary', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');
    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 8000,
    }));
    const result = tracker.finalize();
    const report = formatCacheMetricsForReport(result);

    expect(report).toContain('hit rate');
    expect(report).toContain('1 rounds');
    expect(report).toContain('cached');
    expect(report).toContain('cost savings');
  });

  it('should handle zero-round results', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');
    const result = tracker.finalize();
    const report = formatCacheMetricsForReport(result);

    expect(report).toContain('0% hit rate');
    expect(report).toContain('0 rounds');
  });
});

describe('toTokenUsage', () => {
  it('should convert to TokenUsage schema format', () => {
    const tracker = new ExecutionCacheTracker('builder', 'test_task');
    tracker.recordRound(makeResponse({
      inputTokens: 10000,
      outputTokens: 500,
      cacheCreationInputTokens: 2000,
      cacheReadInputTokens: 6000,
    }));
    const result = tracker.finalize();
    const usage = toTokenUsage(result);

    expect(usage.input).toBe(10000);
    expect(usage.output).toBe(500);
    expect(usage.cacheCreationInputTokens).toBe(2000);
    expect(usage.cacheReadInputTokens).toBe(6000);
    expect(usage.cacheHitRate).toBeGreaterThan(0);
    expect(usage.cacheHitRate).toBeLessThanOrEqual(1);
    expect(usage.estimatedSavingsRate).toBeGreaterThan(0);
    expect(usage.estimatedSavingsRate).toBeLessThanOrEqual(1);
  });
});
