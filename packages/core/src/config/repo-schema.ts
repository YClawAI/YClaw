import { z } from 'zod';

// ─── Repo Registry Schema ───────────────────────────────────────────────────
//
// Each target repository gets a YAML config file in repos/.
// Adding a new repo = adding a new file, no code changes.
//

export const GitHubConfigSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  default_branch: z.string().default('main'),
  branch_prefix: z.string().default('agent/'),
});

export const TechStackSchema = z.object({
  language: z.string(),
  framework: z.string().optional(),
  package_manager: z.enum(['npm', 'yarn', 'pnpm', 'bun']).default('npm'),
  build_command: z.string().optional(),
  test_command: z.string().optional(),
  lint_command: z.string().optional(),
});

export const DeploymentEnvironmentsSchema = z.object({
  dev: z.enum(['auto', 'manual', 'none']).default('auto'),
  staging: z.enum(['auto', 'manual', 'none']).default('auto'),
  production: z.enum(['auto', 'manual', 'none']).default('auto'),
});

export const DeploymentConfigSchema = z.object({
  type: z.enum(['vercel', 'ecs', 'github-pages', 'none']).default('none'),
  environments: DeploymentEnvironmentsSchema.default({}),
  /** Vercel project ID (e.g., "prj_xxxxx"). Falls back to VERCEL_PROJECT_ID env var. */
  vercel_project_id: z.string().optional(),
  /** Vercel team/org ID (e.g., "team_xxxxx"). Falls back to VERCEL_ORG_ID env var. */
  vercel_org_id: z.string().optional(),
  /** ECS cluster name (e.g., "yclaw-cluster-production"). */
  cluster: z.string().optional(),
  /** ECS service name (e.g., "yclaw-production"). */
  service: z.string().optional(),
  /** HTTP GET URL after deploy; 2xx = healthy. */
  health_check_url: z.string().optional(),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

export const FrontendEvidenceSchema = z.object({
  browser_evidence: z.boolean().default(false),
  base_url: z.string().optional(),
  start_command: z.string().optional(),
  smoke_paths: z.array(z.string()).default(['/']),
});

export const CodegenConfigSchema = z.object({
  preferred_backend: z.enum(['claude', 'codex', 'opencode']).default('claude'),
  timeout_minutes: z.number().positive().default(15),
  max_workspace_mb: z.number().positive().default(500),
  claude_md_path: z.string().default('CLAUDE.md'),
  frontend: FrontendEvidenceSchema.optional(),
});

export const RiskTier = z.enum(['auto', 'guarded', 'critical']);
export type RiskTierType = z.infer<typeof RiskTier>;

// ─── Security Configuration ─────────────────────────────────────────────────

/**
 * Trust level controls what install scripts and commands are permitted.
 *   sandboxed (default): `npm install --ignore-scripts`, no postinstall
 *   trusted: full `npm install` with lifecycle scripts
 *
 * Only set trusted for repos where you control all dependencies.
 * Install scripts can exfiltrate env vars — sandboxed mode prevents this.
 */
export const TrustLevel = z.enum(['sandboxed', 'trusted']);
export type TrustLevelType = z.infer<typeof TrustLevel>;

/**
 * Per-repo secrets configuration.
 * `codegen_secrets` are available to CLI subprocesses during codegen.
 * `deploy_secrets` are ONLY available to the Deployer role — never to codegen.
 * `github_token_scope` specifies the scope of GitHub access for this repo.
 */
export const SecretsConfigSchema = z.object({
  codegen_secrets: z.array(z.string()).default([]),
  deploy_secrets: z.array(z.string()).default([]),
  github_token_scope: z.enum(['repo', 'contents_rw', 'contents_ro']).default('contents_rw'),
});

// ─── Repo Config ────────────────────────────────────────────────────────────

export const RepoConfigSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/),
  github: GitHubConfigSchema,
  tech_stack: TechStackSchema,
  risk_tier: RiskTier.default('auto'),
  trust_level: TrustLevel.default('sandboxed'),
  deployment: DeploymentConfigSchema.default({}),
  codegen: CodegenConfigSchema.default({}),
  secrets: SecretsConfigSchema.default({}),
  metadata: z.object({
    description: z.string().optional(),
    primary_reviewers: z.array(z.string()).default([]),
  }).default({}),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type TechStack = z.infer<typeof TechStackSchema>;
export type CodegenConfig = z.infer<typeof CodegenConfigSchema>;
export type FrontendEvidence = z.infer<typeof FrontendEvidenceSchema>;
export type SecretsConfig = z.infer<typeof SecretsConfigSchema>;
