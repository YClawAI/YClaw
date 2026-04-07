/**
 * Codex CLI Pre-PR Code Review Gate
 *
 * Runs OpenAI Codex CLI as a review step in the AO harvest pipeline.
 * Two insertion points:
 *   - Dirty path: between git commit and git push (pre-push gate)
 *   - Clean path: after push, before armPrAutoMerge (pre-merge gate)
 *
 * Remediation loop (dirty path only): if review fails, pipe findings
 * to Claude Code subprocess in same worktree, then re-review.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────────────

const REVIEW_TIMEOUT_MS = 120_000;          // 2 min per review invocation
const REMEDIATION_TIMEOUT_MS = 180_000;     // 3 min per remediation cycle
const TOTAL_GATE_TIMEOUT_MS = 600_000;      // 10 min total gate budget
const MAX_REVIEW_CYCLES = 2;                // 1 initial + 1 after remediation
const MIN_CONFIDENCE_SCORE = 0.7;
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const REVIEW_PROMPT_PATH = join(__dirname, 'prompts', 'codex-review-prompt.md');

// ─── Types (JSDoc) ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} ReviewFinding
 * @property {string} title
 * @property {string} body
 * @property {number} confidence_score
 * @property {number} priority  0=P0, 1=P1, 2=P2, 3=P3
 * @property {{ absolute_file_path: string, line_range: { start: number, end: number } }} [code_location]
 */

/**
 * @typedef {Object} ReviewResult
 * @property {ReviewFinding[]} findings
 * @property {'patch is correct'|'patch is incorrect'} overall_correctness
 * @property {string} overall_explanation
 * @property {number} overall_confidence_score
 */

/**
 * @typedef {'pass'|'fail'|'fail-closed'|'error'|'skipped'} ReviewVerdict
 */

/**
 * @typedef {Object} ReviewGateResult
 * @property {ReviewVerdict} verdict
 * @property {ReviewResult|null} result
 * @property {string} [error]
 * @property {number} reviewDurationMs
 * @property {number} remediationCycles
 * @property {number} findingsCount
 * @property {number} p0Count
 * @property {number} p1Count
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Check if codex binary exists by trying to run --version */
async function checkCodexBinary() {
  return new Promise((resolve) => {
    const proc = spawn(CODEX_BIN, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/** Run a command with timeout, returning { stdout, stderr, exitCode } */
function execWithTimeout(command, args, cwd, timeoutMs, env = null) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env || process.env,
      detached: true, // Create process group for clean kill
    });
    const timer = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* ok */ }
      }, 5000);
    }, timeoutMs);
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    // Don't let the process group hold the parent
    proc.unref();
  });
}

/** Load the custom review prompt if available */
function loadReviewPrompt() {
  try {
    if (existsSync(REVIEW_PROMPT_PATH)) {
      return readFileSync(REVIEW_PROMPT_PATH, 'utf-8').trim();
    }
  } catch { /* fallback to default */ }
  return null;
}

// ─── Core: Run Codex Review ──────────────────────────────────────────────────

/**
 * Run a single Codex CLI review against the worktree.
 *
 * @param {string} worktreePath  Absolute path to the git worktree
 * @param {string} baseBranch    Base branch to diff against (e.g., 'master')
 * @param {number|undefined} issueNumber
 * @returns {Promise<{ result: ReviewResult|null, raw: string, exitCode: number, error?: string }>}
 */
export async function runCodexReview(worktreePath, baseBranch, issueNumber) {
  const outputFile = join(worktreePath, `.codex-review-${issueNumber || 'unknown'}.json`);

  // Clean up any stale output file
  try { unlinkSync(outputFile); } catch { /* ok */ }

  const customPrompt = loadReviewPrompt();
  const args = [
    'exec', 'review',
    '--json',
    '--ephemeral',
    '--base', baseBranch,
    '--full-auto',
    '--output-last-message', outputFile,
  ];
  if (customPrompt) {
    args.push(customPrompt);
  }

  console.log(`[review-gate] Running Codex review for #${issueNumber || '?'} against ${baseBranch}`);
  const startMs = Date.now();

  let execResult;
  try {
    execResult = await execWithTimeout(CODEX_BIN, args, worktreePath, REVIEW_TIMEOUT_MS);
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.warn(`[review-gate] Codex CLI execution error: ${err?.message}`, { durationMs });
    return { result: null, raw: '', exitCode: 1, error: err?.message };
  }

  const durationMs = Date.now() - startMs;
  console.log(`[review-gate] Codex CLI exited with code ${execResult.exitCode} in ${durationMs}ms`);

  if (execResult.exitCode !== 0) {
    return {
      result: null,
      raw: execResult.stderr || execResult.stdout,
      exitCode: execResult.exitCode,
      error: `Codex CLI exited with code ${execResult.exitCode}: ${(execResult.stderr || '').slice(0, 500)}`,
    };
  }

  // Parse output — try JSONL stream first, then output-last-message file
  const parsed = parseReviewOutput(execResult.stdout, outputFile);

  // Clean up output file
  try { unlinkSync(outputFile); } catch { /* ok */ }

  return { result: parsed, raw: execResult.stdout, exitCode: 0 };
}

