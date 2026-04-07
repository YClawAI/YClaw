# @yclaw/memory

Structured memory package for YClaw Agents. Stores facts, categories, checkpoints, resources, triples, and episode metadata in PostgreSQL with optional pgvector-backed deduplication and semantic search.

The package is organized into three implementation phases, each adding progressively advanced capabilities. All phases share the same `MemoryManager` orchestrator.

## Requirements

- Node.js >= 20
- PostgreSQL with the following extensions: `uuid-ossp`, `pgvector`, `pg_trgm`

## Installation

```bash
npm install --workspace=packages/memory
```

## Database Setup

Run migrations in order against your PostgreSQL instance. The quickest path uses the bundled migration runner:

```bash
MEMORY_DATABASE_URL=postgres://user:pass@host:5432/yclaw \
  node packages/memory/scripts/migrate.js
```

The runner executes migrations `001` and `002`. For the full schema (Phases 2 and 3), apply migrations `003` through `006` directly:

```bash
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/003_write_gate_log_rls.sql
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/004_idempotent_ddl.sql
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/005_phase2_tables.sql
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/006_phase3_tables.sql
```

### Migration Summary

| File | Phase | Description |
|---|---|---|
| `001_create_memory_tables.sql` | 1 | Core tables (`items`, `write_gate_log`, `categories`, `category_archives`), RLS policies, triggers |
| `002_seed_categories.sql` | 1 | Seed org-level, department-level, and per-agent default categories |
| `003_write_gate_log_rls.sql` | 1 | Add RLS to `write_gate_log` (tech debt fix) |
| `004_idempotent_ddl.sql` | 2 | Schema version tracking, idempotent index creation |
| `005_phase2_tables.sql` | 2 | `checkpoints`, `resources`, `dedup_log`, `conflict_log` tables; `embedding`, `subject`, `predicate`, `archived_at`, `source_resource_id` columns on `items` |
| `006_phase3_tables.sql` | 3 | `strength`, `sentiment`, `access_count`, `last_accessed_at` columns on `items`; `triples`, `episodes`, `episode_items` tables |

## Quick Start

```typescript
import { getPool, MemoryManager, NullEmbeddingService } from '@yclaw/memory';
import type { MemoryConfig } from '@yclaw/memory';

const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'yclaw',
  user: 'postgres',
  password: 'postgres',
};

const pool = getPool(pgConfig);

const config: MemoryConfig = {
  postgres: pgConfig,
  writeGate: {
    model: 'claude-haiku-4-20250514',
    maxDailyBudgetCents: 100,
  },
  workingMemory: {
    maxSizeBytes: 16 * 1024,
  },
};

const memory = new MemoryManager(pool, config, new NullEmbeddingService());

// Store a fact through the full pipeline
const result = await memory.storeFact(
  { agentId: 'builder', departmentId: 'development' },
  'Builder uses the ACP executor for iterative CI-fix loops.',
  { sourceType: 'manual' },
);

// Recall facts
const items = await memory.recall(
  { agentId: 'builder', departmentId: 'development' },
  { minConfidence: 0.7, limit: 20 },
);

// Get category summaries for prompt assembly
const categories = await memory.getContext({
  agentId: 'builder',
  departmentId: 'development',
});
```

## Public Exports

The package barrel (`src/index.ts`) exports all modules:

```typescript
// Types
export * from './types.js';

// Database
export * from './db/pg.js';

// Phase 1 modules (namespace exports)
export * as WorkingMemory from './working-memory.js';
export * as WriteGate from './write-gate.js';
export * as Items from './items.js';
export * as Categories from './categories.js';
export { MemoryManager } from './memory-manager.js';

// Phase 2 modules
export * as Checkpoint from './checkpoint.js';
export * as Resources from './resources.js';
export * as Dedup from './dedup.js';
export * as ConflictResolution from './conflict-resolution.js';
export { OpenAIEmbeddingService, NullEmbeddingService, type EmbeddingService } from './embeddings.js';

// Phase 3 modules
export * as Strength from './strength.js';
export * as Triples from './triples.js';
export * as Episodes from './episodes.js';
```

