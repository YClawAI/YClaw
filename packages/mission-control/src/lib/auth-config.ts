import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getAuthFacade } from '@yclaw/core/auth';

/**
 * NextAuth configuration for Mission Control.
 *
 * Uses Credentials Provider with gzop_live_* operator API keys validated
 * against the core operator store via the auth facade.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Operator API Key',
      credentials: {
        apiKey: { label: 'API Key', type: 'password', placeholder: 'gzop_live_...' },
      },
      async authorize(credentials) {
        if (!credentials?.apiKey) return null;

        try {
          const facade = await getAuthFacade();
          const identity = await facade.validateOperatorKey(credentials.apiKey);
          if (!identity) return null;

          // Record login audit event (best-effort)
          facade.recordAudit(identity.operatorId, {
            action: 'auth.login',
            resource: { type: 'session', id: 'mc' },
            decision: 'allowed',
          }).catch(() => {});

          // Return shape must match NextAuth User type (augmented in next-auth.d.ts)
          return {
            id: identity.operatorId,
            name: identity.displayName,
            email: identity.email,
            operatorId: identity.operatorId,
            displayName: identity.displayName,
            tier: identity.tier,
            departments: identity.departments,
            roleIds: identity.roleIds,
          };
        } catch {
          // Facade initialization or validation failure — fail-closed
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 60 * 60, // 1 hour — JWT is an identity hint, not the auth decision
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, embed operator claims in the JWT
      if (user) {
        token.operatorId = user.operatorId;
        token.displayName = user.displayName;
        token.tier = user.tier;
        token.departments = user.departments;
        token.roleIds = user.roleIds;
      }

      // On every request, verify operator is still active (revocation check)
      if (token.operatorId) {
        try {
          const facade = await getAuthFacade();
          const state = await facade.getOperatorState(token.operatorId);

          // Fail-closed: if we can't get state or operator is not active, invalidate
          if (!state || state.status !== 'active') {
            return { ...token, operatorId: undefined as unknown as string };
          }

          // Pick up any tier/department/role changes
          token.tier = state.tier;
          token.departments = state.departments;
          token.roleIds = state.roleIds;
        } catch {
          // DB unreachable — fail-closed: invalidate session
          return { ...token, operatorId: undefined as unknown as string };
        }
      }

      return token;
    },

    async session({ session, token }) {
      // Expose safe operator fields to client — NOT apiKeyHash or secrets
      if (token.operatorId) {
        session.user.operatorId = token.operatorId;
        session.user.displayName = token.displayName;
        session.user.tier = token.tier;
        session.user.departments = token.departments;
        session.user.roleIds = token.roleIds;
      }
      return session;
    },
  },
};
