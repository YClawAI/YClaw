import { z } from 'zod';

// ─── Model Configuration ─────────────────────────────────────────────────────

export const ModelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openrouter', 'ollama']),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().positive().default(4096),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ─── Trigger Configuration ───────────────────────────────────────────────────

export const CronTriggerSchema = z.object({
  model: ModelConfigSchema.optional(),
  type: z.literal('cron'),
  schedule: z.string(),
  task: z.string(),
  description: z.string().optional(),
  prompts: z.array(z.string()).optional(),
  /** Per-trigger pre-check override. Reconciler crons should set enabled: false. */
  precheck: z.object({ enabled: z.boolean() }).optional(),
});

export const EventTriggerSchema = z.object({
  model: ModelConfigSchema.optional(),
  type: z.literal('event'),
  event: z.string(),
  task: z.string(),
});

export const WebhookTriggerSchema = z.object({
  model: ModelConfigSchema.optional(),
  type: z.literal('webhook'),
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
  task: z.string(),
});

export const ManualTriggerSchema = z.object({
  model: ModelConfigSchema.optional(),
  type: z.literal('manual'),
  task: z.string(),
});

export const BatchEventTriggerSchema = z.object({
  model: ModelConfigSchema.optional(),
  type: z.literal('batch_event'),
  events: z.array(z.string()).min(1),
  min_count: z.number().positive().default(10),
  timeout_ms: z.number().positive().default(1800000), // 30 min default
  task: z.string(),
});

export const TriggerSchema = z.discriminatedUnion('type', [
  CronTriggerSchema,
  EventTriggerSchema,
  WebhookTriggerSchema,
  ManualTriggerSchema,
  BatchEventTriggerSchema,
]);

export type Trigger = z.infer<typeof TriggerSchema>;

// ─── Data Source Configuration ────────────────────────────────────────────────

export const DataSourceSchema = z.object({
  // type is required — wrong/missing values cause the resolver to silently skip the source
  type: z.enum(['mcp', 'api', 'solana_rpc', 'yclaw_api', 'mongodb', 'cloudwatch', 'teller', 'openrouter_usage', 'aws_cost', 'mongodb_atlas', 'redis_cloud', 'litellm_spend', 'github_repo'])
    .describe('Data source type; must match a known resolver. Invalid values are caught by the CI schema validation test.'),
  // name is optional at the schema level — loader defaults to "unnamed" for logging clarity
  name: z.string().optional().default('unnamed')
    .describe('Human-readable identifier used in logs and error messages'),
  config: z.record(z.unknown()).optional()
    .describe('Resolver-specific configuration (keys vary by type)'),
}).passthrough(); // allow extra fields so future keys do not break older runtime versions

export type DataSource = z.infer<typeof DataSourceSchema>;

// ─── Communication Style ────────────────────────────────────────────────────

export const CommunicationStyleEnum = z.enum(['detailed', 'balanced', 'concise']);
export type CommunicationStyle = z.infer<typeof CommunicationStyleEnum>;

export const AgentCommunicationSchema = z.object({
  style: CommunicationStyleEnum.optional(),
}).optional();

export const CommunicationConfigSchema = z.object({
  style: z.object({
    default: CommunicationStyleEnum.default('balanced'),
    department_overrides: z.record(z.string(), CommunicationStyleEnum).default({}),
    agent_overrides: z.record(z.string(), CommunicationStyleEnum).default({}),
  }).default({}),
}).optional();

export type CommunicationConfig = z.infer<typeof CommunicationConfigSchema>;

// ─── Agent Configuration ─────────────────────────────────────────────────────

// ─── Executor Configuration ──────────────────────────────────────────────────

export const ExecutorConfigSchema = z.object({
  /** Execution mode: 'cli' (spawn), 'pi' (Pi executor), 'auto' (Pi when available). */
  type: z.enum(['cli', 'auto', 'pi']).default('cli'),
  /** Default coding harness when not overridden per-task. */
  defaultHarness: z.enum(['claude-code', 'codex', 'opencode', 'gemini-cli', 'pi']).default('claude-code'),
  /** Global model name override for all sessions. */
  modelOverride: z.string().optional(),
}).optional();