## Module Reference

### Phase 1: Core

#### WorkingMemory

Ephemeral per-session scratch space. In-process only (no database). Keyed by `agentId:sessionId`. Enforces a 16 KB size limit.

```typescript
import * as WorkingMemory from '@yclaw/memory';

WorkingMemory.load(agentId, sessionId): WorkingMemoryState
WorkingMemory.write(agentId, sessionId, dataKey, value): { success: boolean; error?: string }
WorkingMemory.read(agentId, sessionId, dataKey): unknown | undefined
WorkingMemory.getAll(agentId, sessionId): Record<string, unknown>
WorkingMemory.flush(agentId, sessionId): { agentId, sessionId, data, flushedAt } | null
WorkingMemory.clear(agentId, sessionId): void
WorkingMemory.activeSessionCount(): number
```

- `write` checks the serialized size and rolls back the write if it exceeds 16 KB.
- `flush` returns a snapshot and clears the session entry. Returns `null` if the session is empty.

#### WriteGate

LLM-powered quality filter that evaluates candidate facts before storage. Uses the Anthropic Messages API directly.

```typescript
import * as WriteGate from '@yclaw/memory';

WriteGate.evaluate(
  candidateFact: string,
  existingItems: MemoryItem[],
  options: { apiKey: string; model?: string },
): Promise<WriteGateResult>
```

The gate classifies facts into three categories:
- **permanent** -- architecture decisions, conventions, configurations. Proceeds to quality checks.
- **operational** -- task statuses, metrics, system health. Rejected immediately (agents must query live systems).
- **transient** -- session-specific observations, one-time notes. Rejected immediately.

**`WriteGateResult`:**

```typescript
interface WriteGateResult {
  decision: 'accept' | 'reject' | 'conflict';
  reason: string | null;
  confidence: number | null;       // 0.0-1.0
  categoryKey: string | null;      // suggested category slug
  conflictItemId: string | null;
  factCategory: 'permanent' | 'operational' | 'transient' | null;
  latencyMs: number;
  tokensUsed: number | null;
}
```

Default model: `claude-haiku-4-20250514`. Rejects on empty input, API errors, and JSON parse failures (fail-closed).

#### Items

CRUD operations for atomic facts with confidence scoring.

```typescript
import * as Items from '@yclaw/memory';

Items.createItem(pool, ctx, { factText, confidence?, categoryKey?, sourceType?, sourceRef?, tags? }): Promise<MemoryItem>
Items.getItems(pool, ctx, { categoryKey?, minConfidence?, status?, tags?, limit? }): Promise<MemoryItem[]>
Items.updateConfidence(pool, ctx, itemId, delta, reason): Promise<MemoryItem | null>
Items.archiveItem(pool, ctx, itemId): Promise<boolean>
Items.logGateDecision(pool, ctx, entry): Promise<void>
```

- Default confidence: `0.70`. Clamped to `[0.0, 1.0]`.
- Default status filter: `active`. Ordered by confidence DESC, then created_at DESC.
- `archiveItem` performs a soft delete (sets `status = 'archived'`).

#### Categories

Versioned summary documents per knowledge domain. Scoped by org, department, or agent. Old versions are archived before rewrite.

```typescript
import * as Categories from '@yclaw/memory';

Categories.getCategories(pool, ctx): Promise<Category[]>
Categories.getCategoryByKey(pool, ctx, categoryKey): Promise<Category | null>
Categories.updateSummary(pool, ctx, categoryKey, newContent, archivedBy): Promise<Category | null>
Categories.rewriteSummary(currentSummary, newFact, categoryKey, { apiKey, model? }): Promise<string>
```

- `getCategories` returns categories visible to the agent (org + department + agent scope), ordered by `sort_order`.
- `updateSummary` archives the current version and increments the version number. Throws if the category is immutable.
- `rewriteSummary` calls the Anthropic Messages API to produce an updated summary incorporating the new fact. Default model: `claude-haiku-4-20250514`.

