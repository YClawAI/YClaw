/**
 * Elvis Pre-Check — deterministic (zero-LLM) gate for agent cron heartbeats.
 *
 * Runs BEFORE the agent's context is loaded and LLM is invoked. If no signals
 * indicate pending work, the full heartbeat is skipped — saving context tokens,
 * LLM cost, and cold-start latency.
 *
 * FAIL-OPEN design: any error (Redis down, unexpected exception) defaults to
 * shouldRun=true so a pre-check failure never silently disables an agent.
 *
 * Signals checked (composite):
 *   1. Agent task index depth  — task:agent:${agentName} ZSET
 *   2. Builder queue depth     — builder:task_queue:P0-P3 ZSETs (Builder only)
 *   3. Agent-specific signals  — Architect PR queue, Sentinel active alerts, etc.
 *   4. Unprocessed events      — EventStream pending count
 *   5. Max silence interval    — force run if > maxSilenceHours since last execution
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../logging/logger.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const LAST_FULL_PREFIX = 'precheck:last_full:';
const TASK_AGENT_PREFIX = 'task:agent:';
const SENTINEL_ACTIVE_ALERTS_KEY = 'sentinel:active_alerts';

/** Builder uses dedicated priority queue ZSETs instead of the task:agent index. */
const BUILDER_QUEUE_KEYS = [
  'builder:task_queue:P0',
  'builder:task_queue:P1',
  'builder:task_queue:P2',
  'builder:task_queue:P3',
] as const;

/** Architect subscribes to these event stream prefixes for pending PR reviews. */
const ARCHITECT_PR_STREAM_PREFIXES = ['github', 'builder'] as const;

const DEFAULT_MAX_SILENCE_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreCheckResult {
  shouldRun: boolean;
  /** Reasons the heartbeat will run (non-empty when shouldRun=true). */
  reasons: string[];
  /** Reason the heartbeat is being skipped (set when shouldRun=false). */
  skipReason?: string;
}

export interface PreCheckOptions {
  /** Max milliseconds of silence before forcing a full run (default: 6 hours). */
  maxSilenceMs?: number;
}

/**
 * Optional EventStream interface — only the method we need.
 * Avoids hard dependency on EventStream class.
 */
