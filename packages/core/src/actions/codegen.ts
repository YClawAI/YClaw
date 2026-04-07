import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';
import { isRepoExcluded } from '../config/repo-loader.js';
import type { RepoRegistry } from '../config/repo-registry.js';
import { WorkspaceProvisioner } from '../codegen/provisioner.js';
import { BackendRouter } from '../codegen/backends/router.js';
import type {
  CodegenExecuteParams,
  CodegenSessionResult,
} from '../codegen/types.js';
import { REFLECTION_PROMPT } from '../codegen/types.js';
import { redactSecrets } from '../codegen/secrets.js';
import type { AuditLog } from '../logging/audit.js';
import { GitHubExecutor } from './github/index.js';

const logger = createLogger('codegen-executor');

// ─── Codegen Action Executor ────────────────────────────────────────────────
//
// Replaces AgentSpawnExecutor. Orchestrates CLI coding tools against
// target repos instead of spawning other agents' LLM loops.
//
// Actions:
//   codegen:direct  — Commit files + open PR via GitHub API (no subprocess)
//   codegen:execute — Run a codegen session against a target repo (CLI fallback)
//   codegen:status  — Check status of a codegen session (future)
//

interface DirectCommitParams {
  repo: string;
  branch_name: string;
  files: Array<{ path: string; content: string }>;
  pr_title: string;
  pr_body?: string;
  base_branch?: string;
  closes_issues?: number[];
}

/** Active sessions for status tracking */
const activeSessions = new Map<string, CodegenSessionResult>();

export class CodegenExecutor implements ActionExecutor {
  readonly name = 'codegen';
  private provisioner = new WorkspaceProvisioner();
  private router = new BackendRouter();
  private github = new GitHubExecutor();
  private auditLog: AuditLog;
  private registry: RepoRegistry;