**Default category scopes:**

| Scope | Count | Examples |
|---|---|---|
| org | 6 | `org.identity`, `org.authority`, `org.product_knowledge`, `org.brand_voice`, `org.compliance`, `org.processes.standup` |
| department | 12 | `dept.development.engineering`, `dept.marketing.audience`, `dept.operations.infrastructure` |
| agent | 7 per agent | `agent.<name>.directives`, `.tasks`, `.lessons`, `.tools`, `.blockers`, `.collaborations`, `.config` |

#### MemoryManager

Top-level orchestrator that wires all modules together. Constructed with a `Pool`, `MemoryConfig`, and an optional `EmbeddingService`.

```typescript
import { MemoryManager } from '@yclaw/memory';

const mm = new MemoryManager(pool, config, embeddingService?);

// Core pipeline
mm.storeFact(ctx, factText, options?): Promise<{ stored, item, gateResult, dedupAction?, conflictResolved? }>
mm.recall(ctx, filters?): Promise<MemoryItem[]>
mm.getContext(ctx): Promise<Category[]>
mm.flushWorkingMemory(ctx, sessionId): Promise<{ flushed, stored, rejected, merged }>

// Checkpoint
mm.saveCheckpoint(agentId, sessionId, turnNumber, data): Promise<void>
mm.recoverSession(sessionId): Promise<Checkpoint | null>
mm.replaySession(sessionId): Promise<Checkpoint[]>
mm.clearCheckpoints(sessionId): Promise<number>

// Resources
mm.storeResource(agentId, input): Promise<Resource>

// Knowledge graph
mm.queryTriples(agentId, { subject?, predicate?, object? }, limit?): Promise<Triple[]>

// Episodes
mm.searchEpisodes(agentId, query, options?): Promise<EpisodeSearchResult[]>
mm.getEpisodes(agentId, options?): Promise<Episode[]>
mm.closeEpisode(episodeId, summary): Promise<Episode>

// Maintenance
mm.runMaintenance(agentId?): Promise<{ checkpointsDeleted, resourcesArchived, strengthDecayed, weakArchived }>
```

**`storeFact` pipeline:**

1. Load recent high-confidence items (top 50, confidence >= 0.7).
2. Evaluate through WriteGate.
3. Log the gate decision.
4. If rejected, return early.
5. Run dedup check via embeddings (if `EmbeddingService` configured). If merged, return early.
6. Run conflict resolution via subject/predicate extraction.
7. Insert the item.
8. Store embedding, subject/predicate, resource link, sentiment, and triple (all best-effort).
9. Log conflict resolution if applicable.
10. Rewrite the category summary if the item has a `categoryKey` and the category is mutable.

**`recall`** bumps strength on all returned items via `Strength.recordAccessBatch`.

**`flushWorkingMemory`** extracts string values from working memory, stores a Resource for the raw data, runs each value through `storeFact`, clears checkpoints for the session, and attempts episode auto-detection.

**`runMaintenance`** cleans up expired checkpoints (24h), archives old resources (90d), applies strength decay, and archives weak items.

### Phase 2: Reliability

#### Checkpoint

Session crash recovery and replay. Serializes execution state after every agent turn. Ephemeral with a 24-hour TTL.

```typescript
import * as Checkpoint from '@yclaw/memory';

Checkpoint.saveCheckpoint(pool, agentId, sessionId, turnNumber, data): Promise<void>
Checkpoint.getLatestCheckpoint(pool, sessionId): Promise<Checkpoint | null>
Checkpoint.getCheckpoint(pool, sessionId, turnNumber): Promise<Checkpoint | null>
Checkpoint.getSessionCheckpoints(pool, sessionId): Promise<Checkpoint[]>
Checkpoint.cleanupExpiredCheckpoints(pool, ttlHours?): Promise<number>
Checkpoint.clearSessionCheckpoints(pool, sessionId): Promise<number>
```

