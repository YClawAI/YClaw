import { fetchCoreApi } from './core-api';
import type {
  Operator,
  OperatorActivity,
  CrossDeptRequest,
  ApprovalDecision,
  TaskLock,
  InviteOperatorRequest,
  InviteOperatorResponse,
  RotateKeyResponse,
} from '@/types/operators';

// ── Server-side fetchers (called from server components / lib) ──

export interface GetOperatorsResult {
  operators: Operator[];
  error?: string;
}

export async function getOperators(): Promise<GetOperatorsResult> {
  const result = await fetchCoreApi<Operator[] | { operators?: Operator[] }>(
    '/v1/operators',
    { cache: 'no-store' },
  );
  if (!result.ok) {
    return { operators: [], error: result.error || `Failed to load operators (${result.status})` };
  }
  if (!result.data) return { operators: [] };
  const list = Array.isArray(result.data) ? result.data : result.data.operators ?? [];
  return { operators: list };
}

export async function getOperatorActivity(): Promise<OperatorActivity | null> {
  const result = await fetchCoreApi<OperatorActivity>(
    '/v1/operators/activity',
    { cache: 'no-store' },
  );
  if (!result.ok || !result.data) return null;
  return result.data;
}

export async function getCrossDeptApprovals(): Promise<{ pending: CrossDeptRequest[]; recentDecisions: ApprovalDecision[] } | null> {
  // Fetch pending from core API
  const [pendingResult, auditResult] = await Promise.all([
    fetchCoreApi<{ requests?: CrossDeptRequest[] }>('/v1/approvals/cross-dept', { cache: 'no-store' }),
    fetchCoreApi<{ entries?: Array<{ timestamp: string; operatorId: string; action: string; reason?: string; resource?: { type?: string; id?: string }; metadata?: { resultingTaskId?: string } }> }>('/v1/audit', { cache: 'no-store' }),
  ]);
  if (!pendingResult.ok) return null;

  const pending = pendingResult.data?.requests ?? [];
  const recentDecisions: ApprovalDecision[] = (auditResult.ok ? auditResult.data?.entries ?? [] : [])
    .filter((e) => e.action === 'cross_dept.approve' || e.action === 'cross_dept.reject')
    .slice(0, 20)
    .map((e, i) => ({
      id: e.resource?.id ?? `decision-${i}`,
      timestamp: e.timestamp,
      decidedBy: e.operatorId,
      action: e.action as ApprovalDecision['action'],
      requestId: e.resource?.id,
      resourceType: e.resource?.type,
      resultingTaskId: e.metadata?.resultingTaskId,
      note: e.reason,
    }));

  return { pending, recentDecisions };
}

export async function getLocks(): Promise<{ locks: TaskLock[]; note?: string } | null> {
  const result = await fetchCoreApi<{ locks?: TaskLock[]; note?: string }>(
    '/v1/locks',
    { cache: 'no-store' },
  );
  if (!result.ok) return null;
  return { locks: result.data?.locks ?? [], note: result.data?.note };
}

// ── Client-side actions (call MC API routes, not core API directly) ──

export async function inviteOperator(
  data: InviteOperatorRequest,
): Promise<InviteOperatorResponse> {
  const res = await fetch('/api/operators/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Invite failed (${res.status})`);
  }
  return res.json();
}

export async function revokeOperator(
  operatorId: string,
  reason: string,
): Promise<void> {
  const res = await fetch(`/api/operators/${operatorId}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Revoke failed (${res.status})`);
  }
}

export async function rotateOperatorKey(
  operatorId: string,
): Promise<RotateKeyResponse> {
  const res = await fetch(`/api/operators/${operatorId}/rotate-key`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Key rotation failed (${res.status})`);
  }
  return res.json();
}
