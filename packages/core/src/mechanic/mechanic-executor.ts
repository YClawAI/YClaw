/**
 * MechanicExecutor — Constrained task runner for mechanical repo operations.
 *
 * Executes ONLY whitelisted shell commands (lockfile sync, formatting,
 * rebasing). No LLM involvement — purely deterministic execution.
 *
 * Safety controls:
 * - Command whitelist — never runs arbitrary shell commands
 * - Input sanitization — rejects fields with shell metacharacters
 * - execFileSync — no shell invocation, argument injection impossible
 * - Repository allowlist — your-org org only
 * - File output filter — only commits files matching the task type's allowed patterns
 * - 5-minute timeout per task
 * - Rebase abort on conflict
 */

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('mechanic');

// ─── Input Sanitization ─────────────────────────────────────────────────────

/** Only allow safe characters in fields that are passed to shell commands. */
const SAFE_FIELD = /^[a-zA-Z0-9._\-\/]+$/;

export function sanitizeField(value: string, fieldName: string): string {
  if (!SAFE_FIELD.test(value)) {
    throw new Error(
      `Invalid ${fieldName}: contains unsafe characters. Got: "${value.slice(0, 100)}"`,
    );
  }
  return value;
}

// ─── Task Catalog ───────────────────────────────────────────────────────────

export interface MechanicTask {
  repo: string;
  branch: string;
  taskType: string;
  packageManager?: string;
  reason?: string;
  requestedBy?: string;
  prNumber?: number;
}

export interface CommandStep {
  cmd: string;
  args: string[];
}

export interface TaskCatalogEntry {
  /** Sequential command steps — each executed via execFileSync (no shell). */
  steps: CommandStep[];
  /** Glob patterns for files allowed to be committed. null = any file allowed. */
  allowedFiles: string[] | null;
  /** Whether to use shallow clone (faster for lockfile ops). */
  shallowClone: boolean;
  /** Whether to force-push (needed for rebase). */
  forcePush: boolean;
}

export const TASK_CATALOG: Record<string, TaskCatalogEntry> = {
  sync_npm_lockfile: {
    steps: [{ cmd: 'npm', args: ['install', '--package-lock-only', '--ignore-scripts'] }],
    allowedFiles: ['package-lock.json'],
    shallowClone: true,
    forcePush: false,
  },
  sync_pnpm_lockfile: {
    steps: [{ cmd: 'pnpm', args: ['install', '--lockfile-only'] }],
    allowedFiles: ['pnpm-lock.yaml'],
    shallowClone: true,
    forcePush: false,
  },
  sync_yarn_lockfile: {
    steps: [{ cmd: 'yarn', args: ['install', '--mode=update-lockfile'] }],
    allowedFiles: ['yarn.lock'],
    shallowClone: true,
    forcePush: false,
  },
  go_mod_tidy: {
    steps: [{ cmd: 'go', args: ['mod', 'tidy'] }],
    allowedFiles: ['go.mod', 'go.sum'],
    shallowClone: true,
    forcePush: false,
  },
  format_code: {
    steps: [{ cmd: 'npx', args: ['prettier', '--write', '.'] }],
    allowedFiles: null,
    shallowClone: true,
    forcePush: false,
  },
  lint_fix: {
    steps: [{ cmd: 'npx', args: ['eslint', '--fix', '.'] }],
    allowedFiles: null,
    shallowClone: true,
    forcePush: false,
  },
  rebase_branch: {
    steps: [
      { cmd: 'git', args: ['fetch', 'origin', 'master'] },
      { cmd: 'git', args: ['rebase', 'origin/master'] },
    ],
    allowedFiles: null,
    shallowClone: false,
    forcePush: true,
  },
  update_branch: {
    steps: [
      { cmd: 'git', args: ['fetch', 'origin', 'master'] },
      { cmd: 'git', args: ['merge', 'origin/master', '--no-edit'] },
    ],
    allowedFiles: null,
    shallowClone: false,
    forcePush: false,
  },
};