// ─── Parse Review Output ─────────────────────────────────────────────────────

/**
 * Parse the Codex review output from JSONL stream or fallback file.
 *
 * @param {string} jsonlOutput  Raw JSONL stdout from codex exec review --json
 * @param {string} outputFilePath  Path to --output-last-message file
 * @returns {ReviewResult|null}
 */
export function parseReviewOutput(jsonlOutput, outputFilePath) {
  // Strategy 1: Parse JSONL stream for last agent_message
  if (jsonlOutput) {
    const result = parseFromJsonlStream(jsonlOutput);
    if (result) return result;
  }

  // Strategy 2: Read --output-last-message file
  if (outputFilePath) {
    try {
      if (existsSync(outputFilePath)) {
        const fileContent = readFileSync(outputFilePath, 'utf-8').trim();
        const result = tryParseFindings(fileContent);
        if (result) return result;
      }
    } catch (err) {
      console.warn(`[review-gate] Failed to read output file: ${err?.message}`);
    }
  }

  console.warn('[review-gate] Could not parse review output from any source');
  return null;
}

/**
 * Parse JSONL stream looking for the last agent_message item.completed event.
 */
function parseFromJsonlStream(jsonlOutput) {
  const lines = jsonlOutput.split('\n').filter(Boolean);
  let lastAgentMessage = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (
        event.type === 'item.completed' &&
        event.item?.type === 'agent_message' &&
        typeof event.item.text === 'string'
      ) {
        lastAgentMessage = event.item.text;
      }
    } catch { /* skip malformed lines */ }
  }

  if (lastAgentMessage) {
    return tryParseFindings(lastAgentMessage);
  }
  return null;
}

/**
 * Try to parse the findings JSON from a text string.
 * Handles both raw JSON and markdown-fenced JSON.
 */
function tryParseFindings(text) {
  if (!text) return null;

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text);
    if (isValidReviewResult(parsed)) return parsed;
  } catch { /* not raw JSON */ }

  // Try extracting from markdown fences
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (isValidReviewResult(parsed)) return parsed;
    } catch { /* malformed */ }
  }

  // Try finding JSON object in text
  const braceMatch = text.match(/\{[\s\S]*"overall_correctness"[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (isValidReviewResult(parsed)) return parsed;
    } catch { /* malformed */ }
  }

  return null;
}

function isValidReviewResult(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.overall_correctness === 'string' &&
    Array.isArray(obj.findings)
  );
}

// ─── Evaluate Review Result ──────────────────────────────────────────────────

/**
 * Apply pass/fail/error criteria to a parsed review result.
 *
 * @param {{ result: ReviewResult|null, exitCode: number, error?: string }} reviewOutput
 * @returns {{ verdict: ReviewVerdict, p0Count: number, p1Count: number }}
 */
export function evaluateReviewResult(reviewOutput) {
  // Gate error (CLI failure, timeout, parse failure) → fail-open
  if (reviewOutput.exitCode !== 0 || !reviewOutput.result) {
    return { verdict: 'error', p0Count: 0, p1Count: 0 };
  }

  const { result } = reviewOutput;
  const p0Count = result.findings.filter(f => f.priority === 0).length;
  const p1Count = result.findings.filter(f => f.priority === 1).length;

  // Fail-closed: incorrect with P0 findings
  if (result.overall_correctness === 'patch is incorrect' && p0Count > 0) {
    return { verdict: 'fail-closed', p0Count, p1Count };
  }

  // Fail: incorrect, or has P0/P1, or low confidence
  if (
    result.overall_correctness === 'patch is incorrect' ||
    p0Count > 0 ||
    p1Count > 0 ||
    (typeof result.overall_confidence_score === 'number' && result.overall_confidence_score < MIN_CONFIDENCE_SCORE)
  ) {
    return { verdict: 'fail', p0Count, p1Count };
  }

  // Pass
  return { verdict: 'pass', p0Count, p1Count };
}

