/**
 * Core Auth Facade — server-only entry point for Mission Control auth.
 *
 * This is the ONLY auth export from @yclaw/core that MC should import.
 * It wraps OperatorStore, PermissionEngine, AuditLogger, and RoleStore
 * behind a narrow 5-function API.
 *
 * Lazy singleton: first call initializes MongoDB (and optionally Redis).
 * Subsequent calls return the cached instance.
 */

// Guard: fail fast if accidentally imported in a browser/Edge environment
if ('window' in globalThis) {
  throw new Error('@yclaw/core/auth/server must only be imported in a Node.js server environment');
}

import { MongoClient } from 'mongodb';
import { createLogger } from '../logging/logger.js';
import { extractKeyPrefix, verifyApiKey } from '../operators/api-keys.js';
import { OperatorStore } from '../operators/operator-store.js';
import { OperatorAuditLogger } from '../operators/audit-logger.js';
import { RoleStore } from '../operators/roles.js';
import { evaluatePermission } from '../operators/permission-engine.js';
import { TIER_HIERARCHY } from '../operators/types.js';
import type {
  AuthFacade,
  AuthFacadeConfig,
  OperatorIdentity,
  OperatorState,
  OperatorContext,
  PermissionResult,
  ResourceTarget,
  AuditEvent,
} from './types.js';

export type {
  AuthFacade,
  AuthFacadeConfig,
  OperatorIdentity,
  OperatorState,
  OperatorContext,
  PermissionResult,
  ResourceTarget,
  AuditEvent,
} from './types.js';

const logger = createLogger('auth-facade');

// ─── Lazy Singleton ─────────────────────────────────────────────────────────

let cachedFacade: AuthFacade | null = null;
let initPromise: Promise<AuthFacade> | null = null;

/**
 * Get the auth facade singleton. First call initializes connections;
 * subsequent calls return the same instance.
 *
 * This is safe for Next.js API routes — no "startup hook" required.
 * Connection pooling is handled by MongoClient internally.
 */
export function getAuthFacade(config?: AuthFacadeConfig): Promise<AuthFacade> {
  if (cachedFacade) return Promise.resolve(cachedFacade);
  if (initPromise) return initPromise;

  initPromise = initializeFacade(config ?? {}).then((facade) => {
    cachedFacade = facade;
    return facade;
  }).catch((err) => {
    // Reset so next call retries instead of returning stale rejected promise
    initPromise = null;
    throw err;
  });

  return initPromise;
}

// ─── Redis Cache (optional) ─────────────────────────────────────────────────

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

const CACHE_PREFIX = 'mc:op:';

async function connectRedis(url: string): Promise<RedisLike | null> {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry — degrade gracefully
      lazyConnect: true,
      connectTimeout: 3000,
    });
    await redis.connect();
    logger.info('Auth facade Redis connected');
    return redis as unknown as RedisLike;
  } catch {
    logger.warn('Auth facade Redis unavailable — operating without cache');
    return null;
  }
}

// ─── Initialization ─────────────────────────────────────────────────────────

async function initializeFacade(config: AuthFacadeConfig): Promise<AuthFacade> {
  const mongoUri = config.mongoUri ?? process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error(
      'Auth facade requires MONGODB_URI. Set it in the environment or pass mongoUri in config.',
    );
  }

  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 5,
  });
  await client.connect();
  const db = client.db();

  const operatorStore = new OperatorStore(db);
  const auditLogger = new OperatorAuditLogger(db);
  const roleStore = new RoleStore(db);

  // Ensure indexes (idempotent)
  await Promise.all([
    operatorStore.ensureIndexes(),
    auditLogger.ensureIndexes(),
    roleStore.ensureIndexes(),
  ]);

  // Optional Redis cache
  const redisUrl = config.redisUrl ?? process.env.REDIS_URL;
  const redis = redisUrl ? await connectRedis(redisUrl) : null;
  const cacheTtl = config.cacheTtlSeconds ?? 300;

  logger.info('Auth facade initialized');

  return createFacade(operatorStore, auditLogger, roleStore, redis, cacheTtl);
}

// ─── Facade Implementation ──────────────────────────────────────────────────

