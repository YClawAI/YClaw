/**
 * SpawnCliExecutor — Legacy AgentExecutor wrapped as CodingExecutor.
 *
 * Bridges the existing AgentExecutor-based execution path to the new
 * CodingExecutor interface. Used as the CLI fallback (EXECUTOR_TYPE=cli)
 * or when Pi executor is unavailable.
 *
 * Limitations:
 *   - Sessions are ephemeral: no persistence, no reattach across worker restarts
 *   - steer() is unsupported: throws
 *   - Each sendMessage() runs a full AgentExecutor chain (LLM reasoning loop)
 *
 * Design: SpawnCliExecutor stores task context (taskName, payload, model) in
 * an in-memory map keyed by sessionId. sendMessage() calls AgentExecutor.execute()
 * using the stored context, treating the prompt as the task description.
 */

import { createLogger } from '../../logging/logger.js';
import type { CodingExecutor, SessionHandle, SteerInput, TurnResult, HarnessType } from './types.js';
import type { AgentExecutor } from '../../agent/executor.js';
import type { AgentConfig } from '../../config/schema.js';

const logger = createLogger('spawn-cli-executor');

interface CliSessionCtx {
  taskId: string;
  threadId: string;
  taskName: string;
  triggerPayload: Record<string, unknown>;
  modelConfig?: import('../../config/schema.js').ModelConfig;
}

export class SpawnCliExecutor implements CodingExecutor {
  readonly name = 'cli';

  /** In-memory session context — survives only for the lifetime of this worker. */
  private readonly sessionCtx = new Map<string, CliSessionCtx>();

  constructor(
    private readonly agentExecutor: AgentExecutor,
    private readonly builderConfig: AgentConfig,
  ) {}

  /**
   * Create an ephemeral CLI "session". No server-side state — the handle is
   * local to this worker process.
   *
   * Extended opts allows the Dispatcher to pass task context (taskName,
   * triggerPayload, modelConfig) that sendMessage() needs for AgentExecutor.
   */
  async createSession(opts: {
    taskId: string;
    threadId: string;
    harness?: HarnessType;
    model?: string;
    cwd: string;
    timeoutMs?: number;
    // CLI-path extras (not in the base CodingExecutor interface)
    taskName?: string;
    triggerPayload?: Record<string, unknown>;
    modelConfig?: import('../../config/schema.js').ModelConfig;
  }): Promise<SessionHandle> {
    const sessionId = `cli_${opts.taskId}`;
    this.sessionCtx.set(sessionId, {
      taskId: opts.taskId,
      threadId: opts.threadId,
      taskName: opts.taskName ?? 'implement_issue',
      triggerPayload: opts.triggerPayload ?? {},
      modelConfig: opts.modelConfig,
    });

    logger.debug('CLI session created (ephemeral)', {
      sessionId,
      taskName: opts.taskName,
    });

    return {
      sessionId,
      acpResourceUri: '',
      originTaskId: opts.taskId,
      threadId: opts.threadId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      state: 'active',
      model: opts.model ?? '',
      harness: opts.harness ?? 'claude-code',
      ownerWorkerId: null,
      turnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  /** CLI sessions cannot reattach after worker restart. */
  async reattachSession(): Promise<null> {
    return null;
  }

  /**
   * Execute the task via the full AgentExecutor chain (LLM reasoning loop).
   * The `prompt` is injected into the trigger payload so the agent can use it
   * alongside the original event context.
   */
  async sendMessage(
    sessionId: string,
    prompt: string,
    opts?: { timeoutMs?: number; model?: string },
  ): Promise<TurnResult> {
    const ctx = this.sessionCtx.get(sessionId);
    if (!ctx) {
      return {
        success: false,
        modifiedFiles: [],
        diff: '',
        summary: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        error: {
          code: 'SESSION_NOT_FOUND',
          message: `No CLI session context for ${sessionId}`,
          retryable: false,
        },
      };
    }

    // Resolve model override: explicit string override → stored ModelConfig → undefined
    let modelOverride = ctx.modelConfig;
    if (opts?.model && !modelOverride) {
      modelOverride = {
        provider: 'anthropic' as const,
        model: opts.model,
        temperature: 0.2,
        maxTokens: 16384,
      };
    }

    // Inject the prompt into the payload so the agent system prompt can use it
    const payload = {
      ...ctx.triggerPayload,
      _acpPrompt: prompt,
    };

    try {
      const executionRecord = await this.agentExecutor.execute(
        this.builderConfig,
        ctx.taskName,
        'dispatcher',
        payload,
        modelOverride,
      );

      const succeeded = executionRecord.status !== 'failed';
      return {
        success: succeeded,
        modifiedFiles: [],
        diff: '',
        summary: executionRecord.status,
        usage: {
          inputTokens: executionRecord.tokenUsage?.input ?? 0,
          outputTokens: executionRecord.tokenUsage?.output ?? 0,
        },
        ...(executionRecord.error ? {
          error: {
            code: 'AGENT_ERROR',
            message: executionRecord.error,
            retryable: false,
          },
        } : {}),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('CLI executor sendMessage failed', { sessionId, error: msg });
      return {
        success: false,
        modifiedFiles: [],
        diff: '',
        summary: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        error: { code: 'EXECUTOR_ERROR', message: msg, retryable: true },
      };
    }
  }

  /**
   * Steering is not supported for CLI sessions.
   * The AgentExecutor has no notion of a persistent, steerable session.
   * Use the Pi executor (PI_CODING_AGENT_ENABLED=true) for iterative CI-fix loops.
   */
  async steer(_sessionId: string, _input: SteerInput): Promise<TurnResult> {
    return {
      success: false,
      modifiedFiles: [],
      diff: '',
      summary: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      error: {
        code: 'UNSUPPORTED',
        message: 'CLI executor does not support steering — use Pi executor instead',
        retryable: false,
      },
    };
  }

  /** No-op: CLI sessions have no server-side state to cancel. */
  async cancel(): Promise<void> {
    // CLI process cancellation is handled by worker AbortController, not here
  }

  /** No-op: CLI sessions have no server-side state to close. */
  async close(sessionId: string): Promise<void> {
    this.sessionCtx.delete(sessionId);
  }
}
