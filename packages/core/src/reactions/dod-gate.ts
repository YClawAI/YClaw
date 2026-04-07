/**
 * Definition of Done (DoD) Gate -- evaluates whether a PR meets the
 * minimum quality bar before automated merge or deployment.
 *
 * The DoD gate is a safety gate in the reactions system. It checks:
 * 1. CI status (all checks passing)
 * 2. Test coverage (tests exist for changed files)
 * 3. Type safety (no TypeScript errors)
 * 4. Review status (at least one approval)
 * 5. No restricted file modifications (immutable paths)
 *
 * This module is imported by the ReactionEvaluator when processing
 * the 'dod_gate_passed' safety gate type.
 */

import { createLogger } from '../logging/logger.js';

const logger = createLogger('dod-gate');

// --- Immutable Paths ---------------------------------------------------------

const IMMUTABLE_PATTERNS = [
  /^departments\//,
  /^prompts\/.*\.md$/,
  /^packages\/core\/src\/safety\//,
  /^packages\/core\/src\/review\//,
  /^\.github\/workflows\//,
  /^tsconfig\.json$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /^CLAUDE\.md$/,
];

// --- DoD Check Results -------------------------------------------------------

export interface DoDCheckResult {
  passed: boolean;
  checks: DoDCheck[];
  summary: string;
}

export interface DoDCheck {
  name: string;
  passed: boolean;
  reason?: string;
}

// --- DoD Gate Context --------------------------------------------------------

export interface DoDGateContext {
  /** Files changed in the PR. */
  filesChanged: string[];
  /** Whether all CI checks passed. */
  ciPassed: boolean;
  /** Whether TypeScript compilation succeeded (no errors). */
  typeCheckPassed: boolean;
  /** Number of approving reviews. */
  approvalCount: number;
  /** Whether tests exist for the changed files. */
  hasTests: boolean;
  /** Whether this is an automated retry (stricter limits apply). */
  isAutoRetry: boolean;
  /** Number of lines changed (additions + deletions). Required for auto-retry. */
  linesChanged?: number;
}

// --- Evaluate DoD Gate -------------------------------------------------------

/**
 * Evaluate whether a PR passes the Definition of Done gate.
 *
 * Returns a result with individual check outcomes and an overall pass/fail.
 * All checks must pass for the gate to pass.
 */
export function evaluateDoDGate(ctx: DoDGateContext): DoDCheckResult {
  const checks: DoDCheck[] = [];

  // Check 1: CI must be green
  checks.push({
    name: 'ci_passing',
    passed: ctx.ciPassed,
    reason: ctx.ciPassed ? undefined : 'CI checks are not passing',
  });

  // Check 2: Type safety
  checks.push({
    name: 'type_check',
    passed: ctx.typeCheckPassed,
    reason: ctx.typeCheckPassed ? undefined : 'TypeScript compilation has errors',
  });

  // Check 3: At least one approval
  checks.push({
    name: 'review_approval',
    passed: ctx.approvalCount >= 1,
    reason: ctx.approvalCount >= 1
      ? undefined
      : `Need at least 1 approval, have ${ctx.approvalCount}`,
  });

  // Check 4: Tests exist for changed files
  checks.push({
    name: 'tests_exist',
    passed: ctx.hasTests,
    reason: ctx.hasTests ? undefined : 'No tests found for changed files',
  });

  // Check 5: No immutable path modifications
  const immutableViolations = findImmutableViolations(ctx.filesChanged);
  checks.push({
    name: 'no_immutable_changes',
    passed: immutableViolations.length === 0,
    reason: immutableViolations.length === 0
      ? undefined
      : `Modifies restricted files: ${immutableViolations.join(', ')}`,
  });

  // Check 6: Auto-retry scope limits (only for automated retries)
  if (ctx.isAutoRetry) {
    const fileCountOk = ctx.filesChanged.length <= 5;

    // linesChanged is required for auto-retry -- undefined means the data
    // was not provided, which is a gate failure (fail-closed).
    const linesKnown = ctx.linesChanged !== undefined;
    const lineCountOk = linesKnown && ctx.linesChanged! <= 200;

    checks.push({
      name: 'auto_retry_scope',
      passed: fileCountOk && lineCountOk,
      reason: !linesKnown
        ? 'Auto-retry requires linesChanged to be provided (fail-closed)'
        : !fileCountOk
          ? `Auto-retry exceeds 5 file limit (${ctx.filesChanged.length} files)`
          : !lineCountOk
            ? `Auto-retry exceeds 200 line limit (${ctx.linesChanged} lines)`
            : undefined,
    });
  }

  const passed = checks.every((c) => c.passed);
  const failedChecks = checks.filter((c) => !c.passed);

  const summary = passed
    ? `DoD gate passed (${checks.length} checks)`
    : `DoD gate failed: ${failedChecks.map((c) => c.name).join(', ')}`;

  logger.info('DoD gate evaluated', {
    passed,
    checkCount: checks.length,
    failedCount: failedChecks.length,
    summary,
  });

  return { passed, checks, summary };
}

// --- Helpers -----------------------------------------------------------------

/**
 * Check if any changed files match immutable path patterns.
 */
export function findImmutableViolations(filesChanged: string[]): string[] {
  const violations: string[] = [];
  for (const file of filesChanged) {
    for (const pattern of IMMUTABLE_PATTERNS) {
      if (pattern.test(file)) {
        violations.push(file);
        break;
      }
    }
  }
  return violations;
}

/**
 * Check if test files exist for the given source files.
 *
 * Supports two conventions: colocated (foo.test.ts next to foo.ts)
 * and tests-directory (tests/foo.test.ts). A source file passes if
 * either convention finds a matching test. Non-source files are excluded.
 * If no source files changed, returns true.
 */
export function hasTestCoverage(
  filesChanged: string[],
  allFilesInPR: string[],
): boolean {
  const sourceFiles = filesChanged.filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'),
  );

  // If no source files changed, tests are not required
  if (sourceFiles.length === 0) return true;

  // Build a set of all test files for fast lookup
  const testFileSet = new Set(allFilesInPR.filter((f) => f.endsWith('.test.ts')));

  return sourceFiles.every((srcFile) => {
    // Convention 1: Colocated test -- same directory as source
    const colocatedTest = srcFile.replace(/\.ts$/, '.test.ts');
    if (testFileSet.has(colocatedTest)) return true;

    // Convention 2: tests/ directory -- test file at package tests/ root
    // e.g., packages/core/src/reactions/dod-gate.ts
    //     -> packages/core/tests/dod-gate.test.ts
    const basename = srcFile.split('/').pop()!.replace(/\.ts$/, '.test.ts');
    const packageRoot = extractPackageRoot(srcFile);
    if (packageRoot) {
      const testsDirectoryTest = `${packageRoot}/tests/${basename}`;
      if (testFileSet.has(testsDirectoryTest)) return true;
    }

    return false;
  });
}

/**
 * Extract the package root from a file path.
 * e.g., "packages/core/src/reactions/dod-gate.ts" -> "packages/core"
 *
 * Returns null if the path doesn't follow the packages/<name>/... convention.
 */
function extractPackageRoot(filePath: string): string | null {
  const match = filePath.match(/^(packages\/[^/]+)\//);
  return match ? match[1] : null;
}
