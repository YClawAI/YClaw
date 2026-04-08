import { Pool } from 'pg';
import { createLogger } from '../logging/logger.js';
import { WebhookServer } from '../triggers/webhook.js';
import { GitHubWebhookHandler } from '../triggers/github-webhook.js';
import { TelegramWebhookHandler } from '../triggers/telegram-webhook.js';
import { SlackWebhookHandler } from '../triggers/slack-webhook.js';
import { DiscordEventHandler } from '../triggers/discord-event-handler.js';
import type { DiscordChannelAdapter } from '../adapters/channels/DiscordChannelAdapter.js';
import { CacheObserver } from '../logging/cache-observer.js';
import { GitHubExecutor } from '../actions/github/index.js';
import type { SlackExecutor } from '../actions/slack.js';
import { SLACK_CHANNELS } from '../actions/slack.js';
import { randomUUID } from 'node:crypto';
import { createEvent, COORD_TASK_REQUESTED, COORD_TASK_STARTED, COORD_TASK_COMPLETED, COORD_TASK_FAILED } from '../types/events.js';
import type { CoordTaskPayload } from '../types/events.js';
import type { ServiceContext } from './services.js';
import type { ActionContext } from './actions.js';
import type { AgentContext } from './agents.js';
import { HealthAggregator } from '../observability/health.js';
import type { FleetGuard } from '../fleet-guard.js';
import { createAuthMiddleware, createAuditMiddleware, createTailscaleMiddleware } from '../operators/middleware.js';
import { registerOperatorRoutes } from '../operators/routes.js';
import { registerTaskRoutes } from '../operators/task-routes.js';
import { registerConflictRoutes } from '../operators/conflict-routes.js';
import { registerVisibilityRoutes } from '../operators/visibility-routes.js';
import { registerBootstrapRoute } from '../operators/bootstrap.js';
import { registerOnboardingRoutes } from '../onboarding/routes.js';
import { registerHealthRoutes } from '../observability/health-routes.js';
import { registerObservabilityRoutes } from '../observability/observability-routes.js';

const logger = createLogger('bootstrap:routes');

const EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;

export interface RouteContext {
  webhookServer: WebhookServer;
  telegramHandler: TelegramWebhookHandler;
}

function normalizePublishedEventType(source: string, type: string): string {
  return type.startsWith(`${source}:`) ? type.slice(source.length + 1) : type;
}

