/**
 * Memory Architecture — Conflict Resolution Module (Phase 2)
 * One-active-truth enforcement via subject+predicate extraction.
 * Before writing a new fact, check for existing active facts with the
 * same subject+predicate. If found, archive the old and insert the new.
 */

import type { Pool } from 'pg';

export interface ConflictCheck {
  hasConflict: boolean;
  archivedItemId?: string;
  subject: string;
  predicate: string;
  oldValue?: string;
}

export interface ConflictLogEntry {
  id: string;
  agentId: string;
  archivedItemId: string;
  newItemId: string;
  subject: string;
  predicate: string;
  oldValue: string;
  newValue: string;
  resolutionReason: string | null;
  createdAt: Date;
}

/**
 * Extract subject and predicate from a fact using a simple heuristic.
 * In production, this would use an LLM call. For Phase 2, we use
 * a pattern-based approach that handles common fact structures:
 *   "X is Y" → subject=X, predicate=is
 *   "X has Y" → subject=X, predicate=has
 *   "X uses Y" → subject=X, predicate=uses
 *
 * Returns null if no subject+predicate can be extracted.
 */
export function extractSubjectPredicate(
  factText: string,
): { subject: string; predicate: string; object: string } | null {
  // Normalize
  const text = factText.trim();

  // Common patterns: "Subject verb Object"
  const patterns = [
    // "X is Y", "X is not Y"
    /^(.+?)\s+(is(?:\s+not)?)\s+(.+)$/i,
    // "X has Y", "X does not have Y"
    /^(.+?)\s+(has|have|does(?:\s+not)?\s+have)\s+(.+)$/i,
    // "X uses Y"
    /^(.+?)\s+(uses?|prefers?|requires?|supports?|runs?|needs?)\s+(.+)$/i,
    // "X was Y"
    /^(.+?)\s+(was|were|became|changed\s+to)\s+(.+)$/i,
    // "X can Y"
    /^(.+?)\s+(can(?:not)?|should(?:\s+not)?|must(?:\s+not)?|will(?:\s+not)?)\s+(.+)$/i,
    // "X costs Y"
    /^(.+?)\s+(costs?|takes?|produces?|generates?|returns?)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        subject: match[1].trim().toLowerCase(),
        predicate: match[2].trim().toLowerCase(),
        object: match[3].trim(),
      };
    }
  }

  return null;
}

/**
 * Check for and resolve conflicts before inserting a new fact.
 * If a conflict exists, archives the old item and returns info for logging.
 *
 * Call this AFTER Write Gate + Dedup but BEFORE final insert.
 */
export async function checkAndResolveConflict(
  pool: Pool,
  agentId: string,
  factText: string,
): Promise<ConflictCheck> {
  const extracted = extractSubjectPredicate(factText);

  if (!extracted) {
    return { hasConflict: false, subject: '', predicate: '' };
  }

  const { subject, predicate } = extracted;

  // Find existing active fact with same subject+predicate
  const existing = await pool.query(
    `SELECT id, fact_text FROM items
     WHERE agent_id = $1
       AND subject = $2
       AND predicate = $3
       AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [agentId, subject, predicate],
  );

  if (existing.rows.length === 0) {
    return { hasConflict: false, subject, predicate };
  }

  const oldItem = existing.rows[0];

  // Archive the old item
  await pool.query(
    `UPDATE items SET status = 'archived', archived_at = now(), updated_at = now()
     WHERE id = $1`,
    [oldItem.id],
  );

  return {
    hasConflict: true,
    archivedItemId: oldItem.id,
    subject,
    predicate,
    oldValue: oldItem.fact_text,
  };
}

/**
 * Log a conflict resolution.
 */
export async function logConflictResolution(
  pool: Pool,
  agentId: string,
  archivedItemId: string,
  newItemId: string,
  subject: string,
  predicate: string,
  oldValue: string,
  newValue: string,
  reason?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO conflict_log (agent_id, archived_item_id, new_item_id, subject, predicate, old_value, new_value, resolution_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [agentId, archivedItemId, newItemId, subject, predicate, oldValue, newValue, reason ?? null],
  );
}

/**
 * Get conflict log entries for an agent.
 */
export async function getConflictLog(
  pool: Pool,
  agentId: string,
  limit = 50,
): Promise<ConflictLogEntry[]> {
  const result = await pool.query(
    `SELECT * FROM conflict_log WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [agentId, limit],
  );

  return result.rows.map(row => ({
    id: row.id,
    agentId: row.agent_id,
    archivedItemId: row.archived_item_id,
    newItemId: row.new_item_id,
    subject: row.subject,
    predicate: row.predicate,
    oldValue: row.old_value,
    newValue: row.new_value,
    resolutionReason: row.resolution_reason,
    createdAt: row.created_at,
  }));
}