// ─── Remediation ─────────────────────────────────────────────────────────────

/**
 * Run Claude Code as a subprocess to fix review findings.
 * Operates in the same worktree — does NOT spawn a new AO session.
 *
 * @param {string} worktreePath
 * @param {ReviewFinding[]} findings
 * @param {number|undefined} issueNumber
 * @returns {Promise<boolean>}  true if remediation succeeded (committed changes)
 */
export async function runRemediation(worktreePath, findings, issueNumber) {
  // Check for stale index lock
  const lockPath = join(worktreePath, '.git', 'index.lock');
  if (existsSync(lockPath)) {
    console.warn('[review-gate] .git/index.lock exists — waiting 3s for release');
    await new Promise(r => setTimeout(r, 3000));
    if (existsSync(lockPath)) {
      console.warn('[review-gate] .git/index.lock still present — removing stale lock');
      try { unlinkSync(lockPath); } catch { /* ok */ }
    }
  }

  const findingsSummary = findings
    .map(f => `- ${f.title}: ${f.body?.slice(0, 200) || 'No details'}${f.code_location ? ` (${f.code_location.absolute_file_path}:${f.code_location.line_range?.start || '?'})` : ''}`)
    .join('\n');

  const prompt = `A code review found the following issues. Fix them:\n\n${findingsSummary}\n\nMake minimal, targeted fixes. Do not refactor unrelated code. Do not commit or push — just edit the files.`;

  console.log(`[review-gate] Running remediation for ${findings.length} findings`);

  // Sanitize env: only pass what Claude Code needs, strip bridge-only secrets
  const remediationEnv = { ...process.env };
  delete remediationEnv.AO_AUTH_TOKEN;
  delete remediationEnv.AO_BRIDGE_PORT;

  try {
    const result = await execWithTimeout(
      'claude',
      [
        '--bare',
        '--dangerously-skip-permissions',
        '--output-format', 'json',
        '--max-turns', '15',
        '-p', prompt,
      ],
      worktreePath,
      REMEDIATION_TIMEOUT_MS,
      remediationEnv,
    );

    if (result.exitCode !== 0) {
      console.warn(`[review-gate] Remediation exited with code ${result.exitCode}`);
      return false;
    }

    // Check if files were actually changed
    const status = await execWithTimeout('git', ['status', '--porcelain'], worktreePath, 10000);
    if (!status.stdout.trim()) {
      console.log('[review-gate] Remediation made no changes');
      return false;
    }

    // Commit remediation changes
    const addResult = await execWithTimeout('git', ['add', '-A'], worktreePath, 30000);
    if (addResult.exitCode !== 0) {
      console.warn(`[review-gate] git add failed during remediation: ${addResult.stderr}`);
      return false;
    }
    const commitResult = await execWithTimeout(
      'git',
      ['commit', '-m', `fix(#${issueNumber || '?'}): address Codex review findings`],
      worktreePath,
      60000,
    );
    if (commitResult.exitCode !== 0) {
      console.warn(`[review-gate] git commit failed during remediation: ${commitResult.stderr}`);
      return false;
    }

    console.log('[review-gate] Remediation committed successfully');
    return true;
  } catch (err) {
    console.warn(`[review-gate] Remediation failed: ${err?.message}`);
    return false;
  }
}

// ─── Review + Remediate Loop ─────────────────────────────────────────────────

/**
 * Run the full review gate with optional remediation loop.
 * Used on the DIRTY path (pre-push).
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath
 * @param {string} opts.baseBranch
 * @param {number|undefined} opts.issueNumber
 * @param {Function} opts.renewLock  Async function to renew session lock
 * @returns {Promise<ReviewGateResult>}
 */
