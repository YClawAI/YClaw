import { createHash } from 'node:crypto';
import Redis from 'ioredis';

const DEFAULT_PREFIX = process.env.AO_QUEUE_PREFIX || 'ao:queue';
const DEFAULT_DEDUP_TTL_SEC = parseInt(process.env.AO_QUEUE_DEDUP_TTL_SEC || '21600', 10);

/**
 * Lua script that atomically checks LLEN(pending) < maxQueue, then
 * stores the job payload and pushes the job ID onto the pending list.
 *
 * Fixes #766: admission was previously checked in userland before the LPUSH,
 * leaving a TOCTOU window where concurrent /spawn or /batch-spawn requests
 * could all pass the depth check and then all enqueue, silently exceeding
 * MAX_QUEUE.  Running the check and the push inside a single Lua call makes
 * the combined operation atomic from Redis' perspective.
 *
 * KEYS[1] = pending list key
 * KEYS[2] = jobs hash key
 * ARGV[1] = job id
 * ARGV[2] = serialised job record (JSON)
 * ARGV[3] = max queue depth (integer)
 *
 * Returns -1 when the queue is full, otherwise returns the new list length.
 */
const ENQUEUE_ATOMIC_SCRIPT = `
local pending_key = KEYS[1]
local jobs_key    = KEYS[2]
local job_id      = ARGV[1]
local record      = ARGV[2]
local max_queue   = tonumber(ARGV[3])

local current_len = redis.call('LLEN', pending_key)
if current_len >= max_queue then
  return -1
end

redis.call('HSET', jobs_key, job_id, record)
redis.call('LPUSH', pending_key, job_id)
return redis.call('LLEN', pending_key)
`;

/**
 * Lua script that atomically enforces a global concurrency cap across all
 * bridge processes before moving a job from `pending` to `running`.
 *
 * Without this script, each bridge process independently checks its local
 * `activeSpawns` counter.  Two processes that both see `activeSpawns < MAX`
 * can both dequeue a job, silently doubling the effective concurrency.
 *
 * This script serialises the admission check inside Redis so that the
 * global `running` list length is the single source of truth, regardless
 * of how many bridge processes are alive.
 *
 * KEYS[1] = running list key
 * KEYS[2] = pending list key
 * ARGV[1] = max concurrent (integer)
 *
 * Returns the dequeued job ID string, or nil/false when either the running
 * list is already at capacity or the pending list is empty.
 */
const DEQUEUE_ATOMIC_SCRIPT = `
local running_key    = KEYS[1]
local pending_key    = KEYS[2]
local max_concurrent = tonumber(ARGV[1])

if redis.call('LLEN', running_key) >= max_concurrent then
  return nil
end

return redis.call('LMOVE', pending_key, running_key, 'RIGHT', 'LEFT')
`;

function stableTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildQueueFingerprint(job) {
  const fingerprintSource = {
    repo: stableTrimmedString(job.repo),
    issueNumber: job.issueNumber ?? null,
    cleanupIssueNumber: job.cleanupIssueNumber ?? null,
    claimPr: job.claimPr ?? null,
    directive: stableTrimmedString(job.directive),
    context: stableTrimmedString(job.context),
    orchestrator: stableTrimmedString(job.orchestrator),
  };

  return createHash('sha256')
    .update(JSON.stringify(fingerprintSource))
    .digest('hex');
}

const DEFAULT_SESSION_LOCK_TTL_SEC = 3600; // 1 hour

export class AoQueueStore {
  constructor(redis, prefix = DEFAULT_PREFIX, dedupTtlSec = DEFAULT_DEDUP_TTL_SEC) {
    this.redis = redis;
    this.prefix = prefix;
    this.dedupTtlSec = dedupTtlSec;
  }

