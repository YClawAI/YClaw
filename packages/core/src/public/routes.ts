/**
 * Public API routes — /public/v1/*
 * Read-only, unauthenticated endpoints for the public showcase.
 * All data passes through the sanitizer before being returned.
 */
import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import type { AgentContext } from '../bootstrap/agents.js';
import type { OperatorEventStream } from '../operators/event-stream.js';
import type { OperatorTaskStore } from '../operators/task-model.js';
import {
  sanitizeEventSummary,
  sanitizeField,
  roundToMinute,
  containsSensitiveContent,
} from './sanitizer.js';

const logger = createLogger('public-routes');

// ─── Rate Limiting (in-memory, per-IP) ──────────────────────────────────────

const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();
const ipSseCounts = new Map<string, number>();
const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_SSE_PER_IP = 5;
const MAX_SSE_TOTAL = 100;
let totalSseConnections = 0;

function getClientIp(req: Request): string {
  return req.ip || 'unknown';
}

function rateLimitCheck(req: Request, res: Response): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  entry.count++;
  if (entry.count > MAX_REQUESTS_PER_MINUTE) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many requests' });
    return true;
  }
  return false;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequestCounts) {
    if (now > entry.resetAt) ipRequestCounts.delete(ip);
  }
}, 5 * 60_000);

// ─── Public Types ───────────────────────────────────────────────────────────

interface PublicAgent {
  name: string;
  role: string;
  department: string;
  status: 'idle' | 'running' | 'error' | 'offline';
}

interface PublicEvent {
  id: string;
  timestamp: string;
  agentName: string;
  type: string;
  summary: string;
}

interface PublicQueueStats {
  pending: number;
  running: number;
  completed24h: number;
  failed24h: number;
}

interface PublicDepartment {
  name: string;
  agentCount: number;
  activeTaskCount: number;
}

interface PublicStatus {
  status: 'operational' | 'degraded' | 'down';
  activeAgents: number;
  totalTasksToday: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toPublicEvent(e: { eventId: string; timestamp: Date; agentId?: string; type: string; summary: string }): PublicEvent {
  return {
    id: e.eventId,
    timestamp: roundToMinute(e.timestamp),
    agentName: sanitizeField(e.agentId, 'system'),
    type: sanitizeField(e.type, 'activity'),
    summary: sanitizeEventSummary(e.summary),
  };
}

// ─── Route Registration ─────────────────────────────────────────────────────

export function registerPublicRoutes(
  app: Express,
  agents: AgentContext,
  eventStream: OperatorEventStream | null,
  taskStore: OperatorTaskStore | null,
): void {
  const { router } = agents;
  const allConfigs = router.getAllConfigs();

  // ─── GET /public/v1/agents ──────────────────────────────────────────

  app.get('/public/v1/agents', (req: Request, res: Response) => {
    if (rateLimitCheck(req, res)) return;

    const agentList: PublicAgent[] = [...allConfigs.entries()].map(([name, config]) => ({
      name: sanitizeField(name, name),
      role: sanitizeField(config.description, 'Agent'),
      department: sanitizeField(config.department, 'unknown'),
      status: 'idle' as const,
    }));

    res.json({ agents: agentList });
  });

  // ─── GET /public/v1/events ──────────────────────────────────────────

  app.get('/public/v1/events', async (req: Request, res: Response) => {
    if (rateLimitCheck(req, res)) return;

    if (!eventStream) {
      res.json({ events: [] });
      return;
    }

    try {
      const events = await eventStream.query({ limit: 50 });
      const publicEvents: PublicEvent[] = events
        .map(toPublicEvent)
        .filter((e) => !containsSensitiveContent(JSON.stringify(e)));

      res.json({ events: publicEvents });
    } catch (err) {
      logger.warn('Public events query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.json({ events: [] });
    }
  });

  // ─── GET /public/v1/events/stream (SSE) ─────────────────────────────
  // Polls the event stream DB every 5s and pushes new events to connected clients.

  app.get('/public/v1/events/stream', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const ipCount = ipSseCounts.get(ip) || 0;

    if (ipCount >= MAX_SSE_PER_IP || totalSseConnections >= MAX_SSE_TOTAL) {
      res.status(429).json({ error: 'Too many SSE connections' });
      return;
    }

    ipSseCounts.set(ip, ipCount + 1);
    totalSseConnections++;

    res.set('Content-Type', 'text/event-stream');
    res.set('Cache-Control', 'no-cache');
    res.set('Connection', 'keep-alive');
    res.set('X-Accel-Buffering', 'no');
    res.status(200);

    // Access the underlying writable stream for SSE
    const raw = res as unknown as { write(chunk: string): boolean };

    let lastEventId = '';
    let closed = false;

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      if (!closed) raw.write(':keepalive\n\n');
    }, 15_000);

    // Poll for new events every 5s
    const poll = setInterval(async () => {
      if (closed || !eventStream) return;
      try {
        const events = await eventStream.query({ since: lastEventId || undefined, limit: 10 });
        for (const e of events) {
          const pub = toPublicEvent(e);
          if (!containsSensitiveContent(JSON.stringify(pub))) {
            raw.write(`data: ${JSON.stringify(pub)}\n\n`);
          }
          lastEventId = e.eventId;
        }
      } catch {
        // Silently skip poll failures
      }
    }, 5_000);

    // Cleanup on disconnect
    res.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      const current = ipSseCounts.get(ip) || 1;
      if (current <= 1) ipSseCounts.delete(ip);
      else ipSseCounts.set(ip, current - 1);
      totalSseConnections--;
    });
  });

  // ─── GET /public/v1/queue/stats ─────────────────────────────────────

  app.get('/public/v1/queue/stats', async (req: Request, res: Response) => {
    if (rateLimitCheck(req, res)) return;

    if (!taskStore) {
      res.json({ pending: 0, running: 0, completed24h: 0, failed24h: 0 });
      return;
    }

    try {
      const [pending, running, completed, failed] = await Promise.all([
        taskStore.listTasks({ status: 'queued', limit: 0 }).then((r) => r.total),
        taskStore.listTasks({ status: 'running', limit: 0 }).then((r) => r.total),
        taskStore.listTasks({ status: 'completed', limit: 0 }).then((r) => r.total),
        taskStore.listTasks({ status: 'failed', limit: 0 }).then((r) => r.total),
      ]);

      const stats: PublicQueueStats = {
        pending,
        running,
        completed24h: completed,
        failed24h: failed,
      };
      res.json(stats);
    } catch (err) {
      logger.warn('Public queue stats failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.json({ pending: 0, running: 0, completed24h: 0, failed24h: 0 });
    }
  });

  // ─── GET /public/v1/departments ─────────────────────────────────────

  app.get('/public/v1/departments', (req: Request, res: Response) => {
    if (rateLimitCheck(req, res)) return;

    const deptMap = new Map<string, number>();
    for (const [, config] of allConfigs) {
      deptMap.set(config.department, (deptMap.get(config.department) || 0) + 1);
    }

    const departments: PublicDepartment[] = [...deptMap.entries()].map(([name, count]) => ({
      name,
      agentCount: count,
      activeTaskCount: 0,
    }));

    res.json({ departments });
  });

  // ─── GET /public/v1/status ──────────────────────────────────────────

  app.get('/public/v1/status', (req: Request, res: Response) => {
    if (rateLimitCheck(req, res)) return;

    const status: PublicStatus = {
      status: 'operational',
      activeAgents: allConfigs.size,
      totalTasksToday: 0,
    };

    res.json(status);
  });

  logger.info(`Public routes registered: ${allConfigs.size} agents exposed`);
}
