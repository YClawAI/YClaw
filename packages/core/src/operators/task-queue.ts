import { createLogger } from '../logging/logger.js';

const logger = createLogger('task-queue');

interface QueuedTask {
  taskId: string;
  priority: number;
  execute: () => Promise<void>;
}

/**
 * Per-agent serial priority queue. Tasks enqueue by priority and execute
 * one at a time per agent. Higher priority (larger number) goes first.
 * Root (100) always goes before contributor (50).
 */
export class AgentTaskQueue {
  private readonly queues = new Map<string, QueuedTask[]>();
  private readonly running = new Map<string, string>(); // agentName → taskId

  /** Enqueue a task for an agent. Executes immediately if nothing is running. */
  enqueue(agentName: string, taskId: string, priority: number, execute: () => Promise<void>): void {
    const queue = this.queues.get(agentName) ?? [];
    queue.push({ taskId, priority, execute });
    // Sort descending by priority (highest first)
    queue.sort((a, b) => b.priority - a.priority);
    this.queues.set(agentName, queue);

    logger.info('Task enqueued', { agentName, taskId, priority, queueSize: queue.length });

    // If nothing is running for this agent, start processing
    if (!this.running.has(agentName)) {
      void this.processNext(agentName);
    }
  }

  /** Get queue status for an agent. */
  getQueueStatus(agentName: string): { running: string | null; queued: Array<{ taskId: string; priority: number }> } {
    return {
      running: this.running.get(agentName) ?? null,
      queued: (this.queues.get(agentName) ?? []).map((t) => ({ taskId: t.taskId, priority: t.priority })),
    };
  }

  private async processNext(agentName: string): Promise<void> {
    const queue = this.queues.get(agentName);
    if (!queue?.length) {
      this.running.delete(agentName);
      return;
    }

    const task = queue.shift()!;
    this.running.set(agentName, task.taskId);

    logger.info('Task dequeued for execution', { agentName, taskId: task.taskId, priority: task.priority });

    try {
      await task.execute();
    } catch (err) {
      logger.error('Queued task execution failed', {
        agentName, taskId: task.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running.delete(agentName);
      // Process next task in queue
      void this.processNext(agentName);
    }
  }
}