**`CheckpointData`:**

```typescript
interface CheckpointData {
  userInput?: unknown;
  toolCalls?: unknown;
  llmOutput?: unknown;
  internalState?: unknown;
}
```

Uses `ON CONFLICT (session_id, turn_number) DO UPDATE` for idempotent saves.

#### Resources

Append-only audit trail for raw inputs. Every message, event, or API response is stored before fact extraction. Items reference back to their source resource.

```typescript
import * as Resources from '@yclaw/memory';

Resources.createResource(pool, agentId, input): Promise<Resource>
Resources.getResource(pool, resourceId): Promise<Resource | null>
Resources.getResources(pool, agentId, options?): Promise<Resource[]>
Resources.linkItemToResource(pool, itemId, resourceId): Promise<void>
Resources.archiveOldResources(pool, retentionDays?): Promise<number>
Resources.hashContent(content): string
```

- Deduplicates by SHA-256 hash per agent at ingestion time.
- `archiveOldResources` deletes resources older than the retention period (default 90 days) that are not referenced by any item.

#### Dedup

Cosine similarity deduplication via pgvector. Checks for near-duplicates before item insertion. If a match exceeds the threshold, merges into the existing item (updates text, bumps confidence by +0.05).

```typescript
import * as Dedup from '@yclaw/memory';

Dedup.checkAndDedup(pool, embeddingService, agentId, factText, categoryKey, options?):
  Promise<DedupResult & { embedding: number[] }>
Dedup.getDedupLog(pool, agentId, limit?): Promise<DedupLogEntry[]>
```

- Default similarity threshold: `0.85`.
- When scoped to a `categoryKey`, only compares against items in the same category.
- Returns `action: 'merged'` if a duplicate was found, `action: 'inserted'` if the caller should proceed with insertion.

#### ConflictResolution

One-active-truth enforcement via subject+predicate extraction. Before writing a new fact, checks for existing active facts with the same subject+predicate pair. If found, archives the old item and logs the conflict.

```typescript
import * as ConflictResolution from '@yclaw/memory';

ConflictResolution.extractSubjectPredicate(factText):
  { subject: string; predicate: string; object: string } | null
ConflictResolution.checkAndResolveConflict(pool, agentId, factText): Promise<ConflictCheck>
ConflictResolution.logConflictResolution(pool, agentId, archivedItemId, newItemId,
  subject, predicate, oldValue, newValue, reason?): Promise<void>
ConflictResolution.getConflictLog(pool, agentId, limit?): Promise<ConflictLogEntry[]>
```

`extractSubjectPredicate` uses regex pattern matching (not LLM) to decompose facts into subject-predicate-object triples. Supported verb patterns: `is`, `has/have`, `uses/prefers/requires/supports/runs/needs`, `was/were/became`, `can/should/must/will`, `costs/takes/produces/generates/returns`.

#### Embeddings

Thin wrapper around the OpenAI text-embedding-3-small API. Shared by Dedup and Episode Search.

```typescript
import { OpenAIEmbeddingService, NullEmbeddingService } from '@yclaw/memory';
import type { EmbeddingService } from '@yclaw/memory';

// Production
const embeddings = new OpenAIEmbeddingService({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',  // default
  dimensions: 1536,                  // default
});

// Development / testing (returns zero vectors, dedup never matches)
const nullEmbeddings = new NullEmbeddingService();
```

**`EmbeddingService` interface:**

```typescript
interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

`OpenAIEmbeddingService.embedBatch` automatically chunks inputs into batches of 2048 (the OpenAI API limit) and reassembles results in input order.

### Phase 3: Advanced

#### Strength + Sentiment

Decay-based memory strength and emotional tone classification.

```typescript
import * as Strength from '@yclaw/memory';

