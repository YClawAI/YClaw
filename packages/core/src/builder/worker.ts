/**
 * CodingWorker — Independent execution unit for the Builder Dispatcher.
 *
 * Each worker runs a task via the CodingExecutorRouter, which selects
 * between the Pi executor (when PI_CODING_AGENT_ENABLED=true) and the
 * legacy CLI path (AgentExecutor chain).
 *
 * Workers do NOT share mutable state. The Dispatcher manages the pool
 * and assigns tasks to idle workers.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import type { AgentExecutor } from '../agent/executor.js';
import type { AgentConfig, ExecutionRecord } from '../config/schema.js';
import type { BuilderTask, WorkerHandle, TaskFailureReason } from './types.js';
import { TaskState } from './types.js';
import { classifyDrainTermination } from './deploy-state.js';
import { CodingExecutorRouter, type ExecutorRouterConfig } from '../codegen/backends/executors.js';

const logger = createLogger('builder-worker');

export interface WorkerDeps {
  executor: AgentExecutor;
  builderConfig: AgentConfig;
  /** Pre-built executor router. If absent, one is created from env vars. */
  executorRouter?: CodingExecutorRouter;
  /** CostTracker for Pi executor cost bridge. Required when PI_CODING_AGENT_ENABLED=true. */
  costTracker?: import('../costs/cost-tracker.js').CostTracker;
}

export interface WorkerResult {
  taskId: string;
  state: TaskState.COMPLETED | TaskState.FAILED | TaskState.TIMEOUT | TaskState.SKIPPED | TaskState.REQUEUED;
  /** Error message for FAILED/TIMEOUT, or skip reason for SKIPPED. */
  error?: string;
  executionRecord?: ExecutionRecord;
  failureReason?: TaskFailureReason;
}

export class CodingWorker {
  readonly handle: WorkerHandle;
  private readonly deps: WorkerDeps;
  private readonly executorRouter: CodingExecutorRouter;

  /** True after shutdown() is called — worker will not start new sessions. */
  private draining = false;

