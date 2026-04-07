/**
 * CLI Config Schema — extends the core base shape with CLI-specific sections.
 *
 * Core schema stays strict (storage/secrets/channels only).
 * CLI schema adds: deployment, llm, networking, observability.
 * Generated configs include all sections; the core runtime reads only what it needs.
 */

import { z } from 'zod';
import { YclawConfigBaseShape } from '@yclaw/core/infrastructure';

// ─── CLI-Specific Schemas ───────────────────────────────────────────────────

export const DeploymentSchema = z.object({
  target: z.enum(['docker-compose', 'terraform', 'manual']),
});

export const LlmSchema = z.object({
  defaultProvider: z.enum([
    'anthropic',
    'openai',
    'openrouter',
  ]).default('anthropic'),
  defaultModel: z.string().default('claude-sonnet-4-20250514'),
});

export const NetworkingSchema = z.object({
  apiPort: z.number().int().min(1).max(65535).default(3000),
});

export const ObservabilitySchema = z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// ─── Extended CLI Config Schema ─────────────────────────────────────────────

/**
 * Full CLI config schema. Extends the core base shape with deployment,
 * LLM, networking, and observability sections. Re-applies .strict()
 * after extending so unknown keys are still rejected.
 */
export const CliConfigSchema = YclawConfigBaseShape.extend({
  deployment: DeploymentSchema.optional(),
  llm: LlmSchema.optional().default({}),
  networking: NetworkingSchema.optional().default({}),
  observability: ObservabilitySchema.optional().default({}),
}).strict();

export type CliConfig = z.infer<typeof CliConfigSchema>;