Strength.calculateDecayedStrength(currentStrength, lastAccessedAt, now?): number
Strength.recordAccess(pool, itemId): Promise<void>
Strength.recordAccessBatch(pool, itemIds): Promise<void>
Strength.applyDecay(pool, agentId): Promise<{ decayed: number; belowMinimum: number }>
Strength.archiveWeakItems(pool, agentId, threshold?): Promise<number>
Strength.setSentiment(pool, itemId, sentiment): Promise<void>
Strength.classifySentiment(text): Sentiment   // 'positive' | 'negative' | 'neutral' | 'mixed'
```

**Decay model:**
- Half-life: 30 days without access.
- Access bump: +0.15 (capped at 1.0).
- Minimum strength: 0.01 (below this, items are candidates for archival).
- Formula: `strength * exp(-ln2/30 * daysSinceAccess)`

**Sentiment classifier:** Keyword-based heuristic. Counts positive words (success, completed, resolved, etc.) and negative words (failed, error, broken, etc.) to determine tone. In production this would use an LLM or lightweight classifier.

#### Triples

Subject-Predicate-Object knowledge graph. Facts decompose into triples that enable structured queries. Enforces one active triple per agent+subject+predicate pair.

```typescript
import * as Triples from '@yclaw/memory';

Triples.upsertTriple(pool, agentId, input): Promise<{ triple: Triple; replaced: boolean; oldTripleId?: string }>
Triples.queryBySubject(pool, agentId, subject, options?): Promise<Triple[]>
Triples.queryByPredicate(pool, agentId, predicate, options?): Promise<Triple[]>
Triples.queryByObject(pool, agentId, object, options?): Promise<Triple[]>
Triples.getTriplesForItem(pool, itemId): Promise<Triple[]>
Triples.extractTriples(factText): Array<{ subject, predicate, object }>
```

- `upsertTriple`: If an active triple with the same subject+predicate exists and the object matches, bumps confidence. If the object differs, archives the old triple and inserts the new one.
- `queryByObject` uses `ILIKE` for partial matching.
- `extractTriples` extends the conflict-resolution patterns with additional verbs: `depends on`, `connects to`, `deployed to`, `owns`, `manages`, etc.

#### Episodes

Groups related facts into coherent narrative units with auto-detection and semantic search.

```typescript
import * as Episodes from '@yclaw/memory';

Episodes.createEpisode(pool, agentId, title, options?): Promise<Episode>
Episodes.addItemToEpisode(pool, episodeId, itemId): Promise<void>
Episodes.closeEpisode(pool, episodeId, summary, embeddingService?): Promise<Episode>
Episodes.getOpenEpisode(pool, agentId): Promise<Episode | null>
Episodes.getEpisodes(pool, agentId, options?): Promise<Episode[]>
Episodes.getEpisodeItems(pool, episodeId): Promise<string[]>
Episodes.searchEpisodes(pool, embeddingService, agentId, query, options?): Promise<EpisodeSearchResult[]>
Episodes.detectEpisode(pool, agentId, windowMinutes?, minFacts?): Promise<Episode | null>
```

**Auto-detection:** `detectEpisode` finds un-episoded active items created within a time window (default 60 minutes). If 3 or more exist, it creates an episode, links all items, and generates a title from the first fact.

**Episode search:** `searchEpisodes` embeds the query string and performs cosine similarity search over episode summary embeddings via pgvector. Default minimum similarity: 0.3.

**Episode states:** `open`, `closed`, `archived`.

## Core Types

```typescript
type CategoryScope = 'org' | 'department' | 'agent';
type ItemStatus = 'active' | 'archived' | 'rejected';
type WriteGateDecision = 'accept' | 'reject' | 'conflict';
type SourceType = 'conversation' | 'event' | 'tool_output' | 'cross_agent' | 'manual' | 'system';
type Sentiment = 'positive' | 'negative' | 'neutral' | 'mixed';

