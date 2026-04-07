/**
 * @yclaw/memory — Memory Architecture for YClaw Agents
 * Phase 1: Working Memory, Write Gate, Items, Categories, MemoryManager
 * Phase 2: Checkpoint, Resources, Dedup, Conflict Resolution, Embeddings
 * Phase 3: Strength+Sentiment, Triples, Episodes, Episode Search
 */

export * from './types.js';
export * from './db/pg.js';
export * as WorkingMemory from './working-memory.js';
export * as WriteGate from './write-gate.js';
export * as Items from './items.js';
export * as Categories from './categories.js';
export { MemoryManager } from './memory-manager.js';

// Phase 2
export * as Checkpoint from './checkpoint.js';
export * as Resources from './resources.js';
export * as Dedup from './dedup.js';
export * as ConflictResolution from './conflict-resolution.js';
export {
  OpenAIEmbeddingService,
  NullEmbeddingService,
  type EmbeddingService,
} from './embeddings.js';

// Phase 3
export * as Strength from './strength.js';
export * as Triples from './triples.js';
export * as Episodes from './episodes.js';
