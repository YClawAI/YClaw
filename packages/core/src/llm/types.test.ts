import { describe, it, expect } from 'vitest';
import { calculateCacheMetrics } from './types.js';
import type {
  CacheableBlock,
  CacheControl,
  CacheMetrics,
  LLMMessage,
  LLMResponse,
} from './types.js';

describe('CacheableBlock', () => {
  it('should accept a block with cache control', () => {
    const block: CacheableBlock = {
      text: 'Global static prompt content',
      cacheControl: { type: 'ephemeral' },
      label: 'global-prompts',
      estimatedTokens: 2500,
    };
    expect(block.cacheControl?.type).toBe('ephemeral');
    expect(block.label).toBe('global-prompts');
  });

  it('should accept a block without cache control', () => {
    const block: CacheableBlock = {
      text: 'Dynamic auto-recall content',
    };
    expect(block.cacheControl).toBeUndefined();
  });
});

describe('LLMMessage cache fields', () => {
  it('should accept cacheControl on a system message', () => {
    const msg: LLMMessage = {
      role: 'system',
      content: 'System prompt text',
      cacheControl: { type: 'ephemeral' },
    };
    expect(msg.cacheControl?.type).toBe('ephemeral');
  });

  it('should accept cacheableBlocks on a system message', () => {
    const msg: LLMMessage = {
      role: 'system',
      content: '',
      cacheableBlocks: [
        {
          text: 'Layer 1: Global prompts',
          cacheControl: { type: 'ephemeral' },
          label: 'global',
        },
        {
          text: 'Layer 2: Department prompts',
          cacheControl: { type: 'ephemeral' },
          label: 'department',
        },
        {
          text: 'Layer 3: Dynamic content',
          label: 'dynamic',
        },
      ],
    };
    expect(msg.cacheableBlocks).toHaveLength(3);
    expect(msg.cacheableBlocks![0].cacheControl).toBeDefined();
    expect(msg.cacheableBlocks![2].cacheControl).toBeUndefined();
  });

  it('should not require cache fields on non-system messages', () => {
    const msg: LLMMessage = {
      role: 'user',
      content: 'Hello',
    };
    expect(msg.cacheControl).toBeUndefined();
    expect(msg.cacheableBlocks).toBeUndefined();
  });
});

describe('LLMResponse cache usage fields', () => {
  it('should include cache metrics when present', () => {
    const response: LLMResponse = {
      content: 'Response text',
      toolCalls: [],
      usage: {
        inputTokens: 10000,
        outputTokens: 500,
        cacheCreationInputTokens: 8000,
        cacheReadInputTokens: 0,
      },
      stopReason: 'end_turn',
    };
    expect(response.usage.cacheCreationInputTokens).toBe(8000);
    expect(response.usage.cacheReadInputTokens).toBe(0);
  });

  it('should work without cache metrics (backward compat)', () => {
    const response: LLMResponse = {
      content: 'Response text',
      toolCalls: [],
      usage: {
        inputTokens: 10000,
        outputTokens: 500,
      },
      stopReason: 'end_turn',
    };
    expect(response.usage.cacheCreationInputTokens).toBeUndefined();
    expect(response.usage.cacheReadInputTokens).toBeUndefined();
  });
});

describe('calculateCacheMetrics', () => {
  it('should calculate metrics for a cache hit scenario', () => {
    // 10000 input, 8000 from cache, 2000 uncached
    const metrics = calculateCacheMetrics(10000, 0, 8000);
    expect(metrics.totalCacheReadTokens).toBe(8000);
    expect(metrics.totalUncachedInputTokens).toBe(2000);
    expect(metrics.cacheHitRate).toBe(0.8);
    // Savings: 8000 * 0.9 / 10000 = 0.72
    expect(metrics.estimatedSavingsRate).toBe(0.72);
  });

  it('should calculate metrics for a cache miss (creation)', () => {
    // First request: all tokens are new, written to cache
    const metrics = calculateCacheMetrics(10000, 8000, 0);
    expect(metrics.totalCacheCreationTokens).toBe(8000);
    expect(metrics.totalCacheReadTokens).toBe(0);
    expect(metrics.totalUncachedInputTokens).toBe(10000);
    expect(metrics.cacheHitRate).toBe(0);
    expect(metrics.estimatedSavingsRate).toBe(0);
  });

  it('should calculate metrics for mixed cache hit/creation', () => {
    // Some from cache, some new
    const metrics = calculateCacheMetrics(15000, 3000, 10000);
    expect(metrics.totalCacheReadTokens).toBe(10000);
    expect(metrics.totalUncachedInputTokens).toBe(5000);
    // hitRate: 10000 / (10000 + 5000) = 0.667
    expect(metrics.cacheHitRate).toBe(0.667);
    // savings: 10000 * 0.9 / 15000 = 0.6
    expect(metrics.estimatedSavingsRate).toBe(0.6);
  });

  it('should handle zero input tokens', () => {
    const metrics = calculateCacheMetrics(0, 0, 0);
    expect(metrics.cacheHitRate).toBe(0);
    expect(metrics.estimatedSavingsRate).toBe(0);
    expect(metrics.totalUncachedInputTokens).toBe(0);
  });

  it('should handle 100% cache hit', () => {
    const metrics = calculateCacheMetrics(10000, 0, 10000);
    expect(metrics.cacheHitRate).toBe(1);
    expect(metrics.estimatedSavingsRate).toBe(0.9);
    expect(metrics.totalUncachedInputTokens).toBe(0);
  });

  it('should clamp uncached to 0 when totalCacheRead > totalInput', () => {
    // Edge case: provider reports more cache reads than total input
    const metrics = calculateCacheMetrics(8000, 0, 10000);
    expect(metrics.totalUncachedInputTokens).toBe(0);
    expect(metrics.cacheHitRate).toBe(1);
    // Savings capped: 10000 * 0.9 / 8000 = 1.125, but rate is per totalInput
    expect(metrics.estimatedSavingsRate).toBe(1);
  });
});
