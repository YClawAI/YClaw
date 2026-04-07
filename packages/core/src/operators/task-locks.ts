import type { Redis as IORedis } from 'ioredis';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('task-locks');

const LOCK_PREFIX = 'lock:';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TaskLock {
  resourceKey: string;
  taskId: string;
  operatorId: string;
  priority: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface AcquireResult {
  acquired: boolean;
  preempted?: TaskLock;
  currentHolder?: TaskLock;
}

// ─── Lua Scripts ───────────────────────────────────────────────────────────────

// Atomic acquire: check existing lock, compare priority, set or reject
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local taskId = ARGV[1]
local operatorId = ARGV[2]
local priority = tonumber(ARGV[3])
local acquiredAt = ARGV[4]
local expiresAt = ARGV[5]
local ttl = tonumber(ARGV[6])

local existing = redis.call('HGETALL', key)
if #existing == 0 then
  -- No lock, acquire it
  redis.call('HSET', key, 'taskId', taskId, 'operatorId', operatorId,
    'priority', priority, 'acquiredAt', acquiredAt, 'expiresAt', expiresAt)
  redis.call('EXPIRE', key, ttl)
  return {'acquired', '', '', '', '', ''}
end

-- Parse existing lock
local existingData = {}
for i = 1, #existing, 2 do
  existingData[existing[i]] = existing[i + 1]
end

local existingPriority = tonumber(existingData['priority'] or '0')

if priority > existingPriority then
  -- Preempt: higher priority wins
  local preempted = {existingData['taskId'] or '', existingData['operatorId'] or '',
    existingData['priority'] or '', existingData['acquiredAt'] or '', existingData['expiresAt'] or ''}
  redis.call('HSET', key, 'taskId', taskId, 'operatorId', operatorId,
    'priority', priority, 'acquiredAt', acquiredAt, 'expiresAt', expiresAt)
  redis.call('EXPIRE', key, ttl)
  return {'preempted', preempted[1], preempted[2], preempted[3], preempted[4], preempted[5]}
end

-- Blocked: current holder has same or higher priority
return {'blocked', existingData['taskId'] or '', existingData['operatorId'] or '',
  existingData['priority'] or '', existingData['acquiredAt'] or '', existingData['expiresAt'] or ''}
`;

// Atomic release: only holder can release
const RELEASE_SCRIPT = `
local key = KEYS[1]
local operatorId = ARGV[1]

local holder = redis.call('HGET', key, 'operatorId')
if holder == false then
  return 0
end
if holder ~= operatorId then
  return -1
end
redis.call('DEL', key)
return 1
`;

// Atomic extend: only holder can extend
const EXTEND_SCRIPT = `
local key = KEYS[1]
local operatorId = ARGV[1]
local additionalSeconds = tonumber(ARGV[2])
local newExpiresAt = ARGV[3]

local holder = redis.call('HGET', key, 'operatorId')
if holder == false then return 0 end
if holder ~= operatorId then return -1 end

redis.call('HSET', key, 'expiresAt', newExpiresAt)
local currentTtl = redis.call('TTL', key)
if currentTtl > 0 then
  redis.call('EXPIRE', key, currentTtl + additionalSeconds)
else
  redis.call('EXPIRE', key, additionalSeconds)
end
return 1
`;

// ─── TaskLockManager ───────────────────────────────────────────────────────────

export class TaskLockManager {
  constructor(private readonly redis: IORedis) {}

  async acquireLock(params: {
    resourceKey: string;
    taskId: string;
    operatorId: string;
    priority: number;
    ttlSeconds?: number;
  }): Promise<AcquireResult> {
    const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const result = await this.redis.eval(
      ACQUIRE_SCRIPT,
      1,
      `${LOCK_PREFIX}${params.resourceKey}`,
      params.taskId,
      params.operatorId,
      String(params.priority),
      now.toISOString(),
      expiresAt.toISOString(),
      String(ttl),
    ) as string[];

    const status = result[0];

    if (status === 'acquired') {
      logger.info('Lock acquired', { resourceKey: params.resourceKey, operatorId: params.operatorId });
      return { acquired: true };
    }

    const holderLock: TaskLock = {
      resourceKey: params.resourceKey,
      taskId: result[1]!,
      operatorId: result[2]!,
      priority: parseInt(result[3]!, 10),
      acquiredAt: result[4]!,
      expiresAt: result[5]!,
    };

    if (status === 'preempted') {
      logger.info('Lock preempted', {
        resourceKey: params.resourceKey,
        newOperator: params.operatorId,
        preemptedOperator: holderLock.operatorId,
      });
      return { acquired: true, preempted: holderLock };
    }

    // blocked
    return { acquired: false, currentHolder: holderLock };
  }

  async releaseLock(resourceKey: string, operatorId: string): Promise<boolean> {
    const result = await this.redis.eval(
      RELEASE_SCRIPT,
      1,
      `${LOCK_PREFIX}${resourceKey}`,
      operatorId,
    ) as number;

    if (result === 1) {
      logger.info('Lock released', { resourceKey, operatorId });
      return true;
    }
    return false;
  }

  async extendLock(resourceKey: string, operatorId: string, additionalSeconds: number): Promise<boolean> {
    const newExpiresAt = new Date(Date.now() + additionalSeconds * 1000).toISOString();
    const result = await this.redis.eval(
      EXTEND_SCRIPT,
      1,
      `${LOCK_PREFIX}${resourceKey}`,
      operatorId,
      String(additionalSeconds),
      newExpiresAt,
    ) as number;
    return result === 1;
  }

  async getLock(resourceKey: string): Promise<TaskLock | null> {
    const data = await this.redis.hgetall(`${LOCK_PREFIX}${resourceKey}`);
    if (!data || !data.taskId) return null;
    return {
      resourceKey,
      taskId: data.taskId,
      operatorId: data.operatorId!,
      priority: parseInt(data.priority!, 10),
      acquiredAt: data.acquiredAt!,
      expiresAt: data.expiresAt!,
    };
  }

  async listLocks(): Promise<TaskLock[]> {
    const keys = await this.redis.keys(`${LOCK_PREFIX}*`);
    const locks: TaskLock[] = [];
    for (const key of keys) {
      const resourceKey = key.slice(LOCK_PREFIX.length);
      const lock = await this.getLock(resourceKey);
      if (lock) locks.push(lock);
    }
    return locks;
  }

  async forceRelease(resourceKey: string): Promise<boolean> {
    const result = await this.redis.del(`${LOCK_PREFIX}${resourceKey}`);
    if (result > 0) {
      logger.info('Lock force-released', { resourceKey });
      return true;
    }
    return false;
  }
}
