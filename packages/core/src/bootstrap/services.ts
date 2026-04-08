import { Pool } from 'pg';
import { AuditLog, NullAuditLog } from '../logging/audit.js';
import { createLogger } from '../logging/logger.js';
import { MemoryManager, OpenAIEmbeddingService, NullEmbeddingService, type MemoryConfig, type EmbeddingService } from '@yclaw/memory';
import { AgentMemory } from '../self/memory.js';
import { MemoryIndex, NullMemoryIndex, type MemoryIndexLike } from '../self/memory-index.js';
import { EventBus } from '../triggers/event.js';
import { RepoRegistry } from '../config/repo-registry.js';
import { EventStream } from '../services/event-stream.js';
import { Redis as IORedis } from 'ioredis';
import { CostTracker } from '../costs/cost-tracker.js';
import { BudgetEnforcer } from '../costs/budget-enforcer.js';
import { CheckpointManager } from '../checkpoint/checkpoint-manager.js';
import { FleetGuard } from '../fleet-guard.js';
import { SettingsOverlay } from '../config/settings-overlay.js';
import { OperatorStore } from '../operators/operator-store.js';
import { OperatorAuditLogger } from '../operators/audit-logger.js';
import { seedRootOperator } from '../operators/seed.js';
import { RoleStore } from '../operators/roles.js';
import { OperatorTaskStore } from '../operators/task-model.js';
import { TaskLockManager } from '../operators/task-locks.js';
import { CrossDeptStore } from '../operators/cross-dept.js';
import { OperatorEventStream } from '../operators/event-stream.js';
import { OperatorRateLimiter } from '../operators/rate-limiter.js';
import { OperatorSlackNotifier } from '../operators/slack-notifier.js';
import { STALE_DEPLOYMENT_THRESHOLD_MS } from '../actions/deploy/types.js';
import type { Infrastructure } from '../infrastructure/types.js';
import type { YclawConfig } from '../infrastructure/config-schema.js';
import { KnowledgeGraphService } from '../knowledge/knowledge-graph.js';
import { OnboardingStore } from '../onboarding/onboarding-store.js';
import { OnboardingService } from '../onboarding/service.js';
import { IngestionService } from '../onboarding/ingestion-service.js';
import { ValidationRunner } from '../onboarding/validation.js';
import { createProvider } from '../llm/provider.js';
import { NoopMetrics, type IMetrics } from '../observability/metrics.js';
import { AuditTimeline } from '../observability/audit-timeline.js';

const logger = createLogger('bootstrap:services');

export interface ServiceContext {
  auditLog: AuditLog;
  agentMemory: AgentMemory | null;
  memoryIndex: MemoryIndexLike;
  eventBus: EventBus;
  eventStream: EventStream | null;
  streamRedis: IORedis | null;
  repoRegistry: RepoRegistry;
  deployRedis: IORedis | null;
  memoryManager: MemoryManager | undefined;
  memoryPool: Pool | undefined;
  costTracker: CostTracker;
  budgetEnforcer: BudgetEnforcer | null;
  checkpointManager: CheckpointManager;
  fleetGuard: FleetGuard | null;
  settingsOverlay: SettingsOverlay;
  operatorStore: OperatorStore | null;
  operatorAuditLogger: OperatorAuditLogger | null;
  rootOperatorId: string | null;
  roleStore: RoleStore | null;
  operatorTaskStore: OperatorTaskStore | null;
  taskLockManager: TaskLockManager | null;
  crossDeptStore: CrossDeptStore | null;
  operatorEventStream: OperatorEventStream | null;
  operatorRateLimiter: OperatorRateLimiter | null;
  operatorSlackNotifier: OperatorSlackNotifier | null;
  /** Infrastructure layer — available for new code migrating to interfaces. */
  infrastructure: Infrastructure | null;
  /** Onboarding service — conversational setup flow. */
  onboardingService: OnboardingService | null;
  /** Ingestion service — asset ingestion pipeline. */
  ingestionService: IngestionService | null;
  /** Validation runner — post-onboarding department health checks. */
  validationRunner: ValidationRunner | null;
  /** Metrics interface — NoopMetrics by default, pluggable. */
  metrics: IMetrics;
  /** Audit timeline — unified query across audit stores. */
  auditTimeline: AuditTimeline | null;
  /** Parsed yclaw.config.yaml — used for communication style resolution. */
  yclawConfig: YclawConfig | null;
  /** Knowledge graph service — graphify integration for Librarian. */
  knowledgeGraph: KnowledgeGraphService | null;
}

