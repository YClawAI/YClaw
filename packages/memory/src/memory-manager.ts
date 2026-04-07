/**
 * Memory Architecture — MemoryManager
 * Top-level orchestrator for the memory pipeline.
 *
 * Phase 1: storeFact (Write Gate → Items → Category rewrite), recall, getContext, flush
 * Phase 2: + Resource audit trail, Dedup (cosine merge), Conflict Resolution (subject/predicate),
 *            Checkpoint (save/recover/clear), Embedding service integration
 * Phase 3: + Strength decay + Sentiment classification, Triples (knowledge graph),
 *            Episodes (narrative grouping), Episode Search (semantic)
 */

import type { Pool } from 'pg';
import type { MemoryItem, Category, MemoryConfig } from './types.js';
import type { EmbeddingService } from './embeddings.js';
import * as WriteGate from './write-gate.js';
import * as Items from './items.js';
import * as Categories from './categories.js';
import * as WorkingMemory from './working-memory.js';
import * as Resources from './resources.js';
import * as Dedup from './dedup.js';
import * as ConflictRes from './conflict-resolution.js';
import * as Checkpoint from './checkpoint.js';
import * as Strength from './strength.js';
import * as Triples from './triples.js';
import * as Episodes from './episodes.js';

interface AgentContext {
  agentId: string;
  departmentId?: string;
}

export class MemoryManager {
  private pool: Pool;
  private config: MemoryConfig;
  private embeddingService: EmbeddingService | null;

  constructor(pool: Pool, config: MemoryConfig, embeddingService?: EmbeddingService) {
    this.pool = pool;
    this.config = config;
    this.embeddingService = embeddingService ?? null;
  }

  // ─── Phase 2: Checkpoint Integration ────────────────────────────────────

  /**
   * Save a checkpoint after an agent turn.
   */
  async saveCheckpoint(
    agentId: string,
    sessionId: string,
    turnNumber: number,
    data: Checkpoint.CheckpointData,
  ): Promise<void> {
    await Checkpoint.saveCheckpoint(this.pool, agentId, sessionId, turnNumber, data);
  }

  /**
   * Recover from a crash — get the latest checkpoint for a session.
   */
  async recoverSession(sessionId: string): Promise<Checkpoint.Checkpoint | null> {
    return Checkpoint.getLatestCheckpoint(this.pool, sessionId);
  }

  /**
   * Replay a session — get all checkpoints in order.
   */
  async replaySession(sessionId: string): Promise<Checkpoint.Checkpoint[]> {
    return Checkpoint.getSessionCheckpoints(this.pool, sessionId);
  }

  /**
   * Clear checkpoints for a completed session.
   */
  async clearCheckpoints(sessionId: string): Promise<number> {
    return Checkpoint.clearSessionCheckpoints(this.pool, sessionId);
  }

  // ─── Phase 2: Resource Audit Trail ──────────────────────────────────────

  /**
   * Store a raw input as a Resource before extraction.
   */
  async storeResource(
    agentId: string,
    input: Resources.CreateResourceInput,
  ): Promise<Resources.Resource> {
    return Resources.createResource(this.pool, agentId, input);
  }

  // ─── Core: Store Fact Pipeline ──────────────────────────────────────────

