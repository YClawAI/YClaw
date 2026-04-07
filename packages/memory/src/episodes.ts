/**
 * Memory Architecture — Episodes + Episode Search Module (Phase 3)
 *
 * Episodes group related facts into coherent narrative units.
 * Auto-detection creates an episode when 3+ recent active items are not already
 * linked to one.
 * Episode summaries get embedded for semantic search.
 *
 * Episode Search: cosine similarity over episode summary embeddings.
 * "What happened when we deployed the memory system?" → finds the episode.
 */

import type { Pool } from 'pg';
import type { EmbeddingService } from './embeddings.js';

export interface Episode {
  id: string;
  agentId: string;
  title: string;
  summary: string | null;
  startTime: Date;
  endTime: Date | null;
  factCount: number;
  tags: string[];
  status: 'open' | 'closed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface EpisodeSearchResult {
  episode: Episode;
  similarity: number;
}

// Detection thresholds
const MIN_FACTS_FOR_EPISODE = 3;
const EPISODE_TIME_WINDOW_MINUTES = 60; // Facts within 60 min = potentially same episode

/**
 * Create a new episode.
 */
export async function createEpisode(
  pool: Pool,
  agentId: string,
  title: string,
  options?: {
    summary?: string;
    startTime?: Date;
    tags?: string[];
  },
): Promise<Episode> {
  const result = await pool.query(
    `INSERT INTO episodes (agent_id, title, summary, start_time, tags)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      agentId,
      title,
      options?.summary ?? null,
      options?.startTime ?? new Date(),
      options?.tags ?? [],
    ],
  );
  return mapRow(result.rows[0]);
}

/**
 * Add an item to an episode.
 */
export async function addItemToEpisode(
  pool: Pool,
  episodeId: string,
  itemId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO episode_items (episode_id, item_id)
     VALUES ($1, $2)
     ON CONFLICT (episode_id, item_id) DO NOTHING`,
    [episodeId, itemId],
  );

  // Update fact count and end_time
  await pool.query(
    `UPDATE episodes SET
       fact_count = (SELECT COUNT(*) FROM episode_items WHERE episode_id = $1),
       end_time = now(),
       updated_at = now()
     WHERE id = $1`,
    [episodeId],
  );
}

/**
 * Close an episode and generate its summary embedding.
 */
export async function closeEpisode(
  pool: Pool,
  episodeId: string,
  summary: string,
  embeddingService?: EmbeddingService,
): Promise<Episode> {
  let embeddingStr: string | null = null;

  if (embeddingService && summary) {
    try {
      const embedding = await embeddingService.embed(summary);
      embeddingStr = `[${embedding.join(',')}]`;
    } catch (err) {
      console.error('[memory] Episode embedding failed:', (err as Error).message);
    }
  }

  const result = await pool.query(
    `UPDATE episodes SET
       summary = $1,
       embedding = ${embeddingStr ? '$4::vector' : 'embedding'},
       status = 'closed',
       end_time = COALESCE(end_time, now()),
       updated_at = now()
     WHERE id = $2
     RETURNING *`,
    embeddingStr
      ? [summary, episodeId, 'closed', embeddingStr]
      : [summary, episodeId],
  );

  // Fix: need to handle the two query shapes properly
  if (result.rows.length === 0) {
    // Fallback without embedding
    const fallback = await pool.query(
      `UPDATE episodes SET summary = $1, status = 'closed', end_time = COALESCE(end_time, now()), updated_at = now()
       WHERE id = $2 RETURNING *`,
      [summary, episodeId],
    );
    return mapRow(fallback.rows[0]);
  }
  return mapRow(result.rows[0]);
}

/**
 * Get the current open episode for an agent, if any.
 */
