import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';
import type { RepoRegistry } from '../config/repo-registry.js';

const logger = createLogger('repo-executor');

// ─── Repo Registry Action Executor ──────────────────────────────────────────
//
// Actions:
//   repo:register — Register a new repo config (persists to MongoDB)
//   repo:list     — List all registered repo configs
//
// Enables agents to register new repos at runtime without modifying
// yclaw (solves the self-modification exclusion chicken-and-egg).
//

export class RepoExecutor implements ActionExecutor {
  readonly name = 'repo';
  private registry: RepoRegistry;

  constructor(registry: RepoRegistry) {
    this.registry = registry;
  }

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'repo:register',
        description: 'Register a new repository configuration in the repo registry',
        parameters: {
          name: { type: 'string', description: 'Repository name (e.g., "my-app")', required: true },
          github: { type: 'object', description: 'GitHub config: { owner, repo, default_branch, branch_prefix }', required: true },
          tech_stack: { type: 'object', description: 'Tech stack config: { language, framework, package_manager, build_command, test_command, lint_command }', required: true },
          risk_tier: { type: 'string', description: 'Risk tier: "low", "medium", "high", or "auto" (default: auto)' },
          deployment: { type: 'object', description: 'Deployment config: { type, environments }' },
          codegen: { type: 'object', description: 'Codegen config: { preferred_backend, timeout_minutes, max_workspace_mb }' },
        },
      },
      {
        name: 'repo:list',
        description: 'List repositories in the organization',
        parameters: {},
      },
    ];
  }

  async execute(
    action: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult> {
    switch (action) {
      case 'register':
        return this.registerRepo(params);
      case 'list':
        return this.listRepos();
      default:
        return { success: false, error: `Unknown repo action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  // ─── repo:register ─────────────────────────────────────────────────────

  private async registerRepo(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const config = await this.registry.register(params);
      logger.info('Repo registered via action', {
        name: config.name,
        github: `${config.github.owner}/${config.github.repo}`,
      });
      return {
        success: true,
        data: {
          name: config.name,
          github: `${config.github.owner}/${config.github.repo}`,
          risk_tier: config.risk_tier,
          deployment_type: config.deployment.type,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to register repo', { error: msg });
      return { success: false, error: `Failed to register repo: ${msg}` };
    }
  }

  // ─── repo:list ─────────────────────────────────────────────────────────

  private listRepos(): ActionResult {
    const configs = this.registry.getAll();
    const repos = [];
    for (const [name, config] of configs) {
      repos.push({
        name,
        github: `${config.github.owner}/${config.github.repo}`,
        risk_tier: config.risk_tier,
        deployment_type: config.deployment.type,
        tech_stack: config.tech_stack.language,
      });
    }
    return {
      success: true,
      data: { repos, total: repos.length },
    };
  }
}