  /**
   * Store a fact through the full Phase 2 pipeline:
   * Write Gate → Resource → Dedup → Conflict Resolution → Insert Item → Category rewrite
   *
   * The item insert is the durable point of success. Later enrichment steps
   * such as embedding persistence, triple writes, sentiment tagging, resource
   * linking, and category rewrites are best-effort and do not roll back the
   * inserted item if they fail.
   */
  async storeFact(
    ctx: AgentContext,
    factText: string,
    options?: {
      sourceType?: string;
      sourceRef?: string;
      tags?: string[];
      resourceId?: string;
    },
  ): Promise<{
    stored: boolean;
    item: MemoryItem | null;
    gateResult: WriteGate.WriteGateResult;
    dedupAction?: 'inserted' | 'merged';
    conflictResolved?: boolean;
  }> {
    // 1. Get existing items for Write Gate conflict check
    const existingItems = await Items.getItems(this.pool, ctx, {
      minConfidence: 0.7,
      limit: 50,
    });

    // 2. Write Gate
    const gateResult = await WriteGate.evaluate(factText, existingItems, {
      apiKey: this.config.writeGate.model === 'claude-haiku' ? process.env.ANTHROPIC_API_KEY! : '',
      model: this.config.writeGate.model,
    });

    // Log gate decision
    await Items.logGateDecision(this.pool, ctx, {
      agentId: ctx.agentId,
      inputText: factText,
      decision: gateResult.decision,
      rejectReason: gateResult.reason,
      confidence: gateResult.confidence,
      categoryKey: gateResult.categoryKey,
      conflictItemId: gateResult.conflictItemId,
      llmModel: this.config.writeGate.model,
      latencyMs: gateResult.latencyMs,
      tokensUsed: gateResult.tokensUsed,
    });

    if (gateResult.decision !== 'accept') {
      return { stored: false, item: null, gateResult };
    }

    // 3. Dedup check (Phase 2 — skip if no embedding service)
    let dedupAction: 'inserted' | 'merged' = 'inserted';
    let embedding: number[] | undefined;

    if (this.embeddingService) {
      try {
        const dedupResult = await Dedup.checkAndDedup(
          this.pool,
          this.embeddingService,
          ctx.agentId,
          factText,
          gateResult.categoryKey ?? null,
        );
        dedupAction = dedupResult.action;
        embedding = dedupResult.embedding;

        if (dedupResult.action === 'merged') {
          // Item was merged into existing — no new insert needed
          return {
            stored: true,
            item: null, // merged into existing
            gateResult,
            dedupAction: 'merged',
          };
        }
      } catch (err) {
        // Non-fatal: dedup failed, proceed with normal insert
        console.error('[memory] Dedup check failed:', (err as Error).message);
      }
    }

    // 4. Conflict Resolution (Phase 2)
    let conflictResolved = false;
    const extracted = ConflictRes.extractSubjectPredicate(factText);
    let conflictCheck: ConflictRes.ConflictCheck | undefined;

    if (extracted) {
      try {
        conflictCheck = await ConflictRes.checkAndResolveConflict(
          this.pool,
          ctx.agentId,
          factText,
        );
        conflictResolved = conflictCheck.hasConflict;
      } catch (err) {
        console.error('[memory] Conflict check failed:', (err as Error).message);
      }
    }

    // 5. Insert the item
    const item = await Items.createItem(this.pool, ctx, {
      factText,
      confidence: gateResult.confidence ?? 0.70,
      categoryKey: gateResult.categoryKey ?? undefined,
      sourceType: options?.sourceType,
      sourceRef: options?.sourceRef,
      tags: options?.tags,
    });

    // 5b. Set embedding on the new item (for future dedup lookups)
    if (embedding) {
      try {
        const embeddingStr = `[${embedding.join(',')}]`;
        await this.pool.query(
          `UPDATE items SET embedding = $1::vector WHERE id = $2`,
          [embeddingStr, item.id],
        );
      } catch (err) {
        console.error('[memory] Embedding store failed:', (err as Error).message);
      }
    }

    // 5c. Set subject/predicate on the new item (for future conflict lookups)
    if (extracted) {
      try {
        await this.pool.query(
          `UPDATE items SET subject = $1, predicate = $2 WHERE id = $3`,
          [extracted.subject, extracted.predicate, item.id],
        );
      } catch (err) {
        console.error('[memory] Subject/predicate store failed:', (err as Error).message);
      }
    }

    // 5d. Link to source resource if provided
    if (options?.resourceId) {
      try {
        await Resources.linkItemToResource(this.pool, item.id, options.resourceId);
      } catch (err) {
        console.error('[memory] Resource link failed:', (err as Error).message);
      }
    }

    // 5e. Phase 3: Set sentiment + extract triples
    try {
      const sentiment = Strength.classifySentiment(factText);
      await Strength.setSentiment(this.pool, item.id, sentiment);
    } catch (err) {
      console.error('[memory] Sentiment set failed:', (err as Error).message);
    }

    if (extracted) {
      try {
        await Triples.upsertTriple(this.pool, ctx.agentId, {
          itemId: item.id,
          subject: extracted.subject,
          predicate: extracted.predicate,
          object: extracted.object,
          confidence: gateResult.confidence ?? 0.70,
          sourceType: options?.sourceType,
        });
      } catch (err) {
        console.error('[memory] Triple upsert failed:', (err as Error).message);
      }
    }

    // 5f. Log conflict resolution
    if (conflictCheck?.hasConflict && conflictCheck.archivedItemId) {
      try {
        await ConflictRes.logConflictResolution(
          this.pool,
          ctx.agentId,
          conflictCheck.archivedItemId,
          item.id,
          conflictCheck.subject,
          conflictCheck.predicate,
          conflictCheck.oldValue ?? '',
          factText,
          'Newer fact supersedes existing active fact',
        );
      } catch (err) {
        console.error('[memory] Conflict log failed:', (err as Error).message);
      }
    }

    // 6. Update category summary
    if (item.categoryKey) {
      try {
        const category = await Categories.getCategoryByKey(
          this.pool,
          ctx,
          item.categoryKey,
        );
        if (category && !category.immutable) {
          const newSummary = await Categories.rewriteSummary(
            category.content,
            factText,
            item.categoryKey,
            {
              apiKey: process.env.ANTHROPIC_API_KEY!,
              model: this.config.writeGate.model,
            },
          );
          await Categories.updateSummary(
            this.pool,
            ctx,
            item.categoryKey,
            newSummary,
            ctx.agentId,
          );
        }
      } catch (err) {
        console.error(
          `[memory] Category update failed for ${item.categoryKey}:`,
          (err as Error).message,
        );
      }
    }

    return {
      stored: true,
      item,
      gateResult,
      dedupAction,
      conflictResolved,
    };
  }

