import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('task-executor');

// ─── Constants ───────────────────────────────────────────────────────────────

const TASK_TTL_SECONDS = 72 * 60 * 60; // 72 hours
const TASK_KEY_PREFIX = 'task:';
const TASK_AGENT_INDEX_PREFIX = 'task:agent:';

/**
 * Stuck detection thresholds (configurable via env vars).
 * Codegen tasks run longer — 60min default vs 30min for others.
 */
const CODEGEN_STUCK_MS = parseInt(process.env.CODEGEN_STUCK_MINUTES || '60', 10) * 60 * 1000;
const DEFAULT_STUCK_MS = parseInt(process.env.DEFAULT_STUCK_MINUTES || '30', 10) * 60 * 1000;

/** Task names that involve codegen and need the longer stuck threshold. */
const CODEGEN_TASK_NAMES = new Set([
  'implement_issue',
  'implement_directive',
  'fix_ci_failure',
  'address_human_review',
  'address_review_feedback',
  'bootstrap_repo',
]);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskRecord {
  id: string;
  agent: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'stuck';
  priority: 'P0' | 'P1' | 'P2';
  issueNumber?: number;
  prNumber?: number;
  reviewStatus?: 'pending' | 'approved' | 'changes_requested';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface TaskCreateParams {
  agent: string;
  task: string;
  priority?: 'P0' | 'P1' | 'P2';
  issueNumber?: number;
  prNumber?: number;
}

interface TaskUpdateParams {
  id: string;
  status?: TaskRecord['status'];
  prNumber?: number;
  reviewStatus?: TaskRecord['reviewStatus'];
  /** Fallback: if id lookup fails, match by agent + issueNumber instead. */
  agent?: string;
  issueNumber?: number;
  /** Task name for upsert (when creating a missing record). */
  taskName?: string;
}

interface TaskQueryParams {
  id?: string;
  agent?: string;
  status?: TaskRecord['status'];
}

// ─── Stuck Detection ─────────────────────────────────────────────────────────

function isStuck(record: TaskRecord): boolean {
  if (record.status !== 'in_progress') return false;
  const threshold = CODEGEN_TASK_NAMES.has(record.task) ? CODEGEN_STUCK_MS : DEFAULT_STUCK_MS;
  return Date.now() - record.updatedAt > threshold;
}

// ─── TaskExecutor ────────────────────────────────────────────────────────────

/**
 * Task Registry — tracks agent tasks in Redis with 72h TTL.
 * Provides task lifecycle management (create, update, query) and stuck detection.
 *
 * Actions:
 *   task:create — Create a new task record (called by Strategist when dispatching work)
 *   task:update — Update task status/fields (called by agents as work progresses)
 *   task:query  — Query task status by ID or agent (called by Sentinel or any agent)
 */
export class TaskExecutor implements ActionExecutor {
  readonly name = 'task';
  private redis: Redis | null = null;
  private memoryStore = new Map<string, TaskRecord>(); // in-memory fallback
  /**
   * True when the TaskExecutor is running in memory-only (no-Redis) mode.
   * This happens when REDIS_URL is absent or invalid in non-production environments.
   * In production, the constructor throws instead of setting this flag.
   */
  private degraded = false;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || '';
    const isProduction = process.env.NODE_ENV === 'production';
    const isValidUrl = url.startsWith('redis://') || url.startsWith('rediss://');

    if (!isValidUrl) {
      if (isProduction) {
        throw new Error(
          'REDIS_URL is required in production but is missing or invalid. ' +
          'Set REDIS_URL to a valid redis:// or rediss:// connection string. ' +
          'The TaskExecutor cannot run without Redis in production.',
        );
      }
      this.degraded = true;
      logger.warn('No valid REDIS_URL — task registry running in memory-only mode (no persistence)');
      return;
    }

    try {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 15000,
        retryStrategy: (times: number) => {
          if (times > 5) return null;
          return Math.min(times * 500, 10000);
        },
      });

      this.redis.on('error', (err: Error) => {
        logger.error('Task registry Redis error', { error: err.message });
      });

      void this.redis.connect().then(() => {
        logger.info('Task registry Redis connected');
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Task registry Redis connection failed (will retry): ${msg}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isProduction) {
        throw new Error(`Task registry Redis init failed: ${msg}. Redis is required in production.`);
      }
      this.degraded = true;
      logger.warn(`Task registry Redis init failed: ${msg} — using in-memory fallback`);
      this.redis = null;
    }
  }

  // ─── Tool Definitions ───────────────────────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'task:create',
        description: 'Create a new task record in the task registry. Called by Strategist when dispatching work to an agent.',
        parameters: {
          agent: { type: 'string', description: 'Agent name that will execute this task (e.g., "builder")', required: true },
          task: { type: 'string', description: 'Task name matching the agent\'s workflow (e.g., "implement_issue")', required: true },
          priority: { type: 'string', description: 'Task priority: P0 (critical), P1 (high), P2 (normal). Default: P2' },
          issueNumber: { type: 'number', description: 'GitHub issue number this task relates to (if applicable)' },
          prNumber: { type: 'number', description: 'Pull request number this task relates to (if applicable)' },
        },
      },
      {
        name: 'task:update',
        description: 'Update a task record status or metadata. Called by agents as work progresses.',
        parameters: {
          id: { type: 'string', description: 'Task ID to update', required: true },
          status: { type: 'string', description: 'New status: pending, in_progress, completed, failed, or stuck' },
          prNumber: { type: 'number', description: 'Pull request number to associate with this task' },
          reviewStatus: { type: 'string', description: 'PR review status: pending, approved, or changes_requested' },
        },
      },
      {
        name: 'task:query',
        description: 'Query task status by ID or agent name. Returns task records with stuck detection.',
        parameters: {
          id: { type: 'string', description: 'Task ID to look up (returns single record)' },
          agent: { type: 'string', description: 'Agent name to query all tasks for (returns array)' },
          status: { type: 'string', description: 'Filter by status when querying by agent' },
        },
      },
      {
        name: 'task:summary',
        description: 'Get a one-line status summary for all agents in a single call. Returns counts of pending/in_progress/stuck/completed/failed tasks per agent. Much more efficient than querying each agent individually.',
        parameters: {},
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case 'create':
        return this.createTask(params as unknown as TaskCreateParams);
      case 'update':
        return this.updateTask(params as unknown as TaskUpdateParams);
      case 'query':
        return this.queryTask(params as unknown as TaskQueryParams);
      case 'summary':
        return this.summarizeTasks();
      default:
        return { success: false, error: `Unknown task action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    // Degraded (memory-only) mode is not healthy — cross-agent task persistence
    // and distributed coordination are unavailable. Report unhealthy so that
    // readiness probes and health endpoints surface the degraded state rather
    // than silently hiding it.
    if (this.degraded || !this.redis) return false;
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  // ─── task:create ─────────────────────────────────────────────────────────

  private async createTask(params: TaskCreateParams): Promise<ActionResult> {
    const { agent, task, priority = 'P2', issueNumber, prNumber } = params;

    if (!agent || !task) {
      return { success: false, error: 'Missing required parameters: agent, task' };
    }

    const now = Date.now();
    const record: TaskRecord = {
      id: randomUUID(),
      agent,
      task,
      status: 'pending',
      priority,
      issueNumber,
      prNumber,
      createdAt: now,
      updatedAt: now,
    };

    await this.store(record);

    logger.info('Task created', { id: record.id, agent, task, priority });

    return {
      success: true,
      data: { task: record },
    };
  }

  // ─── task:update ─────────────────────────────────────────────────────────

  private async updateTask(params: TaskUpdateParams): Promise<ActionResult> {
    const { id, status, prNumber, reviewStatus, agent, issueNumber, taskName } = params;

    if (!id) {
      return { success: false, error: 'Missing required parameter: id' };
    }

    // Primary lookup by ID
    let record = await this.load(id);

    // Fallback: if ID lookup fails and we have agent + issueNumber, scan agent index
    if (!record && agent && issueNumber !== undefined) {
      record = await this.findByAgentAndIssue(agent, issueNumber);
      if (record) {
        logger.info('task:update resolved via agent+issueNumber fallback', {
          requestedId: id,
          resolvedId: record.id,
          agent,
          issueNumber,
        });
      }
    }

    // Upsert: if no record exists and we have enough info, create one with terminal status.
    // This handles the case where the dispatcher processed a task that was never registered
    // (e.g., triggered via GitHub webhook without a corresponding task:create from Strategist).
    if (!record && agent && status && (status === 'completed' || status === 'failed')) {
      const now = Date.now();
      const newRecord: TaskRecord = {
        id: randomUUID(),
        agent,
        task: taskName || id, // Prefer explicit task name, fall back to ID
        status,
        priority: 'P2',
        issueNumber,
        prNumber,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      };
      await this.store(newRecord);
      logger.info('task:update created missing record (upsert)', {
        requestedId: id,
        newId: newRecord.id,
        agent,
        status,
        issueNumber,
      });
      return { success: true, data: { task: newRecord } };
    }

    if (!record) {
      return { success: false, error: `Task not found: ${id}` };
    }

    const now = Date.now();
    if (status) record.status = status;
    if (prNumber !== undefined) record.prNumber = prNumber;
    if (reviewStatus) record.reviewStatus = reviewStatus;
    record.updatedAt = now;

    if (status === 'completed' || status === 'failed') {
      record.completedAt = now;
    }

    await this.store(record);

    logger.info('Task updated', { id, status, prNumber, reviewStatus });

    return {
      success: true,
      data: { task: record },
    };
  }

  // ─── task:query ──────────────────────────────────────────────────────────

  private async queryTask(params: TaskQueryParams): Promise<ActionResult> {
    const { id, agent, status } = params;

    if (id) {
      const record = await this.load(id);
      if (!record) {
        return { success: false, error: `Task not found: ${id}` };
      }

      // Apply stuck detection
      if (isStuck(record)) {
        record.status = 'stuck';
        await this.store(record);
        logger.warn('Task marked stuck', { id: record.id, agent: record.agent, task: record.task });
      }

      return { success: true, data: { task: record } };
    }

    if (agent) {
      const records = await this.loadByAgent(agent);

      // Apply stuck detection and optional status filter
      const results: TaskRecord[] = [];
      for (const record of records) {
        if (isStuck(record)) {
          record.status = 'stuck';
          await this.store(record);
          logger.warn('Task marked stuck', { id: record.id, task: record.task });
        }
        if (!status || record.status === status) {
          results.push(record);
        }
      }

      return {
        success: true,
        data: {
          tasks: results,
          total: results.length,
          agent,
        },
      };
    }

    return { success: false, error: 'Must provide either id or agent parameter' };
  }

  // ─── task:summary ─────────────────────────────────────────────────────────

  private async summarizeTasks(): Promise<ActionResult> {
    const allRecords = await this.loadAll();
    const agentSummaries: Record<string, Record<string, number>> = {};

    for (const record of allRecords) {
      // Apply stuck detection
      if (isStuck(record)) {
        record.status = 'stuck';
        await this.store(record);
      }

      if (!agentSummaries[record.agent]) {
        agentSummaries[record.agent] = {};
      }
      agentSummaries[record.agent][record.status] =
        (agentSummaries[record.agent][record.status] ?? 0) + 1;
    }

    return {
      success: true,
      data: {
        agents: agentSummaries,
        totalTasks: allRecords.length,
      },
    };
  }

  // ─── Storage Helpers ─────────────────────────────────────────────────────

  private async store(record: TaskRecord): Promise<void> {
    if (this.redis) {
      try {
        const key = `${TASK_KEY_PREFIX}${record.id}`;
        // Serialize as flat string fields (Redis hash values must be strings)
        await this.redis.hset(key,
          'id', record.id,
          'agent', record.agent,
          'task', record.task,
          'status', record.status,
          'priority', record.priority,
          'createdAt', String(record.createdAt),
          'updatedAt', String(record.updatedAt),
          ...(record.issueNumber !== undefined ? ['issueNumber', String(record.issueNumber)] : []),
          ...(record.prNumber !== undefined ? ['prNumber', String(record.prNumber)] : []),
          ...(record.reviewStatus ? ['reviewStatus', record.reviewStatus] : []),
          ...(record.completedAt !== undefined ? ['completedAt', String(record.completedAt)] : []),
        );
        await this.redis.expire(key, TASK_TTL_SECONDS);

        // Update agent index (sorted set, score = createdAt for ordering)
        const agentKey = `${TASK_AGENT_INDEX_PREFIX}${record.agent}`;
        await this.redis.zadd(agentKey, record.createdAt, record.id);
        await this.redis.expire(agentKey, TASK_TTL_SECONDS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to store task in Redis', { id: record.id, error: msg });
        // Fall through to in-memory store
        this.memoryStore.set(record.id, record);
      }
    } else {
      this.memoryStore.set(record.id, record);
    }
  }

  private async load(id: string): Promise<TaskRecord | null> {
    if (this.redis) {
      try {
        const key = `${TASK_KEY_PREFIX}${id}`;
        const data = await this.redis.hgetall(key);
        if (!data || Object.keys(data).length === 0) return null;
        return this.deserialize(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to load task from Redis', { id, error: msg });
        // Fall through to in-memory
      }
    }
    return this.memoryStore.get(id) ?? null;
  }

  private async loadByAgent(agent: string): Promise<TaskRecord[]> {
    if (this.redis) {
      try {
        const agentKey = `${TASK_AGENT_INDEX_PREFIX}${agent}`;
        // Get all task IDs for this agent, sorted by createdAt descending
        const ids = await this.redis.zrevrange(agentKey, 0, -1);
        const records: TaskRecord[] = [];
        const expiredIds: string[] = [];

        for (const id of ids) {
          const record = await this.load(id);
          if (record) {
            records.push(record);
          } else {
            expiredIds.push(id);
          }
        }

        // Lazy cleanup: remove dangling references from the index
        // This prevents unbounded index growth when individual task keys expire
        if (expiredIds.length > 0) {
          await this.redis.zrem(agentKey, ...expiredIds);
          logger.info('Cleaned expired task index entries', {
            agent,
            removed: expiredIds.length,
            remaining: records.length,
          });
        }

        // If index is now empty, remove it entirely to avoid zombie keys
        if (records.length === 0 && expiredIds.length > 0) {
          await this.redis.del(agentKey);
        }

        return records;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to load agent tasks from Redis', { agent, error: msg });
        // Fall through to in-memory
      }
    }
    // In-memory fallback: filter by agent
    return [...this.memoryStore.values()].filter(r => r.agent === agent);
  }

  /**
   * Find a non-terminal task record by agent + issueNumber.
   * Returns the most recent pending/in_progress match, or null.
   */
  private async findByAgentAndIssue(agent: string, issueNumber: number): Promise<TaskRecord | null> {
    const records = await this.loadByAgent(agent);
    // Prefer non-terminal tasks (pending/in_progress) — those are what need updating
    const nonTerminal = records.filter(
      r => r.issueNumber === issueNumber && r.status !== 'completed' && r.status !== 'failed',
    );
    if (nonTerminal.length > 0) return nonTerminal[0]!;
    // Fall back to any matching record (handles idempotent re-updates)
    const any = records.filter(r => r.issueNumber === issueNumber);
    return any.length > 0 ? any[0]! : null;
  }

  private async loadAll(): Promise<TaskRecord[]> {
    if (this.redis) {
      try {
        // Scan for all task:agent:* index keys, then load each agent's tasks
        const agentKeys: string[] = [];
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${TASK_AGENT_INDEX_PREFIX}*`, 'COUNT', '100');
          cursor = next;
          agentKeys.push(...keys);
        } while (cursor !== '0');

        const allRecords: TaskRecord[] = [];
        const seen = new Set<string>();
        for (const agentKey of agentKeys) {
          const ids = await this.redis.zrevrange(agentKey, 0, -1);
          for (const id of ids) {
            if (seen.has(id)) continue;
            seen.add(id);
            const record = await this.load(id);
            if (record) allRecords.push(record);
          }
        }
        return allRecords;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to load all tasks from Redis', { error: msg });
      }
    }
    return [...this.memoryStore.values()];
  }

  private deserialize(data: Record<string, string>): TaskRecord {
    return {
      id: data.id,
      agent: data.agent,
      task: data.task,
      status: data.status as TaskRecord['status'],
      priority: data.priority as TaskRecord['priority'],
      createdAt: parseInt(data.createdAt, 10),
      updatedAt: parseInt(data.updatedAt, 10),
      ...(data.issueNumber ? { issueNumber: parseInt(data.issueNumber, 10) } : {}),
      ...(data.prNumber ? { prNumber: parseInt(data.prNumber, 10) } : {}),
      ...(data.reviewStatus ? { reviewStatus: data.reviewStatus as TaskRecord['reviewStatus'] } : {}),
      ...(data.completedAt ? { completedAt: parseInt(data.completedAt, 10) } : {}),
    };
  }
}
