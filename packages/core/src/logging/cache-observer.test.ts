import { describe, it, expect } from 'vitest';
import {
  CacheObserver,
  ANTHROPIC_PRICING,
  type ModelPricing,
  type CostBreakdown,
  type AgentCacheReport,
  type OrgCacheReport,
} from './cache-observer.js';

// ─── getPricing ─────────────────────────────────────────────────────────────

describe('CacheObserver.getPricing', () => {
  it('should return Opus pricing for claude-opus-4 models', () => {
    const pricing = CacheObserver.getPricing('claude-opus-4-6');
    expect(pricing.inputPerMillion).toBe(15);
    expect(pricing.cacheReadPerMillion).toBe(1.5);
  });

  it('should return Sonnet pricing for claude-sonnet-4 models', () => {
    const pricing = CacheObserver.getPricing('claude-sonnet-4-5-20250929');
    expect(pricing.inputPerMillion).toBe(3);
    expect(pricing.cacheReadPerMillion).toBe(0.3);
  });

  it('should return Haiku pricing for claude-haiku models', () => {
    const pricing = CacheObserver.getPricing('claude-haiku-3-5');
    expect(pricing.inputPerMillion).toBe(0.8);
  });

  it('should return default (Sonnet) pricing for unknown models', () => {
    const pricing = CacheObserver.getPricing('gpt-4o');
    expect(pricing.inputPerMillion).toBe(3);
  });
});

// ─── calculateCost ──────────────────────────────────────────────────────────

describe('CacheObserver.calculateCost', () => {
  const sonnetPricing = ANTHROPIC_PRICING['claude-sonnet-4']!;

  it('should calculate cost with no caching', () => {
    const cost = CacheObserver.calculateCost(
      10000, // input
      500,   // output
      0,     // cache read
      0,     // cache creation
      sonnetPricing,
    );

    // Input: 10000 / 1M * $3 = $0.03
    // Output: 500 / 1M * $15 = $0.0075
    expect(cost.uncachedInputCost).toBeCloseTo(0.03, 5);
    expect(cost.cacheReadCost).toBe(0);
    expect(cost.cacheCreationCost).toBe(0);
    expect(cost.outputCost).toBeCloseTo(0.0075, 5);
    expect(cost.totalCost).toBeCloseTo(0.0375, 4);
    expect(cost.costWithoutCaching).toBeCloseTo(0.0375, 4);
    expect(cost.savingsUsd).toBe(0);
    expect(cost.savingsPercent).toBe(0);
  });

  it('should calculate cost with cache hits', () => {
    const cost = CacheObserver.calculateCost(
      10000, // input
      500,   // output
      8000,  // cache read
      0,     // cache creation
      sonnetPricing,
    );

    // Uncached input: (10000 - 8000) / 1M * $3 = $0.006
    // Cache read: 8000 / 1M * $0.30 = $0.0024
    // Output: 500 / 1M * $15 = $0.0075
    expect(cost.uncachedInputCost).toBeCloseTo(0.006, 5);
    expect(cost.cacheReadCost).toBeCloseTo(0.0024, 5);
    expect(cost.outputCost).toBeCloseTo(0.0075, 5);

    // Total: 0.006 + 0.0024 + 0.0075 = 0.0159
    expect(cost.totalCost).toBeCloseTo(0.0159, 4);

    // Without caching: 10000 / 1M * $3 + $0.0075 = $0.0375
    expect(cost.costWithoutCaching).toBeCloseTo(0.0375, 4);

    // Savings: $0.0375 - $0.0159 = $0.0216
    expect(cost.savingsUsd).toBeCloseTo(0.0216, 4);
    expect(cost.savingsPercent).toBeGreaterThan(50);
  });

  it('should calculate cost with cache creation', () => {
    const cost = CacheObserver.calculateCost(
      10000, // input
      500,   // output
      0,     // cache read
      8000,  // cache creation
      sonnetPricing,
    );

    // Uncached input: 10000 / 1M * $3 = $0.03
    // Cache creation: 8000 / 1M * $3.75 = $0.03
    // Output: 500 / 1M * $15 = $0.0075
    expect(cost.uncachedInputCost).toBeCloseTo(0.03, 5);
    expect(cost.cacheCreationCost).toBeCloseTo(0.03, 5);

    // Total is higher than without caching (creation surcharge)
    expect(cost.totalCost).toBeGreaterThan(cost.costWithoutCaching);
    expect(cost.savingsUsd).toBe(0);
    expect(cost.savingsPercent).toBe(0);
  });

  it('should handle 100% cache hit', () => {
    const cost = CacheObserver.calculateCost(
      10000, // input
      500,   // output
      10000, // cache read (all from cache)
      0,     // cache creation
      sonnetPricing,
    );

    expect(cost.uncachedInputCost).toBe(0);
    // Cache read: 10000 / 1M * $0.30 = $0.003
    expect(cost.cacheReadCost).toBeCloseTo(0.003, 5);
    expect(cost.savingsPercent).toBeGreaterThan(70);
  });

  it('should handle zero tokens', () => {
    const cost = CacheObserver.calculateCost(0, 0, 0, 0, sonnetPricing);
    expect(cost.totalCost).toBe(0);
    expect(cost.costWithoutCaching).toBe(0);
    expect(cost.savingsUsd).toBe(0);
    expect(cost.savingsPercent).toBe(0);
  });

  it('should use Opus pricing correctly', () => {
    const opusPricing = ANTHROPIC_PRICING['claude-opus-4']!;
    const cost = CacheObserver.calculateCost(
      10000, 500, 8000, 0, opusPricing,
    );

    // Uncached: 2000 / 1M * $15 = $0.03
    // Cache read: 8000 / 1M * $1.50 = $0.012
    expect(cost.uncachedInputCost).toBeCloseTo(0.03, 5);
    expect(cost.cacheReadCost).toBeCloseTo(0.012, 5);
  });
});

