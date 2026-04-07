import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import type { AgentCostEvent } from './types.js';
import { computeCostMillicents, millicentsToDisplayCents } from './model-pricing.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('cost-tracker');

const COLLECTION_NAME = 'agent_cost_events';
const TTL_DAYS = 90;

export class CostTracker {
  private db: Db | null;
  private redis: Redis | null;
  private initialized = false;

  constructor(db: Db | null, redis: Redis | null) {
    this.db = db;
    this.redis = redis;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.db) {
      try {
        const col = this.db.collection(COLLECTION_NAME);
        await col.createIndex({ agentId: 1, timestamp: -1 });
        await col.createIndex({ department: 1, timestamp: -1 });
        await col.createIndex(
          { timestamp: 1 },
          { expireAfterSeconds: TTL_DAYS * 86400 },
        );
        logger.info('Cost events collection initialized with TTL index');
      } catch (err) {
        logger.warn(`Cost events index creation failed (non-fatal): ${err}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Record a cost event after an LLM response.
   * Increments Redis counters synchronously, writes MongoDB async (fire-and-forget).
   *
   * Redis key naming:
   *   cost:daily:{agentId}:{YYYY-MM-DD}   — 48h TTL
   *   cost:monthly:{agentId}:{YYYY-MM}    — 35d TTL
   *
   * Counters are stored in integer cents (ceiling of millicents/1000) for
   * compatibility with budget limits. The full-precision millicents value is
   * stored in MongoDB for accurate historical reporting.
   */
  async record(params: {
    agentId: string;
    department: string;
    taskType: string;
    executionId: string;
    modelId: string;
    provider: 'anthropic' | 'openrouter' | 'ollama';
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    latencyMs: number;
  }): Promise<void> {
    // Use millicents internally to avoid undercounting small calls, then ceil to cents
    const costMillicents = computeCostMillicents(
      params.modelId,
      params.inputTokens,
      params.outputTokens,
      params.cacheReadTokens,
      params.cacheWriteTokens,
    );
    const costCents = millicentsToDisplayCents(costMillicents);

    const event: AgentCostEvent = {
      ...params,
      costMillicents,
      costCents,
      timestamp: new Date().toISOString(),
    };

    // Redis hot counters (fast, synchronous-ish)
    // Store in cents for budget comparison; millicents precision is in MongoDB.
    if (this.redis && costCents > 0) {
      try {
        const now = new Date();
        const dayKey = `cost:daily:${params.agentId}:${now.toISOString().slice(0, 10)}`;
        const monthKey = `cost:monthly:${params.agentId}:${now.toISOString().slice(0, 7)}`;

        const pipeline = this.redis.pipeline();
        pipeline.incrby(dayKey, costCents);
        pipeline.expire(dayKey, 48 * 3600); // 48h TTL
        pipeline.incrby(monthKey, costCents);
        pipeline.expire(monthKey, 35 * 86400); // 35d TTL
        await pipeline.exec();
      } catch (err) {
        logger.warn(`Redis counter update failed (non-fatal): ${err}`);
      }
    }

    // MongoDB persistent store (fire-and-forget)
    // timestamp stored as Date for TTL index and proper date arithmetic
    if (this.db) {
      this.db.collection(COLLECTION_NAME).insertOne({
        ...event,
        timestamp: new Date(event.timestamp), // Store as Date for TTL index and proper sorting
      }).catch(err => {
        logger.warn(`Cost event insert failed (non-fatal): ${err}`);
      });
    }

    if (costCents > 0) {
      logger.debug(
        `Cost recorded: ${params.agentId}/${params.taskType} — ${costCents}¢ ` +
        `(${params.inputTokens} in, ${params.outputTokens} out, ` +
        `${params.cacheReadTokens} cached read, model=${params.modelId})`,
      );
    }
  }

  /**
   * Get current daily spend for an agent from Redis.
   */
  async getDailySpendCents(agentId: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const dayKey = `cost:daily:${agentId}:${new Date().toISOString().slice(0, 10)}`;
      const val = await this.redis.get(dayKey);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get current monthly spend for an agent from Redis.
   */
  async getMonthlySpendCents(agentId: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const monthKey = `cost:monthly:${agentId}:${new Date().toISOString().slice(0, 7)}`;
      const val = await this.redis.get(monthKey);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get total fleet-wide daily spend in cents across all agents.
   * Uses Redis SCAN to sum all daily cost keys, cached with 60s TTL.
   */
  async getFleetDailySpendCents(): Promise<number> {
    if (!this.redis) return 0;
    try {
      const cacheKey = `cost:fleet_daily:${new Date().toISOString().slice(0, 10)}`;
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return parseInt(cached, 10);

      const today = new Date().toISOString().slice(0, 10);
      const pattern = `cost:daily:*:${today}`;
      let total = 0;
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          const values = await this.redis.mget(...keys);
          for (const v of values) {
            if (v) total += parseInt(v, 10);
          }
        }
      } while (cursor !== '0');

      // Cache for 60s
      await this.redis.set(cacheKey, String(total), 'EX', 60);
      return total;
    } catch {
      return 0;
    }
  }

  /**
   * Get total fleet-wide monthly spend in cents across all agents.
   * Uses Redis SCAN to sum all monthly cost keys, cached with 60s TTL.
   */
  async getFleetMonthlySpendCents(): Promise<number> {
    if (!this.redis) return 0;
    try {
      const cacheKey = `cost:fleet_monthly:${new Date().toISOString().slice(0, 7)}`;
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return parseInt(cached, 10);

      const month = new Date().toISOString().slice(0, 7);
      const pattern = `cost:monthly:*:${month}`;
      let total = 0;
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          const values = await this.redis.mget(...keys);
          for (const v of values) {
            if (v) total += parseInt(v, 10);
          }
        }
      } while (cursor !== '0');

      // Cache for 60s
      await this.redis.set(cacheKey, String(total), 'EX', 60);
      return total;
    } catch {
      return 0;
    }
  }

  /**
   * Query cost events from MongoDB for the /api/costs endpoint.
   *
   * Uses a MongoDB aggregation pipeline for accurate totals regardless of
   * event count. The `.limit(1000)` on the raw events list is for the response
   * payload only; aggregated totals (totalCents, byAgent, byDepartment, byDay)
   * are computed server-side across all matching documents.
   */
  async queryCosts(params: {
    agentId?: string;
    department?: string;
    from?: Date;
    to?: Date;
  }): Promise<{
    events: AgentCostEvent[];
    totalCents: number;
    byAgent: Record<string, number>;
    byDepartment: Record<string, number>;
    byDay: Record<string, number>;
    truncated: boolean;
    totalEvents: number;
  }> {
    if (!this.db) {
      return {
        events: [],
        totalCents: 0,
        byAgent: {},
        byDepartment: {},
        byDay: {},
        truncated: false,
        totalEvents: 0,
      };
    }

    const matchFilter: Record<string, unknown> = {};
    if (params.agentId) matchFilter.agentId = params.agentId;
    if (params.department) matchFilter.department = params.department;
    if (params.from ?? params.to) {
      matchFilter.timestamp = {};
      if (params.from) (matchFilter.timestamp as Record<string, unknown>).$gte = params.from;
      if (params.to) (matchFilter.timestamp as Record<string, unknown>).$lte = params.to;
    }

    const col = this.db.collection(COLLECTION_NAME);

    // Run aggregation and recent events fetch in parallel
    const [aggResult, recentEvents, totalEvents] = await Promise.all([
      // Aggregation pipeline for accurate totals (no document limit)
      col.aggregate<{
        summary: Array<{ totalCents: number }>;
        byAgent: Array<{ _id: string; total: number }>;
        byDepartment: Array<{ _id: string; total: number }>;
        byDay: Array<{ _id: string; total: number }>;
      }>([
        { $match: matchFilter },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalCents: { $sum: '$costCents' },
                },
              },
            ],
            byAgent: [
              { $group: { _id: '$agentId', total: { $sum: '$costCents' } } },
            ],
            byDepartment: [
              { $group: { _id: '$department', total: { $sum: '$costCents' } } },
            ],
            byDay: [
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
                  },
                  total: { $sum: '$costCents' },
                },
              },
            ],
          },
        },
      ]).toArray(),
      // Recent events for the events array (capped at 1000 for response size)
      col.find<AgentCostEvent>(matchFilter)
        .sort({ timestamp: -1 })
        .limit(1000)
        .toArray(),
      // Total count for truncation flag
      col.countDocuments(matchFilter),
    ]);

    // Parse aggregation result
    const agg = aggResult[0];
    const summary = agg?.summary?.[0];
    const totalCents = summary?.totalCents ?? 0;

    const byAgent: Record<string, number> = {};
    for (const row of agg?.byAgent ?? []) {
      if (row._id) byAgent[row._id] = row.total;
    }

    const byDepartment: Record<string, number> = {};
    for (const row of agg?.byDepartment ?? []) {
      if (row._id) byDepartment[row._id] = row.total;
    }

    const byDay: Record<string, number> = {};
    for (const row of agg?.byDay ?? []) {
      if (row._id) byDay[row._id] = row.total;
    }

    // Fix timestamp formatting: MongoDB returns Date objects; convert to ISO strings
    const events = recentEvents.map(e => ({
      ...e,
      timestamp: (e.timestamp as unknown) instanceof Date
        ? (e.timestamp as unknown as Date).toISOString()
        : String(e.timestamp),
    }));

    return {
      events,
      totalCents,
      byAgent,
      byDepartment,
      byDay,
      truncated: totalEvents > 1000,
      totalEvents,
    };
  }

  /**
   * Get total cost in cents for a specific execution by executionId.
   * Used by objective cost rollup to avoid cross-execution contamination.
   */
  async getExecutionCostCents(executionId: string): Promise<number> {
    if (!this.db) return 0;

    const col = this.db.collection(COLLECTION_NAME);
    const result = await col.aggregate<{ total: number }>([
      { $match: { executionId } },
      { $group: { _id: null, total: { $sum: '$costCents' } } },
    ]).toArray();

    return result[0]?.total ?? 0;
  }
}