function createFacade(
  operatorStore: OperatorStore,
  auditLogger: OperatorAuditLogger,
  roleStore: RoleStore,
  redis: RedisLike | null,
  cacheTtl: number,
): AuthFacade {
  return {
    async validateOperatorKey(key: string): Promise<OperatorIdentity | null> {
      // Extract prefix from gzop_live_* key
      const prefix = extractKeyPrefix(key);
      if (!prefix) return null;

      // Look up operator by prefix
      const operator = await operatorStore.getByApiKeyPrefix(prefix);
      if (!operator) return null;

      // Verify full key hash (argon2id — timing-safe by design)
      const valid = await verifyApiKey(key, operator.apiKeyHash);
      if (!valid) return null;

      // Check status
      if (operator.status !== 'active') return null;

      // Update lastActiveAt (fire-and-forget)
      operatorStore.updateLastActive(operator.operatorId);

      return {
        operatorId: operator.operatorId,
        displayName: operator.displayName,
        email: operator.email,
        tier: operator.tier,
        departments: operator.departments,
        roleIds: operator.roleIds,
        status: operator.status,
      };
    },

    async checkPermission(
      operatorId: string,
      action: string,
      resource: ResourceTarget,
    ): Promise<PermissionResult> {
      // FAIL-CLOSED: any backend failure = deny
      try {
        // Always check live operator state — not stale JWT claims
        const operator = await getOperatorFromCacheOrDb(
          operatorStore, redis, operatorId, cacheTtl,
        );

        if (!operator) {
          return { allowed: false, reason: 'Operator not found' };
        }

        if (operator.status !== 'active') {
          // Invalidate cache on status change detection
          await invalidateCache(redis, operatorId);
          return { allowed: false, reason: `Operator ${operator.status}` };
        }

        // Resolve roles
        const roles = await Promise.all(
          operator.roleIds.map((id) => roleStore.getByRoleId(id)),
        );
        const validRoles = roles.filter((r): r is NonNullable<typeof r> => r !== null);

        const result = evaluatePermission(operator, validRoles, {
          operatorId,
          action,
          resourceType: resource.type,
          resourceId: resource.id,
        });

        return {
          allowed: result.allowed,
          reason: result.reason,
        };
      } catch (err) {
        logger.error('checkPermission failed — denying access (fail-closed)', {
          operatorId,
          action,
          error: err instanceof Error ? err.message : String(err),
        });
        return { allowed: false, reason: 'Permission check failed (infrastructure error)' };
      }
    },

    async getOperatorState(operatorId: string): Promise<OperatorState | null> {
      // FAIL-CLOSED: if we can't reach the DB, return null (caller must deny)
      try {
        const operator = await operatorStore.getByOperatorId(operatorId);
        if (!operator) return null;

        return {
          status: operator.status,
          tier: operator.tier,
          departments: operator.departments,
          roleIds: operator.roleIds,
        };
      } catch (err) {
        logger.error('getOperatorState failed — denying access (fail-closed)', {
          operatorId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },

    async recordAudit(operatorId: string, event: AuditEvent): Promise<void> {
      auditLogger.log({
        timestamp: new Date(),
        operatorId,
        action: event.action,
        resource: event.resource,
        request: event.request ?? { method: 'INTERNAL', path: '', ip: 'internal' },
        decision: event.decision,
        reason: event.reason,
      });
    },

    async invalidateOperatorCache(operatorId: string): Promise<void> {
      await invalidateCache(redis, operatorId);
    },

    async createOperatorContext(operatorId: string): Promise<OperatorContext | null> {
      const operator = await operatorStore.getByOperatorId(operatorId);
      if (!operator || operator.status !== 'active') return null;

      return {
        operatorId: operator.operatorId,
        tier: operator.tier,
        departments: operator.departments,
        headers: {
          'X-Operator-Id': operator.operatorId,
          'X-Operator-Tier': operator.tier,
          'X-Operator-Departments': operator.departments.join(','),
        },
      };
    },
  };
}

// ─── Cache Helpers ──────────────────────────────────────────────────────────

async function invalidateCache(redis: RedisLike | null, operatorId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(`${CACHE_PREFIX}${operatorId}`);
  } catch {
    // Best-effort — Redis failure shouldn't block the operation
  }
}

async function getOperatorFromCacheOrDb(
  operatorStore: OperatorStore,
  redis: RedisLike | null,
  operatorId: string,
  cacheTtl: number,
): Promise<Awaited<ReturnType<OperatorStore['getByOperatorId']>>> {
  if (redis) {
    try {
      const cached = await redis.get(`${CACHE_PREFIX}${operatorId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Cache miss — fall through to DB
    }
  }

  const operator = await operatorStore.getByOperatorId(operatorId);

  if (operator && redis) {
    redis.set(`${CACHE_PREFIX}${operatorId}`, JSON.stringify(operator), 'EX', cacheTtl).catch(() => {});
  }

  return operator;
}
