import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import type { OperatorTaskStore, OperatorTask } from './task-model.js';
import type { TaskLockManager } from './task-locks.js';
import type { OperatorEventStream } from './event-stream.js';
import type { OperatorRateLimiter } from './rate-limiter.js';
import type { OperatorSlackNotifier } from './slack-notifier.js';
import { AgentTaskQueue } from './task-queue.js';
import type { AgentContext } from '../bootstrap/agents.js';

const logger = createLogger('task-executor');

export interface ExecuteAgentTaskParams {
  taskId: string;
  agentName: string;
  department: string;
  task: string;
  payload?: Record<string, unknown>;
  operatorId: string;
  operatorPreamble?: string;
  priority: number;
  resourceKey?: string;
  abortSignal?: AbortSignal;
}

/**
 * Shared task execution helper. Enqueues a single agent task through the priority queue,
 * updates status with real executionId, handles lock release and counter management.
 *
 * Used by: POST /v1/tasks, cross-dept approval, and /api/trigger bridge.
 */
export function createTaskExecutor(
  taskStore: OperatorTaskStore,
  agents: AgentContext,
  lockManager: TaskLockManager | null,
  eventStream: OperatorEventStream | null,
  rateLimiter: OperatorRateLimiter | null,
  slackNotifier: OperatorSlackNotifier | null,
) {
  const { executor, router } = agents;
  const agentTaskQueue = new AgentTaskQueue();

  return function executeAgentTask(params: ExecuteAgentTaskParams): void {
    const { taskId, agentName, department, task, payload, operatorId,
            operatorPreamble, priority, resourceKey, abortSignal } = params;

    const config = router.getConfig(agentName);
    if (!config) {
      logger.error('Agent config not found for queued task', { agentName, taskId });
      void taskStore.updateStatus(taskId, 'failed');
      return;
    }

    agentTaskQueue.enqueue(agentName, taskId, priority, async () => {
      try {
        await taskStore.updateStatus(taskId, 'running');

        const result = await executor.execute(
          config, task, 'operator', payload,
          undefined, abortSignal,
          undefined, operatorPreamble,
        );

        // Update with REAL execution ID from executor
        const current = await taskStore.getByTaskId(taskId);
        if (current && !['cancelled', 'preempted'].includes(current.status)) {
          const finalStatus = result.status === 'failed' ? 'failed' as const : 'completed' as const;
          await taskStore.updateStatusWithExecutionId(taskId, finalStatus, result.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Task execution failed', { taskId, agent: agentName, error: msg });
        const current = await taskStore.getByTaskId(taskId);
        if (current && !['cancelled', 'preempted'].includes(current.status)) {
          await taskStore.updateStatus(taskId, 'failed');
        }
      } finally {
        // Release lock
        if (resourceKey && lockManager) {
          await lockManager.releaseLock(resourceKey, operatorId).catch(() => {});
        }
        // Decrement concurrent counter
        if (rateLimiter) {
          void rateLimiter.decrementConcurrent(operatorId);
        }
        // Emit completion event
        if (eventStream) {
          const final = await taskStore.getByTaskId(taskId);
          const eventType = final?.status === 'completed' ? 'task.completed' : 'task.failed';
          eventStream.emit({
            type: eventType,
            departmentId: department,
            agentId: agentName,
            operatorId,
            summary: `Task ${final?.status || 'finished'}: ${task}`,
            details: { taskId, executionId: final?.realExecutionId },
          });
        }
        // Slack notification
        if (slackNotifier) {
          const final = await taskStore.getByTaskId(taskId);
          if (final?.status === 'completed' || final?.status === 'failed') {
            void slackNotifier.notify({
              operatorId,
              type: final.status === 'completed' ? 'task_completed' : 'task_failed',
              summary: `Task "${task}" ${final.status} (agent: ${agentName})`,
            });
          }
        }
      }
    });
  };
}