  /**
   * Recall items matching filters.
   */
  async recall(
    ctx: AgentContext,
    filters?: {
      categoryKey?: string;
      minConfidence?: number;
      tags?: string[];
      limit?: number;
    },
  ): Promise<MemoryItem[]> {
    const items = await Items.getItems(this.pool, ctx, filters);

    // Phase 3: Record access on recalled items (bumps strength, prevents decay)
    if (items.length > 0) {
      try {
        await Strength.recordAccessBatch(this.pool, items.map(i => i.id));
      } catch (err) {
        console.error('[memory] Access tracking failed:', (err as Error).message);
      }
    }

    return items;
  }

  /**
   * Get all category summaries for prompt assembly.
   * Returns in sort_order (org → department → agent).
   */
  async getContext(ctx: AgentContext): Promise<Category[]> {
    return Categories.getCategories(this.pool, ctx);
  }

  /**
   * Flush working memory at session end.
   * Phase 2: stores a Resource for the raw data, then extracts facts through pipeline.
   */
  async flushWorkingMemory(
    ctx: AgentContext,
    sessionId: string,
  ): Promise<{ flushed: number; stored: number; rejected: number; merged: number }> {
    const data = WorkingMemory.flush(ctx.agentId, sessionId);
    if (!data) {
      return { flushed: 0, stored: 0, rejected: 0, merged: 0 };
    }

    // Phase 2: Store raw working memory data as a Resource
    let resourceId: string | undefined;
    try {
      const resource = await this.storeResource(ctx.agentId, {
        rawContent: JSON.stringify(data.data),
        sourceType: 'working_memory_flush',
        conversationId: sessionId,
      });
      resourceId = resource.id;
    } catch (err) {
      console.error('[memory] Resource store failed:', (err as Error).message);
    }

    // Extract fact-like values from working memory
    const facts: string[] = [];
    for (const [_key, value] of Object.entries(data.data)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        facts.push(value);
      } else if (typeof value === 'object' && value !== null) {
        const strValues = Object.values(value as Record<string, unknown>)
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
        facts.push(...strValues);
      }
    }