interface MemoryItem {
  id: string;
  agentId: string;
  factText: string;
  confidence: number;
  categoryKey: string | null;
  sourceType: SourceType;
  sourceRef: string | null;
  tags: string[];
  status: ItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface Category {
  id: string;
  categoryKey: string;
  scope: CategoryScope;
  departmentId: string | null;
  agentId: string | null;
  content: string;
  version: number;
  tags: string[];
  immutable: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MemoryConfig {
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  };
  writeGate: {
    model: string;
    maxDailyBudgetCents: number;
  };
  workingMemory: {
    maxSizeBytes: number;
  };
}

const DEFAULT_AGENT_CATEGORIES = [
  'directives', 'tasks', 'lessons', 'tools',
  'blockers', 'collaborations', 'config',
] as const;
```

## Database Layer

The `db/pg.ts` module provides a thin wrapper around `pg.Pool`:

```typescript
import { getPool, closePool, query, withTransaction } from '@yclaw/memory';

// Singleton pool (min 2, max 5 connections, 30s idle timeout, 5s connect timeout)
const pool = getPool(config.postgres);

// Query with optional RLS context
await query(pool, 'SELECT * FROM items WHERE id = $1', [id], { agentId: 'builder' });

// Transaction with RLS context
await withTransaction(pool, { agentId: 'builder', role: 'write_gate' }, async (client) => {
  await client.query('UPDATE items SET ...', [...]);
});

// Shutdown
await closePool();
```

RLS context is set via `set_config('app.agent_id', $1, true)` (transaction-scoped). Available context variables: `app.agent_id`, `app.department_id`, `app.role`.

## Row-Level Security

All tables enforce RLS. Key policies:

| Table | Policy | Effect |
|---|---|---|
| `items` | `items_agent_isolation` | Agents see only their own items |
| `categories` | `cat_org_read` | All agents read org-scope categories |
| `categories` | `cat_dept_read` | Agents read their department's categories |
| `categories` | `cat_agent_read` | Agents read only their own agent-scope categories |
| `categories` | `cat_write` / `cat_update` | Only the `write_gate` role can insert/update |
| `write_gate_log` | `wg_agent_read` | Agents read their own gate logs |
| `resources` | `resource_executive_read` | Executive role can read all resources |
| `checkpoints`, `dedup_log`, `conflict_log`, `triples`, `episodes` | Agent isolation | Agents see only their own data |

## Testing

```bash
npm test --workspace=packages/memory       # Run tests
npm run test:watch --workspace=packages/memory  # Watch mode
```

Tests are colocated at `src/memory.test.ts`. Current coverage: default category presence, working memory load/write/flush behavior. Database-backed modules do not have integration tests yet.

## Source Files

| File | Purpose |
|---|---|
| `src/types.ts` | Core type definitions, `MemoryConfig`, `DEFAULT_AGENT_CATEGORIES` |
| `src/index.ts` | Package barrel -- re-exports all modules |
| `src/db/pg.ts` | PostgreSQL pool, RLS context, `query`, `withTransaction` |
| `src/working-memory.ts` | In-process ephemeral scratch space |
| `src/write-gate.ts` | LLM-powered fact quality filter |
| `src/items.ts` | CRUD for atomic facts |
| `src/categories.ts` | Versioned category summaries with LLM rewrite |
| `src/memory-manager.ts` | Top-level orchestrator (`MemoryManager` class) |
| `src/checkpoint.ts` | Session crash recovery and replay |
| `src/resources.ts` | Append-only raw input audit trail |
| `src/dedup.ts` | Cosine similarity deduplication via pgvector |
| `src/conflict-resolution.ts` | One-active-truth enforcement |
| `src/embeddings.ts` | `OpenAIEmbeddingService` and `NullEmbeddingService` |
| `src/strength.ts` | Decay-based strength, access tracking, sentiment classification |
| `src/triples.ts` | Subject-predicate-object knowledge graph |
| `src/episodes.ts` | Narrative episode grouping and semantic search |
| `src/pg.d.ts` | Type declarations for the `pg` module |
| `src/memory.test.ts` | Unit tests (vitest) |
| `scripts/migrate.js` | Migration runner script |
| `migrations/*.sql` | Database schema migrations (001-006) |
