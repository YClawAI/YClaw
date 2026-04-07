import type { RepoConfig } from '../config/repo-schema.js';

// ─── Codegen System Types ───────────────────────────────────────────────────
//
// Core types for workspace management, session tracking, and codegen results.
//

/** Workspace lifecycle state */
export type WorkspaceState =
  | 'creating'
  | 'cloning'
  | 'provisioning'
  | 'executing'
  | 'collecting'
  | 'pushing'
  | 'cleaning';

/** A provisioned workspace for a codegen session */
export interface Workspace {
  id: string;
  repoConfig: RepoConfig;
  basePath: string;
  repoPath: string;
  outputPath: string;
  branch: string;
  state: WorkspaceState;
  createdAt: Date;
}

/** Parameters for codegen:execute action */
export interface CodegenExecuteParams {
  repo: string;
  task: string;
  backend?: string;
  issue_url?: string;
  branch_name?: string;
  run_tests?: boolean;
  max_iterations?: number;
  correlationId?: string;
  /** Agent name for audit attribution (defaults to 'builder' if not provided). */
  agent_name?: string;
}

/** Result from a codegen session */
export interface CodegenSessionResult {
  session_id: string;
  repo: string;
  branch: string;
  status: 'success' | 'partial' | 'failed';
  files_changed: string[];
  tests_passed: boolean;
  commit_sha?: string;
  backend_used: string;
  duration_seconds: number;
  error?: string;
  /** Redacted CLI stdout (last 10KB) for QA traceability. */
  stdout_redacted?: string;
  /** Redacted CLI stderr (last 10KB) for QA traceability. */
  stderr_redacted?: string;
  /** Paths to browser evidence artifacts (screenshots/videos) captured after codegen. */
  browser_evidence_urls?: string[];
}

/** Parameters passed to a CLI backend */
export interface BackendExecuteParams {
  workspace: Workspace;
  task: string;
  timeout_ms: number;
  env: Record<string, string>;
}

/** Result from a CLI backend subprocess */
export interface BackendResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}

/** Session rules injected into every CLI session */
export const SESSION_RULES = `
- Update the repo's root CLAUDE.md with new decisions, patterns, and gotchas
- Update README if the change affects usage, build, or deployment
- Non-obvious decisions get a code comment explaining WHY
- Every PR includes documentation proportional to the change
- Maintain system state documentation in CLAUDE.md:
  - Component relationships (what connects to what)
  - Data flow descriptions (how data moves through the system)
  - State machines (anything with lifecycle stages)
  - Key dependency map (imports, APIs, external services)
- The goal: the next agent (or human) can pick up where you left off
`.trim();

/** Claudeception reflection prompt (runs after every codegen session) */
export const REFLECTION_PROMPT = `
You've completed the task. Before we finish:
1. Is there anything you would have done differently?
2. Did you discover any non-obvious patterns, gotchas, or conventions?
3. Update CLAUDE.md with these learnings.
4. If the learning is reusable, document it as a pattern in CLAUDE.md.
`.trim();
