// ─── Agent Cost Event ────────────────────────────────────────────────────────

export interface AgentCostEvent {
  agentId: string;
  department: string;
  taskType: string;
  executionId: string;
  modelId: string;
  provider: 'anthropic' | 'openrouter' | 'ollama';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Cost in millicents (1/10th of a cent) for precision on small calls. */
  costMillicents: number;
  /** Cost in integer cents (ceiling of millicents/1000) for display and budget comparison. */
  costCents: number;
  latencyMs: number;
  /** ISO 8601 string at creation time; stored as Date in MongoDB. */
  timestamp: string;
}

// ─── Agent Budget ────────────────────────────────────────────────────────────

export type BudgetAction = 'alert' | 'pause' | 'hard_stop';

export type BudgetMode = 'enforcing' | 'tracking' | 'off';

export interface AgentBudget {
  agentId: string;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  alertThresholdPercent: number;
  action: BudgetAction;
}

export interface GlobalBudgetConfig {
  dailyLimitCents: number;
  monthlyLimitCents: number;
  action: BudgetAction;
  alertThresholdPercent: number;
}

// ─── Budget Check Result ─────────────────────────────────────────────────────

export interface BudgetCheckResult {
  allowed: boolean;
  dailySpentCents: number;
  dailyLimitCents: number;
  dailyPercent: number;
  monthlySpentCents: number;
  monthlyLimitCents: number;
  monthlyPercent: number;
  reason?: string;
  /** True when mode is 'tracking' — check ran but didn't block. */
  tracked?: boolean;
}