  constructor(deps: WorkerDeps) {
    this.deps = deps;
    this.handle = {
      id: `worker-${randomUUID().slice(0, 8)}`,
      state: 'idle',
      currentTaskId: null,
      createdAt: new Date().toISOString(),
    };

    // Build or reuse the executor router
    if (deps.executorRouter) {
      this.executorRouter = deps.executorRouter;
    } else {
      const routerCfg: ExecutorRouterConfig = {
        executorTypeEnv: process.env.EXECUTOR_TYPE ?? 'cli',
        // Wire Pi executor config when feature flag is enabled and costTracker available
        ...(process.env.PI_CODING_AGENT_ENABLED === 'true' && deps.costTracker
          ? {
              piConfig: {
                costTracker: deps.costTracker,
                defaultModelId: process.env.PI_DEFAULT_MODEL ?? 'claude-opus-4-6',
                defaultProvider: (process.env.PI_DEFAULT_PROVIDER as 'anthropic' | 'openrouter' | 'ollama') ?? 'anthropic',
              },
            }
          : {}),
      };
      this.executorRouter = new CodingExecutorRouter(
        routerCfg,
        deps.executor,
        deps.builderConfig,
      );
    }

    // Sweep orphaned Pi workspaces on startup (getPi may not exist on mocks)
    if (typeof this.executorRouter.getPi === 'function') {
      this.executorRouter.getPi()?.sweepOrphanedWorkspaces().catch((err) => {
        logger.warn('Pi workspace sweep failed (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  get id(): string {
    return this.handle.id;
  }

  get isIdle(): boolean {
    return this.handle.state === 'idle';
  }

  get isBusy(): boolean {
    return this.handle.state === 'busy';
  }

  /**
   * Execute a task. Returns a WorkerResult when the task completes
   * (successfully, with error, or via timeout).
   *
   * The worker transitions to 'busy' during execution and back to 'idle'
   * only AFTER the underlying executor promise has settled (resolved or
   * rejected). This prevents the worker from appearing idle while a
   * background execution is still running, which would break the max
   * concurrent workers guarantee.
   */
  async execute(task: BuilderTask): Promise<WorkerResult> {
    if (this.handle.state !== 'idle') {
      throw new Error(`Worker ${this.id} is not idle (state: ${this.handle.state})`);
    }

    this.handle.state = 'busy';
    this.handle.currentTaskId = task.id;
    this.handle.taskStartedAt = new Date().toISOString();
    this.handle.abortController = new AbortController();

    const workerLogger = createLogger(`worker:${this.id}`);
    workerLogger.info(`Starting task: ${task.taskName}`, {
      taskId: task.id,
      correlationId: task.correlationId,
      sourceEvent: task.sourceEvent,
    });

    try {
      const result = await this.executeWithTimeout(task, workerLogger);
      return result;
    } finally {
      // Reset worker state — executeWithTimeout guarantees the underlying
      // executor has settled (completed, failed, or aborted) before returning.
      this.handle.state = 'idle';
      this.handle.currentTaskId = null;
      this.handle.taskStartedAt = undefined;
      this.handle.abortController = undefined;
    }
  }

  /**
   * Request the worker to stop its current task. Sets the abort signal
   * but does not forcefully kill the LLM call (it will check on next
   * tool round).
   */
  stop(): void {
    if (this.handle.abortController) {
      this.handle.abortController.abort();
    }
    this.handle.state = 'stopping';
  }

  /**
   * Graceful shutdown: stop accepting new tasks and classify in-flight task
   * state using deploy-state.
   *
   * Uses classifyDrainTermination to decide whether in-flight tasks should
   * be marked REQUEUED (with failureReason 'sigterm') instead of FAILED,
   * preventing SIGTERM kills from tripping circuit breakers.
   */
  async shutdown(): Promise<WorkerResult | undefined> {
    this.draining = true;

    logger.info('Worker shutting down', { workerId: this.id });

    if (!this.handle.currentTaskId || this.handle.state !== 'busy') {
      return undefined;
    }

    const currentState = TaskState.RUNNING; // Worker is busy → task is running
    const { newState, failureReason } = classifyDrainTermination(currentState);
    const drainResult: WorkerResult = {
      taskId: this.handle.currentTaskId,
      state: newState as WorkerResult['state'],
      error: 'Worker shutdown (SIGTERM)',
      failureReason,
    };
    logger.info('In-flight task classified for drain', {
      workerId: this.id,
      taskId: this.handle.currentTaskId,
      newState,
      failureReason,
    });

    return drainResult;
  }

  private async executeWithTimeout(
    task: BuilderTask,
    workerLogger: ReturnType<typeof createLogger>,
  ): Promise<WorkerResult> {
    const abortController = this.handle.abortController!;

    // Set up timeout — signals abort to the executor
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, task.timeoutMs);

    // Use task-level modelOverride (set at enqueue time) instead of
    // looking up from trigger config. This ensures cron and manual
    // model overrides are respected (Issue #3 fix).
    const modelOverride = task.modelOverride;

    // Inject correlationId into the payload so the agent can propagate it
    const payload = {
      ...task.triggerPayload,
      correlationId: task.correlationId,
      _dispatcherMeta: {
        workerId: this.id,
        taskId: task.id,
        priority: task.priority,
      },
    };

    // Start the executor with the abort signal so it can check between
    // LLM rounds and bail out early on timeout/cancellation.
    const executorPromise = this.deps.executor.execute(
      this.deps.builderConfig,
      task.taskName,
      'dispatcher',
      payload,
      modelOverride,
      abortController.signal,
    );

    try {
      const executionRecord = await Promise.race([
        executorPromise,
        new Promise<never>((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(new Error(`Task timed out after ${task.timeoutMs}ms`));
          });
        }),
      ]);

      const succeeded = executionRecord.status !== 'failed';

      workerLogger.info(`Task ${succeeded ? 'completed' : 'failed'}: ${task.taskName}`, {
        taskId: task.id,
        status: executionRecord.status,
        actions: executionRecord.actionsTaken.length,
      });

      return {
        taskId: task.id,
        state: succeeded ? TaskState.COMPLETED : TaskState.FAILED,
        error: executionRecord.error,
        executionRecord,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // timedOut flag was set by the setTimeout callback above

      workerLogger.error(`Task ${timedOut ? 'timed out' : 'errored'}: ${task.taskName}`, {
        taskId: task.id,
        error: errMsg,
      });

      if (timedOut) {
        // Abort was already signaled by the timeout. Now wait for the
        // executor to actually settle so the worker isn't freed while
        // a background execution is still running.
        await executorPromise.catch(() => {
          // Swallow — we already recorded the timeout result.
        });
      }

      return {
        taskId: task.id,
        state: timedOut ? TaskState.TIMEOUT : TaskState.FAILED,
        error: errMsg,
        failureReason: timedOut ? 'timeout' : 'error',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

}
