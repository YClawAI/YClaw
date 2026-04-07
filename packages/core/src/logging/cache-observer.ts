import type { AuditLog, CacheStats } from './audit.js';
import type { ExecutionRecord } from '../config/schema.js';
import { createLogger } from './logger.js';

const logger = createLogger('cache-observer');

// ─── Anthropic Pricing (per million tokens) ─────────────────────────────────
//
// Source: https://docs.anthropic.com/en/docs/about-claude/models
// Prices are in USD per 1M tokens. Cache read = 10% of input price.
// Cache creation = 25% surcharge on input price.

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreationPerMillion: number;
}

/**
 * Known Anthropic model pricing. Keys are model ID prefixes.
 * When a model ID starts with a key, that pricing applies.
 */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheCreationPerMillion: 18.75,
  },
  'claude-sonnet-4': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheCreationPerMillion: 3.75,
  },
  'claude-haiku': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheCreationPerMillion: 1,
  },
};

/** Fallback pricing when model is unknown (uses Sonnet pricing). */
const DEFAULT_PRICING: ModelPricing = ANTHROPIC_PRICING['claude-sonnet-4']!;

// ─── Cost Breakdown ─────────────────────────────────────────────────────────

export interface CostBreakdown {
  /** Cost of uncached input tokens */
  uncachedInputCost: number;
  /** Cost of cache read tokens (90% discount) */
  cacheReadCost: number;
  /** Cost of cache creation tokens (25% surcharge) */
  cacheCreationCost: number;
  /** Cost of output tokens */
  outputCost: number;
  /** Total actual cost */
  totalCost: number;
  /** What the cost would have been without caching */
  costWithoutCaching: number;
  /** Absolute savings in USD */
  savingsUsd: number;
  /** Savings as a percentage (0-100) */
  savingsPercent: number;
}

// ─── Agent Cache Report ─────────────────────────────────────────────────────

export interface AgentCacheReport {
  agent: string;
  period: { from: string; to: string };
  executionCount: number;
  executionsWithCache: number;
  cacheAdoptionRate: number;
  averageCacheHitRate: number;
  averageSavingsRate: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    uncachedInput: number;
  };
  cost: CostBreakdown;
}

// ─── Organization Cache Report ──────────────────────────────────────────────

export interface OrgCacheReport {
  period: { from: string; to: string };
  generatedAt: string;
  agents: AgentCacheReport[];
  totals: {
    executionCount: number;
    executionsWithCache: number;
    cacheAdoptionRate: number;
    averageCacheHitRate: number;
    totalTokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    cost: CostBreakdown;
  };
}

// ─── Cache Observer ─────────────────────────────────────────────────────────

export class CacheObserver {
  constructor(private auditLog: AuditLog) {}

  /**
   * Get pricing for a model ID. Matches by prefix.
   */
  static getPricing(modelId: string): ModelPricing {
    for (const [prefix, pricing] of Object.entries(ANTHROPIC_PRICING)) {
      if (modelId.startsWith(prefix)) return pricing;
    }
    return DEFAULT_PRICING;
  }