  constructor(auditLog: AuditLog, registry: RepoRegistry) {
    this.auditLog = auditLog;
    this.registry = registry;
  }

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'codegen:direct',
        description: 'Commit multiple files and open a PR directly via GitHub API (no subprocess spawning). Use this as the default implementation path for all new features and bug fixes.',
        parameters: {
          repo: { type: 'string', description: 'Repository name from the repo registry', required: true },
          branch_name: { type: 'string', description: 'Feature branch name to create (e.g. "agent/builder-fix-login")', required: true },
          files: { type: 'array', description: 'Files to commit: array of {path, content} objects with full file content', required: true },
          pr_title: { type: 'string', description: 'Pull request title', required: true },
          pr_body: { type: 'string', description: 'Pull request description body' },
          base_branch: { type: 'string', description: 'Base branch to target (default: repo default_branch)' },
        },
      },
      {
        name: 'codegen:execute',
        description: 'Execute a code generation session against a target repository using CLI coding tools (Claude Code, Codex, OpenCode)',
        parameters: {
          repo: { type: 'string', description: 'Repository name from the repo registry', required: true },
          task: { type: 'string', description: 'Natural language task description for the codegen backend', required: true },
          backend: { type: 'string', description: 'Codegen backend override: "claude", "codex", or "opencode" (default: auto-select)' },
          issue_url: { type: 'string', description: 'GitHub issue URL for context' },
          branch_name: { type: 'string', description: 'Custom branch name (default: auto-generated from task)' },
          run_tests: { type: 'boolean', description: 'Run post-checks (tests, lint, build) after codegen (default: true)' },
          max_iterations: { type: 'number', description: 'Max fix-test loop iterations (default: 3)' },
          agent_name: { type: 'string', description: 'Agent name for audit trail (default: "builder")' },
        },
      },
      {
        name: 'codegen:status',
        description: 'Check the status of a codegen session',
        parameters: {
          session_id: { type: 'string', description: 'Codegen session ID to check', required: true },
        },
      },
    ];
  }

  async execute(
    action: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult> {
    switch (action) {
      case 'direct':
        return this.executeDirect(params as unknown as DirectCommitParams);
      case 'execute':
        return this.executeCodegen(params as unknown as CodegenExecuteParams);
      case 'status':
        return this.getStatus(params);
      default:
        return { success: false, error: `Unknown codegen action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.router.hasAvailableBackend();
  }

  // ─── codegen:direct ─────────────────────────────────────────────────────

  private async executeDirect(params: DirectCommitParams): Promise<ActionResult> {
    const { repo, branch_name, files, pr_title, pr_body = '', base_branch, closes_issues } = params;

    if (!repo || !branch_name || !files || files.length === 0 || !pr_title) {
      return { success: false, error: 'Missing required parameters: repo, branch_name, files, pr_title' };
    }

    if (isRepoExcluded(repo)) {
      return {
        success: false,
        error: `Repo "${repo}" is excluded from codegen (self-modification protection)`,
      };
    }

    const repoConfig = this.registry.get(repo);
    if (!repoConfig) {
      return { success: false, error: `Repo "${repo}" not found in registry` };
    }

    const owner = repoConfig.github.owner;
    const repoName = repoConfig.github.repo;
    const baseBranch = base_branch || repoConfig.github.default_branch;

    logger.info('Starting direct commit', { repo, branch: branch_name, fileCount: files.length });

    // Step 1: Create branch
    const branchResult = await this.github.execute('create_branch', {
      owner,
      repo: repoName,
      branch: branch_name,
      from_ref: baseBranch,
    });
    if (!branchResult.success) {
      return { success: false, error: `Failed to create branch "${branch_name}": ${branchResult.error}` };
    }

    // Step 2: Atomic multi-file commit via Git Trees API
    const commitResult = await this.github.execute('commit_batch', {
      owner,
      repo: repoName,
      branch: branch_name,
      base_branch: baseBranch,
      message: pr_title,
      files,
    });
    if (!commitResult.success) {
      return { success: false, error: `Failed to commit files: ${commitResult.error}` };
    }

    // Step 3: Open PR
    const prParams: Record<string, unknown> = {
      owner,
      repo: repoName,
      title: pr_title,
      body: pr_body,
      head: branch_name,
      base: baseBranch,
    };
    if (closes_issues && closes_issues.length > 0) {
      prParams.closes_issues = closes_issues;
    }
    const prResult = await this.github.execute('create_pr', prParams);
    if (!prResult.success) {
      return { success: false, error: `Failed to create PR: ${prResult.error}` };
    }

    const prData = prResult.data as Record<string, unknown>;
    const commitData = commitResult.data as Record<string, unknown>;

    logger.info('Direct commit complete', {
      repo,
      branch: branch_name,
      prUrl: prData?.html_url,
      filesChanged: files.length,
    });

    return {
      success: true,
      data: {
        pr_url: prData?.html_url,
        pr_number: prData?.number,
        branch: branch_name,
        files_changed: files.map((f) => f.path),
        commit_sha: commitData?.sha,
      },
    };
  }

  // ─── codegen:execute ────────────────────────────────────────────────────

  private async executeCodegen(
    params: CodegenExecuteParams,
  ): Promise<ActionResult> {
    const {
      repo,
      task,
      backend: backendOverride,
      issue_url,
      branch_name,
      run_tests = true,
      max_iterations = 3,
      correlationId,
      agent_name = 'builder',
    } = params;

    // Validate required params
    if (!repo || !task) {
      return {
        success: false,
        error: 'Missing required parameters: repo, task',
      };
    }

    // Defense-in-depth: runtime exclusion check
    if (isRepoExcluded(repo)) {
      return {
        success: false,
        error: `Repo "${repo}" is excluded from codegen (self-modification protection)`,
      };
    }

    const sessionId = `cg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = Date.now();

    logger.info('Starting codegen session', {
      sessionId,
      repo,
      task: task.slice(0, 100),
      backend: backendOverride || 'auto',
    });

    // Initialize session result for tracking
    const sessionResult: CodegenSessionResult = {
      session_id: sessionId,
      repo,
      branch: '',
      status: 'failed',
      files_changed: [],
      tests_passed: false,
      backend_used: '',
      duration_seconds: 0,
    };
    activeSessions.set(sessionId, sessionResult);

    let workspace;

    try {
      // Load repo config from live registry
      const repoConfig = this.registry.get(repo);
      if (!repoConfig) {
        const err = `Repo "${repo}" not found in registry`;
        sessionResult.error = err;
        return { success: false, error: err };
      }

      // Resolve backend (checks availability, falls back through chain)
      const backend = await this.router.resolve(
        backendOverride || repoConfig.codegen.preferred_backend,
      );
      if (!backend) {
        const err = `No available codegen backend (tried: ${backendOverride || repoConfig.codegen.preferred_backend})`;
        sessionResult.error = err;
        return { success: false, error: err };
      }
      sessionResult.backend_used = backend.name;

      // Generate branch name
      const slug = task
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 30)
        .replace(/-$/, '');
      const branch = branch_name || `${repoConfig.github.branch_prefix}builder-${slug}`;
      sessionResult.branch = branch;

      // Create workspace
      workspace = this.provisioner.createWorkspace(repoConfig, branch);

      // Clone → Branch → Provision
      await this.provisioner.cloneRepo(workspace);
      await this.provisioner.createBranch(workspace);

      // Compose task with context
      let fullTask = task;
      if (issue_url) {
        fullTask = `GitHub Issue: ${issue_url}\n\n${task}`;
      }

      this.provisioner.provisionConfig(workspace, fullTask);

      // Execute codegen with fix-test loop
      workspace.state = 'executing';
      const timeoutMs = repoConfig.codegen.timeout_minutes * 60 * 1000;
      const env = this.buildScopedEnv(repoConfig);

      let iteration = 0;
      let lastResult;

      while (iteration < max_iterations) {
        iteration++;
        const iterationTask = iteration === 1
          ? fullTask
          : `Tests failed after previous attempt. Fix the failing tests and ensure all checks pass.\n\nPrevious stderr:\n${redactSecrets(lastResult?.stderr.slice(0, 2000) || 'unknown')}`;

        logger.info('Codegen iteration', {
          sessionId,
          iteration,
          backend: backend.name,
        });

        lastResult = await backend.execute({
          workspace,
          task: iterationTask,
          timeout_ms: timeoutMs,
          env,
        });

        if (lastResult.timed_out) {
          sessionResult.error = `Backend timed out after ${repoConfig.codegen.timeout_minutes} minutes`;
          break;
        }

        // Run post-checks if requested
        if (run_tests) {
          const checks = await this.provisioner.runPostChecks(workspace);
          sessionResult.tests_passed = checks.tests && checks.lint && checks.build;

          if (sessionResult.tests_passed) {
            logger.info('All checks passed', { sessionId, iteration });
            break;
          }

          if (iteration < max_iterations) {
            logger.warn('Checks failed, retrying', {
              sessionId,
              iteration,
              checks,
            });
          }
        } else {
          sessionResult.tests_passed = true;
          break;
        }
      }

      // Run Claudeception reflection phase
      if (lastResult && lastResult.exit_code === 0) {
        logger.info('Running Claudeception reflection', { sessionId });
        await backend.execute({
          workspace,
          task: REFLECTION_PROMPT,
          timeout_ms: 120_000,
          env,
        });
      }

      // Capture redacted CLI output for QA traceability
      if (lastResult) {
        sessionResult.stdout_redacted = redactSecrets(lastResult.stdout).slice(-10_000);
        sessionResult.stderr_redacted = redactSecrets(lastResult.stderr).slice(-10_000);
      }

      // Collect results
      workspace.state = 'collecting';
      sessionResult.files_changed = await this.provisioner.getFilesChanged(workspace);

      // Commit and push
      if (sessionResult.files_changed.length > 0) {
        const commitMsg = `feat: ${task.slice(0, 72)}\n\nCodegen session: ${sessionId}\nBackend: ${backend.name}`;
        const pushResult = await this.provisioner.commitAndPush(workspace, commitMsg);
        sessionResult.commit_sha = pushResult.sha;

        if (pushResult.pushed) {
          sessionResult.status = sessionResult.tests_passed ? 'success' : 'partial';
        } else {
          sessionResult.status = 'partial';
          sessionResult.error = 'Push failed';
        }
      } else {
        sessionResult.status = 'partial';
        sessionResult.error = 'No files changed';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Codegen session failed', { sessionId, error: redactSecrets(msg) });
      sessionResult.error = redactSecrets(msg);
      sessionResult.status = 'failed';
    } finally {
      // Guaranteed cleanup
      if (workspace) {
        this.provisioner.cleanup(workspace);
      }

      sessionResult.duration_seconds = Math.round((Date.now() - start) / 1000);

      // Redact any secrets from error messages before audit trail storage
      if (sessionResult.error) {
        sessionResult.error = redactSecrets(sessionResult.error);
      }

      logger.info('Codegen session complete', {
        sessionId,
        status: sessionResult.status,
        duration: sessionResult.duration_seconds,
        filesChanged: sessionResult.files_changed.length,
      });

      // Persist to audit trail for QA traceability
      try {
        await this.auditLog.recordCodegenSession(
          sessionResult,
          agent_name,
          task,
          correlationId,
        );
      } catch (auditErr) {
        logger.error('Failed to record codegen session to audit log', {
          sessionId,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        });
      }
    }

    return {
      success: sessionResult.status !== 'failed',
      data: sessionResult as unknown as Record<string, unknown>,
    };
  }

  // ─── codegen:status ─────────────────────────────────────────────────────

  private getStatus(params: Record<string, unknown>): ActionResult {
    const sessionId = params.session_id as string | undefined;
    if (!sessionId) {
      return { success: false, error: 'Missing session_id parameter' };
    }

    const session = activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    return {
      success: true,
      data: session as unknown as Record<string, unknown>,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Build a scoped environment for the CLI subprocess.
   * Only includes what the subprocess needs — NOT system credentials.
   *
   * IMPORTANT: Only codegen_secrets are passed here.
   * deploy_secrets are NEVER available to codegen subprocesses —
   * they're only accessible to the Deployer role.
   */
  private buildScopedEnv(repoConfig: import('../config/repo-schema.js').RepoConfig): Record<string, string> {
    const env: Record<string, string> = {};

    // Git credentials: NOT passed via env. The workspace provisioner configures
    // a git credential.helper in .git/config that reads from a credentials file.
    // This prevents GITHUB_TOKEN from leaking via subprocess env or CLI tool logs.

    // Backend-specific keys are added by each backend
    // Repo-specific codegen secrets from Secrets Manager (future: load from AWS SM)
    // deploy_secrets are intentionally excluded — Deployer role only
    for (const secretName of repoConfig.secrets.codegen_secrets) {
      const val = process.env[secretName];
      if (val) {
        env[secretName] = val;
      }
    }

    return env;
  }
}
