/**
 * Observability API routes — authenticated, operator-facing diagnostics.
 *
 * All routes live under /v1/observability/* and require authenticated root operator.
 *
 * Endpoints:
 *   GET /v1/observability/health   — Detailed health (authenticated)
 *   GET /v1/observability/audit    — Audit timeline with cursor pagination
 *   GET /v1/observability/errors   — Recent errors with error codes
 *   GET /v1/observability/summary  — Quick system summary for AI assistants
 */

import type { Express, Request, Response } from 'express';
import type { ServiceContext } from '../bootstrap/services.js';
import type { HealthAggregator } from './health.js';
import { ERROR_CODES, getErrorCode, type ErrorCode } from './error-codes.js';
import { createLogger } from '../logging/logger.js';
import type { Operator } from '../operators/types.js';

const logger = createLogger('observability-routes');

function requireRoot(req: Request, res: Response): Operator | null {
  const operator = (req as Request & { operator?: Operator }).operator;
  if (!operator) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  if (operator.tier !== 'root') {
    res.status(403).json({ error: 'Root operator required' });
    return null;
  }
  return operator;
}

export function registerObservabilityRoutes(
  app: Express,
  services: ServiceContext,
  healthAggregator: HealthAggregator | null,
): void {
  // ─── GET /v1/observability/health — Detailed health (authenticated) ────
  app.get('/v1/observability/health', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;

    try {
      if (!healthAggregator) {
        res.status(503).json({ error: 'Infrastructure not initialized' });
        return;
      }

      // Gather agent/task counts from available stores
      let taskCounts = { pending: 0, running: 0, failedLast24h: 0 };
      if (services.operatorTaskStore) {
        try {
          const db = services.auditLog.getDb();
          if (db) {
            const tasksCol = db.collection('operator_tasks');
            const [pending, running, failed] = await Promise.all([
              tasksCol.countDocuments({ status: 'pending' }),
              tasksCol.countDocuments({ status: 'in_progress' }),
              tasksCol.countDocuments({
                status: 'failed',
                updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
              }),
            ]);
            taskCounts = { pending, running, failedLast24h: failed };
          }
        } catch (err) {
          logger.warn('Failed to gather task counts', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Gather recent errors from execution audit
      const recentErrors: Array<{
        timestamp: string;
        errorCode?: string;
        message: string;
        agentId?: string;
        category?: string;
        severity?: string;
        action?: string;
      }> = [];
      try {
        const db = services.auditLog.getDb();
        if (db) {
          const failedExecs = await db
            .collection('executions')
            .find({ status: 'failed' })
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

          for (const exec of failedExecs) {
            const errorCode = exec.errorCode ? String(exec.errorCode) : undefined;
            const codeEntry = errorCode ? getErrorCode(errorCode) : undefined;
            recentErrors.push({
              timestamp: String(exec.createdAt ?? new Date().toISOString()),
              errorCode,
              message: String(exec.error ?? exec.flag ?? 'Unknown error'),
              agentId: exec.agent ? String(exec.agent) : undefined,
              category: codeEntry?.category,
              severity: codeEntry?.severity,
              action: codeEntry?.action,
            });
          }
        }
      } catch (err) {
        logger.warn('Failed to gather recent errors', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Gather agent counts from run records
      let agentCounts: { total: number; active: number; idle: number; errored: number } | null = null;
      try {
        const db = services.auditLog.getDb();
        if (db) {
          const runsCol = db.collection('run_records');
          const recentCutoff = new Date(Date.now() - 60 * 60 * 1000); // last hour
          const [activeAgents, erroredAgents] = await Promise.all([
            runsCol.distinct('agentId', { status: 'in_progress' }),
            runsCol.distinct('agentId', { status: 'failed', createdAt: { $gte: recentCutoff } }),
          ]);
          // Total agents from config — fall back to active+errored if unknown
          const total = Math.max(activeAgents.length + erroredAgents.length, activeAgents.length);
          agentCounts = {
            total,
            active: activeAgents.length,
            idle: Math.max(0, total - activeAgents.length - erroredAgents.length),
            errored: erroredAgents.length,
          };
        }
      } catch (err) {
        logger.warn('Failed to gather agent counts', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const detailed = await healthAggregator.checkDetailed({
        agentCounts: agentCounts ?? undefined,
        taskCounts,
        recentErrors,
      });

      res.json(detailed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Detailed health check failed', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/observability/audit — Audit timeline with cursor pagination ─
  app.get('/v1/observability/audit', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;

    try {
      if (!services.auditTimeline) {
        res.status(503).json({ error: 'Audit timeline not initialized' });
        return;
      }

      const {
        operatorId,
        agentId,
        correlationId,
        action,
        before: beforeStr,
        limit: limitStr,
      } = req.query as Record<string, string | undefined>;

      // Validate 'before' timestamp
      if (beforeStr) {
        const beforeDate = new Date(beforeStr);
        if (isNaN(beforeDate.getTime())) {
          res.status(400).json({ error: 'Invalid before timestamp' });
          return;
        }
      }

      // Validate 'limit'
      let parsedLimit: number | undefined;
      if (limitStr) {
        parsedLimit = parseInt(limitStr, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1) {
          res.status(400).json({ error: 'Invalid limit — must be a positive integer' });
          return;
        }
      }

      const result = await services.auditTimeline.query({
        operatorId,
        agentId,
        correlationId,
        action,
        before: beforeStr,
        limit: parsedLimit,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Audit timeline query failed', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/observability/errors — Recent errors with codes ─────────────
  app.get('/v1/observability/errors', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;

    try {
      const since = req.query['since'] as string | undefined;
      const limitStr = req.query['limit'] as string | undefined;

      // Validate 'limit'
      let limit = 20;
      if (limitStr) {
        const parsed = parseInt(limitStr, 10);
        if (isNaN(parsed) || parsed < 1) {
          res.status(400).json({ error: 'Invalid limit — must be a positive integer' });
          return;
        }
        limit = Math.min(parsed, 100);
      }

      const errors: Array<{
        timestamp: string;
        errorCode?: string;
        message: string;
        agentId?: string;
        category?: string;
        severity?: string;
        action?: string;
      }> = [];

      const db = services.auditLog.getDb();
      if (db) {
        const query: Record<string, unknown> = { status: 'failed' };
        if (since) {
          const sinceMs = parseSinceDuration(since);
          if (sinceMs > 0) {
            query.createdAt = { $gte: new Date(Date.now() - sinceMs) };
          }
        }

        const failedExecs = await db
          .collection('executions')
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();

        for (const exec of failedExecs) {
          const errorCode = exec.errorCode ? String(exec.errorCode) : undefined;
          const codeEntry = errorCode ? getErrorCode(errorCode) : undefined;
          errors.push({
            timestamp: String(exec.createdAt ?? new Date().toISOString()),
            errorCode,
            message: String(exec.error ?? exec.flag ?? 'Unknown error'),
            agentId: exec.agent ? String(exec.agent) : undefined,
            category: codeEntry?.category,
            severity: codeEntry?.severity,
            action: codeEntry?.action,
          });
        }
      }

      res.json({ errors, count: errors.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Error query failed', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/observability/summary — AI assistant summary ────────────────
  app.get('/v1/observability/summary', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;

    try {
      const ready = healthAggregator ? await healthAggregator.isReady() : false;
      const detailed = healthAggregator
        ? await healthAggregator.checkDetailed()
        : null;

      res.json({
        status: detailed?.status ?? (ready ? 'healthy' : 'unhealthy'),
        uptimeSeconds: Math.floor(process.uptime()),
        ready,
        componentCount: detailed ? Object.keys(detailed.components).length : 0,
        unhealthyComponents: detailed
          ? Object.entries(detailed.components)
              .filter(([, c]) => c.status === 'unhealthy')
              .map(([name]) => name)
          : [],
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Summary query failed', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  logger.info('Observability routes registered at /v1/observability/*');
}

/** Parse a human-friendly duration string (e.g., "1h", "30m", "24h") to milliseconds. */
function parseSinceDuration(since: string): number {
  const match = since.match(/^(\d+)(h|m|d)$/);
  if (!match) return 0;
  const value = parseInt(match[1]!, 10);
  const unit = match[2];
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}