  /**
   * Calculate cost breakdown for a set of token counts.
   */
  static calculateCost(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreationTokens: number,
    pricing: ModelPricing,
  ): CostBreakdown {
    const uncachedInput = Math.max(
      0,
      inputTokens - cacheReadTokens,
    );

    const uncachedInputCost =
      (uncachedInput / 1_000_000) * pricing.inputPerMillion;
    const cacheReadCost =
      (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
    const cacheCreationCost =
      (cacheCreationTokens / 1_000_000) * pricing.cacheCreationPerMillion;
    const outputCost =
      (outputTokens / 1_000_000) * pricing.outputPerMillion;

    const totalCost =
      uncachedInputCost + cacheReadCost + cacheCreationCost + outputCost;

    // What it would cost without caching (all input at full price)
    const costWithoutCaching =
      (inputTokens / 1_000_000) * pricing.inputPerMillion + outputCost;

    const savingsUsd = Math.max(0, costWithoutCaching - totalCost);
    const savingsPercent =
      costWithoutCaching > 0
        ? Math.round((savingsUsd / costWithoutCaching) * 10000) / 100
        : 0;

    return {
      uncachedInputCost: round6(uncachedInputCost),
      cacheReadCost: round6(cacheReadCost),
      cacheCreationCost: round6(cacheCreationCost),
      outputCost: round6(outputCost),
      totalCost: round6(totalCost),
      costWithoutCaching: round6(costWithoutCaching),
      savingsUsd: round6(savingsUsd),
      savingsPercent,
    };
  }

  /**
   * Generate a cache performance report for a single agent.
   */
  async getAgentReport(
    agentName: string,
    from?: Date,
    to?: Date,
    modelId?: string,
  ): Promise<AgentCacheReport> {
    const history = await this.auditLog.getAgentHistory(agentName, 500);
    const period = {
      from: (from ?? new Date(Date.now() - 24 * 60 * 60 * 1000)).toISOString(),
      to: (to ?? new Date()).toISOString(),
    };

    const filtered = filterByPeriod(history, period.from, period.to);
    const pricing = CacheObserver.getPricing(modelId ?? 'claude-sonnet-4');

    return this.buildAgentReport(agentName, filtered, period, pricing);
  }

  /**
   * Generate an organization-wide cache report across all agents.
   */
  async getOrgReport(
    agentNames: string[],
    from?: Date,
    to?: Date,
  ): Promise<OrgCacheReport> {
    const period = {
      from: (from ?? new Date(Date.now() - 24 * 60 * 60 * 1000)).toISOString(),
      to: (to ?? new Date()).toISOString(),
    };

    const agentReports: AgentCacheReport[] = [];

    for (const agent of agentNames) {
      try {
        const report = await this.getAgentReport(agent, from, to);
        agentReports.push(report);
      } catch (err) {
        logger.warn(`Failed to get cache report for ${agent}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const totals = this.aggregateReports(agentReports);

    return {
      period,
      generatedAt: new Date().toISOString(),
      agents: agentReports,
      totals,
    };
  }

  /**
   * Format a report as a Slack-friendly summary string.
   */
  static formatSlackSummary(report: OrgCacheReport): string {
    const t = report.totals;
    const lines: string[] = [
      `📊 *Cache Performance Report*`,
      `Period: ${formatDate(report.period.from)} → ${formatDate(report.period.to)}`,
      '',
      `*Totals*`,
      `• Executions: ${t.executionCount} (${t.executionsWithCache} with cache, ${t.cacheAdoptionRate}% adoption)`,
      `• Avg hit rate: ${(t.averageCacheHitRate * 100).toFixed(1)}%`,
      `• Tokens cached: ${formatNumber(t.totalTokens.cacheRead)} read, ${formatNumber(t.totalTokens.cacheCreation)} created`,
      '',
      `*Cost*`,
      `• Actual: $${t.cost.totalCost.toFixed(4)}`,
      `• Without caching: $${t.cost.costWithoutCaching.toFixed(4)}`,
      `• Saved: $${t.cost.savingsUsd.toFixed(4)} (${t.cost.savingsPercent}%)`,
    ];

    if (report.agents.length > 0) {
      lines.push('', '*Per Agent*');
      for (const a of report.agents) {
        if (a.executionsWithCache === 0) continue;
        lines.push(
          `• ${a.agent}: ${(a.averageCacheHitRate * 100).toFixed(1)}% hit rate, ` +
          `$${a.cost.savingsUsd.toFixed(4)} saved (${a.cost.savingsPercent}%)`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a report as a compact JSON-friendly summary for API responses.
   */
  static formatApiSummary(report: OrgCacheReport): Record<string, unknown> {
    return {
      period: report.period,
      generatedAt: report.generatedAt,
      totals: {
        executions: report.totals.executionCount,
        executionsWithCache: report.totals.executionsWithCache,
        cacheAdoptionRate: report.totals.cacheAdoptionRate,
        averageCacheHitRate: report.totals.averageCacheHitRate,
        tokens: report.totals.totalTokens,
        cost: report.totals.cost,
      },
      agents: report.agents.map(a => ({
        agent: a.agent,
        executions: a.executionCount,
        cacheHitRate: a.averageCacheHitRate,
        savingsUsd: a.cost.savingsUsd,
        savingsPercent: a.cost.savingsPercent,
      })),
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private buildAgentReport(
    agentName: string,
    executions: ExecutionRecord[],
    period: { from: string; to: string },
    pricing: ModelPricing,
  ): AgentCacheReport {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let executionsWithCache = 0;
    let hitRateSum = 0;
    let savingsRateSum = 0;

    for (const exec of executions) {
      const usage = exec.tokenUsage;
      if (!usage) continue;

      totalInput += usage.input;
      totalOutput += usage.output;

      const hasCache =
        (usage.cacheReadInputTokens ?? 0) > 0 ||
        (usage.cacheCreationInputTokens ?? 0) > 0;

      if (hasCache) {
        executionsWithCache++;
        totalCacheRead += usage.cacheReadInputTokens ?? 0;
        totalCacheCreation += usage.cacheCreationInputTokens ?? 0;
        hitRateSum += usage.cacheHitRate ?? 0;
        savingsRateSum += usage.estimatedSavingsRate ?? 0;
      }
    }

    const uncachedInput = Math.max(0, totalInput - totalCacheRead);
    const avgHitRate = executionsWithCache > 0
      ? Math.round((hitRateSum / executionsWithCache) * 1000) / 1000
      : 0;
    const avgSavingsRate = executionsWithCache > 0
      ? Math.round((savingsRateSum / executionsWithCache) * 1000) / 1000
      : 0;

    const cost = CacheObserver.calculateCost(
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheCreation,
      pricing,
    );

    return {
      agent: agentName,
      period,
      executionCount: executions.length,
      executionsWithCache,
      cacheAdoptionRate: executions.length > 0
        ? Math.round((executionsWithCache / executions.length) * 100)
        : 0,
      averageCacheHitRate: avgHitRate,
      averageSavingsRate: avgSavingsRate,
      totalTokens: {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheCreation: totalCacheCreation,
        uncachedInput,
      },
      cost,
    };
  }

  private aggregateReports(
    reports: AgentCacheReport[],
  ): OrgCacheReport['totals'] {
    let totalExec = 0;
    let totalWithCache = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let hitRateWeightedSum = 0;
    let totalCostActual = 0;
    let totalCostWithout = 0;

    for (const r of reports) {
      totalExec += r.executionCount;
      totalWithCache += r.executionsWithCache;
      totalInput += r.totalTokens.input;
      totalOutput += r.totalTokens.output;
      totalCacheRead += r.totalTokens.cacheRead;
      totalCacheCreation += r.totalTokens.cacheCreation;
      hitRateWeightedSum += r.averageCacheHitRate * r.executionsWithCache;
      totalCostActual += r.cost.totalCost;
      totalCostWithout += r.cost.costWithoutCaching;
    }

    const avgHitRate = totalWithCache > 0
      ? Math.round((hitRateWeightedSum / totalWithCache) * 1000) / 1000
      : 0;

    const savingsUsd = Math.max(0, totalCostWithout - totalCostActual);
    const savingsPercent = totalCostWithout > 0
      ? Math.round((savingsUsd / totalCostWithout) * 10000) / 100
      : 0;

    return {
      executionCount: totalExec,
      executionsWithCache: totalWithCache,
      cacheAdoptionRate: totalExec > 0
        ? Math.round((totalWithCache / totalExec) * 100)
        : 0,
      averageCacheHitRate: avgHitRate,
      totalTokens: {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheCreation: totalCacheCreation,
      },
      cost: {
        uncachedInputCost: round6(totalCostActual - reports.reduce((s, r) => s + r.cost.cacheReadCost + r.cost.cacheCreationCost + r.cost.outputCost, 0)),
        cacheReadCost: round6(reports.reduce((s, r) => s + r.cost.cacheReadCost, 0)),
        cacheCreationCost: round6(reports.reduce((s, r) => s + r.cost.cacheCreationCost, 0)),
        outputCost: round6(reports.reduce((s, r) => s + r.cost.outputCost, 0)),
        totalCost: round6(totalCostActual),
        costWithoutCaching: round6(totalCostWithout),
        savingsUsd: round6(savingsUsd),
        savingsPercent,
      },
    };
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────

function filterByPeriod(
  executions: ExecutionRecord[],
  from: string,
  to: string,
): ExecutionRecord[] {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  return executions.filter(e => {
    const ts = new Date(e.startedAt).getTime();
    return ts >= fromMs && ts <= toMs;
  });
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
