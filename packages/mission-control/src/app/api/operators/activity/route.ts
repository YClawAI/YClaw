export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

// Backend shapes
interface BackendOperatorStats {
  operatorId: string;
  displayName: string;
  role: string;
  status: string;
  lastActiveAt?: string;
  stats: {
    tasksToday: number;
    tasksThisWeek: number;
    deniedRequests: number;
    pendingApprovals: number;
    activeLocks: number;
  };
}

interface BackendAction {
  timestamp: string;
  operatorId: string;
  action: string;
  target: string;
  summary: string;
}

interface BackendAlert {
  type: string;
  operatorId: string;
  message: string;
}

interface BackendActivity {
  operators: BackendOperatorStats[];
  recentActions: BackendAction[];
  alerts: BackendAlert[];
}

interface BackendAuditEntry {
  timestamp: string;
  operatorId: string;
  action: string;
  decision?: 'allowed' | 'denied';
  reason?: string;
  resource?: { type?: string; id?: string };
}

interface BackendOperator {
  operatorId: string;
  displayName: string;
  status: string;
  createdAt: string;
}

/**
 * Cross-reference recent actions with audit log entries to add decision info.
 * Matches on operatorId + action + timestamp within 5 seconds.
 */
function enrichActionsWithDecisions(
  actions: BackendAction[],
  auditEntries: BackendAuditEntry[],
): Array<BackendAction & { decision?: 'allowed' | 'denied' }> {
  return actions.map((action) => {
    const actionTime = new Date(action.timestamp).getTime();
    // Find matching audit entry (same operator + action within 5s)
    const match = auditEntries.find((entry) => {
      if (entry.operatorId !== action.operatorId) return false;
      if (entry.action !== action.action) return false;
      const entryTime = new Date(entry.timestamp).getTime();
      return Math.abs(entryTime - actionTime) < 5000;
    });
    return {
      ...action,
      decision: match?.decision,
    };
  });
}

/**
 * Derive additional alerts that the backend doesn't compute.
 */
function deriveAlerts(
  operators: BackendOperatorStats[],
  allOperators: BackendOperator[],
  backendAlerts: BackendAlert[],
): BackendAlert[] {
  const derived: BackendAlert[] = [];

  // invitation_expiring: invited operators whose invite is > 18h old (assuming 24h expiry)
  const now = Date.now();
  const EXPIRY_WARNING_MS = 18 * 60 * 60 * 1000; // 18 hours
  const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours assumed
  for (const op of allOperators) {
    if (op.status !== 'invited') continue;
    const age = now - new Date(op.createdAt).getTime();
    if (age > EXPIRY_WARNING_MS) {
      const hoursLeft = Math.max(0, Math.round((INVITE_TTL_MS - age) / 3600000));
      derived.push({
        type: 'invitation_expiring',
        operatorId: op.operatorId,
        message: `${op.displayName}: Invitation expires in ~${hoursLeft}h`,
      });
    }
  }

  // high_rate_usage: operator with tasksToday > 80 (high volume threshold)
  const HIGH_TASK_THRESHOLD = 80;
  for (const op of operators) {
    if (op.stats.tasksToday > HIGH_TASK_THRESHOLD) {
      // Don't duplicate if backend already flagged this operator
      const alreadyFlagged = backendAlerts.some(
        (a) => a.operatorId === op.operatorId && a.type === 'high_rate_usage',
      );
      if (!alreadyFlagged) {
        derived.push({
          type: 'high_rate_usage',
          operatorId: op.operatorId,
          message: `${op.displayName}: ${op.stats.tasksToday} tasks today — high volume`,
        });
      }
    }
  }

  // lock_conflict: multiple operators holding locks + denials present
  const lockHolders = operators.filter((op) => op.stats.activeLocks > 0);
  if (lockHolders.length > 1) {
    const totalDenied = lockHolders.reduce((sum, op) => sum + op.stats.deniedRequests, 0);
    if (totalDenied > 0) {
      derived.push({
        type: 'lock_conflict',
        operatorId: lockHolders[0]!.operatorId,
        message: `Lock contention: ${lockHolders.length} operators holding locks with ${totalDenied} denied requests`,
      });
    }
  }

  return derived;
}

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // department_head+ can view activity
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  // Fetch activity, audit log, and operator list in parallel
  const [activityResult, auditResult, operatorsResult] = await Promise.all([
    fetchCoreApi<BackendActivity>('/v1/operators/activity'),
    fetchCoreApi<{ entries?: BackendAuditEntry[] }>('/v1/audit'),
    fetchCoreApi<BackendOperator[] | { operators?: BackendOperator[] }>('/v1/operators'),
  ]);

  if (!activityResult.ok) {
    const status = activityResult.status || 502;
    return NextResponse.json(
      { error: activityResult.error || 'Failed to fetch activity' },
      { status },
    );
  }

  const activity = activityResult.data!;
  const auditEntries = auditResult.ok ? (auditResult.data?.entries ?? []) : [];
  const allOperators: BackendOperator[] = operatorsResult.ok
    ? (Array.isArray(operatorsResult.data)
      ? operatorsResult.data
      : (operatorsResult.data as { operators?: BackendOperator[] })?.operators ?? [])
    : [];

  // Enrich actions with decision from audit log
  const enrichedActions = enrichActionsWithDecisions(
    activity.recentActions ?? [],
    auditEntries,
  );

  // Derive additional alerts
  const derivedAlerts = deriveAlerts(
    activity.operators ?? [],
    allOperators,
    activity.alerts ?? [],
  );

  return NextResponse.json({
    operators: activity.operators ?? [],
    recentActions: enrichedActions,
    alerts: [...(activity.alerts ?? []), ...derivedAlerts],
  });
}
