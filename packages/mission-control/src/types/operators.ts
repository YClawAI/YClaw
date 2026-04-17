export interface OperatorLimits {
  requestsPerMinute: number;
  maxConcurrentTasks: number;
  dailyTaskQuota: number;
}

export interface OperatorOpenClaw {
  agentName: string;
  instanceLabel?: string;
}

export type OperatorTier = 'root' | 'department_head' | 'contributor' | 'observer';
export type OperatorStatus = 'invited' | 'active' | 'suspended' | 'revoked';

export interface Operator {
  operatorId: string;
  displayName: string;
  role: string;
  email: string;
  tier: OperatorTier;
  departments: string[];
  status: OperatorStatus;
  createdAt: string;
  lastActiveAt?: string;
  // Fields below may be absent in list responses (summary shape)
  priorityClass?: number;
  limits?: OperatorLimits;
  openClaw?: OperatorOpenClaw;
  revokedAt?: string;
  revokedReason?: string;
}

export interface OperatorWithStats extends Operator {
  stats: {
    tasksToday: number;
    tasksThisWeek: number;
    deniedRequests: number;
    pendingApprovals: number;
    activeLocks: number;
  };
}

export interface OperatorActivity {
  operators: OperatorWithStats[];
  recentActions: Array<{
    timestamp: string;
    operatorId: string;
    action: string;
    target: string;
    summary: string;
    decision?: 'allowed' | 'denied'; // enriched at proxy from audit log
  }>;
  alerts: Array<{
    type: string;
    operatorId: string;
    message: string;
  }>;
}

export interface Invitation {
  invitationId: string;
  email: string;
  intendedRole: string;
  intendedTier: string;
  intendedDepartments: string[];
  status: string;
  createdAt: string;
  expiresAt: string;
}

export interface InviteOperatorRequest {
  email: string;
  displayName: string;
  role: string;
  tier: string;
  departments: string[];
  limits?: Partial<OperatorLimits>;
}

export interface InviteOperatorResponse {
  invitationId: string;
  inviteToken: string;
  expiresAt: string;
}

export interface RotateKeyResponse {
  apiKey: string;
}

export const TIER_LABELS: Record<OperatorTier, string> = {
  root: 'Root',
  department_head: 'Dept Head',
  contributor: 'Contributor',
  observer: 'Observer',
};

export const TIER_COLORS: Record<OperatorTier, string> = {
  // Root keeps its purple tone via mc-dept-finance (#BF5AF2) — only "power
  // tier" purple in the iOS palette. Department_head takes the cyan accent.
  root: 'text-mc-dept-finance bg-mc-dept-finance/10 border-mc-dept-finance/30',
  department_head: 'text-mc-accent bg-mc-accent/10 border-mc-accent/30',
  contributor: 'text-mc-info bg-mc-info/10 border-mc-info/30',
  observer: 'text-mc-text-tertiary bg-mc-border border-mc-border',
};

export const STATUS_COLORS: Record<OperatorStatus, string> = {
  active: 'bg-mc-success',
  invited: 'bg-mc-warning',
  suspended: 'bg-mc-blocked',
  revoked: 'bg-mc-danger',
};

// ── Audit types ──

export interface AuditEntry {
  id: string;
  timestamp: string;
  operatorId: string;
  action: string;
  department?: string;       // normalized from backend departmentId
  target?: string;           // normalized from backend resource.type:resource.id
  decision?: 'allowed' | 'denied';
  denialReason?: string;     // normalized from backend reason (when decision=denied)
  ip?: string;               // normalized from backend request.ip
}

export interface AuditResponse {
  entries: AuditEntry[];
  cursor?: string;           // index-based, implemented at proxy layer
  hasMore?: boolean;
  totalCount?: number;
}

export interface AuditFilters {
  operatorId?: string;
  action?: string;
  department?: string;
  from?: string;
  to?: string;
  deniedOnly?: boolean;
  cursor?: string;
  limit?: number;
}

// ── Cross-department approval types ──

export type CrossDeptStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface CrossDeptRequest {
  requestId: string;
  requestingOperatorId: string;
  requestingOperatorName: string;
  requestingDepartment: string;
  requesterTier: string;
  requesterPriority: number;
  requesterDepartments: string[];
  targetDepartment: string;
  targetAgent: string;
  task: string;
  reason: string;
  payload?: Record<string, unknown>;
  resourceKey?: string;
  pendingTaskId?: string;
  status: CrossDeptStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  resultingTaskId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ApproveResponse {
  requestId: string;
  status: 'approved';
  resultingTaskId: string;
  executionIds: string[];
}

export interface RejectResponse {
  requestId: string;
  status: 'rejected';
}

// ── Lock types ──

export interface TaskLock {
  resourceKey: string;
  taskId: string;
  operatorId: string;
  priority: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface ReleaseResponse {
  released: boolean;
  resourceKey: string;
}

// ── Approval decision (synthesized from audit log) ──

export interface ApprovalDecision {
  id: string;
  timestamp: string;
  decidedBy: string;
  action: 'cross_dept.approve' | 'cross_dept.reject';
  requestId?: string;
  resourceType?: string;
  resultingTaskId?: string;
  note?: string;
}

/** Combined approvals response: pending requests + recent decisions */
export interface ApprovalsPageData {
  pending: CrossDeptRequest[];
  recentDecisions: ApprovalDecision[];
}
