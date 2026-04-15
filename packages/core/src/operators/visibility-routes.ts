import type { Express, Request, Response } from 'express';
import { createLogger } from '../logging/logger.js';
import { requireTier } from './middleware.js';
import type { OperatorEventStream } from './event-stream.js';
import type { OperatorRateLimiter } from './rate-limiter.js';
import type { OperatorAuditLogger } from './audit-logger.js';
import type { OperatorStore } from './operator-store.js';
import type { OperatorTaskStore } from './task-model.js';
import type { TaskLockManager } from './task-locks.js';
import type { CrossDeptStore } from './cross-dept.js';
import type { OperatorRequest } from './types.js';

const logger = createLogger('visibility-routes');

export function registerVisibilityRoutes(
  app: Express,
  eventStream: OperatorEventStream,
  auditLogger: OperatorAuditLogger,
  operatorStore: OperatorStore,
  taskStore: OperatorTaskStore,
  lockManager: TaskLockManager | null,
  rateLimiter: OperatorRateLimiter | null,
  crossDeptStore: CrossDeptStore | null,
): void {

  // ─── GET /v1/events (authenticated) ─────────────────────────────────

  app.get('/v1/events', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { since, department, type, limit: limitStr } = req.query as {
        since?: string; department?: string; type?: string; limit?: string;
      };

      let departmentIds: string[] | undefined;
      if (operator.tier !== 'root' && !operator.departments.includes('*')) {
        if (department && !operator.departments.includes(department)) {
          res.status(403).json({ error: `No access to department: ${department}` });
          return;
        }
        departmentIds = department ? [department] : operator.departments;
      } else if (department) {
        departmentIds = [department];
      }

      const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;
      const events = await eventStream.query({ since, departmentIds, type, limit });

      res.json({
        events,
        cursor: events.length > 0 ? events[events.length - 1]!.eventId : since,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to query events', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/operators/activity (root only) ─────────────────────────

  app.get('/v1/operators/activity', requireTier('root'), async (req: Request, res: Response) => {
    try {
      const operators = await operatorStore.listOperators({ status: 'active' });
      const recentActions = await auditLogger.getRecent(20);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);

      const operatorStats = await Promise.all(
        operators.map(async (op) => {
          // Tasks today
          const todayAudit = await auditLogger.queryFiltered({
            operatorId: op.operatorId,
            action: 'task.create',
            from: todayStart,
          });
          // Tasks this week
          const weekAudit = await auditLogger.queryFiltered({
            operatorId: op.operatorId,
            action: 'task.create',
            from: weekStart,
          });
          // Denied requests in last hour
          const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const deniedActions = await auditLogger.queryFiltered({
            operatorId: op.operatorId,
            from: hourAgo,
          });
          const deniedCount = deniedActions.filter((a) => a.decision === 'denied').length;

          // Pending approvals
          let pendingApprovals = 0;
          if (crossDeptStore) {
            const pending = await crossDeptStore.listPending();
            pendingApprovals = pending.filter((r) => r.requestingOperatorId === op.operatorId).length;
          }

          // Active locks
          let activeLocks = 0;
          if (lockManager) {
            const locks = await lockManager.listLocks();
            activeLocks = locks.filter((l) => l.operatorId === op.operatorId).length;
          }

          return {
            operatorId: op.operatorId,
            displayName: op.displayName,
            role: op.role,
            status: op.status,
            lastActiveAt: op.lastActiveAt?.toISOString(),
            stats: {
              tasksToday: todayAudit.length,
              tasksThisWeek: weekAudit.length,
              deniedRequests: deniedCount,
              pendingApprovals,
              activeLocks,
            },
          };
        }),
      );

      // Generate alerts
      const alerts: Array<{ type: string; operatorId: string; message: string }> = [];
      for (const op of operatorStats) {
        if (op.stats.deniedRequests >= 2) {
          alerts.push({
            type: 'high_denial_rate',
            operatorId: op.operatorId,
            message: `${op.stats.deniedRequests} denied requests in the last hour`,
          });
        }
      }

      res.json({
        operators: operatorStats,
        recentActions: recentActions.map((a) => ({
          timestamp: a.timestamp,
          operatorId: a.operatorId,
          action: a.action,
          target: a.resource.id,
          summary: a.reason || a.action,
        })),
        alerts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get operator activity', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/audit (root only) — full filter support ──────────────

  app.get('/v1/audit', requireTier('root'), async (req: Request, res: Response) => {
    try {
      const { operatorId, action, department, from: fromStr, to: toStr, limit: limitStr } = req.query as {
        operatorId?: string; action?: string; department?: string;
        from?: string; to?: string; limit?: string;
      };

      const limit = limitStr ? Math.min(parseInt(limitStr, 10), 500) : 100;
      const from = fromStr ? new Date(fromStr) : undefined;
      const to = toStr ? new Date(toStr) : undefined;

      const entries = await auditLogger.queryFiltered({
        operatorId, action, department, from, to, limit,
      });

      res.json({ entries, count: entries.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to query audit logs', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/health (no auth — exempt in middleware) ──────────────

  app.get('/v1/health', async (_req: Request, res: Response) => {
    try {
      const activeCount = await operatorStore.countByStatus('active');
      const invitedCount = await operatorStore.countByStatus('invited');

      res.json({
        status: 'healthy',
        operators: {
          totalActive: activeCount,
          totalInvited: invitedCount,
          rateLimiterStatus: rateLimiter ? 'connected' : 'disabled',
          lockManagerStatus: lockManager ? 'connected' : 'disabled',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.json({
        status: 'degraded',
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    }
  });

  logger.info('Visibility routes registered (/v1/events, /v1/operators/activity, /v1/audit, /v1/health)');
}