export async function getOpenEpisode(
  pool: Pool,
  agentId: string,
): Promise<Episode | null> {
  const result = await pool.query(
    `SELECT * FROM episodes
     WHERE agent_id = $1 AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [agentId],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Get episodes for an agent.
 */
export async function getEpisodes(
  pool: Pool,
  agentId: string,
  options?: { status?: string; limit?: number; after?: Date },
): Promise<Episode[]> {
  const conditions = ['agent_id = $1'];
  const params: unknown[] = [agentId];
  let idx = 2;

  if (options?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(options.status);
  }
  if (options?.after) {
    conditions.push(`start_time > $${idx++}`);
    params.push(options.after);
  }

  const result = await pool.query(
    `SELECT * FROM episodes WHERE ${conditions.join(' AND ')}
     ORDER BY start_time DESC LIMIT $${idx}`,
    [...params, options?.limit ?? 20],
  );
  return result.rows.map(mapRow);
}

/**
 * Get all items in an episode.
 */
export async function getEpisodeItems(
  pool: Pool,
  episodeId: string,
): Promise<string[]> {
  const result = await pool.query(
    `SELECT item_id FROM episode_items WHERE episode_id = $1 ORDER BY added_at`,
    [episodeId],
  );
  return result.rows.map(r => r.item_id);
}

// ─── Episode Search (Module 12) ──────────────────────────────────────────

/**
 * Semantic search over episode summaries.
 * Uses pgvector cosine similarity on episode embeddings.
 */
export async function searchEpisodes(
  pool: Pool,
  embeddingService: EmbeddingService,
  agentId: string,
  query: string,
  options?: { limit?: number; minSimilarity?: number },
): Promise<EpisodeSearchResult[]> {
  const queryEmbedding = await embeddingService.embed(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const minSim = options?.minSimilarity ?? 0.3;

  const result = await pool.query(
    `SELECT *,
            1 - (embedding <=> $1::vector) AS similarity
     FROM episodes
     WHERE agent_id = $2
       AND status IN ('closed', 'open')
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) > $3
     ORDER BY similarity DESC
     LIMIT $4`,
    [embeddingStr, agentId, minSim, options?.limit ?? 10],
  );

  return result.rows.map(row => ({
    episode: mapRow(row),
    similarity: parseFloat(row.similarity),
  }));
}

/**
 * Auto-detect if recent facts should form a new episode.
 * Looks at recent active items that are not already linked to an episode.
 * If enough items exist, creates one episode and tags it from distinct category keys.
 */
export async function detectEpisode(
  pool: Pool,
  agentId: string,
  windowMinutes = EPISODE_TIME_WINDOW_MINUTES,
  minFacts = MIN_FACTS_FOR_EPISODE,
): Promise<Episode | null> {
  // Find recent items not in any episode
  const result = await pool.query(
    `SELECT i.id, i.fact_text, i.category_key, i.created_at
     FROM items i
     LEFT JOIN episode_items ei ON ei.item_id = i.id
     WHERE i.agent_id = $1
       AND i.status = 'active'
       AND i.created_at > now() - make_interval(mins => $2)
       AND ei.episode_id IS NULL
     ORDER BY i.created_at ASC`,
    [agentId, windowMinutes],
  );

  if (result.rows.length < minFacts) return null;

  // Generate a title from the first few facts
  const facts = result.rows.slice(0, 5).map((r: Record<string, unknown>) => r.fact_text as string);
  const title = generateEpisodeTitle(facts);

  const episode = await createEpisode(pool, agentId, title, {
    startTime: result.rows[0].created_at as Date,
    tags: [...new Set(result.rows
      .map((r: Record<string, unknown>) => r.category_key as string | null)
      .filter((k): k is string => k !== null))],
  });

  // Link all items to the episode
  for (const row of result.rows) {
    await addItemToEpisode(pool, episode.id, row.id);
  }

  return episode;
}

/**
 * Generate a short episode title from constituent facts.
 */
function generateEpisodeTitle(facts: string[]): string {
  // Use first fact, truncated
  const first = facts[0];
  if (first.length <= 60) return first;
  return first.substring(0, 57) + '...';
}

function mapRow(row: Record<string, unknown>): Episode {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    title: row.title as string,
    summary: row.summary as string | null,
    startTime: row.start_time as Date,
    endTime: row.end_time as Date | null,
    factCount: row.fact_count as number,
    tags: row.tags as string[],
    status: row.status as 'open' | 'closed' | 'archived',
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
