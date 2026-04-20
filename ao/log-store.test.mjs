import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogStore, buildOffloadNotice } from './log-store.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpStore() {
  const dir = join(tmpdir(), `ao-log-store-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return { store: new LogStore(dir), dir };
}

// ── ingest() ──────────────────────────────────────────────────────────────────

describe('LogStore.ingest', () => {
  let store, dir;
  beforeEach(() => ({ store, dir } = makeTmpStore()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a refId and a summary object', () => {
    const { refId, summary } = store.ingest('hello world\nline two');
    expect(typeof refId).toBe('string');
    expect(refId.length).toBe(16);
    expect(summary.totalLines).toBe(2);
    expect(summary.refId).toBe(refId);
  });

  it('is idempotent — ingesting the same content twice returns the same refId', () => {
    const text = 'foo bar baz';
    const first  = store.ingest(text, { label: 'A' });
    const second = store.ingest(text, { label: 'A' });
    expect(first.refId).toBe(second.refId);
  });

  it('stores different refIds for different content', () => {
    const a = store.ingest('content A');
    const b = store.ingest('content B');
    expect(a.refId).not.toBe(b.refId);
  });

  it('detects error lines', () => {
    const { summary } = store.ingest('all good\nError: something broke\nstill good');
    expect(summary.errorCount).toBeGreaterThan(0);
    expect(summary.errorLines.some(e => e.content.includes('Error:'))).toBe(true);
  });

  it('detects warning lines', () => {
    const { summary } = store.ingest('info\nwarning: deprecated API\ninfo');
    expect(summary.warningCount).toBeGreaterThan(0);
  });

  it('includes tail lines in summary', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const { summary } = store.ingest(lines.join('\n'));
    expect(summary.tailLines.length).toBe(30); // SUMMARY_TAIL_LINES constant
    expect(summary.tailLines[summary.tailLines.length - 1]).toBe('line 50');
  });

  it('includes capturedAt timestamp', () => {
    const { summary } = store.ingest('test');
    expect(new Date(summary.capturedAt).getTime()).toBeGreaterThan(0);
  });

  it('records totalBytes', () => {
    const text = 'abcdef';
    const { summary } = store.ingest(text);
    expect(summary.totalBytes).toBe(Buffer.byteLength(text, 'utf-8'));
  });

  it('detects section headers', () => {
    const text = [
      'start',
      '',
      'BUILD OUTPUT',
      'building...',
      '',
      'TEST RESULTS',
      'all passed',
    ].join('\n');
    const { summary } = store.ingest(text);
    expect(summary.sections.length).toBeGreaterThan(1);
    expect(summary.sections.some(s => s.header.includes('BUILD OUTPUT'))).toBe(true);
  });

  it('throws TypeError when called with a non-string', () => {
    expect(() => store.ingest(null)).toThrow(TypeError);
    expect(() => store.ingest(42)).toThrow(TypeError);
  });
});

// ── getSummary() ──────────────────────────────────────────────────────────────

describe('LogStore.getSummary', () => {
  let store, dir;
  beforeEach(() => ({ store, dir } = makeTmpStore()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the same summary as ingest()', () => {
    const { refId, summary: ingested } = store.ingest('one\ntwo\nthree');
    const retrieved = store.getSummary(refId);
    expect(retrieved.totalLines).toBe(ingested.totalLines);
    expect(retrieved.refId).toBe(ingested.refId);
  });

  it('throws for unknown refId', () => {
    expect(() => store.getSummary('unknownid0000000')).toThrow(/Unknown refId/);
  });
});

// ── getExcerpt() ──────────────────────────────────────────────────────────────

describe('LogStore.getExcerpt', () => {
  let store, dir;
  beforeEach(() => ({ store, dir } = makeTmpStore()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the correct slice of lines (1-based)', () => {
    const lines = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const { refId } = store.ingest(lines.join('\n'));
    const result = store.getExcerpt(refId, 2, 4);
    expect(result.lines).toEqual(['beta', 'gamma', 'delta']);
    expect(result.from).toBe(2);
    expect(result.to).toBe(4);
    expect(result.totalLines).toBe(5);
  });

  it('clamps from/to to valid bounds', () => {
    const { refId } = store.ingest('a\nb\nc');
    const result = store.getExcerpt(refId, 0, 999);
    expect(result.from).toBe(1);
    expect(result.to).toBe(3);
    expect(result.lines).toEqual(['a', 'b', 'c']);
  });

  it('throws for unknown refId', () => {
    expect(() => store.getExcerpt('badref00000000ab', 1, 5)).toThrow(/Unknown refId/);
  });
});

// ── getRaw() ──────────────────────────────────────────────────────────────────

describe('LogStore.getRaw', () => {
  let store, dir;
  beforeEach(() => ({ store, dir } = makeTmpStore()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the original content verbatim', () => {
    const text = 'hello\nworld\n';
    const { refId } = store.ingest(text);
    expect(store.getRaw(refId)).toBe(text);
  });

  it('returns empty string for unknown refId without throwing', () => {
    expect(store.getRaw('notexist0000000a')).toBe('');
  });
});

// ── has() ─────────────────────────────────────────────────────────────────────

describe('LogStore.has', () => {
  let store, dir;
  beforeEach(() => ({ store, dir } = makeTmpStore()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns true after ingest and false for unknown ref', () => {
    const { refId } = store.ingest('data');
    expect(store.has(refId)).toBe(true);
    expect(store.has('ffffffffffffffff')).toBe(false);
  });
});

// ── cleanup() ─────────────────────────────────────────────────────────────────

describe('LogStore.cleanup', () => {
  let store, dir;
  beforeEach(() => ({ store, dir } = makeTmpStore()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('deletes entries older than TTL', () => {
    const { refId } = store.ingest('old data');
    // Patch capturedAt to be in the past so the TTL check fires.
    const metaPath = join(dir, refId, 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.capturedAt = new Date(Date.now() - 100_000).toISOString();
    writeFileSync(metaPath, JSON.stringify(meta));

    const deleted = store.cleanup(50_000); // 50s TTL — our entry is 100s old
    expect(deleted).toBe(1);
    expect(store.has(refId)).toBe(false);
  });

  it('keeps entries within TTL', () => {
    const { refId } = store.ingest('fresh data');
    const deleted = store.cleanup(60 * 60 * 1000); // 1h TTL
    expect(deleted).toBe(0);
    expect(store.has(refId)).toBe(true);
  });

  it('returns 0 when store is empty', () => {
    expect(store.cleanup()).toBe(0);
  });
});

// ── buildOffloadNotice() ──────────────────────────────────────────────────────

describe('buildOffloadNotice', () => {
  let store, dir;
  beforeEach(() => ({ store, dir } = makeTmpStore()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('includes the refId and retrieval URLs', () => {
    const { refId, summary } = store.ingest('ci output\nError: boom\ndone');
    const notice = buildOffloadNotice(summary, 'http://localhost:8420');
    expect(notice).toContain(refId);
    expect(notice).toContain(`/logs/${refId}/summary`);
    expect(notice).toContain(`/logs/${refId}/excerpt`);
    expect(notice).toContain(`/logs/${refId}`);
  });

  it('surfaces key error lines', () => {
    const { summary } = store.ingest('line1\nError: something broke\nline3');
    const notice = buildOffloadNotice(summary, 'http://localhost:8420');
    expect(notice).toContain('Error: something broke');
  });

  it('includes tail lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const { summary } = store.ingest(lines.join('\n'));
    const notice = buildOffloadNotice(summary, 'http://localhost:8420');
    expect(notice).toContain('line 10');
  });

  it('strips trailing slash from base URL', () => {
    const { summary } = store.ingest('x');
    const notice = buildOffloadNotice(summary, 'http://localhost:8420/');
    expect(notice).not.toContain('//logs/');
  });
});
