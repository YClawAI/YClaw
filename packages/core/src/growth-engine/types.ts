// ─── Growth Engine Types ──────────────────────────────────────────────────────

/** Channel configuration loaded from config files */
export interface ChannelConfig {
  /** Channel name (e.g., 'cold-email', 'twitter', 'landing-page') */
  name: string;
  /** Scoring window in ms — how long to wait before measuring results */
  scoringWindowMs: number;
  /** Cool-down between experiments in ms */
  cooldownMs: number;
  /** Minimum sample size for statistical significance */
  minSampleSize: number;
  /** Minimum lift (percentage points) to beat champion */
  winThreshold: number;
  /** Variables to test in order (from program.md) */
  variablesToTest: string[];
  /** Metric name used for scoring (e.g., 'positive_reply_rate') */
  scoringMetric: string;
  /** Goal description from program.md */
  goal: string;
}

/** Template with variables and mutation metadata */
export interface Template {
  channel: string;
  version: string;
  /** Template body with {{variable}} placeholders */
  body: string;
  /** Subject line (email/landing-page) */
  subject?: string;
  /** Variable values */
  variables: Record<string, string>;
  /** Mutation tracking */
  metadata: TemplateMutationMetadata;
}

export interface TemplateMutationMetadata {
  /** Which variable was changed (null for initial champion) */
  mutationVariable: string | null;
  /** Human-readable description of the mutation */
  mutationDescription: string | null;
  /** Version of the parent template */
  parentVersion: string | null;
}

/** Result from deploying a variant */
export interface DeployResult {
  /** Unique ID for retrieving metrics later */
  deployId: string;
  /** Timestamp of deployment */
  deployedAt: string;
  /** How many units were sent/deployed (emails sent, posts made, etc.) */
  sampleSize: number;
}

/** Raw metrics from a channel */
export interface ChannelMetrics {
  /** The primary metric value (e.g., positive_reply_rate) */
  primaryMetric: number;
  /** All available metrics */
  raw: Record<string, number>;
  /** Sample size */
  sampleSize: number;
}

/** Score result after comparing variant to champion */
export interface ScoreResult {
  /** Computed score value */
  value: number;
  /** Percentage lift over champion */
  lift: number;
  /** Raw metrics */
  metrics: ChannelMetrics;
  /** Whether this variant won */
  isWinner: boolean;
}

/** Result of compliance check */
export interface ComplianceResult {
  passed: boolean;
  reason?: string;
  blockedPhrases?: string[];
  /** Which layer caught the issue ('regex' or 'llm') */
  layer?: 'regex' | 'llm';
}

/** Cross-channel insight from a winning variant */
export interface CrossChannelInsight {
  sourceChannel: string;
  insight: string;
  liftPercent: number;
  winningVariable: string;
  winningValue: string;
  timestamp: string;
}

/** State of an active experiment loop */
export interface ExperimentLoop {
  channelName: string;
  /** Current champion template */
  champion: Template;
  /** Champion's score */
  championScore: number;
  /** AgentHub commit hash for the champion */
  championHash: string;
  /** Index into variablesToTest for round-robin */
  variableIndex: number;
  /** Whether the loop is running */
  running: boolean;
  /** Number of experiments run in this loop */
  experimentsRun: number;
  /** Number of experiments still requiring human approval */
  humanApprovalRemaining: number;
}

/** Configuration for the growth engine module */
export interface GrowthEngineConfig {
  /** AgentHub base URL */
  agentHubUrl: string;
  /** API key for the growth engine agent */
  apiKey: string;
  /** Agent ID (e.g., 'growth-engine') */
  agentId: string;
  /** Number of initial experiments per channel requiring human approval */
  humanApprovalCount: number;
}

/** Experiment result committed to AgentHub */
export interface ExperimentResult {
  channel: string;
  version: string;
  mutationVariable: string | null;
  mutationDescription: string | null;
  score: number;
  lift: number;
  isWinner: boolean;
  metrics: Record<string, number>;
  deployId: string;
  scoredAt: string;
}