export type ExecutorConfig = NonNullable<z.infer<typeof ExecutorConfigSchema>>;

// ─── Task Routing Configuration ──────────────────────────────────────────────

export const TaskRoutingEntrySchema = z.object({
  /** Executor mode for this task type. */
  executorMode: z.enum(['cli', 'auto', 'pi']).optional(),
  /** Model override — string name or full ModelConfig object. */
  model: z.union([z.string(), ModelConfigSchema]).optional(),
  /** Session TTL in seconds for this task type. */
  sessionTtlSec: z.number().int().positive().optional(),
  /** Coding harness for this task type. */
  harness: z.enum(['claude-code', 'codex', 'opencode', 'gemini-cli', 'pi']).optional(),
});

export const TaskRoutingSchema = z.object({
  defaults: z.object({
    executorMode: z.enum(['cli', 'auto', 'pi']).default('auto'),
    model: z.union([z.string(), ModelConfigSchema]).optional(),
    sessionTtlSec: z.number().int().positive().optional(),
  }).default({}),
  byType: z.record(z.string(), TaskRoutingEntrySchema).default({}),
}).optional();

export type TaskRouting = NonNullable<z.infer<typeof TaskRoutingSchema>>;

// ─── Agent Configuration ─────────────────────────────────────────────────────