export async function reviewAndRemediateLoop({ worktreePath, baseBranch, issueNumber, renewLock }) {
  const gateStart = Date.now();
  let cycle = 0;
  let lastFindingTitles = new Set();
  let lastResult = null;

  while (cycle < MAX_REVIEW_CYCLES) {
    // Budget check
    if (Date.now() - gateStart > TOTAL_GATE_TIMEOUT_MS) {
      console.warn(`[review-gate] Total gate timeout exceeded after ${cycle} cycles`);
      return buildGateResult('error', lastResult, cycle, Date.now() - gateStart, 'Total gate timeout');
    }

    // Renew session lock to prevent orphan sweeper interference
    if (renewLock) {
      await renewLock().catch(err => {
        console.warn(`[review-gate] Lock renewal failed: ${err?.message}`);
      });
    }

    cycle++;
    console.log(`[review-gate] Review cycle ${cycle}/${MAX_REVIEW_CYCLES} for #${issueNumber || '?'}`);

    const reviewOutput = await runCodexReview(worktreePath, baseBranch, issueNumber);
    const { verdict, p0Count, p1Count } = evaluateReviewResult(reviewOutput);

    if (verdict === 'pass') {
      return buildGateResult('pass', reviewOutput.result, cycle, Date.now() - gateStart);
    }

    if (verdict === 'error') {
      // Fail-open on infrastructure errors
      console.warn('[review-gate] Review gate error — fail-open');
      return buildGateResult('error', null, cycle, Date.now() - gateStart, reviewOutput.error);
    }

    if (verdict === 'fail-closed') {
      // Hard stop — P0 findings, do not push
      console.error(`[review-gate] FAIL-CLOSED: ${p0Count} P0 findings`);
      return buildGateResult('fail-closed', reviewOutput.result, cycle, Date.now() - gateStart);
    }

    // verdict === 'fail' — attempt remediation if we have cycles left
    lastResult = reviewOutput.result;

    // Circuit breaker: check if findings are repeating (before max-cycle check)
    const currentTitles = new Set((reviewOutput.result?.findings || []).map(f => f.title));
    if (lastFindingTitles.size > 0) {
      const repeating = [...currentTitles].every(t => lastFindingTitles.has(t));
      if (repeating) {
        console.warn('[review-gate] Same findings repeating after remediation — escalating');
        break;
      }
      // Also check if count didn't decrease
      if (currentTitles.size >= lastFindingTitles.size) {
        console.warn(`[review-gate] Finding count did not decrease (${lastFindingTitles.size} → ${currentTitles.size}) — escalating`);
        break;
      }
    }
    lastFindingTitles = currentTitles;

    if (cycle >= MAX_REVIEW_CYCLES) {
      console.warn(`[review-gate] Max review cycles reached (${MAX_REVIEW_CYCLES})`);
      break;
    }

    // Run remediation
    const remediationFindings = (reviewOutput.result?.findings || [])
      .filter(f => f.priority <= 1); // Only fix P0 and P1
    if (remediationFindings.length === 0) {
      console.log('[review-gate] No P0/P1 findings to remediate — escalating');
      break;
    }

    const remediated = await runRemediation(worktreePath, remediationFindings, issueNumber);
    if (!remediated) {
      console.warn('[review-gate] Remediation made no changes — escalating');
      break;
    }
  }

  // Exhausted retries — return fail
  return buildGateResult('fail', lastResult, cycle, Date.now() - gateStart);
}

/**
 * Run a single review pass (no remediation). Used on the CLEAN path.
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath
 * @param {string} opts.baseBranch
 * @param {number|undefined} opts.issueNumber
 * @returns {Promise<ReviewGateResult>}
 */
export async function reviewOnly({ worktreePath, baseBranch, issueNumber }) {
  const startMs = Date.now();
  const reviewOutput = await runCodexReview(worktreePath, baseBranch, issueNumber);
  const { verdict } = evaluateReviewResult(reviewOutput);
  return buildGateResult(verdict, reviewOutput.result, 1, Date.now() - startMs, reviewOutput.error);
}

// ─── PR Helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a PR to draft status.
 */
export async function convertPrToDraft(repo, prNumber, cwd) {
  try {
    // gh doesn't have a direct "convert to draft" command — use the GraphQL API
    const result = await execWithTimeout(
      'gh', ['pr', 'ready', '--undo', String(prNumber), '--repo', repo],
      cwd, 30000,
    );
    console.log(`[review-gate] Converted PR #${prNumber} to draft`);
    return result.exitCode === 0;
  } catch (err) {
    console.warn(`[review-gate] Failed to convert PR #${prNumber} to draft: ${err?.message}`);
    return false;
  }
}

/**
 * Disable auto-merge on a PR (handles case where Claude Code enabled it).
 */
export async function disableAutoMerge(repo, prNumber, cwd) {
  try {
    const result = await execWithTimeout(
      'gh', ['pr', 'merge', '--disable-auto', String(prNumber), '--repo', repo],
      cwd, 30000,
    );
    console.log(`[review-gate] Disabled auto-merge on PR #${prNumber}`);
    return result.exitCode === 0;
  } catch (err) {
    console.warn(`[review-gate] Failed to disable auto-merge on PR #${prNumber}: ${err?.message}`);
    return false;
  }
}

