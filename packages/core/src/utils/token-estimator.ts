/**
 * Token estimation utilities for context budget management.
 *
 * Uses the chars/4 heuristic — fast and accurate enough for threshold checks.
 * Does not call any external API. Safe to call synchronously in hot paths.
 */

import type { LLMMessage } from '../llm/types.js';

/** Approximate characters per token (shared with ContextBuilder). */
const CHARS_PER_TOKEN = 4;

/**
 * Known context window sizes (in tokens) for commonly used models.
 * Used by ContextCompressor to determine when compression is needed.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Claude — all flagship models share the 200k window
  'claude-haiku-4-5-20251001': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-3-haiku-20240307': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,

  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,

  // Google Gemini
  'gemini-2.0-flash': 1_000_000,
  'gemini-1.5-pro': 1_000_000,
  'gemini-1.5-flash': 1_000_000,
};

/** Fallback when a model is not in the known list. Conservative default. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Estimate the token count for a string using the chars/4 heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate total token count across an array of LLM messages.
 * Accounts for both text content and serialized tool call payloads.
 */
export function estimateMessagesTokens(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => {
    let chars = msg.content.length;
    if (msg.toolCalls) {
      chars += JSON.stringify(msg.toolCalls).length;
    }
    return sum + Math.ceil(chars / CHARS_PER_TOKEN);
  }, 0);
}

/**
 * Return the known context window (in tokens) for a model.
 *
 * Precedence:
 * 1. Exact key match in CONTEXT_WINDOWS
 * 2. Partial match (model name contains a key, or key contains model name)
 * 3. DEFAULT_CONTEXT_WINDOW
 */
export function getContextWindow(modelName: string): number {
  if (CONTEXT_WINDOWS[modelName] !== undefined) {
    return CONTEXT_WINDOWS[modelName]!;
  }
  for (const [key, value] of Object.entries(CONTEXT_WINDOWS)) {
    if (modelName.includes(key) || key.includes(modelName)) return value;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
