import type { ToolDefinition } from '../config/schema.js';

/**
 * Anthropic cache_control marker.
 * "ephemeral" is the only supported type — it marks the end of a
 * cacheable prefix block. Anthropic caches everything up to and
 * including this block for 5 minutes (auto-refreshed on hit).
 */
export interface CacheControl {
  type: 'ephemeral';
}

/**
 * A block of content that can be individually cache-controlled.
 * Used to split the system prompt into cacheable layers:
 *
 *   Layer 1+2 (merged): Global static prompts + department prompts + agent manifest
 *            → cache_control: { type: 'ephemeral' }
 *            Merged into a single block to stay within Anthropic's 4 cache_control
 *            block limit. Previously Layer 1 (global) and Layer 2 (department/role)
 *            were separate blocks; merging frees one slot for conversation turn caching.
 *   Layer 3: Memory categories (semi-static, changes on Write Gate flush)
 *            → cache_control: { type: 'ephemeral' }
 *   Layer 4: Auto-recall + task payload (dynamic, no cache)
 *            → no cache_control
 */
export interface CacheableBlock {
  /** Block content (text) */
  text: string;
  /** Cache control marker — set to enable caching up to this block */
  cacheControl?: CacheControl;
  /** Human-readable label for logging (e.g., "layer1+2-static", "layer3-memory") */
  label?: string;
  /** Estimated token count for budget tracking (~4 chars per token) */
  estimatedTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  /**
   * Cache control for this message. When set on a system message,
   * the provider should mark this as a cache breakpoint.
   * Only meaningful for providers that support prompt caching (Anthropic).
   */
  cacheControl?: CacheControl;
  /**
   * Structured content blocks for system messages that need
   * per-block cache control. When present, providers should use
   * these blocks instead of the plain `content` string.
   * Falls back to `content` for providers that don't support blocks.
   */
  cacheableBlocks?: CacheableBlock[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    /**
     * Tokens written to cache on this request.
     * Only populated by providers that support prompt caching (Anthropic).
     * Non-zero means a new cache entry was created.
     */
    cacheCreationInputTokens?: number;
    /**
     * Tokens read from cache on this request.
     * Only populated by providers that support prompt caching (Anthropic).
     * Non-zero means a cache hit occurred — these tokens cost 90% less.
     */
    cacheReadInputTokens?: number;
  };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

/**
 * Aggregated cache performance metrics for a single execution.
 * Used for logging and cost tracking.
 */
export interface CacheMetrics {
  /** Total tokens written to cache across all rounds */
  totalCacheCreationTokens: number;
  /** Total tokens read from cache across all rounds */
  totalCacheReadTokens: number;
  /** Total uncached input tokens across all rounds */
  totalUncachedInputTokens: number;
  /** Cache hit rate: cacheRead / (cacheRead + uncachedInput) */
  cacheHitRate: number;
  /** Estimated cost savings from caching (0.0 to 1.0) */
  estimatedSavingsRate: number;
}

/**
 * Calculate cache metrics from accumulated usage data.
 *
 * Defensive clamping: if totalCacheRead > totalInput (possible with
 * multi-round accumulation rounding), uncached is clamped to 0 and
 * savings rate is clamped to [0, 1].
 */
export function calculateCacheMetrics(
  totalInput: number,
  totalCacheCreation: number,
  totalCacheRead: number,
): CacheMetrics {
  const uncached = Math.max(0, totalInput - totalCacheRead);
  const cacheable = totalCacheRead + uncached;
  const hitRate = cacheable > 0 ? totalCacheRead / cacheable : 0;
  // Cached tokens cost 10% of normal. Savings = 90% of cached tokens / total.
  const rawSavingsRate = totalInput > 0
    ? (totalCacheRead * 0.9) / totalInput
    : 0;
  const savingsRate = Math.min(1, Math.max(0, rawSavingsRate));

  return {
    totalCacheCreationTokens: totalCacheCreation,
    totalCacheReadTokens: totalCacheRead,
    totalUncachedInputTokens: uncached,
    cacheHitRate: Math.round(Math.min(1, hitRate) * 1000) / 1000,
    estimatedSavingsRate: Math.round(savingsRate * 1000) / 1000,
  };
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stopSequences?: string[];
  /**
   * Cache_control strategy for conversation turns (Anthropic only; others ignore this).
   *
   * - 'system_and_3': The system prompt is already cached via cacheableBlocks.
   *   Additionally mark the last message before each of the first 3 new assistant
   *   turns with cache_control: { type: 'ephemeral' }, creating up to 3 cache
   *   checkpoints in the conversation body.
   */
  cacheStrategy?: 'system_and_3';
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: LLMMessage[], options: LLMOptions): Promise<LLMResponse>;
}