export async function initRoutes(
  services: ServiceContext,
  actions: ActionContext,
  agents: AgentContext,
): Promise<RouteContext> {
  const { auditLog, eventBus, repoRegistry, memoryPool, fleetGuard } = services;
  const { actionRegistry, cacheObserver } = actions;
  const {
    executor,
    router,
    cronManager,
    explorationDispatcher,
    growthEngine,
  } = agents;

  // ─── Webhook Server ──────────────────────────────────────────────────
  const webhookServer = new WebhookServer(
    parseInt(process.env.PORT || '3000', 10),
  );

  // ─── Infrastructure Health + Phase 5 Liveness/Readiness ─────────────
  const healthAggregator = services.infrastructure
    ? new HealthAggregator(services.infrastructure)
    : null;

  {
    const expressApp = webhookServer.getExpressApp();

    if (healthAggregator) {
      // Legacy /health/infra route (backward compat for Docker healthchecks)
      expressApp.get('/health/infra', async (_req: import('express').Request, res: import('express').Response) => {
        try {
          const health = await healthAggregator.check();
          res.status(health.healthy ? 200 : 503).json(health);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.status(500).json({ healthy: false, error: msg });
        }
      });
      logger.info('Infrastructure health route registered at /health/infra');
    }

    // Phase 5: Liveness + Readiness routes (before auth middleware)
    registerHealthRoutes(expressApp, healthAggregator);
  }

  // ─── Operator Auth Middleware & Routes ────────────────────────────────
  const { operatorStore, operatorAuditLogger, rootOperatorId, deployRedis } = services;
  if (operatorStore && operatorAuditLogger && rootOperatorId) {
    const expressApp = webhookServer.getExpressApp();

    // Tailscale network boundary (production only)
    expressApp.use(createTailscaleMiddleware());

    // Bootstrap route — after Tailscale (network boundary) but before auth
    // middleware (uses its own Bearer token, not operator API key auth)
    registerBootstrapRoute(expressApp, operatorStore);

    // Mount auth middleware GLOBALLY — handles both /v1/* (required) and /api/* (inject root)
    expressApp.use(createAuthMiddleware(
      operatorStore, operatorAuditLogger, deployRedis, rootOperatorId,
      services.operatorRateLimiter,
    ));

    // Audit middleware — logs every request after response completes
    expressApp.use(createAuditMiddleware(operatorAuditLogger));

    // Register operator CRUD routes
    registerOperatorRoutes(expressApp, operatorStore, operatorAuditLogger, deployRedis, services.roleStore);

    // Register onboarding routes (Phase 4)
    if (services.onboardingService) {
      registerOnboardingRoutes(
        expressApp, services.onboardingService, operatorAuditLogger,
        services.validationRunner, services.ingestionService,
      );
    }

    // Register task & scoped-read routes (Phase 2)
    const { roleStore, operatorTaskStore, taskLockManager, crossDeptStore,
            operatorEventStream, operatorRateLimiter, operatorSlackNotifier } = services;
    let sharedExecuteAgentTask: any;
    if (roleStore && operatorTaskStore) {
      const taskRouteResult = registerTaskRoutes(
        expressApp, operatorTaskStore, roleStore, operatorAuditLogger,
        agents, services, taskLockManager, crossDeptStore,
        operatorEventStream, operatorRateLimiter, operatorSlackNotifier,
      );
      sharedExecuteAgentTask = taskRouteResult.executeAgentTask;
    }

    // Register conflict & cross-dept routes (Phase 3)
    if (operatorTaskStore && crossDeptStore) {
      registerConflictRoutes(
        expressApp, taskLockManager, crossDeptStore, operatorTaskStore,
        operatorAuditLogger, agents, operatorEventStream, operatorSlackNotifier,
        sharedExecuteAgentTask,
      );

      // Periodic cross-dept request expiry (every 10 minutes)
      setInterval(() => {
        crossDeptStore.expirePending().then((count) => {
          if (count > 0) {
            operatorAuditLogger.log({
              timestamp: new Date(),
              operatorId: 'system',
              action: 'cross_dept.expire',
              resource: { type: 'cross_dept_request', id: `batch:${count}` },
              request: { method: 'SYSTEM', path: '/internal/expiry', ip: 'system' },
              decision: 'allowed',
              reason: `${count} cross-dept request(s) expired`,
            });
          }
        }).catch((err) => {
          logger.warn('Cross-dept expiry failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, 10 * 60 * 1000);
    }

    // Register visibility routes (Phase 4)
    if (operatorEventStream && operatorTaskStore) {
      registerVisibilityRoutes(
        expressApp, operatorEventStream, operatorAuditLogger,
        operatorStore, operatorTaskStore, taskLockManager, operatorRateLimiter,
        crossDeptStore,
      );
    }

    // Phase 5: Observability routes (authenticated — after auth middleware)
    registerObservabilityRoutes(expressApp, services, healthAggregator);

    // Maintenance: expire invitations (every 10 minutes)
    setInterval(() => {
      operatorStore.expireInvitations().catch((err) => {
        logger.warn('Invitation expiry failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 10 * 60 * 1000);

    // Maintenance: stale lock safety sweep (every 30 minutes)
    // Redis TTL handles most cases, but this catches edge cases
    if (taskLockManager) {
      setInterval(() => {
        taskLockManager.listLocks().then((locks) => {
          for (const lock of locks) {
            if (new Date(lock.expiresAt) < new Date()) {
              taskLockManager.forceRelease(lock.resourceKey).catch(() => {});
            }
          }
        }).catch(() => {});
      }, 30 * 60 * 1000);
    }
  } else {
    logger.warn('Operator subsystem not available — /v1/* routes disabled');
    // Fail-closed: reject all /v1/* requests when operator auth is not available.
    // Without this guard, /v1/* routes would be accessible without any authentication
    // because the WebhookServer's requireApiKey middleware skips /v1/* paths.
    const expressApp = webhookServer.getExpressApp();
    expressApp.use((req: any, res: any, next: any) => {
      if (req.path.startsWith('/v1/') && req.path !== '/v1/health') {
        res.status(503).json({ error: 'Operator authentication subsystem not available' });
        return;
      }
      next();
    });
  }

  // Register webhook routes from agent configs
  const webhookRoutes = router.getAllWebhookRoutes();
  for (const { path, agent, task } of webhookRoutes) {
    const config = router.getConfig(agent);
    if (!config) continue;

    webhookServer.registerRoute(path, 'POST', async (body) => {
      if (fleetGuard?.isPaused()) {
        logger.info(`Webhook rejected (fleet paused): ${agent}:${task}`);
        return { error: 'Fleet is paused', code: 'FLEET_PAUSED' };
      }
      logger.info(`Webhook triggered: ${agent}:${task}`);
      const result = await executor.execute(
        config, task, 'webhook', body as Record<string, unknown>,
      );
      return { executionId: result.id, status: result.status };
    });
  }

  // ─── Async Trigger Infrastructure ────────────────────────────────────

  interface TrackedExecution {
    id: string;
    agent: string;
    task: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout';
    queuedAt: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    callbackUrl?: string;
  }

  const executionTracker = new Map<string, TrackedExecution>();

  // Prune completed executions older than 1 hour
  setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, exec] of executionTracker) {
      if (exec.completedAt && new Date(exec.completedAt).getTime() < cutoff) {
        executionTracker.delete(id);
      }
    }
  }, 10 * 60 * 1000);

  // Manual trigger endpoint
  webhookServer.registerRoute('/api/trigger', 'POST', async (body) => {
    if (fleetGuard?.isPaused()) {
      logger.info('Manual trigger rejected (fleet paused)');
      return { error: 'Fleet is paused', code: 'FLEET_PAUSED' };
    }
    const { agent: agentName, task, callback_url, ...triggerPayload } = body as {
      agent: string; task: string; callback_url?: string;
      [key: string]: unknown;
    };
    const config = router.getConfig(agentName);
    if (!config) return { error: `Unknown agent: ${agentName}` };

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tracked: TrackedExecution = {
      id: executionId, agent: agentName, task,
      status: 'queued', queuedAt: new Date().toISOString(),
      callbackUrl: callback_url,
    };
    executionTracker.set(executionId, tracked);

    const correlationId = `manual-${randomUUID()}`;
    logger.info(`Manual trigger (async): ${agentName}:${task} → ${executionId}`);

    // Bridge to operator task pipeline — create OperatorTask attributed to root.
    // Verify root operator actually exists in DB before attributing tasks to it
    // (during bootstrap window, rootOperatorId is a placeholder with no DB row).
    if (services.operatorTaskStore && rootOperatorId && operatorStore) {
      const rootOp = await operatorStore.getByOperatorId(rootOperatorId);
      if (!rootOp) {
        logger.debug('Skipping legacy task attribution — root operator not yet bootstrapped');
      } else {
      const opTaskId = `optask_legacy_${executionId}`;
      services.operatorTaskStore.create({
        taskId: opTaskId,
        operatorId: rootOp.operatorId,
        operatorName: `${rootOp.displayName} (legacy /api/trigger)`,
        target: { type: 'agent', id: agentName },
        action: task,
        payload: Object.keys(triggerPayload).length > 0 ? triggerPayload : undefined,
        priority: 100,
        status: 'queued',
        executionIds: [executionId],
        crossDepartment: { requested: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      }).catch((legacyErr: unknown) => {
        logger.warn('Failed to create OperatorTask for legacy trigger', {
          error: legacyErr instanceof Error ? legacyErr.message : String(legacyErr),
        });
      });
      }
    }

    void eventBus.publishCoordEvent(createEvent<CoordTaskPayload>({
      type: COORD_TASK_REQUESTED,
      source: agentName,
      correlation_id: correlationId,
      payload: {
        task_id: executionId, project_id: '', status: 'requested',
        assignee: agentName, description: task,
      },
    }));

    (async () => {
      tracked.status = 'running';
      tracked.startedAt = new Date().toISOString();

      void eventBus.publishCoordEvent(createEvent<CoordTaskPayload>({
        type: COORD_TASK_STARTED,
        source: agentName,
        correlation_id: correlationId,
        payload: {
          task_id: executionId, project_id: '', status: 'started',
          assignee: agentName, description: task,
        },
      }));

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), EXECUTION_TIMEOUT_MS);

      try {
        const result = await Promise.race([
          executor.execute(
            config, task, 'manual',
            Object.keys(triggerPayload).length > 0 ? triggerPayload : undefined,
          ),
          new Promise<never>((_, reject) => {
            timeoutController.signal.addEventListener('abort', () => {
              reject(new Error(`Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`));
            });
          }),
        ]);
        tracked.status = result.status === 'failed' ? 'failed' : 'completed';
        if (result.status === 'failed') {
          tracked.error = 'Execution failed — check audit log';
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTimeout = errMsg.includes('timed out');
        tracked.status = isTimeout ? 'timeout' : 'failed';
        tracked.error = errMsg;
        logger.error(
          `Async trigger ${isTimeout ? 'timed out' : 'failed'}: ${agentName}:${task}`,
          { error: errMsg, executionId },
        );
      } finally {
        clearTimeout(timeoutId);
        if (!tracked.completedAt) {
          tracked.completedAt = new Date().toISOString();
        }

        const coordType = tracked.status === 'completed' ? COORD_TASK_COMPLETED : COORD_TASK_FAILED;
        const coordStatus = tracked.status === 'completed' ? 'completed' : 'failed';
        void eventBus.publishCoordEvent(createEvent<CoordTaskPayload>({
          type: coordType,
          source: agentName,
          correlation_id: correlationId,
          payload: {
            task_id: executionId, project_id: '', status: coordStatus,
            assignee: agentName, message: tracked.error,
          },
        }));
      }

      if (tracked.callbackUrl) {
        try {
          await fetch(tracked.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              executionId: tracked.id, agent: tracked.agent,
              task: tracked.task, status: tracked.status,
              completedAt: tracked.completedAt, error: tracked.error,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          logger.info(`Callback delivered: ${tracked.callbackUrl} for ${executionId}`);
        } catch (cbErr) {
          logger.warn(`Callback failed: ${tracked.callbackUrl}`, {
            error: cbErr instanceof Error ? cbErr.message : String(cbErr),
          });
        }
      }
    })();

    return { executionId, status: 'queued', agent: agentName, task };
  });

  // Execution status endpoint
  webhookServer.registerRoute('/api/executions', 'GET', async (query) => {
    const { id } = query as { id?: string };
    if (id) {
      const exec = executionTracker.get(id);
      if (!exec) return { error: 'Execution not found' };
      return exec;
    }
    const active = [...executionTracker.values()].filter(
      e => e.status === 'queued' || e.status === 'running',
    );
    return { executions: active, total: executionTracker.size };
  });

  const PUBLISHABLE_SOURCES = new Set(['mission-control', 'strategist']);
  const PUBLISHABLE_EVENTS = new Set([
    'growth_pause', 'growth_resume', 'growth_approved',
    'exploration_directive',
  ]);

  webhookServer.registerRoute('/api/events/publish', 'POST', async (body) => {
    const {
      source,
      type,
      payload,
      correlationId,
    } = (body || {}) as {
      source?: string;
      type?: string;
      payload?: Record<string, unknown>;
      correlationId?: string;
    };

    if (!source || !type) {
      return { error: 'Missing required parameters: source, type' };
    }

    if (!PUBLISHABLE_SOURCES.has(source)) {
      return { error: `Source '${source}' is not allowed. Permitted: ${[...PUBLISHABLE_SOURCES].join(', ')}` };
    }

    const eventType = normalizePublishedEventType(source, type);

    if (!PUBLISHABLE_EVENTS.has(eventType)) {
      return { error: `Event type '${eventType}' is not allowed. Permitted: ${[...PUBLISHABLE_EVENTS].join(', ')}` };
    }

    await eventBus.publish(source, eventType, payload || {}, correlationId);
    return { published: true, source, type: eventType, correlationId };
  });

  // Agent status endpoint
  webhookServer.registerRoute('/api/agents', 'GET', async () => {
    const configs = router.getAllConfigs();
    const agentList = [];
    for (const [name, config] of configs) {
      agentList.push({
        name, department: config.department, description: config.description,
        model: config.model.model, actions: config.actions, triggers: config.triggers.length,
      });
    }
    return { agents: agentList };
  });

  // ─── Cache Observability ─────────────────────────────────────────────

  webhookServer.registerRoute('/api/cache/stats', 'GET', async (query) => {
    const { agent: agentName } = query as { agent?: string };
    if (!agentName) return { error: 'Missing required parameter: agent' };
    const config = router.getConfig(agentName);
    if (!config) return { error: `Unknown agent: ${agentName}` };
    try {
      const stats = await auditLog.getAgentStats(agentName);
      return {
        agent: agentName, cache: stats.cache,
        totalExecutions: stats.totalExecutions, successRate: stats.successRate,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to get stats: ${msg}` };
    }
  });

  webhookServer.registerRoute('/api/cache/report', 'GET', async (query) => {
    const { agent: agentName, from: fromStr, to: toStr } = query as {
      agent?: string; from?: string; to?: string;
    };
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;

    try {
      if (agentName) {
        const config = router.getConfig(agentName);
        if (!config) return { error: `Unknown agent: ${agentName}` };
        return await cacheObserver.getAgentReport(agentName, from, to, config.model.model);
      }
      const allConfigs = router.getAllConfigs();
      const agentNames = [...allConfigs.keys()];
      const report = await cacheObserver.getOrgReport(agentNames, from, to);
      return CacheObserver.formatApiSummary(report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to generate report: ${msg}` };
    }
  });

  // ─── Migration & Memory Endpoints ────────────────────────────────────

  webhookServer.registerRoute('/api/migrate', 'POST', async (_body, _headers) => {
    const pgMod = await import('pg');
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const url = process.env.MEMORY_DATABASE_URL;
    if (!url) return { success: false, error: 'MEMORY_DATABASE_URL not set' };
    const client = new pgMod.default.Client({ connectionString: url });
    const results: string[] = [];
    try {
      await client.connect();
      results.push('Connected');
      const ddl = fsMod.readFileSync(pathMod.join(import.meta.dirname, '..', '..', 'memory', 'migrations', '001_create_memory_tables.sql'), 'utf-8');
      await client.query(ddl);
      results.push('DDL complete');
      const seed = fsMod.readFileSync(pathMod.join(import.meta.dirname, '..', '..', 'memory', 'migrations', '002_seed_categories.sql'), 'utf-8');
      await client.query(seed);
      results.push('Seed complete');
      const cats = await client.query('SELECT scope::text, count(*)::int as cnt FROM categories GROUP BY scope ORDER BY scope');
      cats.rows.forEach((r: any) => results.push(r.scope + ': ' + r.cnt));
      await client.end();
      return { success: true, results };
    } catch (e: any) {
      await client.end().catch(() => {});
      return { success: false, error: e.message, results };
    }
  });

  webhookServer.registerRoute('/api/memory-status', 'GET', async () => {
    const pgMod = await import('pg');
    const url = process.env.MEMORY_DATABASE_URL;
    if (!url) return { connected: false, error: 'MEMORY_DATABASE_URL not set' };
    const client = new pgMod.default.Client({ connectionString: url });
    try {
      await client.connect();
      const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
      const cats = await client.query('SELECT scope::text, count(*)::int as cnt FROM categories GROUP BY scope ORDER BY scope').catch(() => ({ rows: [] }));
      const items = await client.query('SELECT count(*)::int as cnt FROM items').catch(() => ({ rows: [{ cnt: 0 }] }));
      await client.end();
      return { connected: true, tables: tables.rows.map((r: any) => r.table_name), categories: cats.rows, items: items.rows[0].cnt };
    } catch (e: any) {
      await client.end().catch(() => {});
      return { connected: false, error: e.message };
    }
  });

  webhookServer.registerRoute('/api/growth/status', 'GET', async () => {
    if (!growthEngine) {
      return { enabled: false, channels: [], pendingApprovals: [] };
    }

    const channels = [...growthEngine.getStatus().values()].map((loop) => ({
      channelName: loop.channelName,
      running: loop.running,
      experimentsRun: loop.experimentsRun,
      humanApprovalRemaining: loop.humanApprovalRemaining,
      championVersion: loop.champion.version,
      championScore: loop.championScore,
      variableIndex: loop.variableIndex,
    }));

    return {
      enabled: true,
      channels,
      pendingApprovals: growthEngine.getPendingApprovalKeys(),
    };
  });

  webhookServer.registerRoute('/api/exploration/tasks', 'GET', async () => {
    if (!explorationDispatcher) {
      return { enabled: false, tasks: [] };
    }

    const tasks = [...explorationDispatcher.activeTasks.values()].map((task) => {
      const completed = explorationDispatcher.completedWorkers.get(task.taskId)?.size ?? 0;
      return {
        taskId: task.taskId,
        description: task.description,
        context: task.context,
        rootHash: task.rootHash,
        targetRepo: task.targetRepo,
        targetBranch: task.targetBranch,
        numWorkers: task.numWorkers,
        assignedWorkers: task.assignedWorkers,
        startedAt: task.startedAt,
        completedWorkers: completed,
        allWorkersComplete: explorationDispatcher.allWorkersComplete(task.taskId),
      };
    });

    return { enabled: true, tasks };
  });

  webhookServer.registerRoute('/api/agents/reset', 'POST', async (body) => {
    const { agent: agentName, confirm } = body as { agent?: string; confirm?: boolean };
    if (!memoryPool) return { error: 'Memory database not connected' };
    if (!confirm) return { error: 'Pass confirm: true to execute. This deletes agent memory permanently.' };

    if (agentName && !/^[a-z0-9_-]+$/i.test(agentName)) {
      return { error: 'Invalid agent name. Use alphanumeric characters, hyphens, and underscores only.' };
    }

    if (agentName) {
      const config = router.getConfig(agentName);
      if (!config) return { error: `Unknown agent: ${agentName}` };
    }

    const label = agentName || 'ALL AGENTS';
    logger.warn(`Memory reset requested for: ${label}`);

    const results: Record<string, number> = {};
    const tables = [
      'episode_items', 'episodes', 'triples', 'strength_log',
      'checkpoints', 'working_memory', 'write_gate_log', 'resources', 'items',
    ];

    for (const table of tables) {
      try {
        const r = agentName
          ? await memoryPool.query(`DELETE FROM ${table} WHERE agent_id = $1`, [agentName])
          : await memoryPool.query(`DELETE FROM ${table}`);
        results[table] = r.rowCount ?? 0;
      } catch (e: any) {
        try {
          if (!agentName) {
            const r = await memoryPool.query(`DELETE FROM ${table}`);
            results[table] = r.rowCount ?? 0;
          } else {
            results[table] = -1;
          }
        } catch (e2: any) {
          results[table] = -1;
        }
      }
    }

    const resetDb = auditLog.getDb();
    let mongoCleared = 0;
    if (resetDb) {
      try {
        const filter = agentName ? { agentId: agentName } : {};
        const r = await resetDb.collection('agent_memory').deleteMany(filter);
        mongoCleared = r.deletedCount;
      } catch (e) {
        mongoCleared = -1;
      }
    }

    logger.warn(`Memory reset complete for: ${label}`, { results, mongoCleared });

    return {
      reset: label, postgres: results,
      mongo: { agent_memory: mongoCleared },
      message: `Memory wiped for ${label}. Categories and schema preserved. Agents will start fresh on next execution.`,
    };
  });

  // ─── Cost Tracking Endpoints ──────────────────────────────────────────

  webhookServer.registerRoute('/api/costs', 'GET', async (query) => {
    const { agentId, department, from: fromStr, to: toStr } = query as {
      agentId?: string; department?: string; from?: string; to?: string;
    };
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;

    try {
      const result = await services.costTracker.queryCosts({ agentId, department, from, to });
      return {
        totalCents: result.totalCents,
        totalDollars: `$${(result.totalCents / 100).toFixed(2)}`,
        byAgent: Object.fromEntries(
          Object.entries(result.byAgent).map(([k, v]) => [k, { cents: v, dollars: `$${(v / 100).toFixed(2)}` }]),
        ),
        byDepartment: Object.fromEntries(
          Object.entries(result.byDepartment).map(([k, v]) => [k, { cents: v, dollars: `$${(v / 100).toFixed(2)}` }]),
        ),
        byDay: Object.fromEntries(
          Object.entries(result.byDay).map(([k, v]) => [k, { cents: v, dollars: `$${(v / 100).toFixed(2)}` }]),
        ),
        eventCount: result.events.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to query costs: ${msg}` };
    }
  });

  webhookServer.registerRoute('/api/budgets', 'GET', async (query) => {
    const { agentId } = query as { agentId?: string };
    if (!services.budgetEnforcer) return { error: 'Budget enforcer not initialized' };
    if (agentId) {
      const budget = services.budgetEnforcer.getBudget(agentId);
      if (!budget) return { error: `No budget for agent: ${agentId}` };
      const check = await services.budgetEnforcer.check(agentId);
      return { budget, current: check };
    }
    // Return all budgets with current spend
    const configs = router.getAllConfigs();
    const results: Record<string, unknown> = {};
    for (const [name] of configs) {
      const budget = services.budgetEnforcer.getBudget(name);
      if (budget) {
        const check = await services.budgetEnforcer.check(name);
        results[name] = { budget, current: check };
      }
    }
    return { agents: results };
  });

  webhookServer.registerRoute('/api/schedules', 'GET', async () => {
    return { schedules: cronManager.listSchedules() };
  });

  webhookServer.registerRoute('/api/deployments', 'GET', async (body) => {
    const { repo } = (body || {}) as { repo?: string };
    if (!repo) return { error: 'Missing required parameter: repo' };
    const history = await auditLog.getDeploymentHistory(repo);
    return { deployments: history };
  });

  // ─── Approval Workflow Endpoints ───────────────────────────────────────

  const { approvalManager } = agents;

  webhookServer.registerRoute('/api/approvals', 'GET', async (query) => {
    const { status, agentId } = (query || {}) as { status?: string; agentId?: string };
    if (status === 'pending') {
      const pending = await approvalManager.getPending(agentId);
      return { approvals: pending };
    }
    const recent = await approvalManager.getRecent();
    return { approvals: recent };
  });

  webhookServer.registerRoute('/api/approvals/decide', 'POST', async (body) => {
    const { id, decision, decidedBy, note } = (body || {}) as {
      id?: string; decision?: string; decidedBy?: string; note?: string;
    };
    if (!id) return { error: 'Missing required parameter: id' };
    if (!decision || (decision !== 'approved' && decision !== 'rejected')) {
      return { error: 'Invalid decision — must be "approved" or "rejected"' };
    }
    if (!decidedBy) return { error: 'Missing required parameter: decidedBy' };

    const result = await approvalManager.decide(id, { decision, decidedBy, note });
    // decide() returns { error: string } when validation fails (e.g. requiresHuman violation)
    if ('error' in result) return result;
    return { approval: result };
  });

  webhookServer.registerRoute('/api/approvals/expire', 'POST', async () => {
    const count = await approvalManager.expirePending();
    return { expired: count };
  });

  // ─── Objective Hierarchy Endpoints ──────────────────────────────────────

  const { objectiveManager } = agents;

  webhookServer.registerRoute('/api/objectives', 'GET', async (query) => {
    const { status, department, ownerAgentId } = (query || {}) as {
      status?: string; department?: string; ownerAgentId?: string;
    };
    const filters: Record<string, string> = {};
    if (status) filters.status = status;
    if (department) filters.department = department;
    if (ownerAgentId) filters.ownerAgentId = ownerAgentId;
    const objectives = await objectiveManager.list(
      Object.keys(filters).length > 0 ? filters as any : undefined,
    );
    return { objectives };
  });

  webhookServer.registerRoute('/api/objectives', 'POST', async (body) => {
    const input = (body || {}) as {
      title?: string; description?: string; department?: string;
      priority?: string; createdBy?: string; ownerAgentId?: string;
      kpis?: Array<{ metric: string; target: number; current: number; unit: string }>;
      costBudgetCents?: number;
    };
    if (!input.title) return { error: 'Missing required field: title' };
    if (!input.department) return { error: 'Missing required field: department' };
    if (!input.priority) return { error: 'Missing required field: priority' };
    if (!input.createdBy) return { error: 'Missing required field: createdBy' };
    if (!input.ownerAgentId) return { error: 'Missing required field: ownerAgentId' };

    try {
      const objective = await objectiveManager.create({
        title: input.title,
        description: input.description ?? '',
        department: input.department,
        priority: input.priority as 'P0' | 'P1' | 'P2' | 'P3',
        createdBy: input.createdBy,
        ownerAgentId: input.ownerAgentId,
        kpis: input.kpis,
        costBudgetCents: input.costBudgetCents,
      });
      return { objective };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
  });

  webhookServer.registerRoute('/api/objectives/status', 'POST', async (body) => {
    const { id, status: newStatus, reason } = (body || {}) as {
      id?: string; status?: string; reason?: string;
    };
    if (!id) return { error: 'Missing required field: id' };
    if (!newStatus || !['active', 'paused', 'completed', 'failed'].includes(newStatus)) {
      return { error: 'Invalid status — must be active, paused, completed, or failed' };
    }

    const result = await objectiveManager.updateStatus(
      id,
      newStatus as 'active' | 'paused' | 'completed' | 'failed',
      reason,
    );
    if (!result) return { error: 'Objective not found' };
    return { objective: result };
  });

  webhookServer.registerRoute('/api/objectives/kpi', 'POST', async (body) => {
    const { id, metric, current } = (body || {}) as {
      id?: string; metric?: string; current?: number;
    };
    if (!id) return { error: 'Missing required field: id' };
    if (!metric) return { error: 'Missing required field: metric' };
    if (current === undefined) return { error: 'Missing required field: current' };

    const result = await objectiveManager.updateKPI(id, metric, current);
    if (!result) return { error: 'Objective or KPI metric not found' };
    return { objective: result };
  });

  webhookServer.registerRoute('/api/objectives/trace', 'GET', async (query) => {
    const { id } = (query || {}) as { id?: string };
    if (!id) return { error: 'Missing required parameter: id' };

    const trace = await objectiveManager.trace(id);
    if (!trace) return { error: 'Objective not found' };
    return trace;
  });

  // ─── Config Revision Endpoints ─────────────────────────────────────────

  const { revisionTracker } = agents;

  // List revisions for an agent (paginated, newest first)
  webhookServer.registerRoute('/api/agents/revisions', 'GET', async (query) => {
    const { id, version: versionStr, limit: limitStr, offset: offsetStr } = (query || {}) as {
      id?: string; version?: string; limit?: string; offset?: string;
    };
    if (!id) return { error: 'Missing required parameter: id' };

    // If a specific version is requested, return that single revision
    if (versionStr) {
      const version = parseInt(versionStr, 10);
      if (isNaN(version) || version < 1) return { error: 'Invalid version — must be a positive integer' };
      const rev = await revisionTracker.getRevision(id, version);
      if (!rev) return { error: `Revision v${version} not found for agent ${id}` };
      return { revision: rev };
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    if (isNaN(limit) || limit < 1) return { error: 'Invalid limit — must be a positive integer' };
    if (isNaN(offset) || offset < 0) return { error: 'Invalid offset — must be a non-negative integer' };
    const result = await revisionTracker.listRevisions(id, { limit, offset });
    return result;
  });

  // Compare two versions
  webhookServer.registerRoute('/api/agents/revisions/compare', 'GET', async (query) => {
    const { id, from: fromStr, to: toStr } = (query || {}) as {
      id?: string; from?: string; to?: string;
    };
    if (!id) return { error: 'Missing required parameter: id' };
    if (!fromStr || !toStr) return { error: 'Missing required parameters: from and to (version numbers)' };

    const fromVersion = parseInt(fromStr, 10);
    const toVersion = parseInt(toStr, 10);
    if (isNaN(fromVersion) || fromVersion < 1 || isNaN(toVersion) || toVersion < 1) {
      return { error: 'Invalid version numbers — must be positive integers' };
    }

    const result = await revisionTracker.compareVersions(id, fromVersion, toVersion);
    if (!result) return { error: 'One or both versions not found' };
    return result;
  });

  // Rollback to a previous version (records a new revision, does not modify YAML files)
  webhookServer.registerRoute('/api/agents/revisions/rollback', 'POST', async (body) => {
    const { id, version, changedBy } = (body || {}) as {
      id?: string; version?: number; changedBy?: string;
    };
    if (!id) return { error: 'Missing required field: id' };
    if (version === undefined || version === null) return { error: 'Missing required field: version' };
    if (typeof version !== 'number' || version < 1) return { error: 'Invalid version — must be a positive integer' };

    const snapshot = await revisionTracker.getRollbackSnapshot(id, version);
    if (!snapshot) return { error: `Version ${version} not found for agent ${id}` };

    const revision = await revisionTracker.recordRollback(
      id, version, snapshot, changedBy ?? 'manual',
    );
    return {
      revision,
      note: 'Rollback revision recorded. Agent YAML configs live in departments/ (immutable path) — restore via git revert or manual edit, then redeploy.',
    };
  });

  // Recent changes across all agents (incident correlation)
  webhookServer.registerRoute('/api/revisions/recent', 'GET', async (query) => {
    const { since } = (query || {}) as { since?: string };
    if (!since) return { error: 'Missing required parameter: since (ISO date)' };

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) return { error: 'Invalid date format for since parameter' };

    const changes = await revisionTracker.getRecentChanges(sinceDate);
    return { changes, count: changes.length };
  });

  // ─── GitHub Webhook Handler ──────────────────────────────────────────

  const githubHandler = new GitHubWebhookHandler(eventBus, { registry: repoRegistry });

  webhookServer.getExpressApp().post('/github/webhook', async (req: any, res: any) => {
    const eventType = req.headers['x-github-event'] as string | undefined;
    if (!eventType) {
      res.status(400).json({ error: 'Missing X-GitHub-Event header' });
      return;
    }

    const deliveryId = req.headers['x-github-delivery'] as string | undefined;

    try {
      const result = await githubHandler.handleWebhook(eventType, req.body, deliveryId);
      res.json({ success: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('GitHub webhook handler failed', { event: eventType, error: msg });
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
  logger.info('GitHub webhook mounted at /github/webhook');

  // ─── Telegram Webhook Handler ────────────────────────────────────────

  const telegramHandler = new TelegramWebhookHandler(eventBus);
  const telegrafCallback = telegramHandler.getWebhookCallback();
  if (telegrafCallback) {
    webhookServer.getExpressApp().post('/telegram/webhook', telegrafCallback);
    logger.info('Telegram webhook mounted at /telegram/webhook');
  }

  // ─── Slack Webhook Handler ───────────────────────────────────────────

  const slackWebhookHandler = new SlackWebhookHandler(eventBus);

  // Fail-closed: do not register the Slack webhook route if signing secret is missing
  if (!process.env.SLACK_SIGNING_SECRET) {
    logger.warn('SLACK_SIGNING_SECRET not set — /slack/events route NOT registered (fail-closed)');
  } else {
    webhookServer.getExpressApp().post('/slack/events', async (req: any, res: any) => {
      if (req.body?.type === 'url_verification') {
        res.json({ challenge: req.body.challenge });
        return;
      }

      // Hard reject if signature verification fails (not just a logged warning)
      const sigValid = slackWebhookHandler.verifySignature(
        req.rawBody as string,
        req.headers['x-slack-signature'] as string,
        req.headers['x-slack-request-timestamp'] as string,
      );
      if (!sigValid) {
        logger.warn('Slack signature verification failed — rejecting request');
        res.status(401).json({ ok: false, error: 'Invalid Slack signature' });
        return;
      }

      try {
        const result = await slackWebhookHandler.handleWebhook(
          req.body,
          req.rawBody as string,
          req.headers['x-slack-signature'] as string,
          req.headers['x-slack-request-timestamp'] as string,
        );
        res.json({ ok: true, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Slack webhook handler failed', { error: msg });
        res.status(500).json({ ok: false, error: 'Internal server error' });
      }
    });
    logger.info('Slack webhook mounted at /slack/events');
  }

  // ─── Discord Event Handler ───────────────────────────────────────────
  // Unlike Slack, Discord uses a persistent gateway connection (discord.js)
  // rather than HTTP webhooks. The handler registers an in-process listener
  // on the shared DiscordChannelAdapter — no Express route to mount.
  //
  // Guarded by DISCORD_BOT_TOKEN presence: if the token is unset the
  // adapter is never created by InfrastructureFactory, so we skip wiring.
  const discordAdapter = services.infrastructure?.channels.get('discord') as
    | DiscordChannelAdapter
    | undefined;
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.info('Discord event handler skipped — DISCORD_BOT_TOKEN not set');
  } else if (!discordAdapter) {
    logger.warn('Discord event handler skipped — DISCORD_BOT_TOKEN set but no adapter in infrastructure.channels');
  } else {
    const discordHandler = new DiscordEventHandler(eventBus, discordAdapter);
    await discordHandler.start();
    logger.info('Discord event handler started (inbound messages → EventBus)');
  }

  await webhookServer.start();

  // Start Telegram polling after server is listening
  if (process.env.NODE_ENV === 'development' || process.env.TELEGRAM_POLLING === 'true') {
    telegramHandler.startPolling().catch((err) => {
      logger.error('Telegram polling failed to start', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  return { webhookServer, telegramHandler };
}
