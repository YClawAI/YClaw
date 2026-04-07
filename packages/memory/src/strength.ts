/**
 * Memory Architecture — Strength + Sentiment Module (Phase 3)
 *
 * Strength: Decay-based memory strength. Items start at 1.0, decay over time
 * if not accessed. Access bumps strength. Enables forgetting curve — stale facts
 * eventually fall below retrieval threshold.
 *
 * Sentiment: Emotional tone classification on items.
 * Extracted alongside facts at write time.
 */

import type { Pool } from 'pg';

export type Sentiment = 'positive' | 'negative' | 'neutral' | 'mixed';

// Decay constants
const DECAY_HALF_LIFE_DAYS = 30; // Strength halves every 30 days without access
const DECAY_RATE = Math.LN2 / DECAY_HALF_LIFE_DAYS;
const ACCESS_BUMP = 0.15;
const MAX_STRENGTH = 1.0;
const MIN_STRENGTH = 0.01; // Below this → candidate for archival

/**
 * Calculate decayed strength based on time since last access.
 */
export function calculateDecayedStrength(
  currentStrength: number,
  lastAccessedAt: Date | null,
  now: Date = new Date(),
): number {
  if (!lastAccessedAt) return currentStrength;
  const daysSinceAccess = (now.getTime() - lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceAccess <= 0) return currentStrength;
  return currentStrength * Math.exp(-DECAY_RATE * daysSinceAccess);
}

/**
 * Record an access (recall) of an item. Bumps strength and updates access tracking.
 */
export async function recordAccess(
  pool: Pool,
  itemId: string,
): Promise<void> {
  await pool.query(
    `UPDATE items SET
       strength = LEAST($1, strength + $2),
       access_count = access_count + 1,
       last_accessed_at = now(),
       updated_at = now()
     WHERE id = $3`,
    [MAX_STRENGTH, ACCESS_BUMP, itemId],
  );
}

/**
 * Batch-record accesses for multiple items (e.g., all items returned by recall).
 */
export async function recordAccessBatch(
  pool: Pool,
  itemIds: string[],
): Promise<void> {
  if (itemIds.length === 0) return;
  await pool.query(
    `UPDATE items SET
       strength = LEAST($1, strength + $2),
       access_count = access_count + 1,
       last_accessed_at = now(),
       updated_at = now()
     WHERE id = ANY($3)`,
    [MAX_STRENGTH, ACCESS_BUMP, itemIds],
  );
}

/**
 * Apply decay to all active items for an agent.
 * Call periodically (e.g., daily via cron).
 * Returns count of items that fell below minimum strength (candidates for archival).
 */
export async function applyDecay(
  pool: Pool,
  agentId: string,
): Promise<{ decayed: number; belowMinimum: number }> {
  // Apply exponential decay based on time since last access
  const result = await pool.query(
    `UPDATE items SET
       strength = GREATEST($1,
         strength * exp(-$2 * EXTRACT(EPOCH FROM (now() - COALESCE(last_accessed_at, updated_at))) / 86400.0)
       ),
       updated_at = now()
     WHERE agent_id = $3 AND status = 'active'
     RETURNING id, strength`,
    [MIN_STRENGTH, DECAY_RATE, agentId],
  );

  const belowMinimum = result.rows.filter(r => parseFloat(r.strength) <= MIN_STRENGTH).length;
  return { decayed: result.rowCount ?? 0, belowMinimum };
}

/**
 * Archive items that have decayed below minimum strength.
 */
export async function archiveWeakItems(
  pool: Pool,
  agentId: string,
  threshold = MIN_STRENGTH,
): Promise<number> {
  const result = await pool.query(
    `UPDATE items SET status = 'archived', archived_at = now(), updated_at = now()
     WHERE agent_id = $1 AND status = 'active' AND strength <= $2`,
    [agentId, threshold],
  );
  return result.rowCount ?? 0;
}

/**
 * Set sentiment on an item.
 */
export async function setSentiment(
  pool: Pool,
  itemId: string,
  sentiment: Sentiment,
): Promise<void> {
  await pool.query(
    `UPDATE items SET sentiment = $1, updated_at = now() WHERE id = $2`,
    [sentiment, itemId],
  );
}

/**
 * Simple sentiment classifier. Uses keyword heuristics for Phase 3.
 * In production, this would be an LLM call or a lightweight classifier.
 */
export function classifySentiment(text: string): Sentiment {
  const lower = text.toLowerCase();

  const positiveWords = ['success', 'completed', 'achieved', 'improved', 'resolved', 'fixed',
    'approved', 'launched', 'deployed', 'working', 'excellent', 'great', 'good', 'positive',
    'growth', 'profit', 'gained', 'upgraded', 'optimized', 'healthy'];
  const negativeWords = ['failed', 'error', 'broken', 'blocked', 'rejected', 'crashed', 'down',
    'vulnerability', 'risk', 'loss', 'degraded', 'timeout', 'outage', 'bug', 'critical',
    'deprecated', 'insecure', 'overloaded', 'breach', 'violation'];

  const posCount = positiveWords.filter(w => lower.includes(w)).length;
  const negCount = negativeWords.filter(w => lower.includes(w)).length;

  if (posCount > 0 && negCount > 0) return 'mixed';
  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}