    let stored = 0;
    let rejected = 0;
    let merged = 0;

    for (const fact of facts) {
      const result = await this.storeFact(ctx, fact, {
        sourceType: 'working_memory_flush',
        sourceRef: sessionId,
        resourceId,
      });
      if (result.stored) {
        if (result.dedupAction === 'merged') merged++;
        else stored++;
      } else {
        rejected++;
      }
    }

    // Phase 2: Clear checkpoints for this session (no longer needed after flush)
    try {
      await this.clearCheckpoints(sessionId);
    } catch (err) {
      console.error('[memory] Checkpoint cleanup failed:', (err as Error).message);
    }

    // Phase 3: Auto-detect episodes from recently stored facts
    try {
      const episode = await Episodes.detectEpisode(this.pool, ctx.agentId);
      if (episode) {
        console.log(`[memory] Episode auto-detected: "${episode.title}" (${episode.factCount} facts)`);
      }
    } catch (err) {
      console.error('[memory] Episode detection failed:', (err as Error).message);
    }

    return { flushed: facts.length, stored, rejected, merged };
  }

  // ─── Phase 3: Knowledge Graph Queries ───────────────────────────────────

  /**
   * Query the knowledge graph by subject.
   */
  async queryTriples(
    agentId: string,
    query: { subject?: string; predicate?: string; object?: string },
    limit = 50,
  ): Promise<Triples.Triple[]> {
    if (query.subject) {
      return Triples.queryBySubject(this.pool, agentId, query.subject, { limit });
    }
    if (query.predicate) {
      return Triples.queryByPredicate(this.pool, agentId, query.predicate, { limit });
    }
    if (query.object) {
      return Triples.queryByObject(this.pool, agentId, query.object, { limit });
    }
    return [];
  }

  /**
   * Semantic search over episode summaries.
   */
  async searchEpisodes(
    agentId: string,
    query: string,
    options?: { limit?: number; minSimilarity?: number },
  ): Promise<Episodes.EpisodeSearchResult[]> {
    if (!this.embeddingService) return [];
    return Episodes.searchEpisodes(this.pool, this.embeddingService, agentId, query, options);
  }

  /**
   * Get episodes for an agent.
   */
  async getEpisodes(
    agentId: string,
    options?: { status?: string; limit?: number; after?: Date },
  ): Promise<Episodes.Episode[]> {
    return Episodes.getEpisodes(this.pool, agentId, options);
  }

  /**
   * Close an episode with a summary (generates embedding for search).
   */
  async closeEpisode(episodeId: string, summary: string): Promise<Episodes.Episode> {
    return Episodes.closeEpisode(this.pool, episodeId, summary, this.embeddingService ?? undefined);
  }

  // ─── Maintenance ────────────────────────────────────────────────────────

  /**
   * Run periodic maintenance tasks.
   * Call from application-level scheduler or cron.
   */
  async runMaintenance(agentId?: string): Promise<{
    checkpointsDeleted: number;
    resourcesArchived: number;
    strengthDecayed: number;
    weakArchived: number;
  }> {
    const checkpointsDeleted = await Checkpoint.cleanupExpiredCheckpoints(this.pool, 24);
    const resourcesArchived = await Resources.archiveOldResources(this.pool, 90);

    let strengthDecayed = 0;
    let weakArchived = 0;

    // Phase 3: Apply decay and archive weak items
    if (agentId) {
      try {
        const decay = await Strength.applyDecay(this.pool, agentId);
        strengthDecayed = decay.decayed;
        weakArchived = await Strength.archiveWeakItems(this.pool, agentId);
      } catch (err) {
        console.error('[memory] Strength decay failed:', (err as Error).message);
      }
    }

    return { checkpointsDeleted, resourcesArchived, strengthDecayed, weakArchived };
  }
}
