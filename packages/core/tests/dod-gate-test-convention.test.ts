/**
 * Tests for hasTestCoverage() dual test-location convention support.
 *
 * The main dod-gate.test.ts covers the core DoD gate logic. This file
 * specifically tests the tests/ directory convention added to fix false
 * negatives when tests live in packages/core/tests/ instead of colocated.
 */
import { describe, it, expect } from 'vitest';
import { hasTestCoverage } from '../src/reactions/dod-gate.js';

describe('hasTestCoverage — tests/ directory convention', () => {
  it('finds tests in packages/core/tests/ for source in packages/core/src/', () => {
    const filesChanged = ['packages/core/src/reactions/dod-gate.ts'];
    const allFiles = [
      'packages/core/src/reactions/dod-gate.ts',
      'packages/core/tests/dod-gate.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('finds tests in packages/core/tests/ for deeply nested source', () => {
    const filesChanged = ['packages/core/src/reactions/nested/deep/module.ts'];
    const allFiles = [
      'packages/core/src/reactions/nested/deep/module.ts',
      'packages/core/tests/module.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('still finds colocated tests (backward compat)', () => {
    const filesChanged = ['packages/core/src/reactions/evaluator.ts'];
    const allFiles = [
      'packages/core/src/reactions/evaluator.ts',
      'packages/core/src/reactions/evaluator.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('passes when either convention matches', () => {
    const filesChanged = ['packages/core/src/reactions/manager.ts'];
    const allFiles = [
      'packages/core/src/reactions/manager.ts',
      'packages/core/src/reactions/manager.test.ts',
      'packages/core/tests/manager.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('fails when neither convention matches', () => {
    const filesChanged = ['packages/core/src/reactions/orphan.ts'];
    const allFiles = [
      'packages/core/src/reactions/orphan.ts',
      'packages/core/tests/unrelated.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(false);
  });

  it('handles multiple source files with mixed conventions', () => {
    const filesChanged = [
      'packages/core/src/reactions/dod-gate.ts',
      'packages/core/src/reactions/escalation.ts',
    ];
    const allFiles = [
      'packages/core/src/reactions/dod-gate.ts',
      'packages/core/src/reactions/escalation.ts',
      'packages/core/tests/dod-gate.test.ts',
      'packages/core/src/reactions/escalation.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('fails when one source file has no test in either location', () => {
    const filesChanged = [
      'packages/core/src/reactions/dod-gate.ts',
      'packages/core/src/reactions/missing.ts',
    ];
    const allFiles = [
      'packages/core/src/reactions/dod-gate.ts',
      'packages/core/src/reactions/missing.ts',
      'packages/core/tests/dod-gate.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(false);
  });

  it('handles non-package paths gracefully (no package root)', () => {
    const filesChanged = ['src/standalone.ts'];
    const allFiles = [
      'src/standalone.ts',
      'tests/standalone.test.ts',
    ];
    // No package root detected, colocated check fails, tests/ check skipped
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(false);
  });

  it('handles non-package paths with colocated test', () => {
    const filesChanged = ['src/standalone.ts'];
    const allFiles = [
      'src/standalone.ts',
      'src/standalone.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('skips non-ts files', () => {
    const filesChanged = [
      'packages/core/src/reactions/README.md',
      'packages/core/src/reactions/dod-gate.ts',
    ];
    const allFiles = [
      'packages/core/src/reactions/README.md',
      'packages/core/src/reactions/dod-gate.ts',
      'packages/core/tests/dod-gate.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('skips .d.ts files', () => {
    const filesChanged = [
      'packages/core/src/reactions/types.d.ts',
      'packages/core/src/reactions/dod-gate.ts',
    ];
    const allFiles = [
      'packages/core/src/reactions/types.d.ts',
      'packages/core/src/reactions/dod-gate.ts',
      'packages/core/tests/dod-gate.test.ts',
    ];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('returns true when only test files changed', () => {
    const filesChanged = ['packages/core/tests/dod-gate.test.ts'];
    const allFiles = ['packages/core/tests/dod-gate.test.ts'];
    expect(hasTestCoverage(filesChanged, allFiles)).toBe(true);
  });

  it('returns true when no files changed', () => {
    expect(hasTestCoverage([], [])).toBe(true);
  });
});
