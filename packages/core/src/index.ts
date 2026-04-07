// Core exports for the YClaw Agent System

// Auth Facade (server-only — the ONLY auth export MC should use)
export { getAuthFacade } from './auth/server.js';
export type {
  AuthFacade,
  AuthFacadeConfig,
  OperatorIdentity,
  OperatorState,
  OperatorContext,
  PermissionResult,
  ResourceTarget,
  AuditEvent,
} from './auth/server.js';

// Config
export { AgentConfigSchema, CommunicationStyleEnum, CommunicationConfigSchema, type AgentConfig, type AgentManifest, type OrgChart, type CommunicationStyle, type CommunicationConfig } from './config/schema.js';
export { loadAgentConfig, loadAllAgentConfigs, loadPrompt, buildOrgChart } from './config/loader.js';
export { resolveCommunicationStyle } from './config/communication-style.js';

// LLM
export { createProvider, type LLMProvider, type LLMMessage, type LLMResponse } from './llm/provider.js';
export { applyTurnCacheMarkers } from './llm/anthropic.js';

// Security
export { MemoryWriteScanner } from './security/memory-scanner.js';
export type { ScanResult, ScanContext, EventBusLike } from './security/memory-scanner.js';
export {
  validateAgentPR,
  AgentCircuitBreaker,
  AGENT_EGRESS_ALLOWLIST,
  isEgressAllowed,
  createAuditEntry,
  PROTECTED_PATHS,
  FORBIDDEN_PATHS,
  DEFAULT_CIRCUIT_BREAKER,
} from './security/index.js';
export type {
  AgentPRValidation,
  CircuitBreakerConfig,
  CircuitState,
  AllowedEndpoint,
  AuditEntry,
} from './security/index.js';


// Agent Runtime
export { AgentExecutor } from './agent/executor.js';
export { AgentRouter } from './agent/router.js';
export { ContextBuilder } from './agent/context.js';
export { ManifestBuilder } from './agent/manifest.js';
export { ContextCompressor } from './agent/middleware/context-compressor.js';
export type { CompressionResult } from './agent/middleware/context-compressor.js';
export { computeSnapshotId, PromptSnapshotStore } from './agent/prompt-snapshot.js';
export type { PromptSnapshot } from './agent/prompt-snapshot.js';

// Token Estimation
export {
  estimateTokens,
  estimateMessagesTokens,
  getContextWindow,
  DEFAULT_CONTEXT_WINDOW,
} from './utils/token-estimator.js';

// Self-Modification
export { SelfModTools } from './self/tools.js';
export { SafetyGate } from './self/safety.js';
export { AgentMemory } from './self/memory.js';

// Review
export { ReviewGate } from './review/reviewer.js';
export { OutboundSafetyGate } from './review/outbound-safety.js';
export { HumanizationGate } from './review/humanizer.js';

// Actions
export type { ActionExecutor, ActionResult, ActionRegistry } from './actions/types.js';
export { CodegenExecutor } from './actions/codegen.js';
export { DeployExecutor } from './actions/deploy/index.js';
export { XSearchExecutor } from './actions/x-search.js';
export { FluxExecutor } from './actions/flux.js';

// Deploy Governance
export {
  RiskTier,
  RISK_TIER_LABELS,
  classifyFile,
  classifyDeploymentRisk,
  assessDeploymentRisk,
} from './deploy/index.js';
export type { RiskAssessmentResult } from './deploy/index.js';

// Codegen (audit types — codegen/ directory removed, types inlined in audit.ts)
export type { CodegenSessionResult } from './logging/audit.js';

// Repo Registry
export { RepoConfigSchema, type RepoConfig } from './config/repo-schema.js';
export { loadRepoConfig, loadAllRepoConfigs, isRepoExcluded } from './config/repo-loader.js';
export { RepoRegistry } from './config/repo-registry.js';
export { RepoExecutor } from './actions/repo.js';

// Triggers
export { EventBus } from './triggers/event.js';
export { CronManager } from './triggers/cron.js';
export { WebhookServer } from './triggers/webhook.js';
export { GitHubWebhookHandler } from './triggers/github-webhook.js';
export type { GitHubWebhookOptions } from './triggers/github-webhook.js';
export { SlackWebhookHandler } from './triggers/slack-webhook.js';

// Data
export { DataResolver } from './data/resolver.js';

// Session Checkpointing
export { CheckpointManager } from './checkpoint/checkpoint-manager.js';
export type { Checkpoint, CheckpointState } from './checkpoint/types.js';
export { CHECKPOINT_TTL_SECONDS } from './checkpoint/types.js';

// Cost Tracking
export { CostTracker } from './costs/cost-tracker.js';
export { BudgetEnforcer } from './costs/budget-enforcer.js';
export { TreasurySnapshotWriter } from './costs/treasury-snapshot.js';
export { computeCostCents, getPricing, MODEL_PRICING } from './costs/model-pricing.js';
export type { AgentCostEvent, AgentBudget, BudgetCheckResult, BudgetMode, GlobalBudgetConfig } from './costs/types.js';

// Fleet Guard
export { FleetGuard } from './fleet-guard.js';

// Logging
export { createLogger } from './logging/logger.js';
export { AuditLog } from './logging/audit.js';
export { CacheObserver } from './logging/cache-observer.js';
export type {
  CostBreakdown,
  AgentCacheReport,
  OrgCacheReport,
  ModelPricing,
} from './logging/cache-observer.js';

// Stitch Client
export { StitchClient, StitchError } from './services/stitch-client.js';
export type {
  StitchProject,
  StitchScreen,
  ListProjectsResult,
  CreateProjectResult,
  GenerateScreenResult,
  EditScreensResult,
  GenerateVariantsResult,
  ListScreensResult,
  GenerateVariantOptions,
} from './services/stitch-client.js';

