import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import { generateApiKey, generateInviteToken, hashInviteToken } from './api-keys.js';
import { clearOperatorCache } from './middleware.js';
import { requireTier } from './middleware.js';
import type { OperatorStore } from './operator-store.js';
import type { OperatorAuditLogger } from './audit-logger.js';
import type { Operator, Invitation, OperatorRequest } from './types.js';
import { InviteOperatorInput, AcceptInviteInput, RevokeOperatorInput, TIER_HIERARCHY } from './types.js';
import type { Redis as IORedis } from 'ioredis';
import type { RoleStore } from './roles.js';

const logger = createLogger('operator-routes');

const INVITE_EXPIRY_HOURS = 72;

export function registerOperatorRoutes(
  app: Express,
  operatorStore: OperatorStore,
  auditLogger: OperatorAuditLogger,
  redis: IORedis | null,
  roleStore?: RoleStore | null,
): void {

  // ─── POST /v1/operators/invite (root only) ──────────────────────────────

  app.post('/v1/operators/invite', requireTier('root'), async (req: Request, res: Response) => {
    try {
      const parsed = InviteOperatorInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { email, displayName, role, tier, departments, limits } = parsed.data;
      const operator = (req as OperatorRequest).operator;
      if (!operator) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Check if email already has an active operator
      const existing = await operatorStore.getByEmail(email);
      if (existing && existing.status === 'active') {
        res.status(409).json({ error: `Operator with email ${email} already exists` });
        return;
      }

      const { token, hash: tokenHash } = generateInviteToken();
      const invitationId = `inv_${randomUUID().slice(0, 8)}`;

      const invitation: Invitation = {
        invitationId,
        email,
        intendedDisplayName: displayName,
        intendedRole: role,
        intendedTier: tier,
        intendedDepartments: departments,
        intendedLimits: limits,
        tokenHash,
        status: 'pending',
        createdBy: operator.operatorId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
      };

      await operatorStore.createInvitation(invitation);

      auditLogger.log({
        timestamp: new Date(),
        operatorId: operator.operatorId,
        action: 'operator.invite',
        resource: { type: 'invitation', id: invitationId },
        request: { method: 'POST', path: '/v1/operators/invite', ip: getIp(req) },
        decision: 'allowed',
      });

      res.json({
        invitationId,
        inviteToken: token,
        email,
        role,
        tier,
        departments,
        expiresAt: invitation.expiresAt.toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create invitation', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/operators/accept-invite (no auth — token IS the auth) ─────

  app.post('/v1/operators/accept-invite', async (req: Request, res: Response) => {
    try {
      const parsed = AcceptInviteInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { inviteToken, agentName, tailscaleNodeId, instanceLabel } = parsed.data;

      // Hash the provided token and look up the invitation
      const tokenHash = hashInviteToken(inviteToken);
      const invitation = await operatorStore.getInvitationByTokenHash(tokenHash);

      if (!invitation) {
        res.status(404).json({ error: 'Invalid or expired invitation token' });
        return;
      }

      if (invitation.status !== 'pending') {
        res.status(410).json({ error: `Invitation already ${invitation.status}` });
        return;
      }

      if (invitation.expiresAt < new Date()) {
        res.status(410).json({ error: 'Invitation has expired' });
        return;
      }

      // Generate operator credentials (async — argon2id)
      const { key: apiKey, prefix: apiKeyPrefix, hash: apiKeyHash } = await generateApiKey();
      const operatorId = `op_${invitation.email.split('@')[0]?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || randomUUID().slice(0, 8)}`;

      // Use display name and limits from invitation (set by CEO at invite time)
      const defaultLimits = { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 };
      const operatorLimits = invitation.intendedLimits
        ? { ...defaultLimits, ...invitation.intendedLimits }
        : defaultLimits;

      const now = new Date();
      const newOperator: Operator = {
        operatorId,
        displayName: invitation.intendedDisplayName,
        role: invitation.intendedRole,
        email: invitation.email,
        apiKeyHash,
        apiKeyPrefix,
        tailscaleNodeId,
        tailscaleIPs: [],
        tier: invitation.intendedTier,
        roleIds: [`role_${invitation.intendedTier}`],
        departments: invitation.intendedDepartments,
        priorityClass: TIER_HIERARCHY[invitation.intendedTier],
        crossDeptPolicy: 'request',
        limits: operatorLimits,
        status: 'active',
        invitedBy: invitation.createdBy,
        createdAt: now,
        updatedAt: now,
        openClaw: agentName ? { agentName, instanceLabel } : undefined,
      };

      await operatorStore.createOperator(newOperator);
      await operatorStore.acceptInvitation(invitation.invitationId, operatorId);

      auditLogger.log({
        timestamp: new Date(),
        operatorId,
        action: 'operator.accept_invite',
        resource: { type: 'operator', id: operatorId },
        request: { method: 'POST', path: '/v1/operators/accept-invite', ip: getIp(req) },
        decision: 'allowed',
      });

      res.json({
        operatorId,
        apiKey, // Shown once
        email: invitation.email,
        role: invitation.intendedRole,
        tier: invitation.intendedTier,
        departments: invitation.intendedDepartments,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to accept invitation', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/operators/me ────────────────────────────────────────────────

  app.get('/v1/operators/me', (req: Request, res: Response) => {
    const operator = (req as OperatorRequest).operator;
    if (!operator) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    res.json({
      operatorId: operator.operatorId,
      displayName: operator.displayName,
      role: operator.role,
      email: operator.email,
      tier: operator.tier,
      departments: operator.departments,
      priorityClass: operator.priorityClass,
      limits: operator.limits,
      status: operator.status,
      lastActiveAt: operator.lastActiveAt?.toISOString(),
      openClaw: operator.openClaw,
    });
  });

  // ─── GET /v1/operators/me/permissions ────────────────────────────────────

  app.get('/v1/operators/me/permissions', async (req: Request, res: Response) => {
    const operator = (req as OperatorRequest).operator;
    if (!operator) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Resolve assigned roles and aggregate grants
    const resolvedRoles: Array<{ roleId: string; name: string; grants: unknown[] }> = [];
    if (roleStore && operator.roleIds?.length) {
      for (const roleId of operator.roleIds) {
        const role = await roleStore.getByRoleId(roleId);
        if (role) resolvedRoles.push({ roleId: role.roleId, name: role.name, grants: role.grants });
      }
    }
    // Also include tier-based default role
    if (roleStore) {
      const tierRole = await roleStore.getRoleForTier(operator.tier);
      if (tierRole && !resolvedRoles.some((r) => r.roleId === tierRole.roleId)) {
        resolvedRoles.push({ roleId: tierRole.roleId, name: tierRole.name, grants: tierRole.grants });
      }
    }

    res.json({
      operatorId: operator.operatorId,
      tier: operator.tier,
      departments: operator.departments,
      isRoot: operator.tier === 'root',
      canInvite: operator.tier === 'root',
      canRevoke: operator.tier === 'root',
      priorityClass: operator.priorityClass,
      limits: operator.limits,
      roles: resolvedRoles,
      effectiveGrants: resolvedRoles.flatMap((r) => r.grants),
    });
  });

  // ─── GET /v1/operators (root only) ──────────────────────────────────────

  app.get('/v1/operators', requireTier('root'), async (req: Request, res: Response) => {
    try {
      const operators = await operatorStore.listOperators();
      res.json({
        operators: operators.map((op) => ({
          operatorId: op.operatorId,
          displayName: op.displayName,
          role: op.role,
          email: op.email,
          tier: op.tier,
          departments: op.departments,
          status: op.status,
          lastActiveAt: op.lastActiveAt?.toISOString(),
          createdAt: op.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to list operators', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/operators/:id/revoke (root only) ──────────────────────────

  app.post('/v1/operators/:id/revoke', requireTier('root'), async (req: Request, res: Response) => {
    try {
      const targetId = req.params.id;
      const parsed = RevokeOperatorInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { reason } = parsed.data;
      const caller = (req as OperatorRequest).operator;
      if (!caller) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Can't revoke yourself
      if (targetId === caller.operatorId) {
        res.status(400).json({ error: 'Cannot revoke your own access' });
        return;
      }

      const target = await operatorStore.getByOperatorId(targetId);
      if (!target) {
        res.status(404).json({ error: 'Operator not found' });
        return;
      }

      if (target.status === 'revoked') {
        res.status(409).json({ error: 'Operator already revoked' });
        return;
      }

      await operatorStore.updateStatus(targetId, 'revoked', reason);
      await clearOperatorCache(redis, target.apiKeyPrefix);

      auditLogger.log({
        timestamp: new Date(),
        operatorId: caller.operatorId,
        action: 'operator.revoke',
        resource: { type: 'operator', id: targetId },
        request: { method: 'POST', path: `/v1/operators/${targetId}/revoke`, ip: getIp(req) },
        decision: 'allowed',
        reason,
      });

      res.json({ operatorId: targetId, status: 'revoked', reason });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to revoke operator', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/operators/:id/rotate-key (root or self) ──────────────────

  app.post('/v1/operators/:id/rotate-key', async (req: Request, res: Response) => {
    try {
      const targetId = req.params.id;
      const caller = (req as OperatorRequest).operator;
      if (!caller) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Only root or the operator themselves can rotate
      if (caller.tier !== 'root' && caller.operatorId !== targetId) {
        res.status(403).json({ error: 'Can only rotate your own key (or be root)' });
        return;
      }

      const target = await operatorStore.getByOperatorId(targetId);
      if (!target) {
        res.status(404).json({ error: 'Operator not found' });
        return;
      }

      // Clear old cache
      await clearOperatorCache(redis, target.apiKeyPrefix);

      // Generate new key (async — argon2id)
      const { key: newApiKey, prefix: newPrefix, hash: newHash } = await generateApiKey();
      await operatorStore.updateApiKey(targetId, newHash, newPrefix);

      auditLogger.log({
        timestamp: new Date(),
        operatorId: caller.operatorId,
        action: 'operator.rotate_key',
        resource: { type: 'operator', id: targetId },
        request: { method: 'POST', path: `/v1/operators/${targetId}/rotate-key`, ip: getIp(req) },
        decision: 'allowed',
      });

      res.json({ operatorId: targetId, apiKey: newApiKey });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to rotate API key', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  logger.info('Operator routes registered (/v1/operators/*)');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
}
