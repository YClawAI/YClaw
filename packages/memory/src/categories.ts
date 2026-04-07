/**
 * Memory Architecture — Categories Module
 * Versioned summary documents per knowledge domain.
 * LLM-rewritten on new facts, old versions archived.
 */

import type { Pool } from 'pg';
import { query, withTransaction } from './db/pg.js';
import type { Category, CategoryScope } from './types.js';

interface AgentContext {
  agentId: string;
  departmentId?: string;
}

/**
 * Get all categories visible to an agent (org + department + agent scope).
 * Returns in sort_order for prompt assembly.
 */
export async function getCategories(
  pool: Pool,
  ctx: AgentContext,
): Promise<Category[]> {
  const result = await query(
    pool,
    `SELECT * FROM categories
     WHERE scope = 'org'
        OR (scope = 'department' AND department_id = $1)
        OR (scope = 'agent' AND agent_id = $2)
     ORDER BY sort_order ASC, created_at ASC`,
    [ctx.departmentId ?? '', ctx.agentId],
    ctx,
  );
  return result.rows.map(mapRow);
}

/**
 * Get the first visible category that matches the given key.
 */
export async function getCategoryByKey(
  pool: Pool,
  ctx: AgentContext,
  categoryKey: string,
): Promise<Category | null> {
  const result = await query(
    pool,
    `SELECT * FROM categories WHERE category_key = $1 LIMIT 1`,
    [categoryKey],
    ctx,
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

/**
 * Update a category summary with LLM rewrite.
 * Archives the old version, increments version number.
 */
export async function updateSummary(
  pool: Pool,
  ctx: AgentContext,
  categoryKey: string,
  newContent: string,
  archivedBy: string,
): Promise<Category | null> {
  return withTransaction(pool, { ...ctx, role: 'write_gate' }, async (client) => {
    // Get current category
    const current = await client.query(
      `SELECT * FROM categories WHERE category_key = $1
       AND (scope = 'org' OR department_id = $2 OR agent_id = $3)
       FOR UPDATE`,
      [categoryKey, ctx.departmentId ?? '', ctx.agentId],
    );

    if (current.rows.length === 0) return null;
    const cat = current.rows[0];

    // Check immutability
    if (cat.immutable) {
      throw new Error(`Category '${categoryKey}' is immutable and cannot be updated`);
    }

    // Archive old version
    await client.query(
      `INSERT INTO category_archives (category_id, content, version, archived_by)
       VALUES ($1, $2, $3, $4)`,
      [cat.id, cat.content, cat.version, archivedBy],
    );

    // Update with new content
    const updated = await client.query(
      `UPDATE categories SET content = $1, version = version + 1, updated_at = now()
       WHERE id = $2 RETURNING *`,
      [newContent, cat.id],
    );

    return mapRow(updated.rows[0]);
  });
}

/**
 * Rewrite a category summary using an LLM, incorporating a new fact.
 */
export async function rewriteSummary(
  currentSummary: string,
  newFact: string,
  categoryKey: string,
  options: { apiKey: string; model?: string },
): Promise<string> {
  const model = options.model ?? 'claude-haiku-4-20250514';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: `You maintain a knowledge summary document for the category "${categoryKey}". Rewrite the summary incorporating the new fact. Resolve any contradictions (new fact wins). Output ONLY the updated summary, no commentary.`,
      messages: [
        {
          role: 'user',
          content: `CURRENT SUMMARY:\n${currentSummary || '(empty)'}\n\nNEW FACT:\n${newFact}`,
        },
      ],
    }),
  });

  const data = (await response.json()) as { content: Array<{ text: string }> };
  return data.content?.[0]?.text ?? currentSummary;
}

function mapRow(row: Record<string, unknown>): Category {
  return {
    id: row.id as string,
    categoryKey: row.category_key as string,
    scope: row.scope as CategoryScope,
    departmentId: row.department_id as string | null,
    agentId: row.agent_id as string | null,
    content: row.content as string,
    version: Number(row.version),
    tags: (row.tags as string[]) ?? [],
    immutable: row.immutable as boolean,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