// Builder Dispatcher
// Shared Contracts (Phase 0)
export {
  SessionStateSchema,
  type SessionState,
  HarnessTypeSchema,
  type HarnessType,
  SessionTokenUsageSchema,
  type SessionTokenUsage,
  SessionRecordSchema,
  type SessionRecord,
  RunStatusSchema,
  type RunStatus,
  RunCostSchema,
  type RunCost,
  RunRecordSchema,
  type RunRecord,
  EventEnvelopeSchema,
  type EventEnvelope,
  ApprovalTypeSchema,
  type ApprovalType,
  ApprovalStatusSchema,
  type ApprovalStatus,
  ApprovalSchema,
  type Approval,
  ThreadKeyInputSchema,
  type ThreadKeyInput,
  computeThreadKey,
} from './contracts/index.js';


// Integration Recipes
export type { Recipe, RecipeStep, BuilderTask as RecipeBuilderTask, CredentialField as RecipeCredentialField, VerifyBlock } from './integrations/recipe-types.js';
export { RecipeSchema, RecipeStepSchema, BuilderTaskSchema, CredentialFieldSchema, VerifyBlockSchema } from './integrations/recipe-types.js';
export { loadAllRecipes, loadRecipe } from './integrations/recipe-loader.js';
export { validateRecipe } from './integrations/recipe-validator.js';
export type { ValidationResult as RecipeValidationResult } from './integrations/recipe-validator.js';
export { RecipeEngine } from './integrations/recipe-engine.js';
export { ConnectionReporter } from './integrations/connection-reporter.js';
export type { StepUpdate as ConnectionStepUpdate } from './integrations/connection-reporter.js';
export { handleWireIntegration } from './integrations/wire-handler.js';
export type { WireIntegrationContext } from './integrations/wire-handler.js';

// Secret Backend Abstraction
export type { SecretBackend, SecretBackendType } from './integrations/secret-backend.js';
export { resolveSecretBackend } from './integrations/secret-backend.js';

// Knowledge / Vault
export { WriteGateway } from './knowledge/write-gateway.js';
export type { ProposalInput, ProposalResult, WriteGatewayConfig } from './knowledge/write-gateway.js';
export { VaultReader } from './knowledge/vault-reader.js';
export type { VaultSearchResult, VaultReaderConfig } from './knowledge/vault-reader.js';
export { VaultStore, normalizeVaultPath } from './knowledge/vault-store.js';
export type {
  VaultCollectionKind,
  VaultDocumentRecord,
  VaultReadResult,
  VaultSearchResponse as MongoVaultSearchResponse,
  VaultSearchResult as MongoVaultSearchResult,
  VaultWriteInput,
  VaultListItem,
} from './knowledge/vault-store.js';
export { VaultSyncEngine } from './knowledge/vault-sync.js';
export type { VaultSyncConfig, SyncReport, RedisLike as VaultRedisLike } from './knowledge/vault-sync.js';
export { VaultExecutor } from './actions/vault.js';

// Knowledge Graph (Graphify)
export { KnowledgeGraphService } from './knowledge/knowledge-graph.js';
export { GraphifyConfigSchema } from './knowledge/graphify-types.js';
export type {
  GraphifyConfig,
  GraphData,
  GraphNode,
  GraphEdge,
  GraphCommunity,
  GraphSummary,
  GraphHealthMetrics,
  GraphQueryInput,
  GraphQueryResult,
  DedupeCandidate,
  DedupeReason,
} from './knowledge/graphify-types.js';
export { loadGraphData, extractGraphSummary, computeHealthMetrics } from './knowledge/graph-report-parser.js';
export { queryGraph } from './knowledge/graph-query.js';
export { enhanceDedupeWithGraph } from './knowledge/graph-dedupe.js';
export type { DedupeInput } from './knowledge/graph-dedupe.js';

// Journaler (GitHub Coordination Ledger)
export { Journaler, JOURNALER_MARKER, formatComment, MILESTONE_TYPES } from './modules/journaler.js';

// SlackNotifier (Coordination Event → Slack Channels)
export { SlackNotifier } from './modules/slack-notifier.js';
export { buildCoordBlock, getChannelForAgent, getAgentEmoji, isEscalation, ALERTS_CHANNEL } from './utils/slack-blocks.js';
export type { SlackBlock } from './utils/slack-blocks.js';

// AgentHub Client
export { AgentHubClient } from './agenthub/client.js';
export { AgentHubPromoter } from './agenthub/promoter.js';
export type {
  AgentHubConfig,
  Commit as AgentHubCommit,
  Post as AgentHubPost,
  Channel as AgentHubChannel,
  ExplorationDirective,
  ExplorationTask,
  ReviewResult,
  PromoteOptions,
} from './agenthub/types.js';

// Exploration Module
export {
  registerExplorationModule,
  ExplorationDispatcher,
  ExplorationWorker,
  ExplorationReviewer,
  ExplorationPoller,
} from './exploration/index.js';
export type { ExplorationModuleConfig } from './exploration/index.js';

// Growth Engine (Marketing Experiment Loops)
export {
  registerGrowthEngine,
  ExperimentEngine,
  ComplianceChecker,
  Mutator,
  Scorer,
  Propagator,
  ColdEmailChannel,
  TwitterChannel,
  LandingPageChannel,
} from './growth-engine/index.js';
export type {
  GrowthEngineModuleConfig,
  GrowthEngineConfig,
  Template as GrowthTemplate,
  ChannelConfig as GrowthChannelConfig,
  ExperimentLoop,
  ExperimentResult,
  ComplianceResult,
  CrossChannelInsight,
  ScoreResult as GrowthScoreResult,
} from './growth-engine/index.js';
