import { describe, expect, it } from 'vitest';
import {
  parseHunkRanges,
  findFunctionBoundaries,
  extractFunctionsForRanges,
  estimateTokens,
} from './code-graph.mjs';

// ── parseHunkRanges ───────────────────────────────────────────────────────────

describe('parseHunkRanges', () => {
  it('returns empty array for empty diff', () => {
    expect(parseHunkRanges('')).toEqual([]);
  });

  it('parses a single hunk with explicit count', () => {
    const diff = [
      'diff --git a/foo.js b/foo.js',
      '--- a/foo.js',
      '+++ b/foo.js',
      '@@ -10,3 +10,4 @@ some context',
      '+added line',
    ].join('\n');
    const result = parseHunkRanges(diff);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('foo.js');
    expect(result[0].ranges).toEqual([{ start: 10, end: 13 }]);
  });

  it('parses a single-line addition (no count in header)', () => {
    const diff = [
      '+++ b/bar.ts',
      '@@ -5 +5 @@ ctx',
    ].join('\n');
    const result = parseHunkRanges(diff);
    expect(result[0].ranges).toEqual([{ start: 5, end: 5 }]);
  });

  it('skips pure-deletion hunks (count = 0)', () => {
    const diff = [
      '+++ b/baz.ts',
      '@@ -5,3 +5,0 @@ ctx', // deleting 3 lines, adding 0
    ].join('\n');
    const result = parseHunkRanges(diff);
    // file appears but range list is empty
    expect(result).toHaveLength(0);
  });

  it('handles multiple files', () => {
    const diff = [
      '+++ b/a.js',
      '@@ -1 +1,2 @@ ctx',
      '+++ b/b.py',
      '@@ -10,5 +10,5 @@ ctx',
    ].join('\n');
    const result = parseHunkRanges(diff);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.file)).toEqual(['a.js', 'b.py']);
  });

  it('merges multiple hunks in the same file', () => {
    const diff = [
      '+++ b/multi.ts',
      '@@ -1 +1 @@ ctx',
      '@@ -20,3 +20,4 @@ ctx',
    ].join('\n');
    const result = parseHunkRanges(diff);
    expect(result[0].ranges).toHaveLength(2);
    expect(result[0].ranges[0]).toEqual({ start: 1, end: 1 });
    expect(result[0].ranges[1]).toEqual({ start: 20, end: 23 });
  });
});

// ── findFunctionBoundaries ────────────────────────────────────────────────────

describe('findFunctionBoundaries', () => {
  it('detects a plain function declaration', () => {
    const src = [
      'function greet(name) {',
      '  return `Hello, ${name}`;',
      '}',
    ];
    const result = findFunctionBoundaries(src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('greet');
    expect(result[0].startLine).toBe(1);
    expect(result[0].endLine).toBe(3);
  });

  it('detects an async arrow function assignment', () => {
    const src = [
      'const fetchData = async (url) => {',
      '  const res = await fetch(url);',
      '  return res.json();',
      '};',
    ];
    const result = findFunctionBoundaries(src);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('fetchData');
  });

  it('detects an exported async function', () => {
    const src = [
      'export async function runReview(path) {',
      '  return true;',
      '}',
    ];
    const result = findFunctionBoundaries(src);
    expect(result[0].name).toBe('runReview');
  });

  it('does NOT treat if/for/while as function names', () => {
    const src = [
      'if (condition) {',
      '  for (const x of items) {',
      '    while (x) {}',
      '  }',
      '}',
    ];
    const result = findFunctionBoundaries(src);
    expect(result).toHaveLength(0);
  });

  it('detects a Python def', () => {
    const src = [
      'def compute(x, y):',
      '    return x + y',
      '',
      'def other():',
      '    pass',
    ];
    const result = findFunctionBoundaries(src);
    expect(result.map(f => f.name)).toContain('compute');
    expect(result.map(f => f.name)).toContain('other');
  });

  it('detects an indented class method', () => {
    const src = [
      'class MyService {',
      '  async processEvent(event) {',
      '    return event;',
      '  }',
      '}',
    ];
    const result = findFunctionBoundaries(src);
    const names = result.map(f => f.name);
    expect(names).toContain('processEvent');
  });
});

// ── extractFunctionsForRanges ─────────────────────────────────────────────────

describe('extractFunctionsForRanges', () => {
  const source = [
    'function alpha() {', // line 1
    '  return 1;',        // line 2
    '}',                  // line 3
    '',                   // line 4
    'function beta() {',  // line 5
    '  return 2;',        // line 6
    '}',                  // line 7
  ].join('\n');

  it('returns only the function overlapping the changed range', () => {
    const result = extractFunctionsForRanges(source, [{ start: 6, end: 6 }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('beta');
  });

  it('returns multiple functions when multiple ranges overlap', () => {
    const result = extractFunctionsForRanges(source, [
      { start: 2, end: 2 },
      { start: 6, end: 6 },
    ]);
    expect(result.map(f => f.name)).toEqual(['alpha', 'beta']);
  });

  it('returns empty array when no functions overlap the range', () => {
    const result = extractFunctionsForRanges(source, [{ start: 4, end: 4 }]);
    expect(result).toHaveLength(0);
  });

  it('includes full function body in the result', () => {
    const result = extractFunctionsForRanges(source, [{ start: 1, end: 3 }]);
    expect(result[0].body).toContain('return 1');
  });
});

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for null', () => {
    expect(estimateTokens(null)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns ceiling of length / 4', () => {
    // 10 chars → ceil(10/4) = 3
    expect(estimateTokens('1234567890')).toBe(3);
    // 12 chars → 3
    expect(estimateTokens('123456789012')).toBe(3);
    // 13 chars → 4
    expect(estimateTokens('1234567890123')).toBe(4);
  });
});
