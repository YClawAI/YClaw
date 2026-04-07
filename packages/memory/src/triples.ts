/**
 * Memory Architecture — Triples Module (Phase 3)
 * Subject-Predicate-Object knowledge graph.
 *
 * Facts currently decompose into at most one triple via pattern matching.
 * Triples inherit confidence from source items and enforce one active
 * `(subject, predicate)` pair per agent.
 */

import type { Pool } from 'pg';

export interface Triple {
  id: string;
  agentId: string;
  itemId: string | null;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  sourceType: string | null;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTripleInput {
  itemId?: string;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  sourceType?: string;
}

/**
 * Upsert a triple. If an active triple with same subject+predicate exists for
 * this agent, it gets archived and the new one replaces it (one-active-truth).
 */
export async function upsertTriple(
  pool: Pool,
  agentId: string,
  input: CreateTripleInput,
): Promise<{ triple: Triple; replaced: boolean; oldTripleId?: string }> {
  const subject = input.subject.trim().toLowerCase();
  const predicate = input.predicate.trim().toLowerCase();
  const object = input.object.trim();

  // Check for existing active triple with same subject+predicate
  const existing = await pool.query(
    `SELECT id, object FROM triples
     WHERE agent_id = $1 AND subject = $2 AND predicate = $3 AND status = 'active'
     LIMIT 1`,
    [agentId, subject, predicate],
  );

  let replaced = false;
  let oldTripleId: string | undefined;

  if (existing.rows.length > 0) {
    // If same object, just update confidence/timestamp
    if (existing.rows[0].object.trim() === object) {
      const updated = await pool.query(
        `UPDATE triples SET
           confidence = GREATEST(confidence, $1),
           updated_at = now()
         WHERE id = $2
         RETURNING *`,
        [input.confidence ?? 0.70, existing.rows[0].id],
      );
      return { triple: mapRow(updated.rows[0]), replaced: false };
    }

    // Different object → archive old, insert new
    oldTripleId = existing.rows[0].id;
    await pool.query(
      `UPDATE triples SET status = 'archived', updated_at = now() WHERE id = $1`,
      [oldTripleId],
    );
    replaced = true;
  }

  const result = await pool.query(
    `INSERT INTO triples (agent_id, item_id, subject, predicate, object, confidence, source_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      agentId,
      input.itemId ?? null,
      subject,
      predicate,
      object,
      input.confidence ?? 0.70,
      input.sourceType ?? null,
    ],
  );

  return { triple: mapRow(result.rows[0]), replaced, oldTripleId };
}

/**
 * Query triples by subject (e.g., "what do we know about X?").
 */
export async function queryBySubject(
  pool: Pool,
  agentId: string,
  subject: string,
  options?: { limit?: number },
): Promise<Triple[]> {
  const result = await pool.query(
    `SELECT * FROM triples
     WHERE agent_id = $1 AND subject = $2 AND status = 'active'
     ORDER BY confidence DESC, updated_at DESC
     LIMIT $3`,
    [agentId, subject.trim().toLowerCase(), options?.limit ?? 50],
  );
  return (result.rows as Record<string, unknown>[]).map(mapRow);
}

/**
 * Query triples by predicate (e.g., "what uses X?").
 */
export async function queryByPredicate(
  pool: Pool,
  agentId: string,
  predicate: string,
  options?: { limit?: number },
): Promise<Triple[]> {
  const result = await pool.query(
    `SELECT * FROM triples
     WHERE agent_id = $1 AND predicate = $2 AND status = 'active'
     ORDER BY confidence DESC, updated_at DESC
     LIMIT $3`,
    [agentId, predicate.trim().toLowerCase(), options?.limit ?? 50],
  );
  return (result.rows as Record<string, unknown>[]).map(mapRow);
}

/**
 * Query triples by object (reverse lookup — "what relates to Y?").
 */
export async function queryByObject(
  pool: Pool,
  agentId: string,
  object: string,
  options?: { limit?: number },
): Promise<Triple[]> {
  const result = await pool.query(
    `SELECT * FROM triples
     WHERE agent_id = $1 AND status = 'active'
       AND object ILIKE $2
     ORDER BY confidence DESC, updated_at DESC
     LIMIT $3`,
    [agentId, `%${object.trim()}%`, options?.limit ?? 50],
  );
  return (result.rows as Record<string, unknown>[]).map(mapRow);
}

/**
 * Get all triples derived from a specific item.
 */
export async function getTriplesForItem(
  pool: Pool,
  itemId: string,
): Promise<Triple[]> {
  const result = await pool.query(
    `SELECT * FROM triples WHERE item_id = $1 ORDER BY created_at`,
    [itemId],
  );
  return (result.rows as Record<string, unknown>[]).map(mapRow);
}

/**
 * Extract triples from a fact text using pattern matching.
 * Returns zero or more triples. Uses the same patterns as conflict-resolution
 * but returns full SPO triples for graph storage.
 */
export function extractTriples(
  factText: string,
): Array<{ subject: string; predicate: string; object: string }> {
  const text = factText.trim();
  const results: Array<{ subject: string; predicate: string; object: string }> = [];

  const patterns = [
    /^(.+?)\s+(is(?:\s+not)?)\s+(.+)$/i,
    /^(.+?)\s+(has|have|does(?:\s+not)?\s+have)\s+(.+)$/i,
    /^(.+?)\s+(uses?|prefers?|requires?|supports?|runs?|needs?)\s+(.+)$/i,
    /^(.+?)\s+(was|were|became|changed\s+to)\s+(.+)$/i,
    /^(.+?)\s+(can(?:not)?|should(?:\s+not)?|must(?:\s+not)?|will(?:\s+not)?)\s+(.+)$/i,
    /^(.+?)\s+(costs?|takes?|produces?|generates?|returns?)\s+(.+)$/i,
    /^(.+?)\s+(depends?\s+on|connects?\s+to|integrates?\s+with|communicates?\s+with)\s+(.+)$/i,
    /^(.+?)\s+(deployed\s+(?:to|on|at)|stored\s+in|located\s+(?:in|at))\s+(.+)$/i,
    /^(.+?)\s+(owns?|manages?|monitors?|controls?|operates?)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      results.push({
        subject: match[1].trim().toLowerCase(),
        predicate: match[2].trim().toLowerCase(),
        object: match[3].trim(),
      });
      break; // One triple per fact for now
    }
  }

  return results;
}

function mapRow(row: Record<string, unknown>): Triple {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    itemId: row.item_id as string | null,
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    confidence: parseFloat(row.confidence as string),
    sourceType: row.source_type as string | null,
    status: row.status as 'active' | 'archived',
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
