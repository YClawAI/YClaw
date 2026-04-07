// ─── AO Bridge Types ──────────────────────────────────────────────────────────
// Shared interfaces for the Agent Orchestrator (AO) bridge layer.
// AO is CLI-driven — these types define the HTTP contract between
// yclaw and the AO bridge Express server running on ECS EC2.

export interface AoSpawnRequest {
  issueUrl?: string;
  issueNumber?: number;
  cleanupIssueNumber?: number;
  claimPr?: number;
  repo: string;
  directive?: string;
  orchestrator?: 'claude-code' | 'codex' | 'aider' | 'pi-rpc' | 'claude-code-headless';
  context?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
}

export interface AoBatchSpawnRequest {
  issues: number[];
  repo: string;
}

export interface AoSpawnResponse {
  id: string;
  status: 'spawned' | 'spawning' | 'queued' | 'failed';
  output?: string;
  error?: string;
  queuePosition?: number;
}

export interface AoBatchSpawnResponse {
  results: AoSpawnResponse[];
}

export interface AoCallbackEvent {
  type: string;
  sessionId?: string;
  issueNumber?: number;
  issueUrl?: string;
  repo?: string;
  status?: string;
  prUrl?: string;
  prNumber?: number;
  error?: string;
  message?: string;
  priority?: 'urgent' | 'action' | 'warning' | 'info';
}
