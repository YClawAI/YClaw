import { describe, it, expect } from 'vitest';
import type { CacheStats } from './audit.js';

/**
 * Test the CacheStats computation logic in isolation.
 * We replicate the computeCacheStats algorithm here because it's a private
 * method on AuditLog. This tests the logic without requiring MongoDB.
 */

interface TokenUsage {
  input: number;
  output: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheHitRate?: number;
  estimatedSavingsRate?: number;
}

interface MinimalExecution {
  tokenUsage?: TokenUsage;
}

function computeCacheStats(executions: MinimalExecution[]): CacheStats {
  let executionsWithCache = 0;
  let totalHitRate = 0;
  let totalSavingsRate = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;

  for (const exec of executions) {
    const usage = exec.tokenUsage;
    if (!usage) continue;

    const hasCache =
      (usage.cacheReadInputTokens !== undefined && usage.cacheReadInputTokens > 0) ||
      (usage.cacheCreationInputTokens !== undefined && usage.cacheCreationInputTokens > 0);

    if (!hasCache) continue;

    executionsWithCache++;
    totalHitRate += usage.cacheHitRate ?? 0;
    totalSavingsRate += usage.estimatedSavingsRate ?? 0;
    totalCacheReadTokens += usage.cacheReadInputTokens ?? 0;
    totalCacheCreationTokens += usage.cacheCreationInputTokens ?? 0;
  }

  return {
    executionsWithCache,
    averageCacheHitRate: executionsWithCache > 0
      ? Math.round((totalHitRate / executionsWithCache) * 1000) / 1000
      : 0,
    averageSavingsRate: executionsWithCache > 0
      ? Math.round((totalSavingsRate / executionsWithCache) * 1000) / 1000
      : 0,
    totalCacheReadTokens,
    totalCacheCreationTokens,
  };
}

describe('CacheStats computation', () => {
  it('should return zeros for empty executions', () => {
    const stats = computeCacheStats([]);
    expect(stats.executionsWithCache).toBe(0);
    expect(stats.averageCacheHitRate).toBe(0);
    expect(stats.averageSavingsRate).toBe(0);
    expect(stats.totalCacheReadTokens).toBe(0);
    expect(stats.totalCacheCreationTokens).toBe(0);
  });

  it('should return zeros when no executions have cache data', () => {
    const stats = computeCacheStats([
      { tokenUsage: { input: 5000, output: 200 } },
      { tokenUsage: { input: 3000, output: 100 } },
      { tokenUsage: undefined },
    ]);
    expect(stats.executionsWithCache).toBe(0);
    expect(stats.averageCacheHitRate).toBe(0);
  });

  it('should compute stats from a single cached execution', () => {
    const stats = computeCacheStats([
      {
        tokenUsage: {
          input: 10000,
          output: 500,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 8000,
          cacheHitRate: 0.8,
          estimatedSavingsRate: 0.72,
        },
      },
    ]);
    expect(stats.executionsWithCache).toBe(1);
    expect(stats.averageCacheHitRate).toBe(0.8);
    expect(stats.averageSavingsRate).toBe(0.72);
    expect(stats.totalCacheReadTokens).toBe(8000);
    expect(stats.totalCacheCreationTokens).toBe(0);
  });

  it('should average hit rates across multiple cached executions', () => {
    const stats = computeCacheStats([
      {
        tokenUsage: {
          input: 10000, output: 500,
          cacheCreationInputTokens: 8000, cacheReadInputTokens: 0,
          cacheHitRate: 0, estimatedSavingsRate: 0,
        },
      },
      {
        tokenUsage: {
          input: 10000, output: 500,
          cacheCreationInputTokens: 0, cacheReadInputTokens: 8000,
          cacheHitRate: 0.8, estimatedSavingsRate: 0.72,
        },
      },
      {
        tokenUsage: {
          input: 10000, output: 500,
          cacheCreationInputTokens: 0, cacheReadInputTokens: 9000,
          cacheHitRate: 0.9, estimatedSavingsRate: 0.81,
        },
      },
    ]);
    expect(stats.executionsWithCache).toBe(3);
    // Average: (0 + 0.8 + 0.9) / 3 ≈ 0.567
    expect(stats.averageCacheHitRate).toBeCloseTo(0.567, 2);
    // Average: (0 + 0.72 + 0.81) / 3 = 0.51
    expect(stats.averageSavingsRate).toBeCloseTo(0.51, 2);
    expect(stats.totalCacheReadTokens).toBe(17000);
    expect(stats.totalCacheCreationTokens).toBe(8000);
  });

  it('should skip executions without tokenUsage', () => {
    const stats = computeCacheStats([
      { tokenUsage: undefined },
      {
        tokenUsage: {
          input: 10000, output: 500,
          cacheCreationInputTokens: 0, cacheReadInputTokens: 8000,
          cacheHitRate: 0.8, estimatedSavingsRate: 0.72,
        },
      },
    ]);
    expect(stats.executionsWithCache).toBe(1);
    expect(stats.averageCacheHitRate).toBe(0.8);
  });

  it('should skip executions with zero cache tokens', () => {
    const stats = computeCacheStats([
      {
        tokenUsage: {
          input: 5000, output: 200,
          cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
        },
      },
      {
        tokenUsage: {
          input: 10000, output: 500,
          cacheCreationInputTokens: 0, cacheReadInputTokens: 8000,
          cacheHitRate: 0.8, estimatedSavingsRate: 0.72,
        },
      },
    ]);
    // Only the second execution has actual cache activity
    expect(stats.executionsWithCache).toBe(1);
    expect(stats.averageCacheHitRate).toBe(0.8);
  });

  it('should count creation-only executions as cached', () => {
    const stats = computeCacheStats([
      {
        tokenUsage: {
          input: 10000, output: 500,
          cacheCreationInputTokens: 8000, cacheReadInputTokens: 0,
          cacheHitRate: 0, estimatedSavingsRate: 0,
        },
      },
    ]);
    // Cache creation counts as cache activity
    expect(stats.executionsWithCache).toBe(1);
    expect(stats.totalCacheCreationTokens).toBe(8000);
    expect(stats.averageCacheHitRate).toBe(0);
  });

  it('should handle missing cacheHitRate gracefully', () => {
    const stats = computeCacheStats([
      {
        tokenUsage: {
          input: 10000, output: 500,
          cacheCreationInputTokens: 0, cacheReadInputTokens: 8000,
          // cacheHitRate and estimatedSavingsRate not set
        },
      },
    ]);
    expect(stats.executionsWithCache).toBe(1);
    // Missing rates default to 0 via ?? 0
    expect(stats.averageCacheHitRate).toBe(0);
    expect(stats.averageSavingsRate).toBe(0);
    expect(stats.totalCacheReadTokens).toBe(8000);
  });
});
