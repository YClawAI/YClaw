import { fetchCoreApi } from './core-api';

export interface GrowthChannelStatus {
  channelName: string;
  running: boolean;
  experimentsRun: number;
  humanApprovalRemaining: number;
  championVersion: string;
  championScore: number;
  variableIndex: number;
}

export interface GrowthRuntimeStatus {
  enabled: boolean;
  channels: GrowthChannelStatus[];
  pendingApprovals: string[];
}

export interface ExplorationTaskStatus {
  taskId: string;
  description: string;
  context: string;
  rootHash: string;
  targetRepo: string;
  targetBranch: string;
  numWorkers: number;
  assignedWorkers: string[];
  startedAt: number;
  completedWorkers: number;
  allWorkersComplete: boolean;
}

export interface ExplorationRuntimeStatus {
  enabled: boolean;
  tasks: ExplorationTaskStatus[];
}

export async function getGrowthRuntimeStatus(): Promise<GrowthRuntimeStatus> {
  const result = await fetchCoreApi<GrowthRuntimeStatus>('/api/growth/status', {
    next: { revalidate: 10 },
  });

  if (!result.ok || !result.data) {
    return { enabled: false, channels: [], pendingApprovals: [] };
  }

  return {
    enabled: !!result.data.enabled,
    channels: result.data.channels ?? [],
    pendingApprovals: result.data.pendingApprovals ?? [],
  };
}

export async function getExplorationRuntimeStatus(): Promise<ExplorationRuntimeStatus> {
  const result = await fetchCoreApi<ExplorationRuntimeStatus>('/api/exploration/tasks', {
    next: { revalidate: 10 },
  });

  if (!result.ok || !result.data) {
    return { enabled: false, tasks: [] };
  }

  return {
    enabled: !!result.data.enabled,
    tasks: result.data.tasks ?? [],
  };
}
