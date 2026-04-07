import { describe, it, expect, vi } from 'vitest';
import { AgentTaskQueue } from '../src/operators/task-queue.js';

describe('AgentTaskQueue', () => {
  it('executes a single task immediately', async () => {
    const queue = new AgentTaskQueue();
    const executed: string[] = [];

    queue.enqueue('builder', 'task_1', 50, async () => {
      executed.push('task_1');
    });

    // Wait for async execution
    await new Promise((r) => setTimeout(r, 50));
    expect(executed).toEqual(['task_1']);
  });

  it('executes tasks in priority order (highest first)', async () => {
    const queue = new AgentTaskQueue();
    const executed: string[] = [];

    // Block the queue with a slow task
    let resolveFirst: () => void;
    const firstDone = new Promise<void>((r) => { resolveFirst = r; });

    queue.enqueue('builder', 'task_blocking', 50, async () => {
      await firstDone;
      executed.push('task_blocking');
    });

    // While blocking task runs, enqueue tasks with different priorities
    queue.enqueue('builder', 'task_low', 10, async () => { executed.push('task_low'); });
    queue.enqueue('builder', 'task_root', 100, async () => { executed.push('task_root'); });
    queue.enqueue('builder', 'task_mid', 50, async () => { executed.push('task_mid'); });

    // Release the blocking task
    resolveFirst!();
    await new Promise((r) => setTimeout(r, 100));

    // Should execute in order: blocking (already running), root (100), mid (50), low (10)
    expect(executed).toEqual(['task_blocking', 'task_root', 'task_mid', 'task_low']);
  });

  it('processes different agents independently', async () => {
    const queue = new AgentTaskQueue();
    const executed: string[] = [];

    queue.enqueue('builder', 'b_task', 50, async () => {
      executed.push('builder');
    });
    queue.enqueue('designer', 'd_task', 50, async () => {
      executed.push('designer');
    });

    await new Promise((r) => setTimeout(r, 50));
    // Both should execute (different agents = independent queues)
    expect(executed).toContain('builder');
    expect(executed).toContain('designer');
    expect(executed).toHaveLength(2);
  });

  it('continues processing after a task failure', async () => {
    const queue = new AgentTaskQueue();
    const executed: string[] = [];

    queue.enqueue('builder', 'task_fail', 100, async () => {
      throw new Error('Intentional failure');
    });
    queue.enqueue('builder', 'task_ok', 50, async () => {
      executed.push('task_ok');
    });

    await new Promise((r) => setTimeout(r, 100));
    // Second task should still execute despite first failing
    expect(executed).toEqual(['task_ok']);
  });

  it('reports queue status correctly', () => {
    const queue = new AgentTaskQueue();

    // Enqueue a long-running task to keep queue busy
    queue.enqueue('builder', 'task_1', 100, () => new Promise(() => {}));
    queue.enqueue('builder', 'task_2', 50, async () => {});
    queue.enqueue('builder', 'task_3', 70, async () => {});

    const status = queue.getQueueStatus('builder');
    expect(status.running).toBe('task_1');
    // task_3 (70) should be before task_2 (50) in queue
    expect(status.queued[0]!.taskId).toBe('task_3');
    expect(status.queued[1]!.taskId).toBe('task_2');
  });

  it('root tasks (priority 100) always go first', async () => {
    const queue = new AgentTaskQueue();
    const executed: string[] = [];

    // Block queue
    let release: () => void;
    const blocker = new Promise<void>((r) => { release = r; });

    queue.enqueue('builder', 'initial', 50, async () => {
      await blocker;
      executed.push('initial');
    });

    // Enqueue several tasks
    queue.enqueue('builder', 'contributor_task', 50, async () => { executed.push('contributor'); });
    queue.enqueue('builder', 'dept_head_task', 70, async () => { executed.push('dept_head'); });
    queue.enqueue('builder', 'root_task', 100, async () => { executed.push('root'); });
    queue.enqueue('builder', 'observer_task', 10, async () => { executed.push('observer'); });

    release!();
    await new Promise((r) => setTimeout(r, 150));

    expect(executed).toEqual(['initial', 'root', 'dept_head', 'contributor', 'observer']);
  });
});
