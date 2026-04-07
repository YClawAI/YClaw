import { getDb } from './mongodb';

export interface RunRecord {
  agentId: string;
  status: string;
  createdAt: string;
  taskId?: string;
  executionId?: string;
  cost?: number;
  output?: string;
}

export async function getRecentRuns(
  agentNames: string[],
  limit = 30,
  taskFilter?: string,
): Promise<RunRecord[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const query: Record<string, unknown> = { agentId: { $in: agentNames } };
    if (taskFilter) query.taskId = taskFilter;

    const runs = await db
      .collection('run_records')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return runs.map(r => ({
      agentId: r.agentId as string,
      status: r.status as string,
      createdAt: r.createdAt as string,
      taskId: r.taskId as string | undefined,
      executionId: r.executionId as string | undefined,
      cost: r.cost?.totalUsd as number | undefined,
      output: r.output as string | undefined,
    }));
  } catch {
    return [];
  }
}

export async function getLatestRun(agentId: string, taskId?: string): Promise<RunRecord | null> {
  const runs = await getRecentRuns([agentId], 1, taskId);
  return runs[0] || null;
}
