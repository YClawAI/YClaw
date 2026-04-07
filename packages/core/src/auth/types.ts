import type { OperatorTier, OperatorStatus } from '../operators/types.js';

// ─── Auth Facade Types ──────────────────────────────────────────────────────

export interface AuthFacadeConfig {
  /** MongoDB URI. Falls back to MONGODB_URI env var. */
  mongoUri?: string;
  /** Redis URL for caching. Falls back to REDIS_URL env var. Optional. */
  redisUrl?: string;
  /** Cache TTL in seconds for operator lookups. Default: 300 (5 min). */
  cacheTtlSeconds?: number;
}

export interface OperatorIdentity {
  operatorId: string;
  displayName: string;
  email: string;
  tier: OperatorTier;
  departments: string[];
  roleIds: string[];
  status: OperatorStatus;
}

export interface ResourceTarget {
  type: string;
  id: string;
}

export interface PermissionResult {
  allowed: boolean;
  reason: string;
}

export interface OperatorState {
  status: OperatorStatus;
  tier: OperatorTier;
  departments: string[];
  roleIds: string[];
}

export interface AuditEvent {
  action: string;
  resource: ResourceTarget;
  request?: {
    method: string;
    path: string;
    ip: string;
  };
  decision: 'allowed' | 'denied';
  reason?: string;
}

export interface OperatorContext {
  operatorId: string;
  tier: OperatorTier;
  departments: string[];
  /** Headers to forward on proxied requests to core. */
  headers: Record<string, string>;
}

export interface AuthFacade {
  validateOperatorKey(key: string): Promise<OperatorIdentity | null>;
  checkPermission(operatorId: string, action: string, resource: ResourceTarget): Promise<PermissionResult>;
  getOperatorState(operatorId: string): Promise<OperatorState | null>;
  recordAudit(operatorId: string, event: AuditEvent): Promise<void>;
  createOperatorContext(operatorId: string): Promise<OperatorContext | null>;
  /** Invalidate Redis cache for an operator. Call on revoke/rotate/status/role changes. */
  invalidateOperatorCache(operatorId: string): Promise<void>;
}