  static fromEnv() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return null;
    }
    return new AoQueueStore(new Redis(redisUrl));
  }

  pendingKey() {
    return `${this.prefix}:pending`;
  }

  runningKey() {
    return `${this.prefix}:running`;
  }

  jobsKey() {
    return `${this.prefix}:jobs`;
  }

  dedupKey(fingerprint) {
    return `${this.prefix}:dedup:${fingerprint}`;
  }

  sessionLockKey(sessionId) {
    return `${this.prefix}:session-lock:${sessionId}`;
  }

  /**
   * Attempt to acquire a session lock.
   * Uses Redis SET NX EX so only the first caller succeeds.
   * @param {string} sessionId
   * @param {number} [ttlSec] - Lock TTL in seconds (default: 1 hour)
   * @returns {Promise<boolean>} true if lock was acquired, false if already held
   */
  async acquireSessionLock(sessionId, ttlSec = DEFAULT_SESSION_LOCK_TTL_SEC) {
    const result = await this.redis.set(this.sessionLockKey(sessionId), '1', 'EX', ttlSec, 'NX');
    return result === 'OK';
  }

  /**
   * Renew (extend) the TTL of an existing session lock.
   * @param {string} sessionId
   * @param {number} [ttlSec] - New TTL in seconds (default: 1 hour)
   * @returns {Promise<boolean>} true if key existed and was renewed
   */
  async renewSessionLock(sessionId, ttlSec = DEFAULT_SESSION_LOCK_TTL_SEC) {
    const result = await this.redis.expire(this.sessionLockKey(sessionId), ttlSec);
    return result === 1;
  }

  /**
   * Release (delete) a session lock.
   * @param {string} sessionId
   */
  async releaseSessionLock(sessionId) {
    await this.redis.del(this.sessionLockKey(sessionId));
  }

  /**
   * Check whether a session lock is currently held.
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async isSessionLocked(sessionId) {
    const result = await this.redis.exists(this.sessionLockKey(sessionId));
    return result === 1;
  }

  /**
   * Return the list of session IDs that currently hold a lock.
   * @returns {Promise<string[]>}
   */
  async listActiveSessionLocks() {
    const pattern = `${this.prefix}:session-lock:*`;
    const keys = await this.redis.keys(pattern);
    const prefix = `${this.prefix}:session-lock:`;
    return keys.map((k) => k.slice(prefix.length));
  }

  async recoverRunningJobs() {
    let recovered = 0;
    while (true) {
      const jobId = await this.redis.lmove(this.runningKey(), this.pendingKey(), 'RIGHT', 'LEFT');
      if (!jobId) break;
      recovered++;
    }
    return recovered;
  }

  /**
   * Enqueue a job.
   *
   * When `maxQueue` is supplied the admission check and the actual push are
   * performed inside a single Lua script so the combined operation is atomic –
   * no concurrent request can slip through between the length check and the
   * LPUSH.  When `maxQueue` is omitted the original MULTI path is used
   * (unlimited queue, kept for backward-compatibility).
   *
   * @param {object} job
   * @param {number} [maxQueue]
   * @returns {Promise<{accepted:boolean, duplicate:boolean, queueFull?:boolean,
   *   id:string, queuePosition:number|null, fingerprint:string}>}
   */
  async enqueue(job, maxQueue) {
    const fingerprint = buildQueueFingerprint(job);
    const dedupKey = this.dedupKey(fingerprint);
    const dedupResult = await this.redis.set(dedupKey, job.id, 'EX', this.dedupTtlSec, 'NX');
    if (dedupResult !== 'OK') {
      const existingId = await this.redis.get(dedupKey);
      return {
        accepted: false,
        duplicate: true,
        id: existingId || job.id,
        queuePosition: null,
        fingerprint,
      };
    }

    const record = JSON.stringify({
      ...job,
      fingerprint,
    });

    try {
      if (maxQueue !== undefined) {
        // Atomic admission check + enqueue via Lua script.
        const result = await this.redis.eval(
          ENQUEUE_ATOMIC_SCRIPT,
          2,
          this.pendingKey(),
          this.jobsKey(),
          job.id,
          record,
          String(maxQueue),
        );

        if (result === -1) {
          // Queue full – undo the dedup reservation so the caller may retry.
          await this.redis.del(dedupKey);
          return {
            accepted: false,
            duplicate: false,
            queueFull: true,
            id: job.id,
            queuePosition: null,
            fingerprint,
          };
        }

        return {
          accepted: true,
          duplicate: false,
          id: job.id,
          queuePosition: result,
          fingerprint,
        };
      }

      // No max-queue enforcement – original MULTI path.
      await this.redis.multi()
        .hset(this.jobsKey(), job.id, record)
        .lpush(this.pendingKey(), job.id)
        .exec();

      const queuePosition = await this.redis.llen(this.pendingKey());
      return {
        accepted: true,
        duplicate: false,
        id: job.id,
        queuePosition,
        fingerprint,
      };
    } catch (err) {
      await this.redis.del(dedupKey);
      throw err;
    }
  }

  /**
   * Dequeue the next pending job.
   *
   * When `maxConcurrent` is supplied the check against the global running
   * count and the actual LMOVE are performed inside a single Lua script so
   * the operation is atomic across all bridge processes sharing this Redis
   * instance.  This prevents multiple processes from each dequeuing up to
   * `maxConcurrent` jobs and overrunning the intended global cap.
   *
   * When `maxConcurrent` is omitted the original non-atomic path is used
   * (kept for backward-compatibility and the in-memory fallback path).
   *
   * @param {number} [maxConcurrent]
   * @returns {Promise<object|null>}
   */
  async dequeue(maxConcurrent) {
    let jobId;

    if (maxConcurrent !== undefined) {
      // Atomically check global running count before dequeuing.
      jobId = await this.redis.eval(
        DEQUEUE_ATOMIC_SCRIPT,
        2,
        this.runningKey(),
        this.pendingKey(),
        String(maxConcurrent),
      );
      if (!jobId) return null;
    } else {
      jobId = await this.redis.lmove(this.pendingKey(), this.runningKey(), 'RIGHT', 'LEFT');
      if (!jobId) return null;
    }

    const raw = await this.redis.hget(this.jobsKey(), jobId);
    if (!raw) {
      await this.redis.lrem(this.runningKey(), 1, jobId);
      return null;
    }

    return JSON.parse(raw);
  }

  async complete(job) {
    await this.redis.multi()
      .lrem(this.runningKey(), 1, job.id)
      .hdel(this.jobsKey(), job.id)
      .del(this.dedupKey(job.fingerprint))
      .exec();
  }

  async metrics() {
    const [pendingCount, runningCount, oldestPendingId] = await Promise.all([
      this.redis.llen(this.pendingKey()),
      this.redis.llen(this.runningKey()),
      this.redis.lindex(this.pendingKey(), -1),
    ]);

    let oldestQueuedAgeSec = 0;
    if (oldestPendingId) {
      const raw = await this.redis.hget(this.jobsKey(), oldestPendingId);
      if (raw) {
        try {
          const job = JSON.parse(raw);
          const queuedAt = new Date(job.queuedAt).getTime();
          if (Number.isFinite(queuedAt)) {
            oldestQueuedAgeSec = Math.max(0, Math.floor((Date.now() - queuedAt) / 1000));
          }
        } catch {
          oldestQueuedAgeSec = 0;
        }
      }
    }

    return {
      pendingCount,
      runningCount,
      oldestQueuedAgeSec,
    };
  }
}
