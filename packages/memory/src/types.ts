/**
 * Memory Architecture — Core Types
 * Spec: Architect v1.1, approved by Troy via Elon
 */

export type CategoryScope = 'org' | 'department' | 'agent';
export type ItemStatus = 'active' | 'archived' | 'rejected';
export type WriteGateDecision = 'accept' | 'reject' | 'conflict';
export type SourceType = 'conversation' | 'event' | 'tool_output' | 'cross_agent' | 'manual' | 'system';

export interface MemoryItem {
  id: string;
  agentId: string;
  factText: string;
  confidence: number;
  categoryKey: string | null;
  sourceType: SourceType;
  sourceRef: string | null;
  tags: string[];
  status: ItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface WriteGateLogEntry {
  id: string;
  agentId: string;
  inputText: string;
  decision: WriteGateDecision;
  rejectReason: string | null;
  confidence: number | null;
  categoryKey: string | null;
  conflictItemId: string | null;
  llmModel: string;
  latencyMs: number | null;
  tokensUsed: number | null;
  createdAt: Date;
}

export interface Category {
  id: string;
  categoryKey: string;
  scope: CategoryScope;
  departmentId: string | null;
  agentId: string | null;
  content: string;
  version: number;
  tags: string[];
  immutable: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryArchive {
  id: string;
  categoryId: string;
  content: string;
  version: number;
  archivedAt: Date;
  archivedBy: string;
}

export interface WorkingMemoryState {
  agentId: string;
  sessionId: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Configuration for the memory system */
export interface MemoryConfig {
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  };
  writeGate: {
    model: string;
    maxDailyBudgetCents: number;
  };
  workingMemory: {
    maxSizeBytes: number; // 16KB default
  };
}

/** Default per-agent categories */
export const DEFAULT_AGENT_CATEGORIES = [
  'directives',
  'tasks',
  'lessons',
  'tools',
  'blockers',
  'collaborations',
  'config',
] as const;
