/**
 * Memory Architecture — Working Memory
 * Ephemeral per-session scratch space. In-process only, no DB.
 * Flushed to Items pipeline on session end.
 */

import type { WorkingMemoryState } from './types.js';

const MAX_SIZE_BYTES = 16 * 1024; // 16KB per Troy's decision

/** In-memory store keyed by `${agentId}:${sessionId}` */
const store = new Map<string, WorkingMemoryState>();

function key(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

/**
 * Create or get working memory for an agent session.
 */
export function load(agentId: string, sessionId: string): WorkingMemoryState {
  const k = key(agentId, sessionId);
  let state = store.get(k);
  if (!state) {
    state = {
      agentId,
      sessionId,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.set(k, state);
  }
  return state;
}

/**
 * Write a key-value pair to working memory (overwrites, never appends).
 */
export function write(
  agentId: string,
  sessionId: string,
  dataKey: string,
  value: unknown,
): { success: boolean; error?: string } {
  const state = load(agentId, sessionId);
  state.data[dataKey] = value;
  state.updatedAt = new Date();

  // Check size limit
  const size = Buffer.byteLength(JSON.stringify(state.data), 'utf-8');
  if (size > MAX_SIZE_BYTES) {
    delete state.data[dataKey];
    return {
      success: false,
      error: `Working memory would exceed ${MAX_SIZE_BYTES} bytes (attempted: ${size})`,
    };
  }

  return { success: true };
}

/**
 * Read a value from working memory.
 */
export function read(agentId: string, sessionId: string, dataKey: string): unknown | undefined {
  const state = store.get(key(agentId, sessionId));
  return state?.data[dataKey];
}

/**
 * Get all working memory data for flush-to-Items.
 */
export function getAll(agentId: string, sessionId: string): Record<string, unknown> {
  const state = store.get(key(agentId, sessionId));
  return state?.data ?? {};
}

/**
 * Clear working memory for a session (called after flush).
 */
export function clear(agentId: string, sessionId: string): void {
  store.delete(key(agentId, sessionId));
}

/**
 * Flush working memory to Items pipeline.
 * Returns the data that should be processed through Write Gate → Items.
 * Clears the working memory after extraction.
 */
export function flush(agentId: string, sessionId: string): {
  agentId: string;
  sessionId: string;
  data: Record<string, unknown>;
  flushedAt: Date;
} | null {
  const state = store.get(key(agentId, sessionId));
  if (!state || Object.keys(state.data).length === 0) {
    clear(agentId, sessionId);
    return null;
  }

  const flushed = {
    agentId: state.agentId,
    sessionId: state.sessionId,
    data: { ...state.data },
    flushedAt: new Date(),
  };

  clear(agentId, sessionId);
  return flushed;
}

/**
 * Get count of active working memory sessions (for monitoring).
 */
export function activeSessionCount(): number {
  return store.size;
}