// ─── formatSlackSummary ─────────────────────────────────────────────────────

describe('CacheObserver.formatSlackSummary', () => {
  it('should format a report as Slack text', () => {
    const report: OrgCacheReport = {
      period: {
        from: '2026-02-23T00:00:00.000Z',
        to: '2026-02-24T00:00:00.000Z',
      },
      generatedAt: '2026-02-24T00:00:00.000Z',
      agents: [
        {
          agent: 'builder',
          period: {
            from: '2026-02-23T00:00:00.000Z',
            to: '2026-02-24T00:00:00.000Z',
          },
          executionCount: 10,
          executionsWithCache: 8,
          cacheAdoptionRate: 80,
          averageCacheHitRate: 0.75,
          averageSavingsRate: 0.6,
          totalTokens: {
            input: 100000,
            output: 5000,
            cacheRead: 75000,
            cacheCreation: 10000,
            uncachedInput: 25000,
          },
          cost: {
            uncachedInputCost: 0.075,
            cacheReadCost: 0.0225,
            cacheCreationCost: 0.0375,
            outputCost: 0.075,
            totalCost: 0.21,
            costWithoutCaching: 0.375,
            savingsUsd: 0.165,
            savingsPercent: 44,
          },
        },
      ],
      totals: {
        executionCount: 10,
        executionsWithCache: 8,
        cacheAdoptionRate: 80,
        averageCacheHitRate: 0.75,
        totalTokens: {
          input: 100000,
          output: 5000,
          cacheRead: 75000,
          cacheCreation: 10000,
        },
        cost: {
          uncachedInputCost: 0.075,
          cacheReadCost: 0.0225,
          cacheCreationCost: 0.0375,
          outputCost: 0.075,
          totalCost: 0.21,
          costWithoutCaching: 0.375,
          savingsUsd: 0.165,
          savingsPercent: 44,
        },
      },
    };

    const text = CacheObserver.formatSlackSummary(report);

    expect(text).toContain('Cache Performance Report');
    expect(text).toContain('2026-02-23');
    expect(text).toContain('80% adoption');
    expect(text).toContain('75.0%');
    expect(text).toContain('75.0K read');
    expect(text).toContain('$0.2100');
    expect(text).toContain('$0.1650');
    expect(text).toContain('44%');
    expect(text).toContain('builder');
  });

  it('should skip agents with no cache activity', () => {
    const report: OrgCacheReport = {
      period: { from: '2026-02-23T00:00:00.000Z', to: '2026-02-24T00:00:00.000Z' },
      generatedAt: '2026-02-24T00:00:00.000Z',
      agents: [
        {
          agent: 'guide',
          period: { from: '2026-02-23T00:00:00.000Z', to: '2026-02-24T00:00:00.000Z' },
          executionCount: 5,
          executionsWithCache: 0,
          cacheAdoptionRate: 0,
          averageCacheHitRate: 0,
          averageSavingsRate: 0,
          totalTokens: { input: 5000, output: 500, cacheRead: 0, cacheCreation: 0, uncachedInput: 5000 },
          cost: {
            uncachedInputCost: 0.015, cacheReadCost: 0, cacheCreationCost: 0,
            outputCost: 0.0075, totalCost: 0.0225, costWithoutCaching: 0.0225,
            savingsUsd: 0, savingsPercent: 0,
          },
        },
      ],
      totals: {
        executionCount: 5, executionsWithCache: 0, cacheAdoptionRate: 0,
        averageCacheHitRate: 0,
        totalTokens: { input: 5000, output: 500, cacheRead: 0, cacheCreation: 0 },
        cost: {
          uncachedInputCost: 0.015, cacheReadCost: 0, cacheCreationCost: 0,
          outputCost: 0.0075, totalCost: 0.0225, costWithoutCaching: 0.0225,
          savingsUsd: 0, savingsPercent: 0,
        },
      },
    };

    const text = CacheObserver.formatSlackSummary(report);
    // Agent section should not include 'guide' since executionsWithCache = 0
    expect(text).not.toContain('guide:');
  });
});

