/**
 * Tests for Phase 1b: Prompt Caching + Frozen Snapshots.
 *
 * Covers:
 *  - computeSnapshotId: determinism, format, sensitivity to content
 *  - PromptSnapshotStore: set/get/freeze/delete/size
 *  - SessionRecord: Zod schema accepts snapshotId and textHash
 *  - applyTurnCacheMarkers: correct cache_control placement at turn boundaries
 */

import { describe, it, expect } from 'vitest';
import {
  computeSnapshotId,
  PromptSnapshotStore,
} from '../src/agent/prompt-snapshot.js';
import { SessionRecordSchema } from '../src/contracts/session.js';
import { applyTurnCacheMarkers } from '../src/llm/anthropic.js';
import type { LLMMessage } from '../src/llm/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSessionRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'ses_abc123',
    threadKey: 'a'.repeat(32),
    state: 'active',
    model: 'claude-sonnet-4-6',
    harness: 'claude-code',
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMsg(role: LLMMessage['role'], content = 'some content'): LLMMessage {
  return { role, content };
}

function makeAssistantWithTool(id: string): LLMMessage {
  return {
    role: 'assistant',
    content: 'Calling tool',
    toolCalls: [{ id, name: 'some_tool', arguments: {} }],
  };
}

function makeToolResult(id: string): LLMMessage {
  return { role: 'tool', content: 'Tool result', toolCallId: id };
}

/**
 * Build a conversation with N turns:
 *   [user, a1, t1, a2, t2, ..., aN, tN]
 */
function buildConversation(turns: number): LLMMessage[] {
  const msgs: LLMMessage[] = [makeMsg('user', 'Start the task')];
  for (let i = 0; i < turns; i++) {
    const id = `tc-${i}`;
    msgs.push(makeAssistantWithTool(id));
    msgs.push(makeToolResult(id));
  }
  return msgs;
}

// ─── computeSnapshotId ────────────────────────────────────────────────────────

