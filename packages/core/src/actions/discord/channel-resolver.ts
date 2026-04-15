/**
 * Channel resolution for Discord executor.
 *
 * Resolves symbolic channel names (from env-var routing or agent-to-department
 * mapping) and raw Discord snowflake IDs to their canonical channel IDs.
 */

import { createLogger } from '../../logging/logger.js';
import { getChannelForDepartment, getChannelForAgent } from '../../utils/channel-routing.js';
import type { Department } from '../../utils/channel-routing.js';

const logger = createLogger('discord:channel-resolver');

/**
 * Resolve a symbolic channel name or raw Discord snowflake ID to a channel ID.
 *
 * Resolution order:
 *   1. Raw snowflake (17–20 digit string) — accepted as-is.
 *   2. DISCORD_CHANNEL_<DEPT> env-var lookup.
 *   3. Agent name → department → channel mapping.
 *   4. Fallback to the `general` channel (logs a warning when triggered).
 *
 * Throws only if even the general channel is unconfigured.
 */
export function resolveChannelId(input: string): string {
  const trimmed = input.trim();

  // 1. Raw Discord snowflake — accept as-is (highest priority so enforcement
  //    overrides aren't re-interpreted by name-based lookups).
  if (/^\d{17,20}$/.test(trimmed)) return trimmed;

  // 2. Env-var-based routing (DISCORD_CHANNEL_<DEPT>)
  const fromEnv = getChannelForDepartment(trimmed as Department, 'discord');
  if (fromEnv) return fromEnv;

  // 3. Agent name → department → channel
  const fromAgent = getChannelForAgent(trimmed, 'discord');
  if (fromAgent) return fromAgent;

  // 4. Last resort: general channel (with warning)
  const general = getChannelForDepartment('general', 'discord');
  if (general) {
    logger.warn('Channel not found, falling back to general', { input: trimmed });
    return general;
  }

  throw new Error(
    `Unknown Discord channel: "${input}". Set DISCORD_CHANNEL_<DEPT> env vars or use a snowflake ID.`,
  );
}
