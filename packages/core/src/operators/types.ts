import type { Request } from 'express';
import { z } from 'zod';

// ─── Operator Model ────────────────────────────────────────────────────────────

export const OperatorTierEnum = z.enum(['root', 'department_head', 'contributor', 'observer']);
export type OperatorTier = z.infer<typeof OperatorTierEnum>;

export const OperatorStatusEnum = z.enum(['invited', 'active', 'suspended', 'revoked']);
export type OperatorStatus = z.infer<typeof OperatorStatusEnum>;

/** Tier hierarchy for authorization comparisons. Higher = more privileged. */
export const TIER_HIERARCHY: Record<OperatorTier, number> = {
  root: 100,
  department_head: 70,
  contributor: 50,
  observer: 10,
};

export const OperatorSchema = z.object({
  operatorId: z.string(),
  displayName: z.string(),
  role: z.string(),
  email: z.string().email(),

  // Authentication
  apiKeyHash: z.string(),
  apiKeyPrefix: z.string(),
  tailscaleNodeId: z.string().optional(),
  tailscaleIPs: z.array(z.string()).default([]),

  // Authorization
  tier: OperatorTierEnum,
  roleIds: z.array(z.string()).default([]),
  departments: z.array(z.string()),
  priorityClass: z.number().default(50),
  crossDeptPolicy: z.enum(['request', 'none']).default('request'),

  // Operational limits
  limits: z.object({
    requestsPerMinute: z.number().default(60),
    maxConcurrentTasks: z.number().default(5),
    dailyTaskQuota: z.number().default(100),
  }).default({}),

  // Lifecycle
  status: OperatorStatusEnum,
  invitedBy: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastActiveAt: z.date().optional(),
  revokedAt: z.date().optional(),
  revokedReason: z.string().optional(),

  // Slack notifications
  slackUserId: z.string().optional(),
  slackChannelId: z.string().optional(),

  // OpenClaw binding
  openClaw: z.object({
    agentName: z.string(),
    instanceLabel: z.string().optional(),
    webhookUrl: z.string().optional(),
  }).optional(),
});

export type Operator = z.infer<typeof OperatorSchema>;

// ─── Invitation Model ──────────────────────────────────────────────────────────

export const InvitationSchema = z.object({
  invitationId: z.string(),
  email: z.string().email(),
  intendedDisplayName: z.string(),
  intendedRole: z.string(),
  intendedTier: OperatorTierEnum,
  intendedDepartments: z.array(z.string()),
  intendedLimits: z.object({
    requestsPerMinute: z.number().optional(),
    maxConcurrentTasks: z.number().optional(),
    dailyTaskQuota: z.number().optional(),
  }).optional(),
  tokenHash: z.string(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  createdBy: z.string(),
  createdAt: z.date(),
  expiresAt: z.date(),
  acceptedAt: z.date().optional(),
  acceptedByOperatorId: z.string().optional(),
});

export type Invitation = z.infer<typeof InvitationSchema>;

// ─── API Input Schemas ─────────────────────────────────────────────────────────

export const InviteOperatorInput = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  role: z.string().min(1).max(50),
  tier: OperatorTierEnum,
  departments: z.array(z.string()).min(1),
  limits: z.object({
    requestsPerMinute: z.number().positive().optional(),
    maxConcurrentTasks: z.number().positive().optional(),
    dailyTaskQuota: z.number().positive().optional(),
  }).optional(),
});

export const AcceptInviteInput = z.object({
  inviteToken: z.string().min(1),
  agentName: z.string().min(1).max(50).optional(),
  tailscaleNodeId: z.string().optional(),
  instanceLabel: z.string().optional(),
});

export const RevokeOperatorInput = z.object({
  reason: z.string().min(1).max(500),
});

// ─── Typed Express Request ────────────────────────────────────────────────────

/** Express Request with the authenticated operator attached by auth middleware. */
export interface OperatorRequest extends Request {
  operator?: Operator;
}
