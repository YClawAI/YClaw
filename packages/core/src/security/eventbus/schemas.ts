/**
 * Schema Registry for Event Bus payload validation.
 *
 * Every event type MUST have a schema. Events without schemas are REJECTED.
 * All schemas use .strict() (Zod equivalent of additionalProperties: false).
 * This blocks extra-field injection attacks (April 2, 2026 incident).
 */

import { z } from 'zod';

// --- Reviewer Events ---

export const reviewerFlaggedSchema = z.object({
  reason: z.string().max(1000),
  evidence: z.array(z.string().max(500)).max(10).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  contentId: z.string().max(100).optional(),
}).strict();

export const reviewerApprovedSchema = z.object({
  summary: z.string().max(1000),
  checksPassed: z.array(z.string()).max(20).optional(),
  contentId: z.string().max(100).optional(),
}).strict();

// --- Deploy Events ---

export const deployExecuteSchema = z.object({
  releaseId: z.string().max(100),
  environment: z.enum(['staging', 'production']),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  services: z.array(z.string()).max(10).optional(),
}).strict();

export const deployStatusSchema = z.object({
  deploymentId: z.string().max(100),
  status: z.enum(['pending', 'in_progress', 'success', 'failed', 'rolled_back']),
  environment: z.enum(['staging', 'production']),
}).strict();

export const deployAssessSchema = z.object({
  repo: z.string().max(200),
  environment: z.enum(['staging', 'production']).optional(),
  commitSha: z.string().max(40).optional(),
}).strict();

export const deployApproveSchema = z.object({
  deploymentId: z.string().max(100),
  decision: z.enum(['APPROVE', 'REQUEST_CHANGES']),
  reason: z.string().max(1000).optional(),
}).strict();

// --- Safety Events ---

export const safetyModifySchema = z.object({
  ruleId: z.string().max(100),
  operation: z.enum(['enable', 'disable', 'update']),
  justification: z.string().max(1000),
}).strict();

export const safetyAlertSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().max(2000),
  affectedAgents: z.array(z.string()).max(20).optional(),
}).strict();

// --- Architect Events ---

export const buildDirectiveSchema = z.object({
  issueId: z.string().max(100).optional(),
  repo: z.string().max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
}).strict();

export const repairDirectiveSchema = z.object({
  prNumber: z.number().int().positive(),
  repo: z.string().max(200),
  ciFailure: z.string().max(2000).optional(),
  suggestedFix: z.string().max(2000).optional(),
}).strict();

// --- Strategist Events ---

export const strategistDirectiveSchema = z.object({
  directive: z.string().max(2000),
  targetAgents: z.array(z.string()).max(20).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
}).strict();

// --- Content Events ---

export const contentDraftSchema = z.object({
  platform: z.string().max(50),
  contentType: z.string().max(50),
  draft: z.string().max(10000),
}).strict();

export const contentPublishedSchema = z.object({
  platform: z.string().max(50),
  url: z.string().max(500).optional(),
  contentId: z.string().max(100).optional(),
}).strict();

/**
 * Schema registry — maps event types to Zod schemas.
 * Events without a schema entry are REJECTED (fail closed).
 */
export class SchemaRegistry {
  private schemas = new Map<string, z.ZodTypeAny>();

  constructor(entries?: Iterable<[string, z.ZodTypeAny]>) {
    if (entries) {
      for (const [key, schema] of entries) {
        this.schemas.set(key, schema);
      }
    }
  }

  get(eventType: string): z.ZodTypeAny | undefined {
    return this.schemas.get(eventType);
  }

  has(eventType: string): boolean {
    return this.schemas.has(eventType);
  }

  register(eventType: string, schema: z.ZodTypeAny): void {
    this.schemas.set(eventType, schema);
  }
}

/**
 * Default schema registry with all known event types.
 */
export function createDefaultSchemaRegistry(): SchemaRegistry {
  return new SchemaRegistry([
    ['reviewer:flagged', reviewerFlaggedSchema],
    ['reviewer:approved', reviewerApprovedSchema],
    ['reviewer:rejected', reviewerFlaggedSchema],
    ['deploy:execute', deployExecuteSchema],
    ['deploy:status', deployStatusSchema],
    ['deploy:assess', deployAssessSchema],
    ['deploy:approve', deployApproveSchema],
    ['safety:modify', safetyModifySchema],
    ['safety:alert', safetyAlertSchema],
    ['architect:build_directive', buildDirectiveSchema],
    ['architect:repair_directive', repairDirectiveSchema],
    ['strategist:directive', strategistDirectiveSchema],
    ['strategist:priority', strategistDirectiveSchema],
    ['content:draft', contentDraftSchema],
    ['content:published', contentPublishedSchema],
  ]);
}
