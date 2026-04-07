/**
 * Memory Architecture — Items Module
 * CRUD operations for atomic facts with confidence scoring.
 */

import type { Pool } from 'pg';
import { query, withTransaction } from './db/pg.js';
import type { MemoryItem, WriteGateLogEntry } from './types.js';

interface AgentContext {
  agentId: string;
  departmentId?: string;
}

/**
 * Insert a new memory item (fact that passed Write Gate).
 */
export async function createItem(
  pool: Pool,
  ctx: AgentContext,
  item: {
    factText: string;
    confidence?: number;
    categoryKey?: string;
    sourceType?: string;
    sourceRef?: string;
    tags?: string[];
  },
): Promise<MemoryItem> {
  const result = await query(
    pool,
    `INSERT INTO items (agent_id, fact_text, confidence, category_key, source_type, source_ref, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      ctx.agentId,
      item.factText,
      item.confidence ?? 0.70,
      item.categoryKey ?? null,
      item.sourceType ?? 'execution',
      item.sourceRef ?? null,
      item.tags ?? [],
    ],
    ctx,
  );
  return mapRow(result.rows[0]);
}

/**
 * Get items for an agent, optionally filtered by category and minimum confidence.
 */
export async function getItems(
  pool: Pool,
  ctx: AgentContext,
  filters?: {
    categoryKey?: string;
    minConfidence?: number;
    status?: string;
    tags?: string[];
    limit?: number;
  },
): Promise<MemoryItem[]> {
  const conditions: string[] = ['status = $1'];
  const params: unknown[] = [filters?.status ?? 'active'];
  let paramIdx = 2;

  if (filters?.categoryKey) {
    conditions.push(`category_key = $${paramIdx++}`);
    params.push(filters.categoryKey);
  }
  if (filters?.minConfidence !== undefined) {
    conditions.push(`confidence >= $${paramIdx++}`);
    params.push(filters.minConfidence);
  }
  if (filters?.tags && filters.tags.length > 0) {
    conditions.push(`tags && $${paramIdx++}`);
    params.push(filters.tags);
  }

  const limit = filters?.limit ?? 100;
  const sql = `SELECT * FROM items WHERE ${conditions.join(' AND ')}
               ORDER BY confidence DESC, created_at DESC LIMIT $${paramIdx}`;
  params.push(limit);

  const result = await query(pool, sql, params, ctx);
  return result.rows.map(mapRow);
}

/**
 * Update confidence for an item (+0.1 on confirmation, -0.2 on contradiction).
 */
export async function updateConfidence(
  pool: Pool,
  ctx: AgentContext,
  itemId: string,
  delta: number,
  reason: string,
): Promise<MemoryItem | null> {
  const result = await query(
    pool,
    `UPDATE items SET confidence = GREATEST(0.0, LEAST(1.0, confidence + $1))
     WHERE id = $2 AND status = 'active'
     RETURNING *`,
    [delta, itemId],
    ctx,
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

/**
 * Archive an item (soft delete).
 */
export async function archiveItem(
  pool: Pool,
  ctx: AgentContext,
  itemId: string,
): Promise<boolean> {
  const result = await query(
    pool,
    `UPDATE items SET status = 'archived' WHERE id = $1 AND status = 'active' RETURNING id`,
    [itemId],
    ctx,
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Log a Write Gate decision (accept or reject).
 */
export async function logGateDecision(
  pool: Pool,
  ctx: AgentContext,
  entry: Omit<WriteGateLogEntry, 'id' | 'createdAt'>,
): Promise<void> {
  await query(
    pool,
    `INSERT INTO write_gate_log (agent_id, input_text, decision, reject_reason, confidence, category_key, conflict_item_id, llm_model, latency_ms, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.agentId,
      entry.inputText,
      entry.decision,
      entry.rejectReason,
      entry.confidence,
      entry.categoryKey,
      entry.conflictItemId,
      entry.llmModel,
      entry.latencyMs,
      entry.tokensUsed,
    ],
    { agentId: ctx.agentId, role: 'write_gate' },
  );
}

function mapRow(row: Record<string, unknown>): MemoryItem {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    factText: row.fact_text as string,
    confidence: Number(row.confidence),
    categoryKey: row.category_key as string | null,
    sourceType: row.source_type as MemoryItem['sourceType'],
    sourceRef: row.source_ref as string | null,
    tags: (row.tags as string[]) ?? [],
    status: row.status as MemoryItem['status'],
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
