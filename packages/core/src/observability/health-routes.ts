/**
 * Health check routes — liveness and readiness.
 *
 * GET /health       — Liveness: always 200 if server is running
 * GET /health/ready — Readiness: 200 if critical deps available, 503 otherwise
 *
 * These are registered BEFORE auth middleware (unauthenticated).
 * The detailed health endpoint lives at /v1/observability/health
 * (authenticated, registered in observability-routes.ts).
 */

import type { Express, Request, Response } from 'express';
import type { HealthAggregator } from './health.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('health-routes');

export function registerHealthRoutes(
  app: Express,
  healthAggregator: HealthAggregator | null,
): void {
  // GET /health — Liveness
  // Always returns 200 if the process is alive. No dependency checks.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'alive', timestamp: new Date().toISOString() });
  });

  // GET /health/ready — Readiness
  // Returns 200 if critical dependencies (stateStore, eventBus) are available.
  app.get('/health/ready', async (_req: Request, res: Response) => {
    if (!healthAggregator) {
      // No infrastructure — can't check readiness
      res.status(503).json({ ready: false, reason: 'Infrastructure not initialized' });
      return;
    }
    try {
      const ready = await healthAggregator.isReady();
      if (ready) {
        res.json({ ready: true, timestamp: new Date().toISOString() });
      } else {
        res.status(503).json({ ready: false, timestamp: new Date().toISOString() });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Readiness check failed', { error: msg });
      res.status(503).json({ ready: false, error: 'Readiness check failed', timestamp: new Date().toISOString() });
    }
  });

  logger.info('Health routes registered (/health, /health/ready)');
}
