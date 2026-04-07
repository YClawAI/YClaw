import type { LLMResponse, CacheMetrics } from '../llm/types.js';
import { calculateCacheMetrics } from '../llm/types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('execution-cache');

/**
 * Accumulates cache metrics across multiple LLM rounds within a single
 * agent execution. Each tool-use conversation may involve 3-10+ LLM calls;
 * this tracker aggregates the cache performance across all of them.
 *
 * Usage:
 *   const tracker = new ExecutionCacheTracker(agentName, taskName);
 *   // After each LLM call:
 *   tracker.recordRound(response);
 *   // At execution end:
 *   const metrics = tracker.finalize();
 */
export class ExecutionCacheTracker {
  private rounds: RoundMetrics[] = [];
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheCreationTokens = 0;
  private totalCacheReadTokens = 0;

  constructor(
    private readonly agentName: string,
    private readonly taskName: string,
  ) {}

  /**
   * Record metrics from a single LLM response round.
   */
  recordRound(response: LLMResponse): void {
    const round: RoundMetrics = {
      roundNumber: this.rounds.length + 1,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheCreationTokens: response.usage.cacheCreationInputTokens ?? 0,
      cacheReadTokens: response.usage.cacheReadInputTokens ?? 0,
    };

    this.rounds.push(round);
    this.totalInputTokens += round.inputTokens;
    this.totalOutputTokens += round.outputTokens;
    this.totalCacheCreationTokens += round.cacheCreationTokens;
    this.totalCacheReadTokens += round.cacheReadTokens;

    // Log per-round cache activity for debugging
    if (round.cacheCreationTokens > 0 || round.cacheReadTokens > 0) {
      const hitRate = round.inputTokens > 0
        ? Math.round((round.cacheReadTokens / round.inputTokens) * 100)
        : 0;
      logger.debug(
        `[${this.agentName}/${this.taskName}] Round ${round.roundNumber}: ` +
        `${round.cacheReadTokens} cached read, ` +
        `${round.cacheCreationTokens} cached write, ` +
        `${round.inputTokens} total input (${hitRate}% hit)`,
      );
    }
  }

  /**
   * Finalize and return aggregated cache metrics for the entire execution.
   * Logs a summary and returns the metrics for storage in the audit log.
   */
  finalize(): ExecutionCacheResult {
    const metrics = calculateCacheMetrics(
      this.totalInputTokens,
      this.totalCacheCreationTokens,
      this.totalCacheReadTokens,
    );

    // Estimate cost savings in dollars (approximate)
    // Anthropic pricing: ~$3/M input tokens for Sonnet, ~$15/M for Opus
    // Cached tokens cost 10% of normal price → 90% savings on cached tokens
    const estimatedSavingsDollars = this.estimateCostSavings(metrics);

    const result: ExecutionCacheResult = {
      agentName: this.agentName,
      taskName: this.taskName,
      totalRounds: this.rounds.length,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      cacheMetrics: metrics,
      estimatedSavingsDollars,
      rounds: this.rounds,
    };

    this.logSummary(result);
    return result;
  }

  /**
   * Get current accumulated metrics without finalizing.
   * Useful for mid-execution monitoring.
   */
  getCurrentMetrics(): CacheMetrics {
    return calculateCacheMetrics(
      this.totalInputTokens,
      this.totalCacheCreationTokens,
      this.totalCacheReadTokens,
    );
  }

  /**
   * Get the number of rounds recorded so far.
   */
  get roundCount(): number {
    return this.rounds.length;
  }

  /**
   * Estimate cost savings in USD based on cache hit rate.
   * Uses approximate Anthropic pricing tiers.
   */
  private estimateCostSavings(metrics: CacheMetrics): number {
    // Base rate: ~$3/M tokens for Sonnet (most common model)
    // Cache read: 10% of base rate → $0.30/M tokens
    // Savings per cached token: $2.70/M tokens
    const SAVINGS_PER_MILLION_TOKENS = 2.70;
    const savings =
      (metrics.totalCacheReadTokens / 1_000_000) * SAVINGS_PER_MILLION_TOKENS;
    return Math.round(savings * 10000) / 10000; // 4 decimal places
  }

  /**
   * Log a human-readable summary of cache performance.
   */
  private logSummary(result: ExecutionCacheResult): void {
    const { cacheMetrics: m } = result;

    if (result.totalRounds === 0) {
      logger.info(
        `[${this.agentName}/${this.taskName}] No LLM rounds recorded`,
      );
      return;
    }

    const hitPct = Math.round(m.cacheHitRate * 100);
    const savingsPct = Math.round(m.estimatedSavingsRate * 100);

    logger.info(
      `[${this.agentName}/${this.taskName}] Execution cache summary: ` +
      `${result.totalRounds} rounds, ` +
      `${result.totalInputTokens} input tokens, ` +
      `${m.totalCacheReadTokens} cached read (${hitPct}% hit rate), ` +
      `${m.totalCacheCreationTokens} cached write, ` +
      `~${savingsPct}% cost savings (~$${result.estimatedSavingsDollars})`,
    );

    // Warn if cache hit rate is unexpectedly low after first round
    if (result.totalRounds > 1 && m.cacheHitRate < 0.3) {
      logger.warn(
        `[${this.agentName}/${this.taskName}] Low cache hit rate (${hitPct}%) ` +
        `across ${result.totalRounds} rounds. Check cache layer boundaries.`,
      );
    }
  }
}

/**
 * Metrics for a single LLM round within an execution.
 */
export interface RoundMetrics {
  roundNumber: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Complete cache performance result for an entire execution.
 * Stored in the audit log for cost tracking and observability.
 */
export interface ExecutionCacheResult {
  agentName: string;
  taskName: string;
  totalRounds: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheMetrics: CacheMetrics;
  estimatedSavingsDollars: number;
  rounds: RoundMetrics[];
}

/**
 * Format cache metrics for inclusion in standup reports.
 * Returns a human-readable summary string.
 */
export function formatCacheMetricsForReport(
  result: ExecutionCacheResult,
): string {
  const { cacheMetrics: m } = result;
  const hitPct = Math.round(m.cacheHitRate * 100);
  const savingsPct = Math.round(m.estimatedSavingsRate * 100);

  return (
    `Cache: ${hitPct}% hit rate across ${result.totalRounds} rounds | ` +
    `${m.totalCacheReadTokens.toLocaleString()} tokens cached | ` +
    `~${savingsPct}% cost savings (~$${result.estimatedSavingsDollars})`
  );
}

/**
 * Convert ExecutionCacheResult to the TokenUsage schema format
 * for storage in the execution record.
 */
export function toTokenUsage(
  result: ExecutionCacheResult,
): {
  input: number;
  output: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheHitRate: number;
  estimatedSavingsRate: number;
} {
  return {
    input: result.totalInputTokens,
    output: result.totalOutputTokens,
    cacheCreationInputTokens: result.cacheMetrics.totalCacheCreationTokens,
    cacheReadInputTokens: result.cacheMetrics.totalCacheReadTokens,
    cacheHitRate: result.cacheMetrics.cacheHitRate,
    estimatedSavingsRate: result.cacheMetrics.estimatedSavingsRate,
  };
}
