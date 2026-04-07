/**
 * Memory Architecture — Resources Module (Phase 2)
 * Append-only raw-content store keyed by agent + content hash.
 * Callers can link items back to a source resource, but the link is optional.
 * Retention cleanup only removes unreferenced resources.
 */

import type { Pool } from 'pg';
import { createHash } from 'node:crypto';

export interface Resource {
  id: string;
  agentId: string;
  rawContent: string;
  sourceType: string;
  sourceMetadata: Record<string, unknown> | null;
  conversationId: string | null;
  contentHash: string;
  createdAt: Date;
}

export interface CreateResourceInput {
  rawContent: string;
  sourceType: string;
  sourceMetadata?: Record<string, unknown>;
  conversationId?: string;
}

/**
 * Compute SHA-256 hash of content for dedup at ingestion.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Store a raw input as a Resource. Returns the resource (or existing if duplicate hash).
 */
export async function createResource(
  pool: Pool,
  agentId: string,
  input: CreateResourceInput,
): Promise<Resource> {
  const contentHash = hashContent(input.rawContent);

  // Check for duplicate by hash (same agent, same content)
  const existing = await pool.query(
    `SELECT * FROM resources WHERE agent_id = $1 AND content_hash = $2 LIMIT 1`,
    [agentId, contentHash],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return mapRow(row);
  }

  const result = await pool.query(
    `INSERT INTO resources (agent_id, raw_content, source_type, source_metadata, conversation_id, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      agentId,
      input.rawContent,
      input.sourceType,
      input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : null,
      input.conversationId ?? null,
      contentHash,
    ],
  );

  return mapRow(result.rows[0]);
}

/**
 * Get a resource by ID.
 */
export async function getResource(
  pool: Pool,
  resourceId: string,
): Promise<Resource | null> {
  const result = await pool.query(
    `SELECT * FROM resources WHERE id = $1`,
    [resourceId],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Get resources for an agent, optionally filtered by source type.
 */
export async function getResources(
  pool: Pool,
  agentId: string,
  options?: {
    sourceType?: string;
    conversationId?: string;
    limit?: number;
    after?: Date;
  },
): Promise<Resource[]> {
  const conditions = ['agent_id = $1'];
  const params: unknown[] = [agentId];
  let idx = 2;

  if (options?.sourceType) {
    conditions.push(`source_type = $${idx++}`);
    params.push(options.sourceType);
  }
  if (options?.conversationId) {
    conditions.push(`conversation_id = $${idx++}`);
    params.push(options.conversationId);
  }
  if (options?.after) {
    conditions.push(`created_at > $${idx++}`);
    params.push(options.after);
  }

  const limit = options?.limit ?? 50;
  const sql = `SELECT * FROM resources WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`;

  const result = await pool.query(sql, params);
  return result.rows.map(mapRow);
}

/**
 * Link an item to its source resource.
 */
export async function linkItemToResource(
  pool: Pool,
  itemId: string,
  resourceId: string,
): Promise<void> {
  await pool.query(
    `UPDATE items SET source_resource_id = $1 WHERE id = $2`,
    [resourceId, itemId],
  );
}

/**
 * Delete unreferenced resources older than the retention window (default 90 days).
 */
export async function archiveOldResources(
  pool: Pool,
  retentionDays = 90,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM resources
     WHERE created_at < now() - make_interval(days => $1)
       AND id NOT IN (SELECT source_resource_id FROM items WHERE source_resource_id IS NOT NULL)`,
    [retentionDays],
  );
  return result.rowCount ?? 0;
}

function mapRow(row: Record<string, unknown>): Resource {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    rawContent: row.raw_content as string,
    sourceType: row.source_type as string,
    sourceMetadata: row.source_metadata as Record<string, unknown> | null,
    conversationId: row.conversation_id as string | null,
    contentHash: row.content_hash as string,
    createdAt: row.created_at as Date,
  };
}
