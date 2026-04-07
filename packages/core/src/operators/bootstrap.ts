/**
 * Root operator bootstrap endpoint.
 *
 * POST /v1/operators/bootstrap
 * - Requires Authorization: Bearer <YCLAW_SETUP_TOKEN>
 * - Only works when zero operators exist in the database
 * - Creates a root operator with full access
 * - Returns the API key (shown once)
 * - Self-disables after first use (409 forever)
 * - Rate limited to 3 attempts to prevent brute-force
 */

import type { Express, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import { generateApiKey } from './api-keys.js';
import type { OperatorStore } from './operator-store.js';
import type { Operator } from './types.js';
import { TIER_HIERARCHY } from './types.js';

const logger = createLogger('operator-bootstrap');

const MAX_ATTEMPTS = 3;

interface BootstrapState {
  attempts: number;
  locked: boolean;
}

export function registerBootstrapRoute(
  app: Express,
  operatorStore: OperatorStore,
): void {
  const setupToken = process.env.YCLAW_SETUP_TOKEN?.trim();

  if (!setupToken || setupToken.length < 32) {
    logger.info('Bootstrap route disabled — YCLAW_SETUP_TOKEN not set or too short');
    return;
  }

  const state: BootstrapState = { attempts: 0, locked: false };

  app.post('/v1/operators/bootstrap', async (req: Request, res: Response) => {
    try {
      // Rate limit check
      if (state.locked) {
        res.status(429).json({
          error: 'Bootstrap locked',
          message: 'Too many failed attempts. Restart the service to retry.',
        });
        return;
      }

      // Validate setup token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        state.attempts++;
        if (state.attempts >= MAX_ATTEMPTS) state.locked = true;
        res.status(401).json({ error: 'Authorization header required (Bearer <YCLAW_SETUP_TOKEN>)' });
        return;
      }

      const providedToken = authHeader.slice(7);

      // Timing-safe comparison to prevent timing attacks
      const tokenBuffer = Buffer.from(setupToken, 'utf-8');
      const providedBuffer = Buffer.from(providedToken, 'utf-8');

      let tokenMatch = false;
      if (tokenBuffer.length === providedBuffer.length) {
        tokenMatch = timingSafeEqual(tokenBuffer, providedBuffer);
      }

      if (!tokenMatch) {
        state.attempts++;
        if (state.attempts >= MAX_ATTEMPTS) state.locked = true;
        logger.warn('Bootstrap attempt with invalid token', {
          attempt: state.attempts,
          locked: state.locked,
        });
        res.status(403).json({ error: 'Invalid setup token' });
        return;
      }

      // Check if operators already exist (atomic: count is fast on indexed collection)
      const existingCount = await operatorStore.countOperators();
      if (existingCount > 0) {
        res.status(409).json({
          error: 'Operators already exist',
          message: 'Bootstrap is only available on fresh deployments.',
        });
        return;
      }

      // Parse optional body fields
      const displayName = typeof req.body?.displayName === 'string'
        ? req.body.displayName
        : 'Root Operator';
      const email = typeof req.body?.email === 'string'
        ? req.body.email
        : 'root@localhost';

      // Generate credentials
      const { key: apiKey, prefix: apiKeyPrefix, hash: apiKeyHash } = await generateApiKey();
      // Deterministic operatorId — unique index on operatorId prevents TOCTOU race.
      // If two concurrent requests both pass the count check, the second insertOne
      // fails with duplicate key error (caught below).
      const operatorId = 'op_root';

      const now = new Date();
      const rootOperator: Operator = {
        operatorId,
        displayName,
        role: 'root',
        email,
        apiKeyHash,
        apiKeyPrefix,
        tailscaleIPs: [],
        tier: 'root',
        roleIds: ['role_root'],
        departments: ['*'],
        priorityClass: TIER_HIERARCHY.root,
        crossDeptPolicy: 'request',
        limits: {
          requestsPerMinute: 120,
          maxConcurrentTasks: 10,
          dailyTaskQuota: 500,
        },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      // Atomic insert — unique constraint on operatorId prevents race conditions.
      // If two concurrent requests pass the count check, the second insertOne fails.
      await operatorStore.createOperator(rootOperator);

      logger.info('Root operator bootstrapped', { operatorId });

      res.status(201).json({
        operatorId,
        apiKey,
        displayName,
        email,
        tier: 'root',
        departments: ['*'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Duplicate key = race condition, another request won
      if (msg.includes('duplicate key') || msg.includes('E11000')) {
        res.status(409).json({
          error: 'Operators already exist',
          message: 'Bootstrap completed by another request.',
        });
        return;
      }
      logger.error('Bootstrap failed', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  logger.info('Bootstrap route registered at POST /v1/operators/bootstrap');
}
