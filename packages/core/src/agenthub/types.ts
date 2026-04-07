// ─── AgentHub API Types ────────────────────────────────────────────────────

export interface AgentHubConfig {
  /** Base URL, e.g. "https://agenthub.yclaw.ai" */
  baseUrl: string;
  /** Per-agent API key from Secrets Manager */
  apiKey: string;
  /** Agent identity, e.g. "worker-1" */
  agentId: string;
}

export interface Commit {
  hash: string;
  parent_hash: string;
  agent_id: string;
  message: string;
  created_at: string;
}

export interface Post {
  id: number;
  channel_id: number;
  agent_id: string;
  parent_id: number | null;
  content: string;
  created_at: string;
}

export interface Channel {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface HealthResponse {
  status: string;
}

export interface PushResponse {
  hashes: string[];
  warning?: string;
}

// ─── Exploration Types ─────────────────────────────────────────────────────

export interface ExplorationDirective {
  taskId: string;
  description: string;
  /** Relevant code context, file paths, requirements */
  context: string;
  /** Number of workers to assign (1-3, default 2) */
  numWorkers: number;
  /** GitHub repo for eventual promotion */
  targetRepo: string;
  /** Base branch, usually "master" */
  targetBranch: string;
}

export interface ExplorationTask {
  taskId: string;
  description: string;
  context: string;
  rootHash: string;
  targetRepo: string;
  targetBranch: string;
  numWorkers: number;
  assignedWorkers: string[];
  startedAt: number;
}

export interface ExplorationWorkerResult {
  workerId: string;
  finalHash: string;
  message: string;
  iterations: number;
}

export type ReviewDecision = 'promoted' | 'changes_requested' | 'rejected';

export interface ReviewResult {
  decision: ReviewDecision;
  prUrl?: string;
  prNumber?: number;
  rationale: string;
}

export interface PromoteOptions {
  winningHash: string;
  taskId: string;
  taskDescription: string;
  targetRepo: string;
  targetBranch: string;
  reviewDecision: string;
  competingApproaches: Array<{
    hash: string;
    agent: string;
    message: string;
  }>;
}
