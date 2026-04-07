export const dynamic = 'force-dynamic';

import { getDb } from '@/lib/mongodb';
import { getRedis, redisPing, getRedisConnectionState, redisZcard } from '@/lib/redis';
import { getGatewayHealth } from '@/lib/openclaw';
import { getPendingApprovalCount } from '@/lib/approvals-queries';

// SSE endpoint — polls MongoDB/Redis every 3s and emits deltas to browser.
// Clients connect via EventSource('/api/events').

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_MS = 15000;

interface AgentStatus {
  agentId: string;
  activeSessions: number;
  lastRunAt?: string;
  lastStatus?: string;
}

interface SystemHealth {
  mongo: boolean;
  redis: boolean;
  redisState: 'connected' | 'reconnecting' | 'disconnected';
  gateway: boolean;
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller may be closed
        }
      };

      // Heartbeat keepalive
      const heartbeat = setInterval(() => send('ping', { ts: Date.now() }), HEARTBEAT_MS);

      // Track previous state for delta detection
      let prevAgentHash = '';
      let prevRunHash = '';
      let prevHealth: SystemHealth = { mongo: false, redis: false, redisState: 'disconnected', gateway: false };
      let prevFleetStatus = '';
      let prevQueueHash = '';
      let prevApprovalsCount = -1;
      let prevSpendHash = '';
      let prevSettingsHash = '';
      let spendPollCounter = 0;

      const poll = async () => {
        try {
          // ── System health ──
          const [db, redisOk, gateway] = await Promise.all([
            getDb(),
            redisPing(),
            getGatewayHealth(),
          ]);
          const health: SystemHealth = {
            mongo: db !== null,
            redis: redisOk,
            redisState: getRedisConnectionState(),
            gateway: gateway !== null,
          };
          if (JSON.stringify(health) !== JSON.stringify(prevHealth)) {
            send('system:health', health);
            prevHealth = health;
          }

          // ── Fleet status ──
          const redis = getRedis();
          if (redis) {
            try {
              const raw = await redis.get('fleet:status');
              const status = raw === 'active' ? 'active' : raw === 'paused' ? 'paused' : 'unknown';
              if (status !== prevFleetStatus) {
                send('fleet:status', { status });
                prevFleetStatus = status;
              }
            } catch {
              if (prevFleetStatus !== 'unknown') {
                send('fleet:status', { status: 'unknown' });
                prevFleetStatus = 'unknown';
              }
            }
          }

          // ── Agent sessions (placeholder — ACP sessions removed) ──
          const agentStatuses: AgentStatus[] = [];
          const agentHash = JSON.stringify(agentStatuses);
          if (agentHash !== prevAgentHash) {
            send('agent:status', agentStatuses);
            prevAgentHash = agentHash;
          }

          // ── Recent runs ──
          if (db) {
            try {
              const runs = await db
                .collection('run_records')
                .find({})
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();

              const runData = runs.map((r) => ({
                agentId: r.agentId as string,
                status: r.status as string,
                createdAt: r.createdAt as string,
                taskId: r.taskId as string | undefined,
                executionId: r.executionId as string | undefined,
                cost: r.cost as { totalUsd?: number } | undefined,
              }));

              const runHash = JSON.stringify(runData);
              if (runHash !== prevRunHash) {
                send('activity:update', runData);
                prevRunHash = runHash;
              }
            } catch {
              // graceful
            }

            // ── Pending approvals count (Fix #3: only emit on change) ──
            try {
              const pendingCount = await getPendingApprovalCount();
              if (pendingCount !== prevApprovalsCount) {
                send('approvals:count', { count: pendingCount });
                prevApprovalsCount = pendingCount;
              }
            } catch {
              // graceful
            }
          }

          // ── Queue counts (O(1) ZCARD instead of O(N) ZRANGE) ──
          try {
            const queueCounts: Record<string, number> = {};
            for (const p of ['P0', 'P1', 'P2', 'P3']) {
              queueCounts[p] = await redisZcard(`builder:task_queue:${p}`);
            }
            const queueHash = JSON.stringify(queueCounts);
            if (queueHash !== prevQueueHash) {
              send('queue:update', queueCounts);
              prevQueueHash = queueHash;
            }
          } catch {
            // graceful
          }

          // ── Spend & settings (every ~15s = 5 poll cycles) ──
          spendPollCounter++;
          if (db && spendPollCounter % 5 === 0) {
            try {
              const month = new Date().toISOString().slice(0, 7);
              const startDate = `${month}-01`;
              const [y, m] = month.split('-').map(Number);
              const nextMonth = m === 12
                ? `${y! + 1}-01-01`
                : `${y}-${String(m! + 1).padStart(2, '0')}-01`;

              const spendDocs = await db
                .collection('org_spend_daily')
                .find({ date: { $gte: startDate, $lt: nextMonth } })
                .toArray();

              const totalUsd = spendDocs.reduce(
                (sum, d) => sum + (Number(d.totalUsd) || 0), 0
              );
              const spendHash = `${month}:${Math.round(totalUsd * 100)}`;
              if (spendHash !== prevSpendHash) {
                send('spend:updated', { month, totalUsd: Math.round(totalUsd * 100) / 100 });
                prevSpendHash = spendHash;
              }
            } catch {
              // graceful
            }

            try {
              const settings = await db
                .collection('org_settings')
                .findOne({ _id: 'global' as any });
              const settingsHash = JSON.stringify(settings ?? {});
              if (settingsHash !== prevSettingsHash) {
                const { _id, ...rest } = settings ?? {} as any;
                send('settings:updated', rest);
                prevSettingsHash = settingsHash;
              }
            } catch {
              // graceful
            }
          }
        } catch {
          // top-level poll error — only emit if health actually changed
          const downHealth: SystemHealth = { mongo: false, redis: false, redisState: getRedisConnectionState(), gateway: false };
          if (JSON.stringify(downHealth) !== JSON.stringify(prevHealth)) {
            send('system:health', downHealth);
            prevHealth = downHealth;
          }
        }
      };

      // Initial poll immediately
      void poll();
      const pollInterval = setInterval(() => void poll(), POLL_INTERVAL_MS);

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        clearInterval(pollInterval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
