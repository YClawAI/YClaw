/**
 * Rate limiting and dedup fingerprinting for Discord executor.
 *
 * Enforces:
 *   - 30s per-channel cooldown per agent (top-level messages)
 *   - 15s per-thread cooldown per agent (thread replies)
 *   - 20 messages/hour/agent global cap
 *   - 1h dedup window (semantic fingerprinting)
 *
 * All checks fail open when Redis is unavailable.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('discord:rate-limiter');

/** Per-agent, per-channel cooldown for top-level messages (seconds). */
const CHANNEL_COOLDOWN_S = 30;
/** Per-agent, per-thread cooldown for thread replies (seconds). */
const THREAD_COOLDOWN_S = 15;
/** Global per-agent hourly cap. */
const HOURLY_CAP = 20;
const HOURLY_WINDOW_S = 3600;
/** Dedup window (seconds). */
const DEDUP_TTL_S = 3600;

const DEDUP_PREFIX = 'discord:dedup:';
const COOLDOWN_PREFIX = 'discord:cooldown:';
const COOLDOWN_THREAD_PREFIX = 'discord:cooldown:thread:';
const HOURLY_PREFIX = 'discord:hourly:';

function hourBucket(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCHours()}`;
}

/**
 * Compute a semantic fingerprint of a (channel, text) pair.
 *
 * Normalizes volatile substrings (UUIDs, timestamps, task IDs, commit SHAs,
 * Discord snowflakes) so that semantically identical messages collapse to the
 * same key. Derived from SlackExecutor.fingerprint.
 */
export function fingerprint(channel: string, text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/dep-\d+-[a-z0-9]+/g, 'dep-ID')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
    .replace(/\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}[:\d.]*/g, 'TIMESTAMP')
    .replace(/`[a-f0-9]{7,12}`/g, '`COMMIT`')
    .replace(/\d{2}:\d{2}(:\d{2})?(\.\d+)?/g, 'TIME')
    .replace(/\d+ (task|minute|hour|day|pr|issue)/g, 'N $1')
    .replace(/\b\d{17,20}\b/g, 'SNOWFLAKE')
    .trim();
  return createHash('sha256').update(`${channel}:${normalized}`).digest('hex').slice(0, 32);
}

/**
 * Returns true if the (channelId, text) pair is a duplicate within the dedup
 * window. Fails open (returns false) when Redis is unavailable.
 */
export async function isDuplicate(
  channelId: string,
  text: string,
  redis: Redis | null,
): Promise<boolean> {
  if (!redis) return false;
  const fp = fingerprint(channelId, text);
  const key = `${DEDUP_PREFIX}${fp}`;
  try {
    const result = await redis.set(key, Date.now().toString(), 'EX', DEDUP_TTL_S, 'NX');
    return result === null;
  } catch (err) {
    logger.warn('Discord dedup check failed, allowing message', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false; // fail-open
  }
}

// ─── Lua rate-limit script (shared by channel + thread paths) ───────────────

const RATE_LIMIT_SCRIPT = `
  local hourCount = tonumber(redis.call('GET', KEYS[1]) or '0')
  if hourCount >= tonumber(ARGV[1]) then
    return 'hourly_cap'
  end

  local cooldownSet = redis.call('SET', KEYS[2], '1', 'EX', ARGV[2], 'NX')
  if not cooldownSet then
    return 'cooldown'
  end

  local newHourCount = redis.call('INCR', KEYS[1])
  if newHourCount == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[3])
  end

  return 'ok'
`;

async function checkRateLimits(
  agentName: string,
  cooldownKey: string,
  cooldownSeconds: number,
  cooldownMessage: string,
  failureLogMessage: string,
  redis: Redis,
): Promise<string | null> {
  const hourKey = `${HOURLY_PREFIX}${agentName}:${hourBucket()}`;
  try {
    const result = await redis.eval(
      RATE_LIMIT_SCRIPT,
      2,
      hourKey,
      cooldownKey,
      HOURLY_CAP.toString(),
      cooldownSeconds.toString(),
      HOURLY_WINDOW_S.toString(),
    );

    if (result === 'ok') return null;
    if (result === 'hourly_cap') {
      return `global hourly cap of ${HOURLY_CAP} msgs reached for ${agentName}`;
    }
    if (result === 'cooldown') {
      return cooldownMessage;
    }
    logger.warn('Discord rate-limit script returned unexpected result, allowing message (fail-open)', {
      agentName,
      result,
    });
    return null;
  } catch (err) {
    logger.warn(failureLogMessage, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null; // fail-open
  }
}

/**
 * Check channel-level rate limits (30s cooldown + hourly cap).
 * Returns null on pass, or a reason string on rejection.
 * Fails open if Redis is null.
 */
export async function checkChannelRateLimits(
  agentName: string,
  channelId: string,
  redis: Redis | null,
): Promise<string | null> {
  if (!redis) return null;
  return checkRateLimits(
    agentName,
    `${COOLDOWN_PREFIX}${agentName}:${channelId}`,
    CHANNEL_COOLDOWN_S,
    `channel cooldown active (${CHANNEL_COOLDOWN_S}s) for ${agentName} in ${channelId}`,
    'Discord rate-limit check failed, allowing message (fail-open)',
    redis,
  );
}

/**
 * Check thread-level rate limits (15s cooldown + hourly cap).
 * Returns null on pass, or a reason string on rejection.
 * Fails open if Redis is null.
 */
export async function checkThreadRateLimits(
  agentName: string,
  threadId: string,
  redis: Redis | null,
): Promise<string | null> {
  if (!redis) return null;
  return checkRateLimits(
    agentName,
    `${COOLDOWN_THREAD_PREFIX}${agentName}:${threadId}`,
    THREAD_COOLDOWN_S,
    `thread cooldown active (${THREAD_COOLDOWN_S}s) for ${agentName} in ${threadId}`,
    'Discord thread rate-limit check failed, allowing message (fail-open)',
    redis,
  );
}
