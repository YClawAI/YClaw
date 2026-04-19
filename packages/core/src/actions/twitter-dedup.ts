/**
 * Twitter Post Dedup Gate — Issue #144
 *
 * Prevents Ember from posting near-identical content simultaneously or within
 * a short window. Before any twitter:post or twitter:thread action is executed,
 * the gate:
 *   1. Normalises and fingerprints the post content
 *   2. Checks for an exact match (SHA-256 hash) against recent posts
 *   3. Computes word-level Jaccard similarity against each recent post
 *   4. Blocks and logs a warning if similarity ≥ DEDUP_SIMILARITY_THRESHOLD (90%)
 *   5. Records new posts in Redis with a 12-hour TTL
 *
 * Falls back to allow (with a warning) when Redis is unavailable so as not to
 * break posting in degraded environments.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('twitter-dedup');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Similarity ratio above which a post is considered a near-duplicate (0–1). */
export const DEDUP_SIMILARITY_THRESHOLD = 0.90;

/** Window in seconds over which recent posts are checked (12 hours). */
export const DEDUP_WINDOW_SECONDS = 12 * 60 * 60; // 43 200 s

/** Redis key prefix for the per-hash exact-match sentinel. */
const EXACT_KEY_PREFIX = 'yclaw:twitter:dedup:exact:';

/** Redis sorted-set key that tracks recent normalised post texts. Score = Unix timestamp (s). */
const RECENT_SET_KEY = 'yclaw:twitter:dedup:recent';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DedupCheckResult {
  /** True → post is a duplicate and should be blocked. */
  isDuplicate: boolean;
  /** Similarity score of the closest match (0–1); undefined when no duplicate found. */
  similarity?: number;
  /** Normalised text of the closest match; undefined when no duplicate found. */
  matchedText?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether `text` is a duplicate of a recently posted tweet.
 *
 * Two-stage check:
 *   Stage 1 — exact SHA-256 match (O(1) Redis lookup)
 *   Stage 2 — word-level Jaccard similarity over all posts in the dedup window
 *
 * @param redis   - ioredis client (null → gate is skipped, post is allowed)
 * @param text    - Raw tweet text to check
 * @param options - Override defaults for threshold / window
 */
export async function checkTwitterDedup(
  redis: Redis | null,
  text: string,
  options?: { threshold?: number; windowSeconds?: number },
): Promise<DedupCheckResult> {
  if (!redis) {
    logger.warn('Twitter dedup gate skipped — Redis not available');
    return { isDuplicate: false };
  }

  const threshold = options?.threshold ?? DEDUP_SIMILARITY_THRESHOLD;
  const windowSeconds = options?.windowSeconds ?? DEDUP_WINDOW_SECONDS;

  const normalised = normalise(text);
  const hash = sha256(normalised);

  // ── Stage 1: Exact-match check ─────────────────────────────────────────────
  try {
    const exactKey = `${EXACT_KEY_PREFIX}${hash}`;
    const exists = await redis.exists(exactKey);
    if (exists) {
      logger.warn('Twitter dedup gate: exact duplicate blocked', {
        hash,
        textPreview: text.slice(0, 80),
      });
      return { isDuplicate: true, similarity: 1.0, matchedText: normalised };
    }
  } catch (err) {
    logger.warn('Twitter dedup gate: exact-check Redis error — allowing post', {
      error: (err as Error).message,
    });
    return { isDuplicate: false };
  }

  // ── Stage 2: Fuzzy-match check ─────────────────────────────────────────────
  try {
    const minScore = Math.floor(Date.now() / 1000) - windowSeconds;
    const recentEntries = await redis.zrangebyscore(RECENT_SET_KEY, minScore, '+inf');

    for (const entry of recentEntries) {
      const similarity = jaccardSimilarity(normalised, entry);
      if (similarity >= threshold) {
        logger.warn('Twitter dedup gate: near-duplicate blocked', {
          similarity: similarity.toFixed(3),
          threshold,
          textPreview: text.slice(0, 80),
          matchedPreview: entry.slice(0, 80),
        });
        return { isDuplicate: true, similarity, matchedText: entry };
      }
    }
  } catch (err) {
    logger.warn('Twitter dedup gate: fuzzy-check Redis error — allowing post', {
      error: (err as Error).message,
    });
    return { isDuplicate: false };
  }

  return { isDuplicate: false };
}

/**
 * Record a successfully posted tweet in the dedup store.
 * Call this AFTER the tweet is confirmed posted — never before.
 *
 * @param redis   - ioredis client (null → no-op)
 * @param text    - Raw tweet text that was posted
 * @param options - Override defaults for window
 */
export async function recordPostedTweet(
  redis: Redis | null,
  text: string,
  options?: { windowSeconds?: number },
): Promise<void> {
  if (!redis) return;

  const windowSeconds = options?.windowSeconds ?? DEDUP_WINDOW_SECONDS;
  const normalised = normalise(text);
  const hash = sha256(normalised);
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    const pipeline = redis.pipeline();

    // Exact-match sentinel: SET NX EX so a second identical post within the
    // window is blocked even if the sorted set lookup misses (e.g. eviction).
    pipeline.set(`${EXACT_KEY_PREFIX}${hash}`, '1', 'EX', windowSeconds);

    // Add to the fuzzy sorted set (score = Unix timestamp in seconds)
    pipeline.zadd(RECENT_SET_KEY, nowSec, normalised);

    // Prune entries outside the dedup window
    pipeline.zremrangebyscore(RECENT_SET_KEY, '-inf', nowSec - windowSeconds);

    // Keep the sorted set alive for the full window (refresh on every write)
    pipeline.expire(RECENT_SET_KEY, windowSeconds);

    await pipeline.exec();

    logger.info('Twitter dedup gate: post recorded', {
      hash,
      textLength: text.length,
    });
  } catch (err) {
    logger.warn('Twitter dedup gate: failed to record post (non-fatal)', {
      error: (err as Error).message,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise tweet text for consistent hashing and comparison:
 * lowercase, collapse whitespace, trim.
 */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Compute the SHA-256 hex digest of a string.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Word-level Jaccard similarity between two normalised strings.
 *
 * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Returns a value in [0, 1]:
 *   0 → completely disjoint
 *   1 → identical word sets
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));

  if (setA.size === 0 && setB.size === 0) return 1; // both empty → identical

  const intersectionSize = [...setA].filter(w => setB.has(w)).length;
  const unionSize = new Set([...setA, ...setB]).size;

  return intersectionSize / unionSize;
}
