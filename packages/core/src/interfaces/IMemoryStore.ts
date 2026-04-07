/**
 * IMemoryStore — Abstract interface for the agent memory subsystem.
 *
 * The packages/memory package already provides a concrete Postgres-backed
 * implementation (MemoryManager). This interface validates that the existing
 * API surface is clean and documents the contract for alternative backends.
 *
 * For Phase 1, the existing MemoryManager IS the default adapter — no wrapper
 * needed. This interface exists so future backends (SQLite for eval, DynamoDB
 * for serverless) have a clear contract to implement.
 */

// ─── Memory Item Types ──────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  agentId: string;
  category: string;
  content: string;
  /** Confidence/strength score (0.0 to 1.0). */
  strength: number;
  /** ISO-8601 timestamp of creation. */
  createdAt: string;
  /** ISO-8601 timestamp of last access. */
  lastAccessedAt: string;
  /** Type: permanent, operational, or transient. */
  durability: 'permanent' | 'operational' | 'transient';
  metadata?: Record<string, unknown>;
}

export interface MemoryTriple {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
}

export interface MemoryEpisode {
  id: string;
  agentId: string;
  summary: string;
  events: string[];
  startedAt: string;
  endedAt?: string;
}

// ─── Search Types ───────────────────────────────────────────────────────────

export interface MemorySearchOptions {
  /** Agent to search memories for. */
  agentId: string;
  /** Text query for semantic search. */
  query: string;
  /** Filter by category. */
  category?: string;
  /** Filter by minimum strength. */
  minStrength?: number;
  /** Maximum number of results. */
  limit?: number;
}

export interface MemorySearchResult {
  item: MemoryItem;
  /** Relevance score (higher is better). */
  relevanceScore: number;
}

// ─── IMemoryStore ───────────────────────────────────────────────────────────

export interface IMemoryStore {
  /** Connect to the backing store. */
  connect(): Promise<void>;

  /** Disconnect gracefully. */
  disconnect(): Promise<void>;

  /** Returns true if the store is connected and operational. */
  healthy(): Promise<boolean>;

  // ─── Memory Items ───────────────────────────────────────────────────────

  /** Store a new memory item. */
  store(item: Omit<MemoryItem, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<string>;

  /** Retrieve a memory item by ID. */
  recall(id: string): Promise<MemoryItem | null>;

  /** Search memories by semantic similarity. */
  search(options: MemorySearchOptions): Promise<MemorySearchResult[]>;

  /** Update the strength of a memory item. */
  reinforce(id: string, strengthDelta: number): Promise<void>;

  /** Remove a memory item. */
  forget(id: string): Promise<void>;

  // ─── Knowledge Triples ──────────────────────────────────────────────────

  /** Store a subject-predicate-object triple. */
  storeTriple(triple: MemoryTriple): Promise<void>;

  /** Query triples by subject, predicate, or object. */
  queryTriples(query: Partial<MemoryTriple>): Promise<MemoryTriple[]>;

  // ─── Episodes ───────────────────────────────────────────────────────────

  /** Record an episode (a sequence of related events). */
  recordEpisode(episode: Omit<MemoryEpisode, 'id'>): Promise<string>;

  /** Get recent episodes for an agent. */
  getRecentEpisodes(agentId: string, limit?: number): Promise<MemoryEpisode[]>;

  // ─── Working Memory ─────────────────────────────────────────────────────

  /** Get the transient working memory for an agent (session-scoped). */
  getWorkingMemory(agentId: string): Promise<Record<string, unknown>>;

  /** Update the transient working memory for an agent. */
  setWorkingMemory(agentId: string, data: Record<string, unknown>): Promise<void>;
}
