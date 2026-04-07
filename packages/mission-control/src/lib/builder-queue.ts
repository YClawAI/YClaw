import { getRedis } from './redis';
import { fetchCoreApi } from './core-api';

export interface QueueTask {
  taskId: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  score: number;
  data?: Record<string, unknown>;
}

export interface DispatcherStatus {
  workers: Array<{
    id: string;
    status: 'idle' | 'busy';
    currentTask?: string;
    currentAgent?: string;
  }>;
  queueDepths: Record<string, number>;
  totalProcessed: number;
  totalFailed: number;
  avgExecutionMs: number;
}

export async function getBuilderQueueTasks(): Promise<Record<string, QueueTask[]>> {
  const redis = getRedis();
  if (!redis) return { P0: [], P1: [], P2: [], P3: [] };

  const result: Record<string, QueueTask[]> = { P0: [], P1: [], P2: [], P3: [] };

  for (const priority of ['P0', 'P1', 'P2', 'P3'] as const) {
    try {
      const tasks = await redis.zrange(`builder:task_queue:${priority}`, 0, -1, 'WITHSCORES');
      for (let i = 0; i < tasks.length; i += 2) {
        const taskId = tasks[i]!;
        const score = Number(tasks[i + 1]);
        result[priority].push({ taskId, priority, score });
      }
    } catch { /* graceful */ }
  }

  return result;
}

export async function getDispatcherStatus(): Promise<DispatcherStatus | null> {
  const [dispatcherResult, metricsResult] = await Promise.all([
    fetchCoreApi<{
      workers?: DispatcherStatus['workers'];
      queueDepths?: Record<string, number>;
    }>('/api/builder/dispatcher', {
      next: { revalidate: 10 },
    }),
    fetchCoreApi<{
      totalProcessed?: number;
      totalFailed?: number;
      avgExecutionMs?: number;
    }>('/api/metrics/dispatcher', {
      next: { revalidate: 10 },
    }),
  ]);

  if (!dispatcherResult.ok || !metricsResult.ok) return null;

  return {
    workers: dispatcherResult.data?.workers || [],
    queueDepths: dispatcherResult.data?.queueDepths || {},
    totalProcessed: metricsResult.data?.totalProcessed || 0,
    totalFailed: metricsResult.data?.totalFailed || 0,
    avgExecutionMs: metricsResult.data?.avgExecutionMs || 0,
  };
}
