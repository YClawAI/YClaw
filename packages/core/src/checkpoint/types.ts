export type CheckpointState = 'started' | 'in_progress' | 'awaiting_tool' | 'finalizing';

export interface Checkpoint {
  agentId: string;
  taskKey: string;
  state: CheckpointState;
  toolCallsCompleted: number;
  lastToolAction: string;
  partialResult: string;
  ecsTaskArn: string;
  startedAt: string;
  checkpointedAt: string;
}

export const CHECKPOINT_TTL_SECONDS = 7200; // 2 hours
export const CHECKPOINT_MAX_PARTIAL_RESULT = 4096; // 4KB
