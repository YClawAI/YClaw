import type { Redis as IORedis } from 'ioredis';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('rate-limiter');

const RPM_PREFIX = 'ratelimit:rpm:';
const CONCURRENT_PREFIX = 'ratelimit:concurrent:';
const DAILY_PREFIX = 'ratelimit:daily:';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
  reason?: 'rpm_exceeded' | 'concurrent_exceeded' | 'daily_quota_exceeded';
}

// Sliding window RPM check via Lua
const RPM_CHECK_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = 60000
local limit = tonumber(ARGV[2])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = 0
  if #oldest >= 2 then
    retryAfter = tonumber(oldest[2]) + window - now
  end
  return {0, limit - count, retryAfter}
end

redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
redis.call('EXPIRE', key, 120)
return {1, limit - count - 1, 0}
`;

export class OperatorRateLimiter {
  constructor(private readonly redis: IORedis) {}

  async checkLimit(operatorId: string, limits: {
    requestsPerMinute: number;
    maxConcurrentTasks: number;
    dailyTaskQuota: number;
  }): Promise<RateLimitResult> {
    // 1. Check RPM (sliding window)
    const now = Date.now();
    const rpmResult = await this.redis.eval(
      RPM_CHECK_SCRIPT, 1,
      `${RPM_PREFIX}${operatorId}`,
      String(now), String(limits.requestsPerMinute),
    ) as number[];

    if (rpmResult[0] === 0) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(rpmResult[2]!, 1000),
        reason: 'rpm_exceeded',
      };
    }

    // 2. Check concurrent tasks
    const concurrent = await this.getConcurrent(operatorId);
    if (concurrent >= limits.maxConcurrentTasks) {
      return {
        allowed: false,
        remaining: 0,
        reason: 'concurrent_exceeded',
      };
    }

    // 3. Check daily quota
    const daily = await this.getDailyCount(operatorId);
    if (daily >= limits.dailyTaskQuota) {
      return {
        allowed: false,
        remaining: 0,
        reason: 'daily_quota_exceeded',
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        rpmResult[1]!,
        limits.maxConcurrentTasks - concurrent,
        limits.dailyTaskQuota - daily,
      ),
    };
  }

  async incrementConcurrent(operatorId: string): Promise<number> {
    return this.redis.incr(`${CONCURRENT_PREFIX}${operatorId}`);
  }

  async decrementConcurrent(operatorId: string): Promise<number> {
    const val = await this.redis.decr(`${CONCURRENT_PREFIX}${operatorId}`);
    // Floor at 0
    if (val < 0) {
      await this.redis.set(`${CONCURRENT_PREFIX}${operatorId}`, '0');
      return 0;
    }
    return val;
  }

  async getConcurrent(operatorId: string): Promise<number> {
    const val = await this.redis.get(`${CONCURRENT_PREFIX}${operatorId}`);
    return val ? parseInt(val, 10) : 0;
  }

  async incrementDaily(operatorId: string): Promise<number> {
    const key = `${DAILY_PREFIX}${operatorId}:${todayKey()}`;
    const count = await this.redis.incr(key);
    // Set TTL to expire at end of day (max 25 hours)
    if (count === 1) {
      await this.redis.expire(key, 25 * 60 * 60);
    }
    return count;
  }

  async getDailyCount(operatorId: string): Promise<number> {
    const val = await this.redis.get(`${DAILY_PREFIX}${operatorId}:${todayKey()}`);
    return val ? parseInt(val, 10) : 0;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