const ALLOWED_ORG = 'your-org';
const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface MechanicResult {
  success: boolean;
  taskType: string;
  filesChanged: string[];
  commitSha?: string;
  error?: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateTask(task: MechanicTask): string | null {
  if (!TASK_CATALOG[task.taskType]) {
    return `Unknown task type: ${task.taskType}. Allowed: ${Object.keys(TASK_CATALOG).join(', ')}`;
  }

  // Sanitize all fields that will be used in shell commands
  try {
    sanitizeField(task.repo, 'repo');
    sanitizeField(task.branch, 'branch');
    if (task.reason) sanitizeField(task.reason, 'reason');
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }

  if (!task.repo.startsWith(`${ALLOWED_ORG}/`)) {
    return `Repository ${task.repo} is not in the ${ALLOWED_ORG} org`;
  }
  if (!task.branch || task.branch === 'master' || task.branch === 'main') {
    return `Cannot run mechanic tasks on protected branch: ${task.branch || '(empty)'}`;
  }
  return null;
}

/**
 * Filter changed files against the task's allowedFiles patterns.
 * Returns files that should NOT be committed (violations).
 */
export function filterDisallowedFiles(
  changedFiles: string[],
  allowedFiles: string[] | null,
): string[] {
  if (allowedFiles === null) return []; // any file allowed
  return changedFiles.filter(
    (f) => !allowedFiles.some((pattern) => f.endsWith(pattern)),
  );
}

// ─── Executor ───────────────────────────────────────────────────────────────

export async function executeMechanicTask(
  task: MechanicTask,
  githubToken: string,
): Promise<MechanicResult> {
  const validationError = validateTask(task);
  if (validationError) {
    logger.error('Task validation failed', { task: task.taskType, error: validationError });
    return { success: false, taskType: task.taskType, filesChanged: [], error: validationError };
  }

  const catalogEntry = TASK_CATALOG[task.taskType]!;
  const workDir = mkdtempSync(join(tmpdir(), 'mechanic-'));

  logger.info('Starting mechanic task', {
    taskType: task.taskType,
    repo: task.repo,
    branch: task.branch,
    prNumber: task.prNumber,
    requestedBy: task.requestedBy,
  });

  try {
    const execOpts: ExecFileSyncOptions = {
      cwd: workDir,
      timeout: TASK_TIMEOUT_MS,
      stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    };

    // Clone the repo — execFileSync, no shell
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${task.repo}.git`;
    const cloneArgs = ['clone'];
    if (catalogEntry.shallowClone) cloneArgs.push('--depth=50');
    cloneArgs.push('--branch', task.branch, '--single-branch', cloneUrl, 'repo');
    execFileSync('git', cloneArgs, execOpts);

    const repoDir = join(workDir, 'repo');
    const repoExecOpts: ExecFileSyncOptions = { ...execOpts, cwd: repoDir };

    // Configure git identity
    execFileSync('git', ['config', 'user.email', 'mechanic@yclaw.example.com'], repoExecOpts);
    execFileSync('git', ['config', 'user.name', 'YClaw Mechanic'], repoExecOpts);

    // Execute the whitelisted command steps
    try {
      for (const step of catalogEntry.steps) {
        execFileSync(step.cmd, step.args, repoExecOpts);
      }
    } catch (cmdError: unknown) {
      // Special handling for rebase conflicts
      if (task.taskType === 'rebase_branch') {
        logger.warn('Rebase conflict detected, aborting', { branch: task.branch });
        try {
          execFileSync('git', ['rebase', '--abort'], repoExecOpts);
        } catch {
          // abort may fail if not in rebase state — ignore
        }
        const msg = cmdError instanceof Error ? cmdError.message : String(cmdError);
        return {
          success: false,
          taskType: task.taskType,
          filesChanged: [],
          error: `Rebase conflict: ${msg.slice(0, 500)}`,
        };
      }
      throw cmdError;
    }

    // Check which files changed
    const diffOutput = execFileSync('git', ['diff', '--name-only'], repoExecOpts).toString().trim();
    const stagedOutput = execFileSync('git', ['diff', '--cached', '--name-only'], repoExecOpts).toString().trim();

    // For rebase, changes are already committed — check against origin
    let changedFiles: string[];
    if (task.taskType === 'rebase_branch') {
      const rebaseChanges = execFileSync(
        'git', ['diff', '--name-only', `origin/${task.branch}..HEAD`],
        repoExecOpts,
      ).toString().trim();
      changedFiles = rebaseChanges ? rebaseChanges.split('\n') : [];
    } else {
      changedFiles = [...new Set([
        ...(diffOutput ? diffOutput.split('\n') : []),
        ...(stagedOutput ? stagedOutput.split('\n') : []),
      ])];
    }

    if (changedFiles.length === 0 && task.taskType !== 'rebase_branch') {
      logger.info('No files changed, nothing to commit', { taskType: task.taskType });
      return { success: true, taskType: task.taskType, filesChanged: [] };
    }

    // Verify file output allowlist
    const disallowed = filterDisallowedFiles(changedFiles, catalogEntry.allowedFiles);
    if (disallowed.length > 0) {
      logger.error('Disallowed files modified', { disallowed, taskType: task.taskType });
      return {
        success: false,
        taskType: task.taskType,
        filesChanged: changedFiles,
        error: `Disallowed files modified: ${disallowed.join(', ')}`,
      };
    }

    // Commit and push (skip for rebase — already committed)
    if (task.taskType !== 'rebase_branch') {
      execFileSync('git', ['add', '-A'], repoExecOpts);
      const commitMsg = `chore(${task.taskType}): ${task.reason || task.taskType} [mechanic]`;
      execFileSync('git', ['commit', '-m', commitMsg], repoExecOpts);
    }

    const pushArgs = ['push', 'origin', task.branch];
    if (catalogEntry.forcePush) pushArgs.push('--force-with-lease');
    execFileSync('git', pushArgs, repoExecOpts);

    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], repoExecOpts).toString().trim();

    logger.info('Mechanic task completed', {
      taskType: task.taskType,
      filesChanged: changedFiles.length,
      commitSha,
      branch: task.branch,
    });

    return {
      success: true,
      taskType: task.taskType,
      filesChanged: changedFiles,
      commitSha,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Mechanic task failed', { taskType: task.taskType, error: msg });
    return {
      success: false,
      taskType: task.taskType,
      filesChanged: [],
      error: msg.slice(0, 1000),
    };
  } finally {
    // Clean up workspace
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      logger.warn('Failed to clean up workspace', { workDir });
    }
  }
}