/**
 * Initialize all services. When Infrastructure is provided (Phase 1+),
 * uses the infrastructure adapters for MongoDB/Redis where possible.
 * Falls back to direct initialization when no infrastructure is provided
 * (backward compatibility).
 */
export async function initServices(infrastructure?: Infrastructure, yclawConfig?: YclawConfig): Promise<ServiceContext> {
  // ─── MongoDB Audit Log ──────────────────────────────────────────────────
  // When infrastructure is provided, reuse its MongoDB connection to avoid
  // opening duplicate MongoClient connections (Codex review #1).
  let auditLog: AuditLog;
  const infraDb = infrastructure?.stateStore.getRawDb();
  if (infraDb) {
    try {
      auditLog = await AuditLog.fromDb(infraDb as import('mongodb').Db);
      logger.info('Audit log connected (via infrastructure stateStore)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`AuditLog.fromDb failed — falling back to NullAuditLog (${msg})`);
      auditLog = new NullAuditLog();
    }
  } else {
    try {
      auditLog = new AuditLog(
        process.env.MONGODB_URI!,
        process.env.MONGODB_DB || 'yclaw_agents',
      );
      await auditLog.connect();
      logger.info('Audit log connected');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`MongoDB unavailable — running in degraded mode (${msg})`);
      auditLog = new NullAuditLog();
    }
  }

  // ─── Agent Memory + Search Index (MongoDB-backed) ──────────────────────
  let agentMemory: AgentMemory | null = null;
  let memoryIndex: MemoryIndexLike = new NullMemoryIndex();
  const db = auditLog.getDb();
  if (db) {
    try {
      agentMemory = new AgentMemory(db);
      await agentMemory.initialize();
      logger.info('Agent memory collection initialized');

      const idx = new MemoryIndex(db);
      await idx.initialize();
      memoryIndex = idx;
      logger.info('Memory search index initialized');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Memory subsystem initialization failed — running without search (${msg})`);
    }
  }

  // ─── Deploy Governance v2 Migration ─────────────────────────────────────
  try {
    const cleared = await auditLog.clearPendingDeployments(
      'Cleared by deploy-governance-v2 migration — resubmit through new pipeline (hard gates + Architect review)',
    );
    if (cleared > 0) {
      logger.info(`Deploy governance v2: cleared ${cleared} stale pending deployment(s) from old human-approval queue`);
    }
  } catch (migrationErr) {
    const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
    logger.warn(`Deploy governance v2 migration failed (non-fatal): ${msg}`);
  }

  // ─── Stale Deploy Cleanup ──────────────────────────────────────────────
  // Uses STALE_DEPLOYMENT_THRESHOLD_MS (2 hours) so CRITICAL-tier deployments
  // legitimately awaiting architect review are not prematurely cancelled.
  try {
    const staleCleared = await auditLog.clearPendingDeployments(
      'Cancelled: stale deployment (exceeded STALE_DEPLOYMENT_THRESHOLD_MS) — flood cleanup at startup',
      STALE_DEPLOYMENT_THRESHOLD_MS,
    );
    if (staleCleared > 0) {
      logger.warn(`Found and cancelled ${staleCleared} stale deploy assessment(s) older than ${STALE_DEPLOYMENT_THRESHOLD_MS / 60_000} min`);
    }
  } catch (staleErr) {
    const msg = staleErr instanceof Error ? staleErr.message : String(staleErr);
    logger.warn(`Stale deploy cleanup failed (non-fatal): ${msg}`);
  }

  // ─── Repo Registry ─────────────────────────────────────────────────────
  const repoRegistry = new RepoRegistry();
  await repoRegistry.initialize(db);
  logger.info('Repo registry initialized', { repos: repoRegistry.size });

  // ─── Redis Event Bus ───────────────────────────────────────────────────
  // When infrastructure is provided, reuse its EventBus + Redis connections
  // to avoid opening duplicate ioredis connections (Codex review #1).
  let eventBus: EventBus;
  let deployRedis: IORedis | null = null;
  let eventStream: EventStream | null = null;
  let streamRedis: IORedis | null = null;

  const infraEventBus = infrastructure?.eventBus;
  if (infraEventBus && 'getInnerEventBus' in infraEventBus) {
    const redisAdapter = infraEventBus as import('../adapters/events/RedisEventBus.js').RedisEventBus;
    eventBus = redisAdapter.getInnerEventBus();
    deployRedis = redisAdapter.getRawRedis();
    logger.info('Event bus initialized (via infrastructure eventBus)');

    // Wire EventStream using the shared Redis connection
    if (deployRedis) {
      try {
        streamRedis = deployRedis; // Reuse the same connection
        eventStream = new EventStream(streamRedis);
        eventBus.setEventStream(eventStream);
        logger.info('EventStream wired to EventBus (coordination events enabled)');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`EventStream wiring failed — coord events disabled (${msg})`);
        streamRedis = null;
        eventStream = null;
      }
    }
  } else {
    eventBus = new EventBus(process.env.REDIS_URL);
    logger.info('Event bus initialized');

    // ─── Redis Streams (coordination events) ─────────────────────────────
    const streamRedisUrl = process.env.REDIS_URL;
    if (streamRedisUrl && (streamRedisUrl.startsWith('redis://') || streamRedisUrl.startsWith('rediss://'))) {
      try {
        streamRedis = new IORedis(streamRedisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          connectTimeout: 15000,
        });
        await streamRedis.connect();
        eventStream = new EventStream(streamRedis);
        eventBus.setEventStream(eventStream);
        logger.info('EventStream wired to EventBus (coordination events enabled)');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`EventStream Redis failed — coord events disabled (${msg})`);
        streamRedis = null;
        eventStream = null;
      }
    }

    // ─── Deploy Redis (flood protection) ─────────────────────────────────
    const deployRedisUrl = process.env.REDIS_URL;
    if (deployRedisUrl && (deployRedisUrl.startsWith('redis://') || deployRedisUrl.startsWith('rediss://'))) {
      try {
        deployRedis = new IORedis(deployRedisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
        await deployRedis.connect();
        logger.info('Deploy Redis connected (flood protection enabled)');
      } catch (redisErr) {
        logger.warn('Deploy Redis unavailable — flood protection disabled', {
          error: redisErr instanceof Error ? redisErr.message : String(redisErr),
        });
        deployRedis = null;
      }
    }
  }

  // ─── Memory Architecture (Postgres) ────────────────────────────────────
  let memoryManager: MemoryManager | undefined;
  let memoryPool: Pool | undefined;
  const memoryDbUrl = process.env.MEMORY_DATABASE_URL;
  if (memoryDbUrl) {
    try {
      // Respect sslmode=disable in the connection string so the bundled
      // postgres container (which has no SSL) works out of the box. Any
      // other sslmode — or no sslmode at all — falls back to relaxed SSL,
      // which is what managed services like RDS need (self-signed certs).
      const disableSsl = /[?&]sslmode=disable(?:&|$)/.test(memoryDbUrl);
      memoryPool = new Pool({
        connectionString: memoryDbUrl,
        ssl: disableSsl ? false : { rejectUnauthorized: false },
        min: 2,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });

      memoryPool.on('error', (err: Error) => {
        logger.error('[memory:pg] Pool error:', { error: err.message });
      });

      const client = await memoryPool.connect();
      const testResult = await client.query('SELECT count(*)::int as cnt FROM categories');
      client.release();
      logger.info(`Memory database connected (${testResult.rows[0].cnt} categories)`);

      const memoryConfig: MemoryConfig = {
        postgres: {
          host: '',
          port: 5432,
          database: '',
          user: '',
          password: '',
          ssl: true,
        },
        writeGate: {
          model: 'claude-haiku',
          maxDailyBudgetCents: 300,
        },
        workingMemory: {
          maxSizeBytes: 16_384,
        },
      };

      let embeddingService: EmbeddingService;
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        embeddingService = new OpenAIEmbeddingService({ apiKey: openaiKey });
        logger.info('Embedding service initialized (OpenAI text-embedding-3-small)');
      } else {
        embeddingService = new NullEmbeddingService();
        logger.info('Embedding service: null (OPENAI_API_KEY not set — dedup disabled)');
      }

      memoryManager = new MemoryManager(memoryPool, memoryConfig, embeddingService);
      logger.info('Memory Architecture Phase 3 initialized (all 13 modules)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Memory database unavailable — running without persistent memory (${msg})`);
    }
  } else {
    logger.info('MEMORY_DATABASE_URL not set — persistent memory disabled');
  }

  // ─── Cost Tracking ──────────────────────────────────────────────────────
  const costRedis = deployRedis; // Reuse existing Redis connection
  const costTracker = new CostTracker(auditLog.getDb(), costRedis);
  await costTracker.initialize();
  logger.info('Cost tracker initialized');

  let budgetEnforcer: BudgetEnforcer | null = null;
  const budgetEnforcementEnabled = process.env.BUDGET_ENFORCEMENT_ENABLED !== 'false';
  if (budgetEnforcementEnabled && auditLog.getDb()) {
    // Pass costRedis for alert deduplication (budget:warned:{agentId}:{date} keys)
    budgetEnforcer = new BudgetEnforcer(auditLog.getDb(), costRedis, costTracker, eventBus);
    await budgetEnforcer.initialize();
    logger.info('Budget enforcer initialized');
  } else if (!budgetEnforcementEnabled) {
    logger.info('Budget enforcement disabled via BUDGET_ENFORCEMENT_ENABLED=false');
  }

  // ─── Settings Overlay (MongoDB → Agent Runtime config overlay) ────────
  const settingsOverlay = new SettingsOverlay(db);
  logger.info('Settings overlay initialized');

  // ─── Checkpoint Manager (session resume) ────────────────────────────────
  const checkpointRedis = deployRedis; // Reuse existing Redis connection
  const checkpointManager = new CheckpointManager(checkpointRedis);
  logger.info(`Checkpoint manager initialized${checkpointRedis ? '' : ' (no Redis — checkpoints disabled)'}`);

  // ─── Fleet Guard (soft pause via Redis) ────────────────────────────────
  let fleetGuard: FleetGuard | null = null;
  const fleetRedisUrl = process.env.REDIS_URL;
  if (fleetRedisUrl && (fleetRedisUrl.startsWith('redis://') || fleetRedisUrl.startsWith('rediss://'))) {
    try {
      fleetGuard = new FleetGuard(fleetRedisUrl);
      await fleetGuard.initialize();
      logger.info('Fleet guard initialized', { paused: fleetGuard.isPaused() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Fleet guard unavailable — soft pause disabled (${msg})`);
      fleetGuard = null;
    }
  }

  // ─── Operator Store & Seed ────────────────────────────────────────────────
  let operatorStore: OperatorStore | null = null;
  let operatorAuditLogger: OperatorAuditLogger | null = null;
  let rootOperatorId: string | null = null;
  let roleStore: RoleStore | null = null;
  let operatorTaskStore: OperatorTaskStore | null = null;
  let taskLockManager: TaskLockManager | null = null;
  let crossDeptStore: CrossDeptStore | null = null;
  let operatorEventStream: OperatorEventStream | null = null;
  let operatorRateLimiter: OperatorRateLimiter | null = null;
  let operatorSlackNotifier: OperatorSlackNotifier | null = null;
  if (db) {
    try {
      operatorStore = new OperatorStore(db);
      await operatorStore.ensureIndexes();
      operatorAuditLogger = new OperatorAuditLogger(db);
      await operatorAuditLogger.ensureIndexes();
      rootOperatorId = await seedRootOperator(operatorStore);

      roleStore = new RoleStore(db);
      await roleStore.ensureIndexes();
      await roleStore.seedDefaults();

      operatorTaskStore = new OperatorTaskStore(db);
      await operatorTaskStore.ensureIndexes();

      crossDeptStore = new CrossDeptStore(db);
      await crossDeptStore.ensureIndexes();

      // Task lock manager requires Redis
      if (deployRedis) {
        taskLockManager = new TaskLockManager(deployRedis);
        logger.info('Task lock manager initialized (Redis-backed)');
      }

      operatorEventStream = new OperatorEventStream(db);
      await operatorEventStream.ensureIndexes();

      if (deployRedis) {
        operatorRateLimiter = new OperatorRateLimiter(deployRedis);
        logger.info('Operator rate limiter initialized');
      }

      operatorSlackNotifier = new OperatorSlackNotifier(operatorStore);

      logger.info('Operator subsystem initialized', { rootOperatorId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Operator subsystem initialization failed (${msg})`);
      operatorStore = null;
      operatorAuditLogger = null;
      roleStore = null;
      operatorTaskStore = null;
      taskLockManager = null;
      crossDeptStore = null;
      operatorEventStream = null;
      operatorRateLimiter = null;
      operatorSlackNotifier = null;
    }
  }

  // ─── Onboarding Service ────────────────────────────────────────────────────
  // Council change #1: LLM config resolved at bootstrap layer, not in service.
  let onboardingService: OnboardingService | null = null;
  let ingestionService: IngestionService | null = null;
  let validationRunner: ValidationRunner | null = null;
  if (db) {
    try {
      const onboardingStore = new OnboardingStore(db);
      await onboardingStore.ensureIndexes();

      // Onboarding-specific override takes priority over global.
      // Use `||` (not `??`) so that empty strings — which are the common state
      // when a user copies .env.example and leaves the override blank — fall
      // back to the global LLM_PROVIDER / LLM_MODEL instead of being passed
      // through as an unknown provider.
      const llmProvider =
        process.env.ONBOARDING_LLM_PROVIDER?.trim() ||
        process.env.LLM_PROVIDER?.trim() ||
        'anthropic';
      const llmModel =
        process.env.ONBOARDING_MODEL?.trim() ||
        process.env.LLM_MODEL?.trim() ||
        'claude-sonnet-4-20250514';
      const onboardingProvider = createProvider({
        provider: llmProvider as 'anthropic' | 'openrouter' | 'ollama',
        model: llmModel,
        temperature: 0.3,
        maxTokens: 4096,
      });

      // OnboardingService accepts null auditLogger (graceful degradation)
      onboardingService = new OnboardingService(onboardingProvider, onboardingStore, operatorAuditLogger);

      // IngestionService needs IObjectStore from infrastructure
      if (infrastructure?.objectStore) {
        ingestionService = new IngestionService(onboardingStore, onboardingProvider, infrastructure.objectStore);
      } else {
        logger.warn('Ingestion service unavailable — no object store configured');
      }

      // ValidationRunner with session scoping
      validationRunner = new ValidationRunner(db, onboardingStore);

      logger.info('Onboarding service initialized', { llmProvider, llmModel });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Onboarding service initialization failed (${msg})`);
      onboardingService = null;
      ingestionService = null;
      validationRunner = null;
    }
  }

  // ─── Knowledge Graph Service (Graphify) ─────────────────────────────────
  let knowledgeGraph: KnowledgeGraphService | null = null;
  const graphConfig = yclawConfig?.librarian?.graph;
  if (graphConfig?.enabled) {
    knowledgeGraph = new KnowledgeGraphService(graphConfig);
    logger.info('Knowledge graph service initialized', {
      sourceRoot: graphConfig.source_root,
      outputDir: graphConfig.output_dir,
    });
  } else {
    logger.info('Knowledge graph service disabled (librarian.graph.enabled not set)');
  }

  return {
    auditLog, agentMemory, memoryIndex, eventBus, eventStream, streamRedis,
    repoRegistry, deployRedis, memoryManager, memoryPool,
    costTracker, budgetEnforcer, checkpointManager, fleetGuard,
    settingsOverlay, operatorStore, operatorAuditLogger, rootOperatorId,
    roleStore, operatorTaskStore, taskLockManager, crossDeptStore,
    operatorEventStream, operatorRateLimiter, operatorSlackNotifier,
    infrastructure: infrastructure ?? null,
    onboardingService,
    ingestionService,
    validationRunner,
    metrics: new NoopMetrics(),
    auditTimeline: operatorAuditLogger ? new AuditTimeline(operatorAuditLogger, auditLog) : null,
    yclawConfig: yclawConfig ?? null,
    knowledgeGraph,
  };
}
