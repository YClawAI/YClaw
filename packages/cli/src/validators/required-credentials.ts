/**
 * Centralized required-credential derivation (H4).
 * Single source of truth — used by both resolveInitPlan() and doctor.
 */

import type { CliConfig } from '../types.js';

/**
 * Derive which credential env vars are required for a given config.
 */
export function getRequiredCredentials(config: CliConfig): string[] {
  const required: string[] = [];

  // LLM provider key
  const provider = config.llm?.defaultProvider ?? 'anthropic';
  const keyMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const llmKey = keyMap[provider];
  if (llmKey) required.push(llmKey);

  // Channel tokens
  if (config.channels.slack?.enabled) {
    required.push('SLACK_BOT_TOKEN');
  }
  if (config.channels.telegram?.enabled) {
    required.push('TELEGRAM_BOT_TOKEN');
  }
  if (config.channels.discord?.enabled) {
    required.push('DISCORD_BOT_TOKEN');
  }
  if (config.channels.twitter?.enabled) {
    required.push('TWITTER_APP_KEY');
  }

  return required;
}
