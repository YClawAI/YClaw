/**
 * Tests for the Definition of Done (DoD) Gate module.
 *
 * Validates evaluateDoDGate(), findImmutableViolations(), and
 * hasTestCoverage() — the three public functions of the DoD gate.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  evaluateDoDGate,
  findImmutableViolations,
  hasTestCoverage,
} from '../src/reactions/dod-gate.js';
import type { DoDGateContext, DoDCheckResult } from '../src/reactions/dod-gate.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<DoDGateContext> = {}): DoDGateContext {
  return {
    filesChanged: ['src/feature.ts'],
    ciPassed: true,
    typeCheckPassed: true,
    approvalCount: 1,
    hasTests: true,
    isAutoRetry: false,
    ...overrides,
  };
}

// ─── evaluateDoDGate ─────────────────────────────────────────────────────────

describe('evaluateDoDGate', () => {
  it('passes when all checks are green', () => {
    const result = evaluateDoDGate(makeContext());
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.summary).toContain('passed');
  });

  it('fails when CI is not passing', () => {
    const result = evaluateDoDGate(makeContext({ ciPassed: false }));
    expect(result.passed).toBe(false);
    const ciCheck = result.checks.find((c) => c.name === 'ci_passing');
    expect(ciCheck?.passed).toBe(false);
    expect(ciCheck?.reason).toContain('CI');
  });

  it('fails when type check has errors', () => {
    const result = evaluateDoDGate(makeContext({ typeCheckPassed: false }));
    expect(result.passed).toBe(false);
    const typeCheck = result.checks.find((c) => c.name === 'type_check');
    expect(typeCheck?.passed).toBe(false);
    expect(typeCheck?.reason).toContain('TypeScript');
  });

  it('fails when no approvals', () => {
    const result = evaluateDoDGate(makeContext({ approvalCount: 0 }));
    expect(result.passed).toBe(false);
    const reviewCheck = result.checks.find((c) => c.name === 'review_approval');
    expect(reviewCheck?.passed).toBe(false);
    expect(reviewCheck?.reason).toContain('approval');
  });

  it('passes with exactly 1 approval', () => {
    const result = evaluateDoDGate(makeContext({ approvalCount: 1 }));
    const reviewCheck = result.checks.find((c) => c.name === 'review_approval');
    expect(reviewCheck?.passed).toBe(true);
  });

  it('passes with multiple approvals', () => {
    const result = evaluateDoDGate(makeContext({ approvalCount: 3 }));
    const reviewCheck = result.checks.find((c) => c.name === 'review_approval');
    expect(reviewCheck?.passed).toBe(true);
  });

  it('fails when tests do not exist', () => {
    const result = evaluateDoDGate(makeContext({ hasTests: false }));
    expect(result.passed).toBe(false);
    const testCheck = result.checks.find((c) => c.name === 'tests_exist');
    expect(testCheck?.passed).toBe(false);
  });

  it('fails when immutable files are modified', () => {
    const result = evaluateDoDGate(
      makeContext({ filesChanged: ['departments/dev/builder.yaml'] }),
    );
    expect(result.passed).toBe(false);
    const immutableCheck = result.checks.find(
      (c) => c.name === 'no_immutable_changes',
    );
    expect(immutableCheck?.passed).toBe(false);
    expect(immutableCheck?.reason).toContain('restricted');
  });

  it('summary lists failed check names', () => {
    const result = evaluateDoDGate(
      makeContext({ ciPassed: false, hasTests: false }),
    );
    expect(result.passed).toBe(false);
    expect(result.summary).toContain('ci_passing');
    expect(result.summary).toContain('tests_exist');
  });

  describe('auto-retry scope checks', () => {
    it('does not check scope limits when isAutoRetry is false', () => {
      const result = evaluateDoDGate(
        makeContext({
          isAutoRetry: false,
          filesChanged: Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`),
          linesChanged: 500,
        }),
      );
      const scopeCheck = result.checks.find(
        (c) => c.name === 'auto_retry_scope',
      );
      expect(scopeCheck).toBeUndefined();
    });

    it('passes auto-retry scope when within limits', () => {
      const result = evaluateDoDGate(
        makeContext({
          isAutoRetry: true,
          filesChanged: ['src/a.ts', 'src/b.ts'],
          linesChanged: 100,
        }),
      );
      const scopeCheck = result.checks.find(
        (c) => c.name === 'auto_retry_scope',
      );
      expect(scopeCheck?.passed).toBe(true);
    });

    it('fails auto-retry scope when too many files', () => {
      const result = evaluateDoDGate(
        makeContext({
          isAutoRetry: true,
          filesChanged: Array.from({ length: 6 }, (_, i) => `src/file${i}.ts`),
          linesChanged: 50,
        }),
      );
      const scopeCheck = result.checks.find(
        (c) => c.name === 'auto_retry_scope',
      );
      expect(scopeCheck?.passed).toBe(false);
      expect(scopeCheck?.reason).toContain('file limit');
    });

    it('fails auto-retry scope when too many lines', () => {
      const result = evaluateDoDGate(
        makeContext({
          isAutoRetry: true,
          filesChanged: ['src/a.ts'],
          linesChanged: 201,
        }),
      );
      const scopeCheck = result.checks.find(
        (c) => c.name === 'auto_retry_scope',
      );
      expect(scopeCheck?.passed).toBe(false);
      expect(scopeCheck?.reason).toContain('line limit');
    });

    it('fails auto-retry scope when linesChanged is undefined (fail-closed)', () => {
      const result = evaluateDoDGate(
        makeContext({
          isAutoRetry: true,
          filesChanged: ['src/a.ts'],
          linesChanged: undefined,
        }),
      );
      const scopeCheck = result.checks.find(
        (c) => c.name === 'auto_retry_scope',
      );
      expect(scopeCheck?.passed).toBe(false);
      expect(scopeCheck?.reason).toContain('fail-closed');
    });

    it('passes at exactly 5 files and 200 lines', () => {
      const result = evaluateDoDGate(
        makeContext({
          isAutoRetry: true,
          filesChanged: Array.from({ length: 5 }, (_, i) => `src/file${i}.ts`),
          linesChanged: 200,
        }),
      );
      const scopeCheck = result.checks.find(
        (c) => c.name === 'auto_retry_scope',
      );
      expect(scopeCheck?.passed).toBe(true);
    });
  });
});

// ─── findImmutableViolations ─────────────────────────────────────────────────

describe('findImmutableViolations', () => {
  it('returns empty array for safe files', () => {
    const violations = findImmutableViolations([
      'src/feature.ts',
      'src/utils/helper.ts',
    ]);
    expect(violations).toEqual([]);
  });

  it('detects departments/ modifications', () => {
    const violations = findImmutableViolations([
      'departments/dev/builder.yaml',
    ]);
    expect(violations).toContain('departments/dev/builder.yaml');
  });

  it('detects prompts/*.md modifications', () => {
    const violations = findImmutableViolations([
      'prompts/chain-of-command.md',
    ]);
    expect(violations).toContain('prompts/chain-of-command.md');
  });

  it('detects safety module modifications', () => {
    const violations = findImmutableViolations([
      'packages/core/src/safety/gate.ts',
    ]);
    expect(violations).toContain('packages/core/src/safety/gate.ts');
  });

  it('detects review module modifications', () => {
    const violations = findImmutableViolations([
      'packages/core/src/review/reviewer.ts',
    ]);
    expect(violations).toContain('packages/core/src/review/reviewer.ts');
  });

  it('detects workflow modifications', () => {
    const violations = findImmutableViolations([
      '.github/workflows/ci.yml',
    ]);
    expect(violations).toContain('.github/workflows/ci.yml');
  });

  it('detects tsconfig.json modification', () => {
    const violations = findImmutableViolations(['tsconfig.json']);
    expect(violations).toContain('tsconfig.json');
  });

  it('detects eslintrc modifications', () => {
    const violations = findImmutableViolations(['.eslintrc.json']);
    expect(violations).toContain('.eslintrc.json');
  });

  it('detects prettierrc modifications', () => {
    const violations = findImmutableViolations(['.prettierrc']);
    expect(violations).toContain('.prettierrc');
  });

  it('detects CLAUDE.md modification', () => {
    const violations = findImmutableViolations(['CLAUDE.md']);
    expect(violations).toContain('CLAUDE.md');
  });

  it('returns multiple violations', () => {
    const violations = findImmutableViolations([
      'departments/dev/builder.yaml',
      'src/feature.ts',
      'prompts/test.md',
      '.github/workflows/ci.yml',
    ]);
    expect(violations).toHaveLength(3);
    expect(violations).toContain('departments/dev/builder.yaml');
    expect(violations).toContain('prompts/test.md');
    expect(violations).toContain('.github/workflows/ci.yml');
  });

  it('handles empty file list', () => {
    const violations = findImmutableViolations([]);
    expect(violations).toEqual([]);
  });
});

// ─── hasTestCoverage ─────────────────────────────────────────────────────────

describe('hasTestCoverage', () => {
  it('returns true when all source files have tests', () => {
    const result = hasTestCoverage(
      ['src/feature.ts'],
      ['src/feature.ts', 'src/feature.test.ts'],
    );
    expect(result).toBe(true);
  });

  it('returns false when source file has no test', () => {
    const result = hasTestCoverage(
      ['src/feature.ts'],
      ['src/feature.ts'],
    );
    expect(result).toBe(false);
  });

  it('returns true when no source files changed', () => {
    const result = hasTestCoverage(
      ['README.md', 'package.json'],
      ['README.md', 'package.json'],
    );
    expect(result).toBe(true);
  });

  it('excludes .test.ts files from source file check', () => {
    const result = hasTestCoverage(
      ['src/feature.test.ts'],
      ['src/feature.test.ts'],
    );
    expect(result).toBe(true);
  });

  it('excludes .d.ts files from source file check', () => {
    const result = hasTestCoverage(
      ['src/types.d.ts'],
      ['src/types.d.ts'],
    );
    expect(result).toBe(true);
  });

  it('handles multiple source files with mixed coverage', () => {
    const result = hasTestCoverage(
      ['src/a.ts', 'src/b.ts'],
      ['src/a.ts', 'src/a.test.ts', 'src/b.ts'],
    );
    expect(result).toBe(false);
  });

  it('returns true when all multiple source files have tests', () => {
    const result = hasTestCoverage(
      ['src/a.ts', 'src/b.ts'],
      ['src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/b.test.ts'],
    );
    expect(result).toBe(true);
  });

  it('handles empty file lists', () => {
    const result = hasTestCoverage([], []);
    expect(result).toBe(true);
  });
});
