import { fetchCoreApi } from './core-api';

export interface CronSchedule {
  agentId: string;
  taskId: string;
  schedule: string;
  nextFireAt?: string;
  lastRunAt?: string;
  enabled: boolean;
}

export async function getSchedules(): Promise<CronSchedule[]> {
  const result = await fetchCoreApi<CronSchedule[] | { schedules?: CronSchedule[] }>('/api/schedules', {
    next: { revalidate: 30 },
  });
  if (!result.ok || !result.data) return [];
  if (Array.isArray(result.data)) return result.data;
  return result.data.schedules ?? [];
}

export async function getAgentSchedules(agentId: string): Promise<CronSchedule[]> {
  const all = await getSchedules();
  return all.filter(s => s.agentId === agentId);
}

export interface CacheStats {
  executions: number;
  cachedExecutions: number;
  cacheAdoptionRate: number;
  averageCacheHitRate: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  savingsUsd: number;
  totalCostUsd: number;
}

export async function getCacheStats(): Promise<CacheStats | null> {
  const result = await fetchCoreApi<{
    totals?: {
      executions?: number;
      executionsWithCache?: number;
      cacheAdoptionRate?: number;
      averageCacheHitRate?: number;
      tokens?: {
        cacheRead?: number;
        cacheCreation?: number;
      };
      cost?: {
        savingsUsd?: number;
        totalCost?: number;
      };
    };
  }>('/api/cache/report', {
    next: { revalidate: 30 },
  });

  if (!result.ok || !result.data?.totals) return null;
  const totals = result.data.totals;
  return {
    executions: totals.executions ?? 0,
    cachedExecutions: totals.executionsWithCache ?? 0,
    cacheAdoptionRate: totals.cacheAdoptionRate ?? 0,
    averageCacheHitRate: totals.averageCacheHitRate ?? 0,
    cacheReadTokens: totals.tokens?.cacheRead ?? 0,
    cacheCreationTokens: totals.tokens?.cacheCreation ?? 0,
    savingsUsd: totals.cost?.savingsUsd ?? 0,
    totalCostUsd: totals.cost?.totalCost ?? 0,
  };
}

export interface MemoryStatus {
  connected: boolean;
  tableCount: number;
  categoryCount: number;
  itemCount: number;
  tables: string[];
  error?: string;
}

export async function getMemoryStatus(): Promise<MemoryStatus | null> {
  const result = await fetchCoreApi<{
    connected?: boolean;
    tables?: string[];
    categories?: Array<{ scope?: string; cnt?: number }>;
    items?: number;
    error?: string;
  }>('/api/memory-status', {
    next: { revalidate: 60 },
  });

  if (!result.ok) return null;
  const data = result.data ?? {};
  return {
    connected: !!data.connected,
    tableCount: data.tables?.length ?? 0,
    categoryCount: data.categories?.length ?? 0,
    itemCount: data.items ?? 0,
    tables: data.tables ?? [],
    ...(data.error ? { error: data.error } : {}),
  };
}
