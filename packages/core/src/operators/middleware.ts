import type { Request, Response, NextFunction } from 'express';
import type { Redis as IORedis } from 'ioredis';
import { createLogger } from '../logging/logger.js';
import { extractKeyPrefix, verifyApiKey } from './api-keys.js';
import type { OperatorStore } from './operator-store.js';
import type { OperatorAuditLogger } from './audit-logger.js';
import type { OperatorRateLimiter } from './rate-limiter.js';
import type { Operator, OperatorTier } from './types.js';
import { TIER_HIERARCHY } from './types.js';

const logger = createLogger('operator-auth');

const CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_PREFIX = 'op:prefix:';

// Paths that are never subject to operator auth (they have their own auth or are public)
const AUTH_EXEMPT_PATHS = new Set(['/health', '/v1/health']);
const AUTH_EXEMPT_PREFIXES = ['/github/', '/slack/', '/telegram'];

// Tailscale CGNAT range: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
function isTailscaleIP(ip: string): boolean {
  if (!ip) return false;
  // Handle comma-separated X-Forwarded-For
  const firstIp = ip.split(',')[0]!.trim();
  const parts = firstIp.split('.');
  if (parts.length !== 4) return false;
  const first = parseInt(parts[0]!, 10);
  const second = parseInt(parts[1]!, 10);
  return first === 100 && second >= 64 && second <= 127;
}

/**
 * Tailscale network boundary middleware. Rejects requests not from Tailscale IP range.
 * Skipped in development mode (NODE_ENV !== 'production').
 */
export function createTailscaleMiddleware() {
  const IS_PRODUCTION = process.env.NODE_ENV === 'production';

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!IS_PRODUCTION) {
      next();
      return;
    }

    // Skip for paths with their own auth (webhooks)
    if (isExemptPath(req.path)) {
      next();
      return;
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    if (!isTailscaleIP(ip)) {
      res.status(403).json({ error: 'Access restricted to Tailscale network' });
      return;
    }

    next();
  };
}

function isExemptPath(path: string): boolean {
  if (AUTH_EXEMPT_PATHS.has(path)) return true;
  return AUTH_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Creates the primary auth middleware for operator authentication.
 * Must be mounted globally (NOT path-scoped) so req.path is the full path.
 *
 * Behavior:
 * - Exempt paths (health, github, slack, telegram): skip entirely
 * - POST /v1/operators/accept-invite: skip (invite token IS the auth)
 * - /v1/* routes: auth REQUIRED (401 without Bearer token)
 * - /api/* routes: auth OPTIONAL — if no Bearer token, inject root operator (backward compat)
 */
export function createAuthMiddleware(
  operatorStore: OperatorStore,
  auditLogger: OperatorAuditLogger,
  redis: IORedis | null,
  rootOperatorId: string,
  rateLimiter?: OperatorRateLimiter | null,
) {
  // Root operator record cached at startup for legacy route injection
  let cachedRootOperator: Operator | null = null;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip exempt paths
    if (isExemptPath(req.path)) {
      next();
      return;
    }

    const isV1Route = req.path.startsWith('/v1/');
    const isAcceptInvite = req.path === '/v1/operators/accept-invite' && req.method === 'POST';

    // Accept-invite doesn't require auth (the invite token IS the auth)
    if (isAcceptInvite) {
      next();
      return;
    }

    const authHeader = req.headers.authorization as string | undefined;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    // No auth header
    if (!bearerToken) {
      if (isV1Route) {
        logDenied(auditLogger, 'anonymous', req, 'Missing Authorization header');
        res.status(401).json({ error: 'Missing Authorization: Bearer <api_key> header' });
        return;
      }
      // Legacy /api/* route — inject root operator for attribution
      if (!cachedRootOperator) {
        cachedRootOperator = await operatorStore.getByOperatorId(rootOperatorId);
      }
      if (cachedRootOperator) {
        (req as any).operator = cachedRootOperator;
      }
      next();
      return;
    }

    // Extract prefix from key
    const prefix = extractKeyPrefix(bearerToken);
    if (!prefix) {
      logDenied(auditLogger, 'anonymous', req, 'Invalid API key format');
      res.status(401).json({ error: 'Invalid API key format' });
      return;
    }

    // Look up operator by prefix (check Redis cache first)
    let operator: Operator | null = null;

    if (redis) {
      try {
        const cached = await redis.get(`${CACHE_PREFIX}${prefix}`);
        if (cached) {
          operator = await operatorStore.getByOperatorId(cached);
        }
      } catch {
        // Cache miss or Redis error — fall through to DB
      }
    }

    if (!operator) {
      operator = await operatorStore.getByApiKeyPrefix(prefix);
    }

    if (!operator) {
      logDenied(auditLogger, 'unknown', req, 'API key prefix not found');
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // Verify full key hash (async argon2id)
    if (!await verifyApiKey(bearerToken, operator.apiKeyHash)) {
      logDenied(auditLogger, operator.operatorId, req, 'API key hash mismatch');
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // Check operator status
    if (operator.status !== 'active') {
      const statusMsg = operator.status === 'revoked' ? 'revoked' : 'suspended';
      logDenied(auditLogger, operator.operatorId, req, `Operator ${statusMsg}`);
      res.status(403).json({ error: `Operator access ${statusMsg}` });
      return;
    }

    // Cache operator lookup for next requests
    if (redis) {
      redis.set(`${CACHE_PREFIX}${prefix}`, operator.operatorId, 'EX', CACHE_TTL_SECONDS).catch(() => {});
    }

    // Rate limit check — only on task-submission endpoints (POST /v1/tasks)
    // Skip for root and for read-only/cancel/approval endpoints
    const isTaskSubmission = req.path === '/v1/tasks' && req.method === 'POST';
    if (rateLimiter && operator.tier !== 'root' && isTaskSubmission) {
      const limitResult = await rateLimiter.checkLimit(operator.operatorId, operator.limits);
      if (!limitResult.allowed) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfterMs: limitResult.retryAfterMs,
          limit: limitResult.reason,
        });
        return;
      }
    }

    // Attach operator to request
    (req as any).operator = operator;

    // Fire-and-forget lastActiveAt update
    operatorStore.updateLastActive(operator.operatorId);

    next();
  };
}

