import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('ao-executor');

const DEFAULT_SERVICE_URL = 'http://ao.yclaw.internal:8420';
const STATUS_TIMEOUT_MS = 5_000;
const REGISTER_TIMEOUT_MS = 300_000; // 5 min — clone can take a while

// ─── AO Action Executor ────────────────────────────────────────────────────
//
// Actions:
//   ao:status           — Check AO service health and queue depth
//   ao:register_project — Dynamically register a new repo in AO at runtime
//
// Used by Architect to manage AO without requiring a redeploy.
//

export class AoExecutor implements ActionExecutor {
  readonly name = 'ao';
  private readonly serviceUrl: string;

  constructor() {
    this.serviceUrl = process.env.AO_SERVICE_URL || DEFAULT_SERVICE_URL;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'ao:status',
        description:
          'Check AO (Agent Orchestrator) health and queue depth. Returns available (boolean), queue_depth (number or null), and any open circuit breakers.',
        parameters: {},
      },
      {
        name: 'ao:register_project',
        description:
          'Dynamically register a new GitHub repository with the Agent Orchestrator at runtime. ' +
          'AO will clone the repo and register it as an active project without requiring a redeploy. ' +
          'Use this when you need to work on a repo that is not yet configured in AO.',
        parameters: {
          repoUrl: {
            type: 'string',
            description:
              'GitHub repo URL (https://github.com/owner/repo) or slug (owner/repo).',
            required: true,
          },
          name: {
            type: 'string',
            description: 'Optional AO project key override. Defaults to the repo slug (owner__repo).',
            required: false,
          },
          branch: {
            type: 'string',
            description: 'Default branch to clone and track. Defaults to "main".',
            required: false,
          },
        },
      },
    ];
  }

  async execute(
    action: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult> {
    switch (action) {
      case 'status':
        return this.getStatus();
      case 'register_project':
        return this.registerProject(params);
      default:
        return { success: false, error: `Unknown ao action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.isAvailable();
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async getStatus(): Promise<ActionResult> {
    const available = await this.isAvailable();

    // Try /status for queue depth (best-effort — endpoint may not exist)
    let queueDepth: number | null = null;
    let degraded = false;

    if (available) {
      try {
        const response = await fetch(`${this.serviceUrl}/status`, {
          signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
        });
        if (response.ok) {
          const body = (await response.json()) as Record<string, unknown>;
          if (typeof body.queue_depth === 'number') {
            queueDepth = body.queue_depth;
          }
          if (body.degraded === true) {
            degraded = true;
          }
        }
      } catch {
        // /status endpoint may not exist — that's fine, health is enough
        logger.debug('AO /status endpoint unavailable — queue depth unknown');
      }
    }

    return {
      success: true,
      data: {
        available,
        degraded,
        queue_depth: queueDepth,
        service_url: this.serviceUrl,
      },
    };
  }

  private async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serviceUrl}/health`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async registerProject(params: Record<string, unknown>): Promise<ActionResult> {
    const { repoUrl, name, branch } = params;

    if (typeof repoUrl !== 'string' || !repoUrl.trim()) {
      return { success: false, error: 'repoUrl is required' };
    }

    const body: Record<string, string> = { repoUrl: repoUrl.trim() };
    if (typeof name === 'string' && name.trim()) {
      body.name = name.trim();
    }
    if (typeof branch === 'string' && branch.trim()) {
      body.branch = branch.trim();
    }

    try {
      const token = process.env.AO_AUTH_TOKEN;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['X-AO-TOKEN'] = token;
      }

      const response = await fetch(`${this.serviceUrl}/api/projects/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
      });

      const responseBody = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        const errMsg = typeof responseBody.error === 'string'
          ? responseBody.error
          : `AO returned HTTP ${response.status}`;
        logger.error(`ao:register_project failed: ${errMsg}`);
        return { success: false, error: errMsg };
      }

      logger.info(`ao:register_project succeeded for ${repoUrl}`, { data: responseBody });
      return { success: true, data: responseBody };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`ao:register_project request failed: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
}
