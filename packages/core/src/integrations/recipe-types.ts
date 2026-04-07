import { z } from 'zod';

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const CredentialFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'password', 'oauth']),
  placeholder: z.string().optional(),
  help_url: z.string().url().optional(),
  help_text: z.string().optional(),
  /** If true, this field can be left blank during credential submission */
  optional: z.boolean().optional(),
});

export const VerifyBlockSchema = z.object({
  method: z.enum(['GET', 'POST', 'HEAD']),
  url: z.string().url(),
  auth_style: z.enum(['bearer', 'x-api-key', 'custom-header', 'query-param']).optional(),
  auth_header: z.string().optional(),
  headers: z.record(z.string()).optional(),
  /** Request body for POST verification (e.g., GraphQL query). Sent as-is. */
  body: z.string().optional(),
  expect_status: z.number().int().min(100).max(599).optional(),
});

export const BuilderTaskSchema = z.object({
  description: z.string().min(1),
  files_to_create: z.array(z.string()).optional(),
  files_to_modify: z.array(z.string()).optional(),
});

export const RecipeStepSchema = z.object({
  id: z.string().min(1),
  actor: z.enum(['human', 'system', 'openclaw', 'fleet']),
  label: z.string().min(1),
  type: z.string().optional(),
  instructions: z.string().optional(),
  builder_task: BuilderTaskSchema.optional(),
});

export const RecipeSchema = z.object({
  integration: z.string().min(1).regex(/^[a-z0-9-]+$/, 'integration id must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  credential_fields: z.array(CredentialFieldSchema).min(1),
  verify: VerifyBlockSchema.optional(),
  steps: z.array(RecipeStepSchema).min(1),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type BuilderTask = z.infer<typeof BuilderTaskSchema>;
export type CredentialField = z.infer<typeof CredentialFieldSchema>;
export type VerifyBlock = z.infer<typeof VerifyBlockSchema>;
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
