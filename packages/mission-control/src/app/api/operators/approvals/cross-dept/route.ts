export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';
import type { CrossDeptRequest, ApprovalDecision } from '@/types/operators';

// Backend audit entry shape
interface BackendAuditEntry {
  timestamp: string;
  operatorId: string;
  action: string;
  decision?: 'allowed' | 'denied';
  reason?: string;
  resource?: { type?: string; id?: string };
  metadata?: { resultingTaskId?: string };
}

/**
 * Extract recent approval/rejection decisions from audit log.
 * Backend logs these as cross_dept.approve and cross_dept.reject.
 */
function extractDecisions(auditEntries: BackendAuditEntry[]): ApprovalDecision[] {
  return auditEntries
    .filter(
      (e) => e.action === 'cross_dept.approve' || e.action === 'cross_dept.reject',
    )
    .slice(0, 20)
    .map((entry, i) => ({
      id: entry.resource?.id ?? `decision-${i}`,
      timestamp: entry.timestamp,
      decidedBy: entry.operatorId,
      action: entry.action as ApprovalDecision['action'],
      requestId: entry.resource?.id,
      resourceType: entry.resource?.type,
      resultingTaskId: entry.metadata?.resultingTaskId,
      note: entry.reason,
    }));
}

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // department_head+ can view approvals
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  // Fetch pending requests and audit log in parallel
  const [pendingResult, auditResult] = await Promise.all([
    fetchCoreApi<{ requests?: CrossDeptRequest[] }>('/v1/approvals/cross-dept'),
    fetchCoreApi<{ entries?: BackendAuditEntry[] }>('/v1/audit'),
  ]);

  if (!pendingResult.ok) {
    return NextResponse.json(
      { error: pendingResult.error || 'Failed to fetch approvals' },
      { status: pendingResult.status || 502 },
    );
  }

  const pending = pendingResult.data?.requests ?? [];
  const recentDecisions = auditResult.ok
    ? extractDecisions(auditResult.data?.entries ?? [])
    : [];

  return NextResponse.json({
    pending,
    recentDecisions,
  });
}