describe('computeSnapshotId', () => {
  it('returns a 32-character hex string', () => {
    const id = computeSnapshotId('hello world');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic — same content produces same ID', () => {
    const content = 'You are an agent. Your task is to help.';
    expect(computeSnapshotId(content)).toBe(computeSnapshotId(content));
  });

  it('is sensitive to content — different content produces different IDs', () => {
    const a = computeSnapshotId('Content A');
    const b = computeSnapshotId('Content B');
    expect(a).not.toBe(b);
  });

  it('handles empty string', () => {
    const id = computeSnapshotId('');
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('handles large content (multi-KB system prompt)', () => {
    const large = 'You are an agent.\n'.repeat(5000);
    const id = computeSnapshotId(large);
    expect(id).toHaveLength(32);
  });
});

// ─── PromptSnapshotStore ─────────────────────────────────────────────────────

describe('PromptSnapshotStore', () => {
  it('set() stores and returns a snapshot with correct fields', () => {
    const store = new PromptSnapshotStore();
    const snap = store.set('ses_001', 'System prompt text');
    expect(snap.snapshotId).toHaveLength(32);
    expect(snap.textHash).toBe(snap.snapshotId);
    expect(snap.content).toBe('System prompt text');
    expect(snap.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('get() returns undefined for unknown key', () => {
    const store = new PromptSnapshotStore();
    expect(store.get('unknown')).toBeUndefined();
  });

  it('get() returns the stored snapshot', () => {
    const store = new PromptSnapshotStore();
    store.set('key1', 'content here');
    const snap = store.get('key1');
    expect(snap).toBeDefined();
    expect(snap?.content).toBe('content here');
  });

  it('freeze() returns existing snapshot on second call (byte-identical)', () => {
    const store = new PromptSnapshotStore();
    const first = store.freeze('ses_002', 'Original content');
    const second = store.freeze('ses_002', 'Different content');
    expect(second.content).toBe('Original content');
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('freeze() creates a new snapshot on first call', () => {
    const store = new PromptSnapshotStore();
    const snap = store.freeze('ses_003', 'Initial prompt');
    expect(snap.content).toBe('Initial prompt');
    expect(store.size).toBe(1);
  });

  it('delete() removes the snapshot and returns true', () => {
    const store = new PromptSnapshotStore();
    store.set('key', 'data');
    expect(store.delete('key')).toBe(true);
    expect(store.get('key')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('delete() returns false for unknown key', () => {
    const store = new PromptSnapshotStore();
    expect(store.delete('nope')).toBe(false);
  });

  it('size reflects the number of stored snapshots', () => {
    const store = new PromptSnapshotStore();
    expect(store.size).toBe(0);
    store.set('a', 'content a');
    expect(store.size).toBe(1);
    store.set('b', 'content b');
    expect(store.size).toBe(2);
    store.delete('a');
    expect(store.size).toBe(1);
  });

  it('snapshotId is stable — same content on different keys produces same ID', () => {
    const store = new PromptSnapshotStore();
    const snap1 = store.set('ses_A', 'Shared prompt text');
    const snap2 = store.set('ses_B', 'Shared prompt text');
    expect(snap1.snapshotId).toBe(snap2.snapshotId);
  });
});

// ─── SessionRecord.snapshotId / textHash ─────────────────────────────────────

describe('SessionRecord schema — snapshotId and textHash', () => {
  it('parses a record without snapshotId (optional field)', () => {
    const result = SessionRecordSchema.safeParse(makeSessionRecord());
    expect(result.success).toBe(true);
  });

  it('parses a record with valid snapshotId (32 hex chars)', () => {
    const record = makeSessionRecord({
      snapshotId: 'a'.repeat(32),
      textHash: 'a'.repeat(32),
    });
    const result = SessionRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.snapshotId).toBe('a'.repeat(32));
      expect(result.data.textHash).toBe('a'.repeat(32));
    }
  });

  it('rejects snapshotId shorter than 32 chars', () => {
    const record = makeSessionRecord({ snapshotId: 'abc123' });
    const result = SessionRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it('rejects snapshotId longer than 32 chars', () => {
    const record = makeSessionRecord({ snapshotId: 'a'.repeat(33) });
    const result = SessionRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it('accepts snapshotId from computeSnapshotId (always 32 chars)', () => {
    const id = computeSnapshotId('Some system prompt content');
    const record = makeSessionRecord({ snapshotId: id, textHash: id });
    const result = SessionRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });
});

// ─── applyTurnCacheMarkers ────────────────────────────────────────────────────

describe('applyTurnCacheMarkers', () => {
  it('returns original array unchanged when fewer than 2 messages', () => {
    const msgs: LLMMessage[] = [makeMsg('user', 'task')];
    const result = applyTurnCacheMarkers(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.cacheControl).toBeUndefined();
  });

  it('does not mutate the input array', () => {
    const msgs = buildConversation(3);
    const original = msgs.map(m => ({ ...m }));
    applyTurnCacheMarkers(msgs);
    for (let i = 0; i < msgs.length; i++) {
      expect(msgs[i]!.cacheControl).toBe(original[i]!.cacheControl);
    }
  });

  it('marks the last message before each of the first 3 assistant turns', () => {
    // Layout: [user, a1, t1, a2, t2, a3, t3, a4, t4]
    // Expected marks: t1 (before a2), t2 (before a3), t3 (before a4)
    const msgs = buildConversation(4);
    const result = applyTurnCacheMarkers(msgs);

    // Find indices in result
    // msgs: [user=0, a1=1, t1=2, a2=3, t2=4, a3=5, t3=6, a4=7, t4=8]
    expect(result[2]!.cacheControl).toEqual({ type: 'ephemeral' }); // t1 before a2
    expect(result[4]!.cacheControl).toEqual({ type: 'ephemeral' }); // t2 before a3
    expect(result[6]!.cacheControl).toEqual({ type: 'ephemeral' }); // t3 before a4
    // 4th turn's tool result should NOT be marked (maxMarks = 3)
    expect(result[8]!.cacheControl).toBeUndefined();
  });

  it('marks up to maxMarks (default 3) turn boundaries', () => {
    const msgs = buildConversation(10);
    const result = applyTurnCacheMarkers(msgs);
    const markedCount = result.filter(m => m.cacheControl).length;
    expect(markedCount).toBe(3);
  });

  it('marks fewer than 3 when conversation has fewer turns', () => {
    // 2 turns: [user, a1, t1, a2, t2]
    // Only 1 assistant after the first → 1 mark (t1 before a2)
    const msgs = buildConversation(2);
    const result = applyTurnCacheMarkers(msgs);
    const markedCount = result.filter(m => m.cacheControl).length;
    expect(markedCount).toBe(1);
  });

  it('respects custom maxMarks', () => {
    const msgs = buildConversation(6);
    const result = applyTurnCacheMarkers(msgs, 2);
    const markedCount = result.filter(m => m.cacheControl).length;
    expect(markedCount).toBe(2);
  });

  it('does not overwrite an existing cacheControl marker', () => {
    // Mark the first tool result manually
    const msgs = buildConversation(3);
    const firstToolIdx = 2; // t1
    msgs[firstToolIdx] = { ...msgs[firstToolIdx]!, cacheControl: { type: 'ephemeral' } };

    const result = applyTurnCacheMarkers(msgs);
    // t1 is pre-existing (skipped by algorithm — already has cacheControl)
    // t2 is newly marked (a3 follows it at i=5, prev=t2 at i=4)
    // t3 is NOT marked — no assistant follows t3 in a 3-turn conversation
    const markedCount = result.filter(m => m.cacheControl).length;
    expect(markedCount).toBe(2); // t1 (pre-existing) + t2 (new)
  });

  it('handles a conversation with only one turn (no new assistant after it)', () => {
    // [user, a1, t1] — no second assistant → no marks
    const msgs = buildConversation(1);
    const result = applyTurnCacheMarkers(msgs);
    const markedCount = result.filter(m => m.cacheControl).length;
    expect(markedCount).toBe(0);
  });

  it('tool messages get cacheControl (not assistant)', () => {
    // [user, a1, t1, a2, t2, a3, t3]
    const msgs = buildConversation(3);
    const result = applyTurnCacheMarkers(msgs);
    // Marked positions are t1(2), t2(4) — both tool messages
    const marked = result.filter(m => m.cacheControl);
    for (const m of marked) {
      expect(m.role).toBe('tool');
    }
  });
});
