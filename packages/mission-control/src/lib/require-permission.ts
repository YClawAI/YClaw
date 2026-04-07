import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { getAuthFacade } from '@yclaw/core/auth';
import { getServerSession } from './auth-session';

const TIER_HIERARCHY: Record<string, number> = {
  root: 100,
  department_head: 70,
  contributor: 50,
  observer: 10,
};

type OperatorTier = 'root' | 'department_head' | 'contributor' | 'observer';

/**
 * Get authenticated session or return 401 response.
 * Use in API route handlers as the first call.
 */
export async function requireSession(): Promise<
  { session: Session; error?: never } | { session?: never; error: NextResponse }
> {
  const session = await getServerSession();
  if (!session?.user?.operatorId) {
    return {
      error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }
  return { session };
}

/**
 * Check that the session's operator meets the minimum tier.
 * Returns a 403 NextResponse if denied, or null if allowed.
 */
export function checkTier(session: Session, minTier: OperatorTier): NextResponse | null {
  const operatorLevel = TIER_HIERARCHY[session.user.tier] ?? 0;
  const requiredLevel = TIER_HIERARCHY[minTier] ?? 0;

  if (operatorLevel < requiredLevel) {
    return NextResponse.json(
      { error: `Requires ${minTier} tier or higher` },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Check that the operator has access to a department.
 * Root operators bypass all department checks (via tier, not wildcard departments).
 * Returns a 403 NextResponse if denied, or null if allowed.
 */
export function checkDepartment(session: Session, department: string): NextResponse | null {
  // Root bypasses department checks entirely
  if (session.user.tier === 'root') return null;

  if (!session.user.departments.includes(department)) {
    return NextResponse.json(
      { error: `No access to department: ${department}` },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Check permission via the core facade (live operator state, not just JWT claims).
 * Use for sensitive operations where stale JWT claims aren't sufficient.
 */
export async function checkPermission(
  session: Session,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<NextResponse | null> {
  // FAIL-CLOSED: if facade throws, deny access
  try {
    const facade = await getAuthFacade();
    const result = await facade.checkPermission(session.user.operatorId, action, {
      type: resourceType,
      id: resourceId,
    });

    if (!result.allowed) {
      return NextResponse.json(
        { error: `Permission denied: ${result.reason}` },
        { status: 403 },
      );
    }
    return null;
  } catch {
    return NextResponse.json(
      { error: 'Permission check failed (service unavailable)' },
      { status: 503 },
    );
  }
}

/**
 * Check if the operator is the target operator OR has root tier.
 * Used for "self or root" operations like key rotation.
 */
export function checkSelfOrRoot(session: Session, targetOperatorId: string): NextResponse | null {
  if (session.user.tier === 'root') return null;
  if (session.user.operatorId === targetOperatorId) return null;
  return NextResponse.json(
    { error: 'Can only perform this action on your own account, or requires root tier' },
    { status: 403 },
  );
}
