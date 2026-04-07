// ─── Config Revision Types ───────────────────────────────────────────────────

/**
 * Full snapshot of behavior-relevant config fields.
 * Covers every AgentConfig field that could affect agent behavior.
 */
export interface ConfigSnapshot {
  // ── Model ──
  modelProvider: string;
  model: string;
  maxTokens: number;
  temperature: number;

  // ── Prompts ──
  systemPromptHash: string;
  systemPromptLength: number;
  systemPromptNames: string[];

  // ── Actions & Tools ──
  availableActions: string[];

  // ── Triggers (serialized for diff) ──
  /** Serialized trigger entries: "type:task@detail" */
  triggers: string[];
  cronSchedules: string[];

  // ── Events ──
  eventSubscriptions: string[];
  eventPublications: string[];

  // ── Data Sources ──
  /** Serialized: "type:name" */
  dataSources: string[];

  // ── Review & Safety ──
  reviewBypass: string[];
  humanize: boolean;

  // ── Executor ──
  /** JSON-serialized executor config (null if not set) */
  executorHash: string | null;

  // ── Task Routing ──
  /** JSON-serialized taskRouting config (null if not set) */
  taskRoutingHash: string | null;

  // ── Weights & Metadata ──
  /** JSON-serialized content_weights (null if not set) */
  contentWeightsHash: string | null;
  /** JSON-serialized metadata (null if not set) */
  metadataHash: string | null;

  // ── Path ──
  yamlPath: string;
}

export interface ConfigFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ConfigDiff {
  added: string[];
  removed: string[];
  changed: ConfigFieldChange[];
}

export type RevisionSource = 'deploy' | 'api_update' | 'pr_merge' | 'manual';

export interface ConfigRevision {
  id: string;
  agentId: string;
  version: number;
  snapshot: ConfigSnapshot;
  diff: ConfigDiff;
  changedBy: string;
  changeReason: string;
  source: RevisionSource;
  commitSha: string | null;
  prNumber: number | null;
  timestamp: string;
}

export interface CreateRevisionInput {
  agentId: string;
  snapshot: ConfigSnapshot;
  changedBy: string;
  changeReason: string;
  source: RevisionSource;
  commitSha?: string;
  prNumber?: number;
}