export const AgentConfigSchema = z.object({
  name: z.string().regex(/^[a-z_]+$/),
  department: z.enum([
    'executive',
    'marketing',
    'operations',
    'development',
    'finance',
    'support',
  ]),
  description: z.string(),
  model: ModelConfigSchema,
  system_prompts: z.array(z.string()),
  triggers: z.array(TriggerSchema),
  actions: z.array(z.string()),
  data_sources: z.array(DataSourceSchema).default([]),
  event_subscriptions: z.array(z.string()).default([]),
  event_publications: z.array(z.string()).default([]),
  review_bypass: z.array(z.string()).default([]),
  content_weights: z.record(z.number()).optional(),
  humanize: z.boolean().optional(),
  /** Communication style override for this agent. */
  communication: AgentCommunicationSchema,
  metadata: z.record(z.unknown()).optional(),
  /** ACP executor configuration for agents that run coding sessions. */
  executor: ExecutorConfigSchema,
  /** Per-task-type routing overrides (model, executor mode, TTL). */
  taskRouting: TaskRoutingSchema,
  /** Operator access policy for external triggers. */
  operator_policy: z.object({
    accept_external_triggers: z.boolean().default(true),
    external_actions: z.array(z.object({
      name: z.string(),
      risk: z.enum(['low', 'medium', 'high', 'cross_department']),
      requires_approval: z.boolean().default(false),
    })).optional(),
    forbidden_actions: z.array(z.string()).optional(),
  }).optional(),
  /** Elvis pre-check configuration for cron heartbeats. */
  heartbeat: z.object({
    precheck: z.object({
      /** Whether to run the Elvis pre-check before invoking the LLM. Default: true. */
      enabled: z.boolean().default(true),
      /** Force a full run if the agent has been silent for longer than this. Default: 6h. */
      maxSilenceHours: z.number().positive().default(6),
    }).optional(),
  }).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ─── Organization Chart ──────────────────────────────────────────────────────

export const DepartmentSchema = z.object({
  agents: z.array(z.string()),
  role: z.string(),
});

export const OrgChartSchema = z.object({
  departments: z.record(DepartmentSchema),
});

export type OrgChart = z.infer<typeof OrgChartSchema>;

// ─── Event Schema ────────────────────────────────────────────────────────────

export const AgentEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
  timestamp: z.string().datetime(),
  correlationId: z.string().optional(),
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ─── Token Usage with Cache Metrics ──────────────────────────────────────────

export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheCreationInputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
  cacheHitRate: z.number().min(0).max(1).optional(),
  estimatedSavingsRate: z.number().min(0).max(1).optional(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// ─── Execution History ───────────────────────────────────────────────────────

export const ExecutionRecordSchema = z.object({
  id: z.string(),
  agent: z.string(),
  trigger: z.string(),
  task: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  status: z.enum(['running', 'completed', 'failed', 'timeout']),
  correlationId: z.string().optional(),
  actionsTaken: z.array(z.object({
    action: z.string(),
    result: z.enum(['success', 'failure', 'skipped']),
    details: z.record(z.unknown()).optional(),
  })),
  reviewResult: z.object({
    approved: z.boolean(),
    flags: z.array(z.string()),
    severity: z.enum(['low', 'medium', 'high']).optional(),
    rewrite: z.string().optional(),
  }).optional(),
  performance: z.record(z.unknown()).optional(),
  selfModifications: z.array(z.object({
    type: z.string(),
    description: z.string(),
    approved: z.boolean(),
  })).default([]),
  error: z.string().optional(),
  tokenUsage: TokenUsageSchema.optional(),
});

export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;

// ─── Self-Modification ───────────────────────────────────────────────────────

export const SafetyLevel = z.enum([
  'auto_approved',
  'agent_reviewed',
  'human_reviewed',
]);

export type SafetyLevelType = z.infer<typeof SafetyLevel>;

export const SelfModificationSchema = z.object({
  id: z.string(),
  agent: z.string(),
  type: z.enum([
    'config',
    'prompt',
    'tool',
    'code',
    'schedule',
    'model',
    'memory',
    'new_agent',
  ]),
  description: z.string(),
  changes: z.unknown(),
  safetyLevel: SafetyLevel,
  status: z.enum(['pending', 'approved', 'rejected', 'applied']),
  reviewedBy: z.string().optional(),
  appliedAt: z.string().datetime().optional(),
  timestamp: z.string().datetime(),
});

export type SelfModification = z.infer<typeof SelfModificationSchema>;

// ─── Review Request ──────────────────────────────────────────────────────────

export const ReviewRequestSchema = z.object({
  id: z.string(),
  agent: z.string(),
  contentType: z.string(),
  content: z.string(),
  targetPlatform: z.string(),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const ReviewResultSchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  flags: z.array(z.string()),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  rewrite: z.string().optional(),
  voiceScore: z.number().min(0).max(100).optional(),
  reviewedAt: z.string().datetime(),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// ─── Agent Manifest (Self-Awareness Injection) ───────────────────────────────

export const AgentManifestSchema = z.object({
  _self: z.object({
    name: z.string(),
    department: z.string(),
    description: z.string(),
    model: ModelConfigSchema,
    configPath: z.string(),
    promptsLoaded: z.array(z.object({
      path: z.string(),
      tokens: z.number().optional(),
    })),
    availableActions: z.array(z.string()),
    triggers: z.array(TriggerSchema),
  }),
  _organization: OrgChartSchema.extend({
    eventBus: z.object({
      mySubscriptions: z.array(z.string()),
      myPublications: z.array(z.string()),
      allEvents: z.array(z.string()),
    }),
  }),
  _history: z.object({
    recentExecutions: z.array(ExecutionRecordSchema),
    successRate: z.number(),
    mostCommonFlag: z.string().optional(),
    bestPerformingContentType: z.string().optional(),
    worstPerformingContentType: z.string().optional(),
  }),
  _runtime: z.object({
    executor: z.string(),
    llmLayer: z.string(),
    reviewGate: z.string(),
    actionExecutors: z.record(z.string()),
    configLoader: z.string(),
    eventBus: z.string(),
  }),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

// ─── LLM Tool Definition ────────────────────────────────────────────────────

export const ToolParameterSchema: z.ZodType<ToolParameter> = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string(),
  required: z.boolean().default(false),
  properties: z.record(z.lazy(() => ToolParameterSchema)).optional(),
  items: z.lazy(() => ToolParameterSchema).optional(),
});

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  properties?: Record<string, ToolParameter>;
  items?: ToolParameter;
}

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(ToolParameterSchema),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;