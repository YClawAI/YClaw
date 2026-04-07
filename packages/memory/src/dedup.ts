/**
 * Memory Architecture — Dedup Module (Phase 2)
 * Cosine similarity deduplication via pgvector.
 * Before inserting a new Item, check for near-duplicates.
 * If match > threshold, merge into existing item (update text, bump confidence).
 */

import type { Pool } from 'pg';
import type { EmbeddingService } from './embeddings.js';

export interface DedupResult {
  action: 'inserted' | 'merged';
  itemId: string;
  mergedWith?: string;
  similarity?: number;
}

export interface DedupLogEntry {
  id: string;
  agentId: string;
  survivingItemId: string;
  mergedItemText: string;
  similarityScore: number;
  confidenceBefore: number;
  confidenceAfter: number;
  createdAt: Date;
}

const DEFAULT_THRESHOLD = 0.85;
const CONFIDENCE_BUMP = 0.05;
const MAX_CONFIDENCE = 1.0;

/**
 * Check for duplicate items and either merge or signal insertion.
 * Returns the item ID and whether it was merged or should be inserted.
 *
 * Call this AFTER Write Gate approval but BEFORE inserting the item.
 * If action='merged', skip insertion. If action='inserted', proceed with insert.
 */
export async function checkAndDedup(
  pool: Pool,
  embeddingService: EmbeddingService,
  agentId: string,
  factText: string,
  categoryKey: string | null,
  options?: {
    threshold?: number;
  },
): Promise<DedupResult & { embedding: number[] }> {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

  // Generate embedding for the new fact
  const embedding = await embeddingService.embed(factText);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Search for similar items in the same agent's active items
  // Optionally scoped to same category for tighter matching
  const conditions = ['agent_id = $1', 'status = $2', 'embedding IS NOT NULL'];
  const params: unknown[] = [agentId, 'active'];
  let idx = 3;

  if (categoryKey) {
    conditions.push(`category_key = $${idx++}`);
    params.push(categoryKey);
  }

  params.push(embeddingStr);

  const sql = `
    SELECT id, fact_text, confidence,
           1 - (embedding <=> $${idx}::vector) AS similarity
    FROM items
    WHERE ${conditions.join(' AND ')}
      AND 1 - (embedding <=> $${idx}::vector) > ${threshold}
    ORDER BY similarity DESC
    LIMIT 1
  `;

  const result = await pool.query(sql, params);

  if (result.rows.length > 0) {
    const match = result.rows[0];
    const oldConfidence = parseFloat(match.confidence);
    const newConfidence = Math.min(oldConfidence + CONFIDENCE_BUMP, MAX_CONFIDENCE);

    // Merge: update existing item with fresher wording and bumped confidence
    await pool.query(
      `UPDATE items SET
         fact_text = $1,
         confidence = $2,
         updated_at = now()
       WHERE id = $3`,
      [factText, newConfidence, match.id],
    );

    // Log the merge
    await pool.query(
      `INSERT INTO dedup_log (agent_id, surviving_item_id, merged_item_text, similarity_score, confidence_before, confidence_after)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [agentId, match.id, factText, match.similarity, oldConfidence, newConfidence],
    );

    return {
      action: 'merged',
      itemId: match.id,
      mergedWith: match.id,
      similarity: parseFloat(match.similarity),
      embedding,
    };
  }

  // No duplicate found — caller should insert
  return {
    action: 'inserted',
    itemId: '', // Will be set by caller after insert
    embedding,
  };
}

/**
 * Get dedup log entries for an agent.
 */
export async function getDedupLog(
  pool: Pool,
  agentId: string,
  limit = 50,
): Promise<DedupLogEntry[]> {
  const result = await pool.query(
    `SELECT * FROM dedup_log WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [agentId, limit],
  );

  return result.rows.map(row => ({
    id: row.id,
    agentId: row.agent_id,
    survivingItemId: row.surviving_item_id,
    mergedItemText: row.merged_item_text,
    similarityScore: parseFloat(row.similarity_score),
    confidenceBefore: parseFloat(row.confidence_before),
    confidenceAfter: parseFloat(row.confidence_after),
    createdAt: row.created_at,
  }));
}
