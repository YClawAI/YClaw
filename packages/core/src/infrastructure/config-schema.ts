/**
 * YCLAW Configuration Schema
 *
 * Zod schema for yclaw.config.yaml — defines which adapters to use
 * for each infrastructure component. The InfrastructureFactory reads
 * this config to wire up the correct adapter combination.
 *
 * Backward compatible: if no config file exists, falls back to
 * environment variables (existing behavior).
 */

import { z } from 'zod';
import { CommunicationConfigSchema } from '../config/schema.js';
import { GraphifyConfigSchema } from '../knowledge/graphify-types.js';

// ─── Storage Configuration ──────────────────────────────────────────────────

export const StateStoreConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mongodb'),
    uri: z.string().optional(),      // Falls back to MONGODB_URI env var
    database: z.string().optional(),  // Falls back to MONGODB_DB env var
  }),
  // Future: postgresql, sqlite, dynamodb
]);

export const EventBusConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('redis'),
    url: z.string().optional(),  // Falls back to REDIS_URL env var
  }),
  // Future: nats, sqs, rabbitmq
]);

export const MemoryStoreConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('postgresql'),
    url: z.string().optional(),  // Falls back to MEMORY_DATABASE_URL env var
  }),
  // Future: sqlite
]);

export const ObjectStoreConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    path: z.string().optional(),  // Falls back to YCLAW_OBJECT_STORE_PATH env var
  }),
  z.object({
    type: z.literal('s3'),
    bucket: z.string().optional(),  // Falls back to YCLAW_S3_BUCKET env var
    prefix: z.string().optional(),
    region: z.string().optional(),
  }),
  // Future: gcs, azure-blob
]);

// ─── Secrets Configuration ──────────────────────────────────────────────────

export const SecretsConfigSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('env'),
  }),
  z.object({
    provider: z.literal('aws-secrets-manager'),
    prefix: z.string().optional(),
    region: z.string().optional(),
  }),
  // Future: gcp-sm, vault, doppler
]);

// ─── Channel Configuration ──────────────────────────────────────────────────

export const ChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Adapter-specific configuration (tokens, webhook URLs, etc.). */
  config: z.record(z.unknown()).optional(),
});

export const ChannelsConfigSchema = z.object({
  slack: ChannelConfigSchema.optional(),
  telegram: ChannelConfigSchema.optional(),
  twitter: ChannelConfigSchema.optional(),
  discord: ChannelConfigSchema.optional(),
}).catchall(ChannelConfigSchema);

// ─── Top-Level Config ───────────────────────────────────────────────────────

/**
 * Base config shape BEFORE .strict() is applied.
 * Exported so the CLI package can .extend() it with additional sections
 * (deployment, llm, networking, observability) without modifying core.
 */
export const YclawConfigBaseShape = z.object({
  /** Storage backend configuration. */
  storage: z.object({
    state: StateStoreConfigSchema.default({ type: 'mongodb' }),
    events: EventBusConfigSchema.default({ type: 'redis' }),
    memory: MemoryStoreConfigSchema.default({ type: 'postgresql' }),
    objects: ObjectStoreConfigSchema.default({ type: 'local' }),
  }).default({}),

  /** Secrets provider configuration. */
  secrets: SecretsConfigSchema.default({ provider: 'env' }),

  /** Communication channel configuration. */
  channels: ChannelsConfigSchema.default({}),

  /** Communication style configuration. */
  communication: CommunicationConfigSchema,

  /** Librarian graph integration configuration. */
  librarian: z.object({
    graph: GraphifyConfigSchema.default({}),
  }).optional(),
});

/** Strict schema used by the core runtime. Rejects unknown keys. */
export const YclawConfigSchema = YclawConfigBaseShape.strict();

export type YclawConfig = z.infer<typeof YclawConfigSchema>;
export type StateStoreConfig = z.infer<typeof StateStoreConfigSchema>;
export type EventBusConfig = z.infer<typeof EventBusConfigSchema>;
export type MemoryStoreConfig = z.infer<typeof MemoryStoreConfigSchema>;
export type ObjectStoreConfig = z.infer<typeof ObjectStoreConfigSchema>;
export type SecretsConfig = z.infer<typeof SecretsConfigSchema>;
export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;
