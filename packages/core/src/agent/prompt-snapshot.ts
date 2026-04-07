/**
 * PromptSnapshot — frozen system prompt management for Anthropic cache stability.
 *
 * Enabled via: FF_PROMPT_CACHING=true
 *
 * Problem:
 *   Anthropic's prompt caching requires byte-identical system prompt text across
 *   requests to get cache hits. If the system prompt changes between rounds (e.g.
 *   due to non-deterministic manifest generation or memory updates), the cache is
 *   invalidated every turn.
 *
 * Solution:
 *   1. At session start, compute SHA-256 of the system prompt content.
 *   2. Store the frozen snapshot keyed by sessionId (in-memory store).
 *   3. On every subsequent round in the same session, reconstruct from the snapshot
 *      so the bytes are always identical.
 *   4. Record snapshotId in the SessionRecord for observability.
 *
 * Future:
 *   Cross-session reuse (implement → CI-fix → re-review) requires a Redis-backed
 *   store keyed by threadKey with TTL = session TTL. The in-memory store here
 *   captures the interface contract; the Redis adapter is tracked as future work.
 */

import { createHash } from 'node:crypto';

/** Number of hex characters to keep from the SHA-256 digest (16 bytes). */
const SNAPSHOT_ID_LENGTH = 32;

export interface PromptSnapshot {
  /** First 32 hex chars of SHA-256(content). Stable across same-content rebuilds. */
  snapshotId: string;
  /** Semantic alias for snapshotId — used in SessionRecord for clarity. */
  textHash: string;
  /** The frozen system prompt content bytes. */
  content: string;
  /** ISO 8601 timestamp when this snapshot was first created. */
  createdAt: string;
}

/**
 * Compute a deterministic snapshot ID from system prompt text.
 *
 * Returns the first 32 hex characters of SHA-256(content, 'utf8').
 * Two calls with identical content always produce the same ID.
 */
export function computeSnapshotId(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, SNAPSHOT_ID_LENGTH);
}

/**
 * In-memory store of prompt snapshots keyed by session/thread key.
 *
 * Thread-safe within a single Node.js process (single-threaded event loop).
 * Not persisted — snapshots are lost on process restart.
 *
 * For cross-execution cache reuse, a Redis-backed implementation would key
 * snapshots by `threadKey` (SHA-256 of repo+PR+taskType) with TTL matching
 * the session lifetime.
 */
export class PromptSnapshotStore {
  private readonly snapshots = new Map<string, PromptSnapshot>();

  /**
   * Create and store a new snapshot for the given key.
   * Overwrites any existing snapshot for that key.
   */
  set(key: string, content: string): PromptSnapshot {
    const snapshotId = computeSnapshotId(content);
    const snapshot: PromptSnapshot = {
      snapshotId,
      textHash: snapshotId,
      content,
      createdAt: new Date().toISOString(),
    };
    this.snapshots.set(key, snapshot);
    return snapshot;
  }

  /**
   * Retrieve an existing snapshot for the given key.
   * Returns undefined if no snapshot exists yet.
   */
  get(key: string): PromptSnapshot | undefined {
    return this.snapshots.get(key);
  }

  /**
   * Freeze the system prompt for a session.
   *
   * First call for a key: stores a new snapshot and returns it.
   * Subsequent calls for the same key: returns the existing snapshot.
   *
   * This is the primary API for ensuring byte-identical system prompts:
   *   const snap = store.freeze(sessionId, messages[0]!.content);
   *   messages[0] = { ...messages[0], content: snap.content };
   */
  freeze(key: string, content: string): PromptSnapshot {
    const existing = this.snapshots.get(key);
    if (existing) return existing;
    return this.set(key, content);
  }

  /** Remove a snapshot when the session ends. */
  delete(key: string): boolean {
    return this.snapshots.delete(key);
  }

  /** Number of stored snapshots. */
  get size(): number {
    return this.snapshots.size;
  }
}