/**
 * Add review findings as a PR comment.
 */
export async function addReviewComment(repo, prNumber, gateResult, cwd) {
  const { result, verdict, remediationCycles, reviewDurationMs } = gateResult;
  if (!result) return false;

  const findingsText = result.findings
    .map(f => {
      const loc = f.code_location
        ? `\`${f.code_location.absolute_file_path}:${f.code_location.line_range?.start || '?'}\``
        : '';
      return `### ${f.title}\n${loc}\n${f.body || ''}`;
    })
    .join('\n\n');

  const body = [
    `## 🔍 Codex Review — ${verdict.toUpperCase()}`,
    '',
    `**Correctness:** ${result.overall_correctness}`,
    `**Confidence:** ${(result.overall_confidence_score * 100).toFixed(0)}%`,
    `**Findings:** ${result.findings.length} (${result.findings.filter(f => f.priority <= 1).length} P0/P1)`,
    `**Duration:** ${(reviewDurationMs / 1000).toFixed(1)}s | **Cycles:** ${remediationCycles}`,
    '',
    result.overall_explanation || '',
    '',
    findingsText ? '---\n' + findingsText : '',
  ].filter(Boolean).join('\n');

  try {
    const result2 = await execWithTimeout(
      'gh', ['pr', 'comment', String(prNumber), '--repo', repo, '--body', body],
      cwd, 30000,
    );
    console.log(`[review-gate] Posted review comment on PR #${prNumber}`);
    return result2.exitCode === 0;
  } catch (err) {
    console.warn(`[review-gate] Failed to post review comment: ${err?.message}`);
    return false;
  }
}

/**
 * Add a label to a PR/issue.
 */
export async function addLabel(repo, prNumber, label, cwd) {
  try {
    const result = await execWithTimeout(
      'gh', ['pr', 'edit', String(prNumber), '--repo', repo, '--add-label', label],
      cwd, 15000,
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ─── Build Result ────────────────────────────────────────────────────────────

function buildGateResult(verdict, result, cycles, durationMs, error) {
  const findings = result?.findings || [];
  return {
    verdict,
    result,
    error,
    reviewDurationMs: durationMs,
    remediationCycles: cycles,
    findingsCount: findings.length,
    p0Count: findings.filter(f => f.priority === 0).length,
    p1Count: findings.filter(f => f.priority === 1).length,
  };
}

// ─── Pre-flight Check ────────────────────────────────────────────────────────

/**
 * Check if the review gate should run. Returns false if:
 * - Codex CLI not available
 * - OPENAI_API_KEY not set
 * - Commit was a no-op (nothing to review)
 */
export async function shouldRunReview(worktreePath) {
  // Check API key
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[review-gate] OPENAI_API_KEY not set — skipping review');
    return false;
  }

  // Check binary
  const available = await checkCodexBinary();
  if (!available) {
    console.warn('[review-gate] Codex CLI not available — skipping review');
    return false;
  }

  // Check there are actual changes to review (commit no-op detection)
  try {
    const result = await execWithTimeout(
      'git', ['diff', '--stat', 'HEAD~1'], worktreePath, 10000,
    );
    if (result.exitCode === 0 && !result.stdout.trim()) {
      console.log('[review-gate] No changes in HEAD commit — skipping review');
      return false;
    }
    // exitCode !== 0 likely means HEAD~1 doesn't exist (first commit) — still review
  } catch {
    // If command fails entirely, still review
  }

  return true;
}

// ─── Structured Logging ──────────────────────────────────────────────────────

/**
 * Log review gate metrics in structured format for observability.
 */
export function logReviewMetrics(gateResult, meta) {
  const metrics = {
    event: 'review_gate',
    issueNumber: meta.issueNumber,
    repo: meta.repo,
    path: meta.path, // 'dirty' or 'clean'
    sessionId: meta.sessionId,
    verdict: gateResult.verdict,
    findingsCount: gateResult.findingsCount,
    p0Count: gateResult.p0Count,
    p1Count: gateResult.p1Count,
    overallCorrectness: gateResult.result?.overall_correctness || null,
    confidenceScore: gateResult.result?.overall_confidence_score || null,
    reviewDurationMs: gateResult.reviewDurationMs,
    remediationCycles: gateResult.remediationCycles,
    error: gateResult.error || null,
  };
  console.log(`[review-gate] ${JSON.stringify(metrics)}`);
}
