import type { Session } from 'next-auth';
import { getServerSession } from './auth-session';

type OperatorTier = 'root' | 'department_head' | 'contributor' | 'observer';

const TIER_HIERARCHY: Record<string, number> = {
  root: 100,
  department_head: 70,
  contributor: 50,
  observer: 10,
};

/**
 * Wraps a Next.js Server Action with auth + RBAC enforcement.
 *
 * Server Actions are directly invocable POST endpoints — they bypass
 * middleware route guards. EVERY Server Action that mutates state
 * MUST use this wrapper.
 *
 * Auth failures are returned as `{ ok: false, error: '...' }` to match
 * the standard Server Action return contract. The wrapped action's return
 * type must include `{ ok: boolean; error?: string }` for this to work.
 *
 * Usage:
 *   export const inviteOperator = withAuth('root', async (session, formData) => { ... });
 *   export const triggerAgent = withAuth('contributor', async (session, formData) => { ... });
 */
export function withAuth<TArgs extends unknown[], TResult extends { ok: boolean; error?: string }>(
  minTier: OperatorTier,
  action: (session: Session, ...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const session = await getServerSession();

    if (!session?.user?.operatorId) {
      return { ok: false, error: 'Authentication required' } as TResult;
    }

    const operatorLevel = TIER_HIERARCHY[session.user.tier] ?? 0;
    const requiredLevel = TIER_HIERARCHY[minTier] ?? 0;

    if (operatorLevel < requiredLevel) {
      return { ok: false, error: `Requires ${minTier} tier or higher` } as TResult;
    }

    return action(session, ...args);
  };
}
