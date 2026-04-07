/**
 * Pi Cost Bridge — subscribes to pi session events and forwards cost data
 * to YClaw's existing CostTracker. No Proxy wrappers. No model wrappers.
 * Pi computes costs natively — we just listen.
 *
 * Usage:
 *   const bridge = new PiCostBridge(costTracker, { agentName: "builder", taskId });
 *   const unsubscribe = session.subscribe((event) => bridge.handleEvent(event));
 *   // ... run session ...
 *   unsubscribe();
 *   const totals = bridge.getTotals();
 */

import type { CostTracker } from '../costs/cost-tracker.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('pi-cost-bridge');

export class PiCostBridge {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private totalCostUsd = 0;
  private turnCount = 0;

  constructor(
    private readonly costTracker: CostTracker,
    private readonly context: {
      agentName: string;
      taskId: string;
      department?: string;
      modelId?: string;
      provider?: string;
    },
  ) {}

  /**
   * Handle a pi session event. Wire this to session.subscribe().
   * Only processes 'message_end' events that contain usage data.
   */
  handleEvent(event: unknown): void {
    if (!event || typeof event !== 'object' || !('type' in event)) return;
    const evt = event as { type: string; [key: string]: unknown };

    if (evt.type !== 'message_end') return;

    const message = evt.message as Record<string, unknown> | undefined;
    if (!message?.usage) return;

    const usage = message.usage as {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
      cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
    };

    // Accumulate
    this.inputTokens += usage.input ?? 0;
    this.outputTokens += usage.output ?? 0;
    this.cacheReadTokens += usage.cacheRead ?? 0;
    this.cacheWriteTokens += usage.cacheWrite ?? 0;
    this.totalCostUsd += usage.cost?.total ?? 0;
    this.turnCount++;

    // Forward to YClaw cost tracker immediately (CostTracker handles errors internally)
    this.costTracker.record({
      agentId: this.context.agentName,
      department: this.context.department ?? 'development',
      taskType: 'coding',
      executionId: this.context.taskId,
      modelId: this.context.modelId ?? 'claude-sonnet-4-20250514',
      provider: (this.context.provider as 'anthropic' | 'openrouter' | 'ollama') ?? 'anthropic',
      inputTokens: usage.input ?? 0,
      outputTokens: usage.output ?? 0,
      cacheReadTokens: usage.cacheRead ?? 0,
      cacheWriteTokens: usage.cacheWrite ?? 0,
      latencyMs: 0, // Not available from event — tracked at turn level if needed
    }).catch((err) => {
      logger.warn('Cost tracking failed (non-fatal)', {
        taskId: this.context.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** Get accumulated totals for this session */
  getTotals(): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalCostUsd: number;
    turnCount: number;
  } {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      totalCostUsd: this.totalCostUsd,
      turnCount: this.turnCount,
    };
  }

  /** Reset counters (e.g., between followUp chains) */
  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheWriteTokens = 0;
    this.totalCostUsd = 0;
    this.turnCount = 0;
  }
}
