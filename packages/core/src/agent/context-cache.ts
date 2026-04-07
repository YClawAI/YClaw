import type { CacheableBlock } from '../llm/types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('context-cache');

/**
 * Cache layer definitions for the 4-tier prompt caching hierarchy.
 *
 * Layer 1 (cached): Global static prompts — mission_statement.md, chain-of-command.md, etc.
 * Layer 2 (cached): Department prompts + agent manifest (YAML config, available actions)
 * Layer 3 (cached): Memory categories (org memory, dept memory, agent memory — semi-static)
 * Layer 4 (NOT cached): Auto-recall snippets + task payload + event data (dynamic per execution)
 */

/** Prompt filenames that belong to Layer 1 (global static). */
const LAYER_1_PROMPTS = new Set([
  'mission_statement.md',
  'chain-of-command.md',
  'protocol-overview.md',
]);

/** Prompt filenames that belong to Layer 2 (department/role). */
const LAYER_2_PROMPT_PATTERNS = [
  'engineering-standards.md',
  'brand-voice.md',
  'daily-standup',
  'workflow.md',
  'claudeception.md',
  'skill-usage.md',
];

/**
 * Classify a prompt filename into its cache layer.
 *
 * Layer 1: Global static (mission, chain-of-command, protocol)
 * Layer 2: Department/role prompts (everything else that's a .md prompt)
 */
export function classifyPromptLayer(filename: string): 1 | 2 {
  if (LAYER_1_PROMPTS.has(filename)) {
    return 1;
  }
  return 2;
}

/**
 * Estimate token count from text content.
 * Uses the ~4 chars per token heuristic for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build cacheable blocks from the system prompt components.
 *
 * This is the core function that segments the assembled system prompt
 * into the 4-layer cache hierarchy for Anthropic prompt caching.
 *
 * @param manifestYaml - The agent manifest YAML string (self-awareness injection)
 * @param promptContents - Map of prompt filename → content
 * @param memoryContent - Assembled memory categories string (org + dept + agent)
 * @param dynamicContent - Auto-recall snippets + task payload + event data
 * @returns Array of CacheableBlock objects with appropriate cache_control markers
 */
export function buildCacheableBlocks(
  manifestYaml: string,
  promptContents: Map<string, string>,
  memoryContent: string | undefined,
  dynamicContent: string | undefined,
): CacheableBlock[] {
  const blocks: CacheableBlock[] = [];

  // ─── Layer 1+2: Static Prompts + Agent Manifest (merged) ────────────
  // Merging Layer 1 (global static) and Layer 2 (department/role) into a
  // single cached block to stay within Anthropic's 4 cache_control block
  // limit. Previously these were 2 separate cached blocks, which combined
  // with Layer 3 (memory) = 3 system blocks, leaving only 1 turn marker
  // budget. Merging frees up 1 slot for conversation turn caching.
  const staticParts: string[] = [];

  // Add agent manifest (YAML config, available actions, org chart)
  if (manifestYaml) {
    staticParts.push(`# Agent Self-Awareness Manifest\n\n${manifestYaml}`);
  }

  // Add all prompts (Layer 1 global + Layer 2 department/role)
  for (const [filename, content] of promptContents) {
    staticParts.push(`--- /app/prompts/${filename} ---\n${content}`);
  }

  if (staticParts.length > 0) {
    const staticText = staticParts.join('\n\n');
    blocks.push({
      text: staticText,
      cacheControl: { type: 'ephemeral' },
      label: 'layer1+2-static',
      estimatedTokens: estimateTokens(staticText),
    });
    logger.debug(
      `Layer 1+2 (static + manifest): ${staticParts.length} parts, ` +
      `~${estimateTokens(staticText)} tokens`,
    );
  }

  // ─── Layer 3: Memory Categories ─────────────────────────────────────
  // Semi-static — changes on Write Gate flush. Cached with ephemeral marker.
  if (memoryContent && memoryContent.trim().length > 0) {
    blocks.push({
      text: memoryContent,
      cacheControl: { type: 'ephemeral' },
      label: 'layer3-memory',
      estimatedTokens: estimateTokens(memoryContent),
    });
    logger.debug(
      `Layer 3 (memory): ~${estimateTokens(memoryContent)} tokens`,
    );
  }

  // ─── Layer 4: Dynamic Content (NOT cached) ──────────────────────────
  // Auto-recall snippets, task payload, event data — changes every execution.
  if (dynamicContent && dynamicContent.trim().length > 0) {
    blocks.push({
      text: dynamicContent,
      // No cacheControl — this is dynamic per execution
      label: 'layer4-dynamic',
      estimatedTokens: estimateTokens(dynamicContent),
    });
    logger.debug(
      `Layer 4 (dynamic): ~${estimateTokens(dynamicContent)} tokens`,
    );
  }

  // Log summary
  const cachedBlocks = blocks.filter(b => b.cacheControl);
  const uncachedBlocks = blocks.filter(b => !b.cacheControl);
  const cachedTokens = cachedBlocks.reduce(
    (sum, b) => sum + (b.estimatedTokens ?? 0), 0,
  );
  const uncachedTokens = uncachedBlocks.reduce(
    (sum, b) => sum + (b.estimatedTokens ?? 0), 0,
  );

  logger.info(
    `Cache hierarchy: ${blocks.length} blocks ` +
    `(${cachedBlocks.length} cached ~${cachedTokens} tokens, ` +
    `${uncachedBlocks.length} uncached ~${uncachedTokens} tokens)`,
  );

  return blocks;
}

/**
 * Merge cacheable blocks into a single system message with cacheableBlocks.
 * This is the bridge between the context builder and the LLM message format.
 *
 * @param blocks - Array of CacheableBlock objects from buildCacheableBlocks
 * @returns A single content string (for fallback) and the blocks array
 */
export function mergeBlocksToSystemContent(
  blocks: CacheableBlock[],
): { content: string; cacheableBlocks: CacheableBlock[] } {
  const content = blocks.map(b => b.text).join('\n\n');
  return { content, cacheableBlocks: blocks };
}
