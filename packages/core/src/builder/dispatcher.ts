/**
 * BuilderDispatcher — Orchestrates Builder task execution via a worker pool.
 *
 * Replaces the monolithic Builder agent execution model where new Redis
 * pub/sub events preempt the current task. The dispatcher:
 *
 *   1. Receives events from the EventBus
 *   2. Creates prioritized task objects in a Redis-backed queue
 *   3. Assigns tasks to available workers from the pool
 *   4. Tracks worker lifecycle (spawn, busy, idle, cleanup)
 *   5. Enforces per-task timeouts
 *
 * Workers run in the SAME Node.js process (Phase 1). They are async
 * LLM API call chains that consume minimal local CPU.
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../logging/logger.js';
import type { AgentExecutor } from '../agent/executor.js';
import type { AgentConfig, AgentEvent } from '../config/schema.js';
import type { EventBus } from '../triggers/event.js';
import { TaskQueue } from './task-queue.js';
import { CodingWorker, type WorkerResult } from './worker.js';
import type { ModelConfig } from '../config/schema.js';
import {
  type DispatcherConfig,
  type BuilderTask,
  type DlqEntry,
  type DispatcherMetrics,
  Priority,
  TaskState,
  EVENT_TASK_MAP,
  DEFAULT_DISPATCHER_CONFIG,
} from './types.js';
import { flushStaleTaskState, isCountableFailure } from './deploy-state.js';
import { createEvent, COORD_TASK_REQUESTED, COORD_TASK_STARTED, COORD_TASK_COMPLETED, COORD_TASK_FAILED } from '../types/events.js';
import type { CoordTaskPayload } from '../types/events.js';

const logger = createLogger('builder-dispatcher');

export interface DispatcherDeps {
  redis: Redis | null;
  executor: AgentExecutor;
  eventBus: EventBus;
  builderConfig: AgentConfig;
  fleetGuard?: { isPaused(): boolean } | null;
  githubToken?: string;
  /** Optional callback to update the Task Registry when tasks reach terminal states. */
  updateTaskRegistry?: (params: {
    taskId: string;
    agent: string;
    task: string;
    status: 'completed' | 'failed' | 'stuck';
    prNumber?: number;
    issueNumber?: number;
  }) => Promise<void>;
}

export class BuilderDispatcher {
  private readonly config: DispatcherConfig;
  private readonly queue: TaskQueue;
  private readonly workers: CodingWorker[] = [];
  private readonly deps: DispatcherDeps;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private dlqRetryTimer: ReturnType<typeof setInterval> | null = null;
  private dlqDigestTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private dispatching = false;
  /** Whether the backpressure Slack alert has been sent (reset when depth drops). */
  private backpressureAlerted = false;

  /** Track completed task results for observability. */
  private readonly recentResults: WorkerResult[] = [];
  private static readonly MAX_RECENT_RESULTS = 50;

  /** Ring buffer of task durations (ms) for latency metrics. */
  private readonly recentTaskDurations: number[] = [];
  private static readonly MAX_DURATIONS = 50;

  /** Slack alerter for DLQ notifications and daily digest. */
  private slackAlerter: ((text: string, channel: string) => Promise<void>) | null = null;

  /** DLQ alert batching — collect entries and flush as one message. */
  private dlqAlertBuffer: DlqEntry[] = [];
  private dlqAlertFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DLQ_BATCH_SIZE = 5;
  private static readonly DLQ_BATCH_TIMEOUT_MS = 60_000;
  private static readonly DLQ_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

  /** DLQ alert dedup — track recent alerts per task type to suppress spam. */
  private readonly dlqAlertHistory: Array<{ taskType: string; timestamp: number }> = [];
  private static readonly DLQ_DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 min
  private static readonly DLQ_DEDUP_THRESHOLD = 3;

