// ─── Objective Hierarchy Types ───────────────────────────────────────────────

export type ObjectiveStatus = 'active' | 'paused' | 'completed' | 'failed';
export type ObjectivePriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface ObjectiveKPI {
  metric: string;
  target: number;
  /** Current value. Omit when creating — defaults to 0 at creation time. */
  current: number;
  unit: string;
}

/** Input shape for KPIs — `current` defaults to 0 if omitted. */
export interface ObjectiveKPIInput {
  metric: string;
  target: number;
  current?: number;
  unit: string;
}

export interface Objective {
  id: string;
  title: string;
  description: string;
  department: string;
  status: ObjectiveStatus;
  priority: ObjectivePriority;
  createdBy: string;
  ownerAgentId: string;
  kpis: ObjectiveKPI[];
  costBudgetCents: number;
  costSpentCents: number;
  childTaskIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateObjectiveInput {
  title: string;
  description: string;
  department: string;
  priority: ObjectivePriority;
  createdBy: string;
  ownerAgentId: string;
  kpis?: ObjectiveKPIInput[];
  /** Budget in cents. Defaults to 0 (no budget cap). */
  costBudgetCents?: number;
}

/**
 * Causal chain fields added to trigger payloads.
 * All optional for backward compatibility.
 */
export interface CausalContext {
  objectiveId?: string;
  parentTaskId?: string;
  causalChain?: string[];
}

export interface ObjectiveTrace {
  objective: Objective;
  tasks: Array<{
    id: string;
    status: string;
    agent: string;
    task: string;
    costCents: number;
    startedAt: string;
    completedAt?: string;
  }>;
  totalCostCents: number;
  events: Array<{
    type: string;
    timestamp: string;
    details: Record<string, unknown>;
  }>;
}