interface EventStreamLike {
  pendingCount(typePrefix?: string): Promise<number>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

const log = createLogger('heartbeat-precheck');

/**
 * Determine whether an agent should run its cron heartbeat.
 *
 * Returns shouldRun=true (with reasons) when there is actionable work or when
 * the max silence interval has been exceeded. Returns shouldRun=false when all
 * signals are quiet and the agent ran recently.
 *
 * Always returns shouldRun=true on Redis failure (fail-open).
 */
export async function shouldRunHeartbeat(
  agentName: string,
  redis: Redis | null,
  eventStream?: EventStreamLike | null,
  options: PreCheckOptions = {},
): Promise<PreCheckResult> {
  if (!redis) {
    return {
      shouldRun: true,
      reasons: ['No Redis — cannot check state, running as fallback'],
    };
  }

  try {
    const maxSilenceMs = options.maxSilenceMs ?? DEFAULT_MAX_SILENCE_MS;

    const [queueDepth, specificSignals, unprocessedEvents, lastFullMs] = await Promise.all([
      getQueueDepth(agentName, redis),
      getAgentSpecificSignals(agentName, redis, eventStream),
      getUnprocessedEvents(eventStream),
      getLastFullRun(agentName, redis),
    ]);

    const reasons: string[] = [];

    if (queueDepth > 0) {
      reasons.push(`${queueDepth} task(s) in queue`);
    }

    reasons.push(...specificSignals);

    if (unprocessedEvents > 0) {
      reasons.push(`${unprocessedEvents} unprocessed event(s)`);
    }

    const timeSinceLast = lastFullMs > 0 ? Date.now() - lastFullMs : Infinity;
    if (timeSinceLast > maxSilenceMs) {
      const hoursAgo = lastFullMs > 0
        ? Math.round(timeSinceLast / 3_600_000)
        : null;
      const label = hoursAgo !== null ? `${hoursAgo}h since last run` : 'never run';
      reasons.push(`max silence exceeded (${label})`);
    }

    if (reasons.length > 0) {
      return { shouldRun: true, reasons };
    }

    return {
      shouldRun: false,
      reasons: [],
      skipReason: 'no pending work',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[${agentName}] Pre-check failed — running as fallback`, { error: msg });
    return {
      shouldRun: true,
      reasons: [`check failed (${msg}) — running as fallback`],
    };
  }
}

/**
 * Record that an agent completed a full cron run.
 * Called after executor.execute() returns so the silence interval resets.
 */
export async function recordHeartbeatRun(
  agentName: string,
  redis: Redis | null,
): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${LAST_FULL_PREFIX}${agentName}`, String(Date.now()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[${agentName}] Failed to record pre-check timestamp`, { error: msg });
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * General queue depth for an agent.
 *
 * Builder uses the priority queue ZSETs (P0-P3). All other agents check the
 * task:agent:${agentName} ZSET which tracks assigned/in-progress tasks.
 */
async function getQueueDepth(agentName: string, redis: Redis): Promise<number> {
  try {
    if (agentName === 'builder') {
      const counts = await Promise.all(
        BUILDER_QUEUE_KEYS.map(key => redis.zcard(key)),
      );
      return counts.reduce((sum, n) => sum + n, 0);
    }
    return await redis.zcard(`${TASK_AGENT_PREFIX}${agentName}`);
  } catch {
    return 0;
  }
}

/**
 * Agent-specific signals beyond the generic queue check.
 *
 * Returns an array of human-readable reason strings (non-empty = has work).
 */
async function getAgentSpecificSignals(
  agentName: string,
  redis: Redis,
  eventStream?: EventStreamLike | null,
): Promise<string[]> {
  const reasons: string[] = [];

  if (agentName === 'architect') {
    const pendingPrs = await getArchitectPendingPrs(eventStream);
    if (pendingPrs > 0) {
      reasons.push(`${pendingPrs} pending PR event(s) awaiting review`);
    }
  }

  if (agentName === 'sentinel') {
    const activeAlerts = await getSentinelActiveAlerts(redis);
    if (activeAlerts > 0) {
      reasons.push(`${activeAlerts} active alert(s)`);
    }
  }

  if (agentName === 'deployer') {
    const pendingApprovals = await getDeployerPendingApprovals(eventStream);
    if (pendingApprovals > 0) {
      reasons.push(`${pendingApprovals} pending deploy event(s)`);
    }
  }

  return reasons;
}

/** Architect: check event stream for pending GitHub/Builder PR events. */
async function getArchitectPendingPrs(
  eventStream?: EventStreamLike | null,
): Promise<number> {
  if (!eventStream) return 0;
  try {
    const counts = await Promise.all(
      ARCHITECT_PR_STREAM_PREFIXES.map(prefix => eventStream.pendingCount(prefix)),
    );
    return counts.reduce((sum, n) => sum + n, 0);
  } catch {
    return 0;
  }
}

/** Sentinel: check Redis for active (unresolved) alerts. */
async function getSentinelActiveAlerts(redis: Redis): Promise<number> {
  try {
    const val = await redis.get(SENTINEL_ACTIVE_ALERTS_KEY);
    if (!val) return 0;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
  } catch {
    return 0;
  }
}

/** Deployer: check event stream for pending deploy-related events. */
async function getDeployerPendingApprovals(
  eventStream?: EventStreamLike | null,
): Promise<number> {
  if (!eventStream) return 0;
  try {
    return await eventStream.pendingCount('architect');
  } catch {
    return 0;
  }
}

/** General unprocessed event count across all subscribed streams. */
async function getUnprocessedEvents(
  eventStream?: EventStreamLike | null,
): Promise<number> {
  if (!eventStream) return 0;
  try {
    return await eventStream.pendingCount();
  } catch {
    return 0;
  }
}

/** Timestamp of the last full run for this agent, or 0 if never. */
async function getLastFullRun(agentName: string, redis: Redis): Promise<number> {
  try {
    const val = await redis.get(`${LAST_FULL_PREFIX}${agentName}`);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}