  /**
   * Project-level circuit breaker — tracks failures per project/issue to prevent
   * infinite task cycling when the same project keeps generating failing tasks.
   * Map key: project identifier (from triggerPayload). Value: failure timestamps.
   * When failures >= threshold within window, new tasks for that project are rejected.
   */
  private readonly projectFailures = new Map<string, number[]>();
  private static readonly PROJECT_CB_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
  private static readonly PROJECT_CB_THRESHOLD = 3; // 3 failures in 2h = circuit open
  private static readonly PROJECT_CB_MAX_TRACKED = 100; // Cap tracked projects to prevent unbounded growth
  private projectCbSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: DispatcherDeps, config?: Partial<DispatcherConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_DISPATCHER_CONFIG, ...config };
    this.queue = new TaskQueue(deps.redis, this.config);

    // Pre-create the worker pool
    for (let i = 0; i < this.config.maxConcurrentWorkers; i++) {
      this.workers.push(new CodingWorker({
        executor: deps.executor,
        builderConfig: deps.builderConfig,
      }));
    }

    logger.info('BuilderDispatcher created', {
      workers: this.config.maxConcurrentWorkers,
      queueKey: this.config.queueKey,
    });
  }

  /**
   * Start the dispatcher. Begins polling the queue for dispatchable tasks.
   *
   * Event routing happens via direct handleEvent() calls from main.ts,
   * NOT via EventBus subscriptions. The main event loop validates payloads,
   * checks targeted delegation, and routes Builder events here.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Run startup cleanup, then start polling. Both cleanup phases must
    // complete before polling begins to prevent stale task dequeue races.
    void this.runStartupCleanup().then(() => {
      if (!this.running) return; // stop() called during cleanup

      // Start queue polling
      this.pollTimer = setInterval(() => {
        void this.dispatchNext().catch(err => {
          logger.error('dispatchNext failed on poll tick', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, this.config.pollIntervalMs);

      // Phase 6: DLQ auto-retry timer
      this.dlqRetryTimer = setInterval(() => {
        void this.retryDlqEntries().catch(err => {
          logger.error('DLQ retry sweep failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, this.config.dlqRetryIntervalMs);

      // One-time DLQ sweep on startup for backlog recovery
      const getDlqDepth = (this.queue as { getDlqDepth?: () => Promise<number> }).getDlqDepth;
      if (getDlqDepth) {
        void getDlqDepth.call(this.queue).then(async (depth) => {
          if (depth > 10) {
            logger.warn(`DLQ has ${depth} entries — running immediate retry sweep`);
            await this.retryDlqEntries();
          }
        }).catch(err => {
          logger.error('DLQ startup sweep failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Daily DLQ digest
      this.dlqDigestTimer = setInterval(() => {
        void this.postDlqDigest().catch(err => {
          logger.warn('DLQ digest post failed (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, BuilderDispatcher.DLQ_DIGEST_INTERVAL_MS);

      // Project circuit breaker sweep (every 10 minutes) — cleans stale entries
      this.projectCbSweepTimer = setInterval(() => {
        this.sweepProjectCircuits();
      }, 10 * 60 * 1000);

      logger.info('BuilderDispatcher started', {
        pollIntervalMs: this.config.pollIntervalMs,
        dlqRetryIntervalMs: this.config.dlqRetryIntervalMs,
      });
    }); // end runStartupCleanup().then()
  }

  /**
   * Run startup cleanup: recover orphaned tasks + flush stale state.
   * Must complete before poll loop begins to prevent dequeue races.
   */
  private async runStartupCleanup(): Promise<void> {
    // Phase 6: Startup recovery — re-enqueue orphaned tasks
    try {
      await this.queue.recoverOrphaned((taskName: string) => this.getTimeoutForTask(taskName));
    } catch (err) {
      logger.error('Startup recovery failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Phase 7: Flush stale tasks on startup
    if (this.deps.redis) {
      try {
        await flushStaleTaskState(
          this.deps.redis,
          this.config.taskKeyPrefix,
          this.config.queueKey,
          this.config.dlqKey,
          14_400_000, // 4 hours
        );
      } catch (err) {
        logger.error('Startup stale task flush failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Stop the dispatcher. Cancels polling and signals all busy workers
   * to stop. Does NOT wait for workers to finish — they will complete
   * or timeout on their own.
   */
  stop(): void {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.dlqRetryTimer) {
      clearInterval(this.dlqRetryTimer);
      this.dlqRetryTimer = null;
    }
    if (this.dlqDigestTimer) {
      clearInterval(this.dlqDigestTimer);
      this.dlqDigestTimer = null;
    }
    if (this.projectCbSweepTimer) {
      clearInterval(this.projectCbSweepTimer);
      this.projectCbSweepTimer = null;
    }

    // Flush any buffered DLQ alerts before stopping
    void this.flushDlqAlerts();

    // Signal busy workers to abort
    for (const worker of this.workers) {
      if (worker.isBusy) {
        worker.stop();
      }
    }

    logger.info('BuilderDispatcher stopped');
  }

  /**
   * Handle an incoming event by creating a task and enqueuing it.
   * Called by EventBus subscription handlers.
   */
  async handleEvent(eventKey: string, event: AgentEvent): Promise<BuilderTask | null> {
    const taskName = EVENT_TASK_MAP[eventKey];
    if (!taskName) {
      logger.warn(`No task mapping for event: ${eventKey}`);
      return null;
    }

    const priority = this.config.priorityMap[taskName] ?? Priority.P2_IMPLEMENTATION;
    const payload = event.payload ?? {};
    const issueNum = (payload.issue_number ?? payload.issueNumber) as number | undefined;

    // ─── Strategist flood guard ────────────────────────────────────────────
    // Hard cap: reject strategist directives when Builder has enough work.
    // Checks total active work (queue + running workers), not just queue depth,
    // because workers consume tasks immediately — queue alone stays deceptively low.
    // Non-strategist events are unaffected.
    if (eventKey === 'strategist:builder_directive') {
      const depth = await this.queue.totalSize();
      const activeWorkers = this.workers.filter(w => w.isBusy).length;
      const totalWork = depth + activeWorkers;
      if (totalWork >= 5) {
        logger.warn('Strategist directive rejected — Builder saturated', {
          eventKey,
          taskName,
          queueDepth: depth,
          activeWorkers,
          totalWork,
          threshold: 5,
        });
        if (this.slackAlerter) {
          void this.slackAlerter(
            `Strategist directive rejected: total work ${totalWork} >= 5 ` +
            `(queue: ${depth}, workers: ${activeWorkers}). Task: ${taskName}.`,
            '#yclaw-alerts',
          ).catch(() => {});
        }
        this.notifyTaskRegistry(event.correlationId ?? '', taskName, 'failed', undefined, issueNum);
        return null;
      }
    }

    // ─── address_review_feedback guard ────────────────────────────────────
    // Skip before enqueueing if the review is an approval (ReactionsManager handles
    // auto-merge; Builder has nothing to fix) or if the PR is already closed/merged.
    if (taskName === 'address_review_feedback') {
      const reviewState = payload.review_state as string | undefined;
      const commentBody = String(payload.comment_body ?? '');
      if (reviewState === 'approved' || commentBody.includes('[APPROVED]')) {
        logger.info('Skipping address_review_feedback — review is an approval', {
          eventKey,
          pr: payload.pr_number,
          repo: payload.repo,
          review_state: reviewState,
        });
        return null;
      }
      if (payload.pr_state === 'closed') {
        logger.info('Skipping address_review_feedback — PR is already closed', {
          eventKey,
          pr: payload.pr_number,
          repo: payload.repo,
        });
        return null;
      }
    }

    // ─── Phase 7: Staleness gate — reject events older than threshold ─────
    if (event.correlationId) {
      const staleMs = this.correlationAgeMs(event.correlationId);
      if (staleMs !== null && staleMs > this.config.correlationMaxAgeMs) {
        logger.info('Stale event rejected', {
          taskName,
          correlationId: event.correlationId,
          ageMinutes: Math.round(staleMs / 60_000),
          maxAgeMinutes: Math.round(this.config.correlationMaxAgeMs / 60_000),
        });
        this.notifyTaskRegistry(event.correlationId ?? '', taskName, 'failed', undefined, issueNum);
        return null;
      }
    }

    // ─── Phase 7: Correlation-level dedup — only one task per correlationId ─
    if (event.correlationId && this.deps.redis) {
      const corrDedupKey = `dedup:corr:${event.correlationId}`;
      const isNew = await this.deps.redis.set(corrDedupKey, '1', 'EX', 7200, 'NX');
      if (isNew === null) {
        logger.info('Duplicate correlation suppressed', {
          taskName,
          correlationId: event.correlationId,
        });
        this.notifyTaskRegistry(event.correlationId ?? '', taskName, 'failed', undefined, issueNum);
        return null;
      }
    }

    // ─── Phase 6: Dedup ───────────────────────────────────────────────────
    const dedupK = this.dedupKey(taskName, payload);
    if (dedupK) {
      const isNew = await this.trySetDedup(dedupK);
      if (!isNew) {
        logger.info('Duplicate task suppressed', { taskName, dedupKey: dedupK });
        this.notifyTaskRegistry(event.correlationId ?? '', taskName, 'failed', undefined, issueNum);
        return null;
      }
    }

    // ─── Project circuit breaker ──────────────────────────────────────────
    if (this.isProjectCircuitOpen(payload)) {
      const projectKey = this.extractProjectKey(payload);
      logger.warn('Project circuit breaker OPEN — rejecting task', {
        taskName,
        projectKey,
        eventKey,
      });
      this.notifyTaskRegistry(event.correlationId ?? '', taskName, 'failed');
      this.cleanupCircuitBrokenPR(payload);
      return null;
    }

    // ─── Phase 6: Backpressure ────────────────────────────────────────────
    const rejected = await this.checkBackpressure(priority, taskName);
    if (rejected) {
      this.notifyTaskRegistry(event.correlationId ?? '', taskName, 'failed');
      return null;
    }

    // Resolve model override from trigger config so the worker uses
    // the correct model (e.g., Sonnet for self_reflection).
    const modelOverride = this.resolveModelOverride(taskName);

    const task = await this.queue.enqueue({
      taskName,
      priority,
      sourceEvent: eventKey,
      triggerPayload: payload,
      correlationId: event.correlationId,
      timeoutMs: this.getTimeoutForTask(taskName),
      modelOverride,
    });

    // Coordination event: task requested
    void this.deps.eventBus.publishCoordEvent(createEvent<CoordTaskPayload>({
      type: COORD_TASK_REQUESTED,
      source: 'builder',
      correlation_id: task.correlationId,
      payload: {
        task_id: task.id,
        project_id: '',
        status: 'requested',
        assignee: 'builder',
        description: task.taskName,
      },
    }));

    // Attempt immediate dispatch if a worker is available
    void this.dispatchNext().catch(err => {
      logger.error('dispatchNext failed after handleEvent enqueue', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return task;
  }

  /**
   * Manually enqueue a task (e.g., from cron triggers or API).
   */
  async enqueueTask(params: {
    taskName: string;
    priority?: Priority;
    triggerPayload?: Record<string, unknown>;
    correlationId?: string;
    timeoutMs?: number;
    modelOverride?: ModelConfig;
    prompt?: string;
    /** Executor preference for this task. */
    executorHint?: 'pi' | 'cli' | 'auto';
  }): Promise<BuilderTask> {
    const priority = params.priority
      ?? this.config.priorityMap[params.taskName]
      ?? Priority.P2_IMPLEMENTATION;

    // Use explicit modelOverride if provided, otherwise resolve from trigger config.
    const modelOverride = params.modelOverride ?? this.resolveModelOverride(params.taskName);

    const payload = params.triggerPayload ?? {};
    const taskName = params.taskName;

    const task = await this.queue.enqueue({
      taskName,
      priority,
      sourceEvent: 'manual',
      triggerPayload: payload,
      correlationId: params.correlationId,
      timeoutMs: params.timeoutMs ?? this.getTimeoutForTask(taskName),
      modelOverride,
      prompt: params.prompt,
      executorHint: params.executorHint,
    });

    void this.dispatchNext().catch(err => {
      logger.error('dispatchNext failed after enqueueTask', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return task;
  }

  // ─── Queue Dispatch Loop ───────────────────────────────────────────────

  /**
   * Assign queued tasks to ALL idle workers, not just one.
   * Loops until no idle workers remain or the queue is empty.
   * Called on every poll tick and after each enqueue/completion.
   */
  private async dispatchNext(): Promise<void> {
    if (!this.running) return;
    if (this.dispatching) return; // Mutex: only one dispatchNext at a time
    this.dispatching = true;

    try {
      while (true) {
        const idleWorker = this.workers.find(w => w.isIdle);
        if (!idleWorker) break; // All workers busy

        const task = await this.queue.dequeue();
        if (!task) break; // Queue empty

        // Fleet pause check — re-queue the task if paused
        if (this.deps.fleetGuard?.isPaused()) {
          logger.info('Fleet paused — re-queuing dequeued task', {
            taskId: task.id, taskName: task.taskName,
          });
          await this.queue.enqueue({
            taskName: task.taskName,
            priority: task.priority,
            sourceEvent: task.sourceEvent,
            triggerPayload: task.triggerPayload,
            correlationId: task.correlationId,
            timeoutMs: task.timeoutMs,
            modelOverride: task.modelOverride,
            sessionId: task.sessionId,
            threadId: task.threadId,
            steerInstruction: task.steerInstruction,
          });
          break;
        }

        // Update task with worker assignment
        await this.queue.updateTask(task.id, {
          state: TaskState.RUNNING,
          workerId: idleWorker.id,
        });

        logger.info(`Dispatching task ${task.id} → ${idleWorker.id}`, {
          taskName: task.taskName,
          priority: Priority[task.priority],
          correlationId: task.correlationId,
        });

        // Coordination event: task started
        void this.deps.eventBus.publishCoordEvent(createEvent<CoordTaskPayload>({
          type: COORD_TASK_STARTED,
          source: 'builder',
          correlation_id: task.correlationId,
          payload: {
            task_id: task.id,
            project_id: '',
            status: 'started',
            assignee: 'builder',
          },
        }));

        // Fire and forget — worker execution is async.
        // The completion handler updates the queue and tries to dispatch more.
        void this.runWorker(idleWorker, task);
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async runWorker(worker: CodingWorker, task: BuilderTask): Promise<void> {
    const startTime = Date.now();

    try {
      const result = await worker.execute(task);

      // Record result
      await this.queue.updateTask(task.id, {
        state: result.state,
        completedAt: new Date().toISOString(),
        error: result.error,
      });

      this.recordResult(result);

      // Track duration for metrics
      const durationMs = Date.now() - startTime;
      this.recentTaskDurations.push(durationMs);
      if (this.recentTaskDurations.length > BuilderDispatcher.MAX_DURATIONS) {
        this.recentTaskDurations.shift();
      }

      // Push failures and timeouts to the dead-letter queue.
      // DLQ push and Slack alert are fire-and-forget: a Slack outage must
      // never corrupt the task's final state or overwrite the real error.
      // Phase 6: Clear dedup key on task completion (success or failure)
      const dedupK = this.dedupKey(task.taskName, task.triggerPayload);
      if (dedupK && this.deps.redis) {
        void this.deps.redis.del(dedupK).catch(() => {});
      }

      // Skipped tasks are acknowledged immediately — no retry, no DLQ.
      // This handles tasks that a worker determines are not actionable
      // (e.g. a pre-flight check found the PR already merged).
      if (result.state === TaskState.SKIPPED) {
        logger.info(`Task ${task.id} skipped — acknowledged without retry`, {
          taskName: task.taskName,
          correlationId: task.correlationId,
          reason: result.error,
        });
        const skipIssueNum = (task.triggerPayload.issue_number ?? task.triggerPayload.issueNumber) as number | undefined;
        this.notifyTaskRegistry(task.id, task.taskName, 'completed', undefined, skipIssueNum);
        // Fall through to dispatchNext at the bottom of runWorker (outside try/catch)
        // by breaking out of the try block — achieved by returning from the outer scope
        // via the finally guard. We call it explicitly here to avoid restructuring.
        void this.dispatchNext().catch(e => {
          logger.error('dispatchNext failed after skipped task', {
            error: e instanceof Error ? e.message : String(e),
          });
        });
        return;
      }

      const isFailure = result.state === TaskState.FAILED || result.state === TaskState.TIMEOUT;

      // Immediate timeout retry: re-enqueue once before sending to DLQ.
      // This catches slow LLM rounds that aren't stuck — the retry often succeeds.
      // Phase 7: Also check staleness — don't retry tasks whose correlation is too old.
      const retryCount = task.timeoutRetryCount ?? 0;
      const dlqRetryCount = task.dlqRetryCount ?? 0;
      const corrAgeMs = task.correlationId ? this.correlationAgeMs(task.correlationId) : null;
      const isStale = corrAgeMs !== null && corrAgeMs > this.config.correlationMaxAgeMs;

      if (result.state === TaskState.TIMEOUT && retryCount < 1 && !isStale && dlqRetryCount < this.config.dlqMaxRetries) {
        logger.warn(`Task ${task.id} timed out — retrying immediately (attempt ${retryCount + 1})`, {
          taskName: task.taskName,
          correlationId: task.correlationId,
        });
        await this.queue.enqueue({
          taskName: task.taskName,
          priority: task.priority,
          sourceEvent: task.sourceEvent,
          triggerPayload: task.triggerPayload,
          correlationId: task.correlationId,
          timeoutMs: task.timeoutMs,
          modelOverride: task.modelOverride,
          sessionId: task.sessionId,
          threadId: task.threadId,
          executorHint: task.executorHint,
          harness: task.harness,
          sessionModel: task.sessionModel,
          prompt: task.prompt,
          repoPath: task.repoPath,
          steerInstruction: task.steerInstruction,
          steerContext: task.steerContext,
          timeoutRetryCount: retryCount + 1,
        });
        // Skip DLQ — the retry is enqueued
        return;
      }

      if (result.state === TaskState.TIMEOUT && isStale) {
        logger.info(`Stale task expired — skipping retry`, {
          taskName: task.taskName,
          correlationId: task.correlationId,
          ageMinutes: corrAgeMs !== null ? Math.round(corrAgeMs / 60_000) : 'unknown',
        });
        // Fall through to DLQ as permanent (won't be retried)
      }

      if (isFailure) {
        const backoffMs = Math.min(
          this.config.dlqRetryIntervalMs * Math.pow(2, dlqRetryCount),
          30 * 60 * 1000,
        );
        const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

        // Mark permanent if stale OR if retry cap reached
        const isPermanent = isStale || dlqRetryCount >= this.config.dlqMaxRetries;

        const entry: DlqEntry = {
          taskId: task.id,
          taskName: task.taskName,
          correlationId: task.correlationId,
          priority: task.priority,
          sourceEvent: task.sourceEvent,
          error: isStale
            ? `${result.error ?? 'timeout'} [EXPIRED: correlation >2h old]`
            : (result.error ?? 'timeout'),
          failedAt: new Date().toISOString(),
          durationMs,
          retryCount: dlqRetryCount,
          nextRetryAt,
          maxRetries: this.config.dlqMaxRetries,
          permanent: isPermanent,
          triggerPayload: task.triggerPayload,
        };
        try {
          await this.queue.pushToDlq(entry);
        } catch (dlqErr) {
          logger.error('Failed to push task to DLQ', {
            taskId: task.id,
            error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
          });
        }
        // Record project-level failure for circuit breaker (skip SIGTERM kills)
        if (isCountableFailure(result.state, result.failureReason)) {
          this.recordProjectFailure(task.triggerPayload);
        }
        // Buffer for batched Slack alert instead of individual messages
        this.bufferDlqAlert(entry);
      }

      // Coordination event: task completed or failed
      const coordType = result.state === TaskState.COMPLETED ? COORD_TASK_COMPLETED : COORD_TASK_FAILED;
      const coordStatus = result.state === TaskState.COMPLETED ? 'completed' : 'failed';
      void this.deps.eventBus.publishCoordEvent(createEvent<CoordTaskPayload>({
        type: coordType,
        source: 'builder',
        correlation_id: task.correlationId,
        payload: {
          task_id: task.id,
          project_id: '',
          status: coordStatus,
          assignee: 'builder',
          message: result.error,
        },
      }));

      // Notify Task Registry of terminal state so Strategist sees accurate status
      const registryStatus = result.state === TaskState.COMPLETED ? 'completed' as const : 'failed' as const;
      const prNum = (task.triggerPayload.pr_number ?? task.triggerPayload.prNumber) as number | undefined;
      const issueNumWorker = (task.triggerPayload.issue_number ?? task.triggerPayload.issueNumber) as number | undefined;
      this.notifyTaskRegistry(task.id, task.taskName, registryStatus, prNum, issueNumWorker);

      logger.info(`Task ${task.id} finished: ${result.state}`, {
        taskName: task.taskName,
        workerId: worker.id,
        correlationId: task.correlationId,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Worker ${worker.id} unexpected error`, {
        taskId: task.id,
        error: errMsg,
      });

      try {
        await this.queue.updateTask(task.id, {
          state: TaskState.FAILED,
          completedAt: new Date().toISOString(),
          error: errMsg,
        });
      } catch (updateErr) {
        logger.error('Failed to update task state after worker error', {
          taskId: task.id,
          error: updateErr instanceof Error ? updateErr.message : String(updateErr),
        });
      }

      // Coordination event: unexpected failure
      void this.deps.eventBus.publishCoordEvent(createEvent<CoordTaskPayload>({
        type: COORD_TASK_FAILED,
        source: 'builder',
        correlation_id: task.correlationId,
        payload: {
          task_id: task.id,
          project_id: '',
          status: 'failed',
          assignee: 'builder',
          message: errMsg,
        },
      }));

      // Notify Task Registry of failure
      const catchIssueNum = (task.triggerPayload.issue_number ?? task.triggerPayload.issueNumber) as number | undefined;
      this.notifyTaskRegistry(task.id, task.taskName, 'failed', undefined, catchIssueNum);
    }

    // After a worker finishes, try to dispatch the next queued task
    void this.dispatchNext().catch(err => {
      logger.error('dispatchNext failed after worker completion', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ─── Observability ─────────────────────────────────────────────────────

  /**
   * Get a snapshot of the dispatcher's current state for API/logging.
   */
  getStatus(): {
    running: boolean;
    workers: Array<{ id: string; state: string; currentTaskId: string | null }>;
    queueSize: Promise<number>;
    recentResults: WorkerResult[];
  } {
    return {
      running: this.running,
      workers: this.workers.map(w => ({
        id: w.id,
        state: w.handle.state,
        currentTaskId: w.handle.currentTaskId,
      })),
      queueSize: this.queue.size(),
      recentResults: [...this.recentResults],
    };
  }

  /**
   * Get the underlying task queue (for testing/observability).
   */
  getQueue(): TaskQueue {
    return this.queue;
  }

  /**
   * Wire a Slack alerter for DLQ notifications and daily digest posting.
   * Should be called before any tasks are enqueued so the alerter is present
   * from the first possible failure. Wiring after start() leaves a small window
   * where early failures will be DLQ'd but not alerted via Slack.
   */
  setSlackAlerter(fn: (text: string, channel: string) => Promise<void>): void {
    this.slackAlerter = fn;
  }

  /**
   * Post a message via the configured Slack alerter.
   * No-op if no alerter has been set.
   */
  async postSlackDigest(text: string, channel: string): Promise<void> {
    if (!this.slackAlerter) return;
    await this.slackAlerter(text, channel);
  }

  /**
   * Post a daily DLQ digest via the event bus.
   */
  async postDlqDigest(): Promise<void> {
    const metrics = await this.getMetrics();
    if (metrics.dlq.depth === 0) return;

    const permanent = metrics.dlq.entries.filter(e => e.permanent).length;
    const retryable = Math.max(metrics.dlq.depth - permanent, 0);

    await this.deps.eventBus.publish('slack', 'alert', {
      channel: 'C0AFA847NAD',
      text: `📋 Builder DLQ Daily Digest\n• Total: ${metrics.dlq.depth}\n• Retryable: ${retryable}\n• Permanent (need manual fix): ${permanent}\n• Top errors: ${this.topErrors(metrics.dlq.entries)}`,
    });
  }

  /**
   * Buffer a DLQ entry for batched Slack alerting.
   * Flushes after 5 entries or 60 seconds, whichever comes first.
   * Suppresses alerts when the same task type fails 3+ times in 10 minutes.
   */
  private bufferDlqAlert(entry: DlqEntry): void {
    const now = Date.now();

    // Prune expired history entries
    while (
      this.dlqAlertHistory.length > 0
      && now - this.dlqAlertHistory[0]!.timestamp > BuilderDispatcher.DLQ_DEDUP_WINDOW_MS
    ) {
      this.dlqAlertHistory.shift();
    }

    // Check if this task type has exceeded the dedup threshold
    const recentCount = this.dlqAlertHistory.filter(
      a => a.taskType === entry.taskName,
    ).length;

    this.dlqAlertHistory.push({ taskType: entry.taskName, timestamp: now });

    if (recentCount >= BuilderDispatcher.DLQ_DEDUP_THRESHOLD) {
      logger.info(`DLQ alert suppressed (${recentCount + 1} ${entry.taskName} failures in 10min)`, {
        taskName: entry.taskName,
        taskId: entry.taskId,
      });
      return;
    }

    this.dlqAlertBuffer.push(entry);

    if (this.dlqAlertBuffer.length >= BuilderDispatcher.DLQ_BATCH_SIZE) {
      void this.flushDlqAlerts();
    } else if (!this.dlqAlertFlushTimer) {
      this.dlqAlertFlushTimer = setTimeout(
        () => void this.flushDlqAlerts(),
        BuilderDispatcher.DLQ_BATCH_TIMEOUT_MS,
      );
    }
  }

  /**
   * Flush buffered DLQ entries as a single Slack message.
   */
  private async flushDlqAlerts(): Promise<void> {
    if (this.dlqAlertFlushTimer) {
      clearTimeout(this.dlqAlertFlushTimer);
      this.dlqAlertFlushTimer = null;
    }
    if (this.dlqAlertBuffer.length === 0) return;

    const entries = this.dlqAlertBuffer.splice(0);
    const summary = entries
      .map(e => `• \`${e.taskName}\` P${e.priority} — ${e.error?.substring(0, 80) ?? 'unknown'}`)
      .join('\n');

    if (this.slackAlerter) {
      try {
        await this.slackAlerter(
          `⚠️ Builder DLQ: ${entries.length} task(s) failed\n${summary}`,
          '#yclaw-alerts',
        );
      } catch (err) {
        logger.warn('Batched DLQ Slack alert failed (non-fatal)', {
          count: entries.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private topErrors(entries: DlqEntry[]): string {
    if (entries.length === 0) return 'none';

    const counts = new Map<string, number>();
    for (const entry of entries) {
      const raw = entry.error ?? 'unknown';
      const key = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([error, count]) => `${count}x ${error}`)
      .join(' | ');
  }

  /**
   * Graceful shutdown: stop accepting new tasks, wait for in-flight workers
   * to complete, then force-stop any still running.
   */
  async stopGracefully(drainTimeoutMs = 25_000): Promise<void> {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.dlqRetryTimer) {
      clearInterval(this.dlqRetryTimer);
      this.dlqRetryTimer = null;
    }
    if (this.dlqDigestTimer) {
      clearInterval(this.dlqDigestTimer);
      this.dlqDigestTimer = null;
    }
    if (this.projectCbSweepTimer) {
      clearInterval(this.projectCbSweepTimer);
      this.projectCbSweepTimer = null;
    }

    // Flush any buffered DLQ alerts before draining
    await this.flushDlqAlerts();

    logger.info('BuilderDispatcher draining in-flight workers', {
      busy: this.workers.filter(w => w.isBusy).length,
      drainTimeoutMs,
    });

    const deadline = Date.now() + drainTimeoutMs;
    while (Date.now() < deadline) {
      if (this.workers.every(w => !w.isBusy)) break;
      await new Promise<void>(r => setTimeout(r, 500));
    }

    // Phase 6 + deploy-state: Classify in-flight tasks and re-queue via worker.shutdown()
    for (const worker of this.workers) {
      if (worker.isBusy && worker.handle.currentTaskId) {
        const drainResult = await worker.shutdown();
        const task = await this.queue.getTask(worker.handle.currentTaskId);
        if (task) {
          // Use the drain classification (REQUEUED/sigterm) instead of plain QUEUED
          const newState = drainResult?.state === TaskState.REQUEUED
            ? TaskState.REQUEUED
            : TaskState.QUEUED;
          task.state = newState;
          task.workerId = undefined;
          task.assignedAt = undefined;
          await this.queue.updateTask(task.id, {
            state: newState,
            workerId: '',
            assignedAt: '',
          });
          await this.queue.addToQueue(task);
          logger.info('Re-queued incomplete task on shutdown', {
            taskId: task.id,
            taskName: task.taskName,
            state: newState,
            failureReason: drainResult?.failureReason,
          });
        } else {
          worker.stop();
        }
      }
    }

    // Give workers a moment to finish before exit
    await new Promise<void>(r => setTimeout(r, 500));

    logger.info('BuilderDispatcher drained');
  }

  /**
   * Assemble a full observability snapshot for the metrics endpoint
   * and the daily Slack digest.
   */
  async getMetrics(): Promise<DispatcherMetrics> {
    const byPriority = await this.queue.sizeByPriority();
    const total = byPriority.P0 + byPriority.P1 + byPriority.P2 + byPriority.P3;

    const busyWorkers = this.workers.filter(w => w.isBusy).length;
    const idleWorkers = this.workers.filter(w => w.isIdle).length;

    let completed = 0;
    let failed = 0;
    let timedOut = 0;
    let requeued = 0;
    for (const r of this.recentResults) {
      if (r.state === TaskState.COMPLETED) completed++;
      else if (r.state === TaskState.FAILED) failed++;
      else if (r.state === TaskState.TIMEOUT) timedOut++;
      else if (r.state === TaskState.REQUEUED) requeued++;
    }

    const durations = [...this.recentTaskDurations].sort((a, b) => a - b);
    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;
    const p95DurationMs = durations.length > 0
      ? (durations[Math.floor(durations.length * 0.95)] ?? null)
      : null;

    const dlqDepth = await this.queue.getDlqDepth();
    const dlqEntries = await this.queue.getDlqEntries(10);

    return {
      timestamp: new Date().toISOString(),
      workers: { total: this.workers.length, idle: idleWorkers, busy: busyWorkers },
      queue: { total, byPriority },
      recentTasks: { completed, failed, timedOut, requeued, avgDurationMs, p95DurationMs },
      dlq: { depth: dlqDepth, entries: dlqEntries },
    };
  }

  /**
   * Lightweight health snapshot for Strategist and API consumers.
   * Includes queue depth, DLQ depth, worker utilization, and a
   * composite isHealthy flag.
   */
  async getQueueHealth(): Promise<{
    queueDepth: number;
    dlqDepth: number;
    activeWorkers: number;
    totalWorkers: number;
    recentTimeoutRate: number;
    isHealthy: boolean;
  }> {
    const queueDepth = await this.queue.totalSize();
    const dlqDepth = await this.queue.getDlqDepth();
    const activeWorkers = this.workers.filter(w => w.isBusy).length;
    const totalWorkers = this.workers.length;
    const recentTimeoutRate = this.calculateRecentTimeoutRate();

    const isHealthy =
      queueDepth < this.config.backpressureThreshold &&
      dlqDepth < 20 &&
      recentTimeoutRate < 0.5;

    return {
      queueDepth,
      dlqDepth,
      activeWorkers,
      totalWorkers,
      recentTimeoutRate,
      isHealthy,
    };
  }

  /**
   * Calculate the fraction of recent tasks that timed out.
   * Returns 0 when there are no recent results.
   */
  private calculateRecentTimeoutRate(): number {
    if (this.recentResults.length === 0) return 0;
    const timeouts = this.recentResults.filter(r => r.state === TaskState.TIMEOUT).length;
    return timeouts / this.recentResults.length;
  }

  // ─── Phase 6: DLQ Retry ──────────────────────────────────────────────

  /**
   * Periodically called by the DLQ retry timer.
   * Delegates to TaskQueue.retryEligibleDlqEntries().
   */
  private async retryDlqEntries(): Promise<void> {
    const retried = await this.queue.retryEligibleDlqEntries(
      this.config.dlqMaxRetries,
      (taskName: string) => this.getTimeoutForTask(taskName),
    );
    if (retried > 0) {
      logger.info(`DLQ auto-retry: re-enqueued ${retried} entries`);
    }
  }

  /**
   * Drain the DLQ. Exposed for trigger-based invocation.
   */
  async drainDlq(options: {
    retryAll?: boolean;
    purgeBefore?: string;
    dryRun?: boolean;
  }): Promise<{ retried: number; purged: number }> {
    return this.queue.drainDlq({
      ...options,
      maxRetries: this.config.dlqMaxRetries,
      getTimeoutForTask: (taskName: string) => this.getTimeoutForTask(taskName),
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Resolve model override from the Builder's trigger config for a given task.
   * Checks both event and cron triggers so cron model overrides are not ignored.
   */
  private resolveModelOverride(taskName: string): ModelConfig | undefined {
    const trigger = this.deps.builderConfig.triggers.find(
      t => 'task' in t && t.task === taskName,
    );
    return trigger?.model as ModelConfig | undefined;
  }

  // ─── Phase 6: Dedup ────────────────────────────────────────────────────

  /**
   * Generate a dedup key from task name and identifying payload fields.
   * Returns null if the payload lacks stable identifiers.
   */
  private dedupKey(taskName: string, payload: Record<string, unknown>): string | null {
    const repo = (payload.repo as string | undefined)
      ?? (payload.repository as string | undefined)
      ?? '';
    const prNumber = String(
      (payload.pr_number as number | string | undefined)
      ?? (payload.prNumber as number | string | undefined)
      ?? '',
    );
    const issueNumber = String(
      (payload.issue_number as number | string | undefined)
      ?? (payload.issueNumber as number | string | undefined)
      ?? '',
    );
    const sha = (payload.sha as string | undefined)
      ?? (payload.head_sha as string | undefined)
      ?? '';

    const identifier = prNumber || issueNumber || sha;
    if (!repo && !identifier) return null;

    return `dedup:${taskName}:${repo}:${identifier}`;
  }

  /**
   * Attempt to set a dedup key in Redis (NX, 1hr TTL).
   * Returns true if the key was set (new task), false if it already exists (duplicate).
   */
  private async trySetDedup(key: string): Promise<boolean> {
    if (!this.deps.redis) return true; // No Redis → no dedup, allow through
    const result = await this.deps.redis.set(key, '1', 'EX', 3600, 'NX');
    return result !== null;
  }

  // ─── Phase 6: Backpressure ─────────────────────────────────────────────

  /**
   * Check queue depth and reject tasks based on backpressure thresholds.
   * Returns true if the task was rejected.
   */
  private async checkBackpressure(priority: Priority, taskName: string): Promise<boolean> {
    const depth = await this.queue.totalSize();

    if (depth >= this.config.maxQueueDepth) {
      if (priority > Priority.P0_SAFETY) {
        logger.warn('Queue full — rejecting task', {
          taskName,
          priority: Priority[priority],
          depth,
          maxQueueDepth: this.config.maxQueueDepth,
        });
        void this.alertBackpressure(depth);
        return true;
      }
    } else if (depth >= this.config.backpressureThreshold) {
      if (priority >= Priority.P3_BACKGROUND) {
        logger.warn('Queue backpressure — rejecting background task', {
          taskName,
          depth,
          backpressureThreshold: this.config.backpressureThreshold,
        });
        void this.alertBackpressure(depth);
        return true;
      }
    } else {
      // Depth below threshold — reset alert flag
      this.backpressureAlerted = false;
    }

    return false;
  }

  /**
   * Send a one-time Slack alert when backpressure is active.
   */
  private async alertBackpressure(depth: number): Promise<void> {
    if (this.backpressureAlerted || !this.slackAlerter) return;
    this.backpressureAlerted = true;

    try {
      await this.slackAlerter(
        `⚠️ Builder queue backpressure active\nQueue depth: ${depth}\n` +
        `Threshold: ${this.config.backpressureThreshold} | Max: ${this.config.maxQueueDepth}`,
        '#yclaw-alerts',
      );
    } catch {
      // Non-fatal — alert failure should not block task processing
    }
  }

  /**
   * Flush tasks from the queue by filter criteria.
   * Used to clear zombie/stale tasks without redeploying.
   */
  async flushTasks(opts: {
    taskName?: string;
    priority?: string;
    correlationPattern?: string;
    flushDlq?: boolean;
  }): Promise<{ flushedQueue: number; flushedDlq: number }> {
    let flushedQueue = 0;
    let flushedDlq = 0;

    // Flush matching tasks from priority queues
    const priorities = opts.priority
      ? [opts.priority]
      : ['P0', 'P1', 'P2', 'P3'];

    for (const p of priorities) {
      const queueKey = `${this.config.queueKey}:${p}`;
      if (!this.deps.redis) continue;

      const taskIds = await this.deps.redis.zrange(queueKey, 0, -1);
      for (const taskId of taskIds) {
        const taskKey = `${this.config.taskKeyPrefix}${taskId}`;
        const taskData = await this.deps.redis.hgetall(taskKey);
        if (!taskData || !taskData.taskName) continue;

        let match = true;
        if (opts.taskName && taskData.taskName !== opts.taskName) match = false;
        if (opts.correlationPattern && taskData.correlationId &&
            !taskData.correlationId.includes(opts.correlationPattern)) match = false;

        if (match) {
          await this.deps.redis.zrem(queueKey, taskId);
          await this.deps.redis.del(taskKey);
          flushedQueue++;
        }
      }
    }

    // Flush DLQ if requested
    if (opts.flushDlq && this.deps.redis) {
      const dlqLen = await this.deps.redis.llen(this.config.dlqKey);
      if (opts.taskName || opts.correlationPattern) {
        // Selective DLQ flush
        const allRaw = await this.deps.redis.lrange(this.config.dlqKey, 0, -1);
        const keep: string[] = [];
        for (const raw of allRaw) {
          try {
            const entry = JSON.parse(raw) as DlqEntry;
            let shouldFlush = true;
            if (opts.taskName && entry.taskName !== opts.taskName) shouldFlush = false;
            if (opts.correlationPattern && entry.correlationId &&
                !entry.correlationId.includes(opts.correlationPattern)) shouldFlush = false;
            if (shouldFlush) {
              flushedDlq++;
            } else {
              keep.push(raw);
            }
          } catch {
            keep.push(raw);
          }
        }
        if (flushedDlq > 0) {
          await this.deps.redis.del(this.config.dlqKey);
          if (keep.length > 0) {
            await this.deps.redis.rpush(this.config.dlqKey, ...keep);
          }
        }
      } else {
        // Full DLQ flush
        await this.deps.redis.del(this.config.dlqKey);
        flushedDlq = dlqLen;
      }
    }

    logger.info('Queue flush completed', {
      flushedQueue,
      flushedDlq,
      filter: opts,
    });

    return { flushedQueue, flushedDlq };
  }

  // ─── Project Circuit Breaker ────────────────────────────────────────────

  /**
   * Extract a stable project key from a task's trigger payload.
   * Checks common fields: project_id, issue_number+repo, pr_number+repo.
   */
  private extractProjectKey(payload: Record<string, unknown>): string | null {
    // Direct project ID (from Strategist dispatches)
    const projectId = payload.project_id as string | undefined;
    if (projectId) return `project:${projectId}`;

    const repo = (payload.repo as string | undefined)
      ?? (payload.repository as string | undefined)
      ?? (payload.repo_full as string | undefined)
      ?? '';

    const issueNumber = payload.issue_number ?? payload.issueNumber;
    if (repo && issueNumber) return `issue:${repo}#${issueNumber}`;

    const prNumber = payload.pr_number ?? payload.prNumber;
    if (repo && prNumber) return `pr:${repo}#${prNumber}`;

    // CI failure events: use repo+branch as project key so the circuit breaker
    // can track repeated CI failures on the same branch. Without this, CI fix
    // loops run indefinitely because extractProjectKey returns null and the
    // circuit breaker is bypassed entirely.
    const branch = payload.branch as string | undefined;
    if (repo && branch) return `ci:${repo}:${branch}`;

    return null;
  }

  /**
   * Fire-and-forget cleanup when the circuit breaker rejects a task.
   * Closes the zombie PR and labels the linked issue as stalled.
   */
  private cleanupCircuitBrokenPR(payload: Record<string, unknown>): void {
    const token = this.deps.githubToken;
    if (!token) return;

    const owner = payload.owner as string | undefined;
    const repo = (payload.repo as string | undefined) ?? (payload.repository as string | undefined);
    const prNumber = payload.pr_number ?? payload.prNumber;
    const issueNumber = payload.issue_number ?? payload.issueNumber;

    if (!owner || !repo || !prNumber) return;

    const ghBase = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };

    void (async () => {
      try {
        // Comment on the PR
        await fetch(`${ghBase}/pulls/${prNumber}/reviews`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            body: '🛑 Circuit breaker activated after repeated failures. Closing PR — original issue returned to backlog for re-evaluation.',
            event: 'COMMENT',
          }),
        });

        // Close the PR
        await fetch(`${ghBase}/pulls/${prNumber}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ state: 'closed' }),
        });

        // Comment on the linked issue + add "stalled" label
        if (issueNumber) {
          await fetch(`${ghBase}/issues/${issueNumber}/comments`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              body: 'Builder failed to resolve this issue after multiple attempts (circuit breaker triggered). Needs Architect breakdown or manual intervention.',
            }),
          });

          await fetch(`${ghBase}/issues/${issueNumber}/labels`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ labels: ['stalled'] }),
          });
        }

        logger.info('Circuit breaker cleanup complete', { owner, repo, prNumber, issueNumber });
      } catch (err) {
        logger.error('Circuit breaker cleanup failed', {
          error: err instanceof Error ? err.message : String(err),
          owner,
          repo,
          prNumber,
        });
      }
    })();
  }

  /**
   * Check if a project's circuit breaker is open (too many recent failures).
   * Returns true if the task should be REJECTED.
   */
  private isProjectCircuitOpen(payload: Record<string, unknown>): boolean {
    const key = this.extractProjectKey(payload);
    if (!key) return false;

    const failures = this.projectFailures.get(key);
    if (!failures) return false;

    const now = Date.now();
    // Prune old failures outside the window
    const recent = failures.filter(ts => now - ts < BuilderDispatcher.PROJECT_CB_WINDOW_MS);
    if (recent.length !== failures.length) {
      if (recent.length === 0) {
        this.projectFailures.delete(key);
      } else {
        this.projectFailures.set(key, recent);
      }
    }

    return recent.length >= BuilderDispatcher.PROJECT_CB_THRESHOLD;
  }

  /**
   * Record a project-level failure for circuit breaker tracking.
   */
  private recordProjectFailure(payload: Record<string, unknown>): void {
    const key = this.extractProjectKey(payload);
    if (!key) return;

    const failures = this.projectFailures.get(key) ?? [];
    failures.push(Date.now());

    // Cap array size per project
    if (failures.length > 20) failures.splice(0, failures.length - 20);
    this.projectFailures.set(key, failures);

    // LRU eviction: if we've exceeded max tracked projects, remove the oldest
    if (this.projectFailures.size > BuilderDispatcher.PROJECT_CB_MAX_TRACKED) {
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [k, v] of this.projectFailures) {
        const latest = v.length > 0 ? v[v.length - 1]! : 0;
        if (latest < oldestTs) {
          oldestTs = latest;
          oldestKey = k;
        }
      }
      if (oldestKey) this.projectFailures.delete(oldestKey);
    }
  }

  /**
   * Periodic sweep: remove circuit breaker entries where all failures are older
   * than the window. Prevents unbounded memory growth over long uptimes.
   * Called every 10 minutes by projectCbSweepTimer.
   *
   * NOTE: This Map is only accessed from the Node.js event loop (single-threaded).
   * If the dispatcher ever moves to a worker-thread model, this needs synchronization.
   */
  private sweepProjectCircuits(): void {
    const now = Date.now();
    const windowMs = BuilderDispatcher.PROJECT_CB_WINDOW_MS;
    let swept = 0;

    for (const [key, failures] of this.projectFailures) {
      const recent = failures.filter(ts => now - ts < windowMs);
      if (recent.length === 0) {
        this.projectFailures.delete(key);
        swept++;
      } else if (recent.length !== failures.length) {
        this.projectFailures.set(key, recent);
      }
    }

    if (swept > 0) {
      logger.debug(`Circuit breaker sweep: removed ${swept} stale entries, ${this.projectFailures.size} remaining`);
    }
  }

  /**
   * Reset the circuit breaker for a specific project (manual override).
   */
  resetProjectCircuit(projectKey: string): boolean {
    return this.projectFailures.delete(projectKey);
  }

  /**
   * List all open circuit breakers (for observability).
   */
  getOpenCircuits(): Array<{ key: string; failures: number; oldestMs: number }> {
    const now = Date.now();
    const open: Array<{ key: string; failures: number; oldestMs: number }> = [];
    for (const [key, failures] of this.projectFailures) {
      const recent = failures.filter(ts => now - ts < BuilderDispatcher.PROJECT_CB_WINDOW_MS);
      if (recent.length >= BuilderDispatcher.PROJECT_CB_THRESHOLD) {
        open.push({
          key,
          failures: recent.length,
          oldestMs: now - Math.min(...recent),
        });
      }
    }
    return open;
  }

  /**
   * Extract the embedded timestamp from a correlation ID and compute its age.
   * Correlation IDs follow the pattern: `owner/repo:context:timestamp`.
   * Returns null if no timestamp can be extracted.
   */
  private correlationAgeMs(correlationId: string): number | null {
    // Try extracting trailing numeric segment (epoch millis)
    const parts = correlationId.split(':');
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return null;
    const ts = Number(lastPart);
    // Sanity: must be a plausible epoch ms (after 2024-01-01, before 2030-01-01)
    if (isNaN(ts) || ts < 1_704_067_200_000 || ts > 1_893_456_000_000) return null;
    return Date.now() - ts;
  }

  /**
   * Fire-and-forget Task Registry update. Logs a warning on failure but
   * never blocks the dispatcher or throws.
   */
  private notifyTaskRegistry(
    taskId: string,
    taskName: string,
    status: 'completed' | 'failed' | 'stuck',
    prNumber?: number,
    issueNumber?: number,
  ): void {
    if (!this.deps.updateTaskRegistry) return;
    this.deps.updateTaskRegistry({
      taskId,
      agent: 'builder',
      task: taskName,
      status,
      prNumber,
      issueNumber,
    }).catch(err => {
      logger.warn('updateTaskRegistry failed (non-fatal)', {
        taskId,
        status,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private getTimeoutForTask(taskName: string): number {
    // Safety fixes get a shorter timeout; implementation tasks get longer
    const timeouts: Record<string, number> = {
      fix_ci_failure: 30 * 60 * 1000,         // 30 min — Pi+Opus needs time to read logs, reason, fix, test
      address_review_feedback: 30 * 60 * 1000, // 30 min — may need to refactor based on review
      address_human_review: 30 * 60 * 1000,    // 30 min
      implement_issue: 45 * 60 * 1000,         // 45 min — real implementation work (landing pages, features)
      implement_directive: 45 * 60 * 1000,     // 45 min
      daily_standup: 10 * 60 * 1000,           // 10 min
      self_reflection: 10 * 60 * 1000,         // 10 min
    };
    return timeouts[taskName] ?? this.config.defaultTimeoutMs;
  }

  private recordResult(result: WorkerResult): void {
    this.recentResults.push(result);
    if (this.recentResults.length > BuilderDispatcher.MAX_RECENT_RESULTS) {
      this.recentResults.shift();
    }
  }
}
