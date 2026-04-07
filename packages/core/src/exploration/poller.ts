import { createLogger } from '../logging/logger.js';
import type { ExplorationTask } from '../agenthub/types.js';
import type { ExplorationDispatcher } from './exploration-dispatcher.js';
import type { ExplorationReviewer } from './exploration-reviewer.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Default poll interval: 30 seconds */
export const POLL_INTERVAL_MS = 30_000;

/** Exploration timeout: 30 minutes */
const EXPLORATION_TIMEOUT_MS = 30 * 60 * 1000;

/** F6: Maximum review retries before dropping a task */
const MAX_REVIEW_RETRIES = 3;

// ─── ExplorationPoller ─────────────────────────────────────────────────────

/**
 * Polls to detect when all workers have completed their exploration.
 * Triggers the ExplorationReviewer when ready.
 *
 * F5: Checks dispatcher's completion tracking (promise resolution) instead of
 * guessing from AgentHub leaves, so review only runs after all iterations finish.
 *
 * F6: Only removes tasks from activeTasks after successful review. Transient
 * failures trigger a retry on the next poll cycle (up to MAX_REVIEW_RETRIES).
 */
export class ExplorationPoller {
  private readonly log = createLogger('exploration-poller');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly reviewRetries = new Map<string, number>();
  /** Tasks currently undergoing review — prevents concurrent review triggers */
  private readonly reviewInProgress = new Set<string>();

  constructor(
    private readonly dispatcher: ExplorationDispatcher,
    private readonly reviewer: ExplorationReviewer,
  ) {}

  start(intervalMs = POLL_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll().catch((err) => {
        this.log.error('Poll cycle failed', { error: (err as Error).message });
      });
    }, intervalMs);
    this.log.info('Poller started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info('Poller stopped');
    }
  }

  async poll(): Promise<void> {
    const activeTasks = this.dispatcher.activeTasks;
    if (activeTasks.size === 0) return;

    for (const [taskId, task] of activeTasks) {
      // Skip tasks already being reviewed
      if (this.reviewInProgress.has(taskId)) continue;

      try {
        // F5: Check dispatcher's completion tracking, not AgentHub leaves
        const allDone = this.dispatcher.allWorkersComplete(taskId);
        const timedOut = Date.now() - task.startedAt > EXPLORATION_TIMEOUT_MS;

        if (allDone) {
          this.log.info('All workers completed, triggering review', { taskId });
          void this.triggerReview(taskId, task);
        } else if (timedOut) {
          this.log.warn('Task timed out, triggering review with available results', { taskId });
          void this.triggerReview(taskId, task);
        }
      } catch (err) {
        this.log.error('Error checking task', {
          taskId,
          error: (err as Error).message,
        });
      }
    }
  }

  /**
   * F6: Review with retry tracking. Only removes the task on success or
   * after exhausting retries. The task stays in activeTasks during review
   * (protected by reviewInProgress set to prevent double-trigger).
   */
  private async triggerReview(taskId: string, task: ExplorationTask): Promise<void> {
    this.reviewInProgress.add(taskId);

    try {
      const result = await this.reviewer.review(task);

      this.log.info('Review complete', {
        taskId,
        decision: result.decision,
        prUrl: result.prUrl,
      });

      // Success — clean up all tracking state
      this.dispatcher.activeTasks.delete(taskId);
      this.dispatcher.completedWorkers.delete(taskId);
      this.reviewRetries.delete(taskId);
    } catch (err) {
      const retries = (this.reviewRetries.get(taskId) ?? 0) + 1;
      this.reviewRetries.set(taskId, retries);

      if (retries >= MAX_REVIEW_RETRIES) {
        this.log.error('Review failed permanently after max retries, dropping task', {
          taskId,
          retries,
          error: (err as Error).message,
        });
        this.dispatcher.activeTasks.delete(taskId);
        this.dispatcher.completedWorkers.delete(taskId);
        this.reviewRetries.delete(taskId);
      } else {
        this.log.warn('Review failed, will retry on next poll cycle', {
          taskId,
          retries,
          maxRetries: MAX_REVIEW_RETRIES,
          error: (err as Error).message,
        });
      }
    } finally {
      this.reviewInProgress.delete(taskId);
    }
  }
}
