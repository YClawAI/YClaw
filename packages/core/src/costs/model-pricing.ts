// ─── Model Pricing Table ─────────────────────────────────────────────────────
//
// Prices in USD per million tokens.
// Cache read = 10% of input price, cache write = 125% of input price.

export interface ModelPricingEntry {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const MODEL_PRICING: Record<string, ModelPricingEntry> = {
  // Anthropic — exact model IDs first (longer, more specific)
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  // Prefix fallbacks (shorter, less specific — matched after exact)
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

const DEFAULT_PRICING: ModelPricingEntry = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

export function getPricing(modelId: string): ModelPricingEntry {
  // Exact match first
  const exact = MODEL_PRICING[modelId];
  if (exact !== undefined) return exact;
  // Prefix match — sort by prefix length descending so the most-specific prefix wins
  const sorted = Object.entries(MODEL_PRICING).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, pricing] of sorted) {
    if (modelId.startsWith(prefix)) return pricing;
  }
  return DEFAULT_PRICING;
}

/**
 * Compute cost in millicents (1/10th of a cent) from token counts.
 *
 * We track in millicents internally to avoid rounding sub-cent costs to zero.
 * A Haiku call with 100 input + 50 output tokens costs ~0.00012¢ — which rounds
 * to 0 in integer cents but is correctly represented as 0 millicents only when
 * truly zero. Use `millicentsToDisplay()` to convert for display.
 *
 * Note: TOCTOU race condition — two concurrent executions for the same agent can
 * both pass the budget check before either records cost. With 13 agents this is
 * unlikely to cause real damage (worst case: one extra execution over budget).
 * A future improvement could use a Lua script for atomic check-and-reserve.
 */
export function computeCostMillicents(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  const p = getPricing(modelId);
  // Uncached input = total input minus cached reads
  const uncachedInput = Math.max(0, inputTokens - cacheReadTokens);
  const costDollars =
    (uncachedInput / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    (cacheWriteTokens / 1_000_000) * p.cacheWrite;
  // Millicents = dollars * 100_000 (100 cents/dollar * 1000 millicents/cent)
  return Math.round(costDollars * 100_000);
}

/**
 * Convert millicents to integer cents for display / budget comparison.
 * Uses ceiling so no cost is ever displayed as zero when tokens were consumed.
 */
export function millicentsToDisplayCents(millicents: number): number {
  return Math.ceil(millicents / 1000);
}

/**
 * Compute cost in integer cents from token counts.
 * Internally uses millicents to avoid undercounting small calls.
 * Uses Math.ceil so no cost is ever recorded as zero when tokens were consumed.
 *
 * @deprecated Prefer computeCostMillicents for internal tracking.
 */
export function computeCostCents(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  return millicentsToDisplayCents(
    computeCostMillicents(modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
  );
}