// ─── formatApiSummary ───────────────────────────────────────────────────────

describe('CacheObserver.formatApiSummary', () => {
  it('should produce a compact API-friendly object', () => {
    const report: OrgCacheReport = {
      period: { from: '2026-02-23T00:00:00.000Z', to: '2026-02-24T00:00:00.000Z' },
      generatedAt: '2026-02-24T00:00:00.000Z',
      agents: [
        {
          agent: 'builder',
          period: { from: '2026-02-23T00:00:00.000Z', to: '2026-02-24T00:00:00.000Z' },
          executionCount: 10,
          executionsWithCache: 8,
          cacheAdoptionRate: 80,
          averageCacheHitRate: 0.75,
          averageSavingsRate: 0.6,
          totalTokens: { input: 100000, output: 5000, cacheRead: 75000, cacheCreation: 10000, uncachedInput: 25000 },
          cost: {
            uncachedInputCost: 0.075, cacheReadCost: 0.0225, cacheCreationCost: 0.0375,
            outputCost: 0.075, totalCost: 0.21, costWithoutCaching: 0.375,
            savingsUsd: 0.165, savingsPercent: 44,
          },
        },
      ],
      totals: {
        executionCount: 10, executionsWithCache: 8, cacheAdoptionRate: 80,
        averageCacheHitRate: 0.75,
        totalTokens: { input: 100000, output: 5000, cacheRead: 75000, cacheCreation: 10000 },
        cost: {
          uncachedInputCost: 0.075, cacheReadCost: 0.0225, cacheCreationCost: 0.0375,
          outputCost: 0.075, totalCost: 0.21, costWithoutCaching: 0.375,
          savingsUsd: 0.165, savingsPercent: 44,
        },
      },
    };

    const summary = CacheObserver.formatApiSummary(report);

    expect(summary.period).toEqual(report.period);
    expect(summary.generatedAt).toBe(report.generatedAt);

    const totals = summary.totals as Record<string, unknown>;
    expect(totals.executions).toBe(10);
    expect(totals.cacheAdoptionRate).toBe(80);

    const agents = summary.agents as Array<Record<string, unknown>>;
    expect(agents).toHaveLength(1);
    expect(agents[0].agent).toBe('builder');
    expect(agents[0].cacheHitRate).toBe(0.75);
    expect(agents[0].savingsUsd).toBe(0.165);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('CacheObserver edge cases', () => {
  it('should handle cache read exceeding total input (defensive)', () => {
    const cost = CacheObserver.calculateCost(
      8000,  // input
      500,   // output
      10000, // cache read > input (edge case)
      0,
      ANTHROPIC_PRICING['claude-sonnet-4']!,
    );

    // Uncached should be clamped to 0
    expect(cost.uncachedInputCost).toBe(0);
    expect(cost.totalCost).toBeGreaterThan(0);
  });

  it('should handle very large token counts without overflow', () => {
    const cost = CacheObserver.calculateCost(
      500_000_000, // 500M input tokens
      50_000_000,  // 50M output tokens
      400_000_000, // 400M cache read
      0,
      ANTHROPIC_PRICING['claude-opus-4']!,
    );

    expect(cost.totalCost).toBeGreaterThan(0);
    expect(cost.savingsUsd).toBeGreaterThan(0);
    expect(Number.isFinite(cost.totalCost)).toBe(true);
    expect(Number.isFinite(cost.savingsPercent)).toBe(true);
  });

  it('should produce valid percentages (0-100 range)', () => {
    const cost = CacheObserver.calculateCost(
      10000, 500, 10000, 0,
      ANTHROPIC_PRICING['claude-sonnet-4']!,
    );

    expect(cost.savingsPercent).toBeGreaterThanOrEqual(0);
    expect(cost.savingsPercent).toBeLessThanOrEqual(100);
  });
});
