import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('ao-executor');

const DEFAULT_SERVICE_URL = 'http://ao.yclaw.internal:8420';
const STATUS_TIMEOUT_MS = 5_000;

// ─── AO Action Executor ────────────────────────────────────────────────────
//
// Actions:
//   ao:status — Check AO service health and queue depth
//
// Used by Architect's stale_issue_sweep to gate delegation on AO availability.
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
    ];
  }

  async execute(
    action: string,
    _params: Record<string, unknown>,
  ): Promise<ActionResult> {
    switch (action) {
      case 'status':
        return this.getStatus();
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
}
