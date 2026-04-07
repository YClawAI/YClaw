import { getServerSession as nextAuthGetServerSession } from 'next-auth';
import { authOptions } from './auth-config';

export type { Session } from 'next-auth';

/**
 * Get the current server-side session with real operator identity.
 *
 * Returns the NextAuth session with operator claims (operatorId, tier,
 * departments, roleIds) or null if unauthenticated.
 *
 * The JWT callback in auth-config.ts re-validates operator state on every
 * request, so the session reflects live operator status.
 */
export async function getServerSession() {
  return nextAuthGetServerSession(authOptions);
}
