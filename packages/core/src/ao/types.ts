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

// ─── AO Deep Health ───────────────────────────────────────────────────────────

export interface AoDeepHealthComponentStatus {
  status: 'ok' | 'degraded' | 'error';
  [key: string]: unknown;
}

export interface AoDeepHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    ec2?: AoDeepHealthComponentStatus & { uptime_seconds?: number };
    docker?: AoDeepHealthComponentStatus & { running_containers?: number };
    disk?: AoDeepHealthComponentStatus & { free_pct?: number };
    last_session?: AoDeepHealthComponentStatus & { completed_at?: string };
    [key: string]: AoDeepHealthComponentStatus | undefined;
  };
  queue_depth: number;
  circuit_breakers: Record<string, { open: boolean; failures: number }>;
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