/**
 * Audit middleware — logs every request after response completes.
 * Mount after auth middleware so req.operator is populated.
 */
export function createAuditMiddleware(auditLogger: OperatorAuditLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip exempt paths (health checks, webhooks with their own logging)
    if (isExemptPath(req.path)) {
      next();
      return;
    }

    const start = Date.now();

    // Hook into response finish event
    res.on('finish', () => {
      const operator = (req as any).operator as Operator | undefined;
      if (!operator) return; // No operator = unauthenticated exempt path

      const statusCode = (res as any).statusCode as number | undefined;
      const decision = statusCode && statusCode >= 400 ? 'denied' as const : 'allowed' as const;

      // Derive action from method + path
      const action = deriveAction(req.method, req.path);

      auditLogger.log({
        timestamp: new Date(),
        operatorId: operator.operatorId,
        action,
        resource: { type: deriveResourceType(req.path), id: req.path },
        request: {
          method: req.method,
          path: req.path,
          ip: getIp(req),
        },
        decision,
      });
    });

    next();
  };
}

/** Middleware: require minimum tier level. */
export function requireTier(minimumTier: OperatorTier) {
  const minLevel = TIER_HIERARCHY[minimumTier];

  return (req: Request, res: Response, next: NextFunction): void => {
    const operator = (req as any).operator as Operator | undefined;
    if (!operator) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const operatorLevel = TIER_HIERARCHY[operator.tier];
    if (operatorLevel < minLevel) {
      res.status(403).json({ error: `Requires ${minimumTier} tier or higher` });
      return;
    }

    next();
  };
}

/** Middleware: require access to a specific department (from route param or query). */
export function requireDepartment(paramName = 'department') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const operator = (req as any).operator as Operator | undefined;
    if (!operator) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Root has access to everything
    if (operator.departments.includes('*')) {
      next();
      return;
    }

    const department = req.params?.[paramName] || req.query?.[paramName] || req.body?.[paramName];
    if (!department) {
      next(); // No department to check — let the route handler deal with filtering
      return;
    }

    if (!operator.departments.includes(department as string)) {
      res.status(403).json({ error: `No access to department: ${department}` });
      return;
    }

    next();
  };
}

/** Clear Redis auth cache for an operator (used on revocation/key rotation). */
export async function clearOperatorCache(redis: IORedis | null, prefix: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(`${CACHE_PREFIX}${prefix}`);
  } catch (err) {
    logger.warn('Failed to clear operator cache', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
}

function logDenied(
  auditLogger: OperatorAuditLogger,
  operatorId: string,
  req: Request,
  reason: string,
): void {
  auditLogger.log({
    timestamp: new Date(),
    operatorId,
    action: 'auth.denied',
    resource: { type: 'api', id: req.path },
    request: {
      method: req.method,
      path: req.path,
      ip: getIp(req),
    },
    decision: 'denied',
    reason,
  });
}

function deriveAction(method: string, path: string): string {
  // /v1/operators/invite → operator.invite
  // /api/trigger → api.trigger
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[0]}.${segments.slice(1).join('.')}`;
  }
  return `${method.toLowerCase()}.${path}`;
}

function deriveResourceType(path: string): string {
  if (path.startsWith('/v1/operators')) return 'operator';
  if (path.startsWith('/v1/tasks')) return 'task';
  if (path.startsWith('/api/agents')) return 'agent';
  if (path.startsWith('/api/trigger')) return 'execution';
  return 'api';
}
