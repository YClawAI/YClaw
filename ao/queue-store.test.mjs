import { describe, expect, it } from 'vitest';
import { AoQueueStore, buildQueueFingerprint } from './queue-store.mjs';

class FakeRedis {
  constructor() {
    this.strings = new Map();
    this.hashes = new Map();
    this.lists = new Map();
  }

  async set(key, value, mode, ttl, nxMode) {
    if (nxMode === 'NX' && this.strings.has(key)) {
      return null;
    }
    this.strings.set(key, value);
    return 'OK';
  }

  async get(key) {
    return this.strings.get(key) ?? null;
  }

  async del(key) {
    this.strings.delete(key);
    return 1;
  }

  async exists(key) {
    return this.strings.has(key) ? 1 : 0;
  }

  /**
   * Minimal expire stub: returns 1 if key exists (simulates setting TTL),
   * 0 if the key doesn't exist.
   */
  async expire(key, _ttl) {
    return this.strings.has(key) ? 1 : 0;
  }

  /**
   * Minimal keys stub: returns all string keys matching a glob-like pattern
   * where '*' is the only wildcard supported.
   */
  async keys(pattern) {
    const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);
    return [...this.strings.keys()].filter((k) => regex.test(k));
  }

  async hset(key, field, value) {
    const map = this.hashes.get(key) ?? new Map();
    map.set(field, value);
    this.hashes.set(key, map);
    return 1;
  }

  async hget(key, field) {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hdel(key, field) {
    const map = this.hashes.get(key);
    map?.delete(field);
    return 1;
  }

  async lpush(key, value) {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  async llen(key) {
    return (this.lists.get(key) ?? []).length;
  }

  async lindex(key, index) {
    const list = this.lists.get(key) ?? [];
    const resolved = index < 0 ? list.length + index : index;
    return list[resolved] ?? null;
  }

  async lmove(source, destination, from, to) {
    const sourceList = this.lists.get(source) ?? [];
    if (sourceList.length === 0) return null;
    const value = from === 'RIGHT' ? sourceList.pop() : sourceList.shift();
    this.lists.set(source, sourceList);

    const destList = this.lists.get(destination) ?? [];
    if (to === 'LEFT') {
      destList.unshift(value);
    } else {
      destList.push(value);
    }
    this.lists.set(destination, destList);
    return value;
  }

  async lrem(key, count, value) {
    const list = this.lists.get(key) ?? [];
    const next = [];
    let removed = 0;
    for (const item of list) {
      if (removed < Math.abs(count) && item === value) {
        removed++;
        continue;
      }
      next.push(item);
    }
    this.lists.set(key, next);
    return removed;
  }

  /**
   * Minimal eval stub that replicates both Lua scripts used by AoQueueStore.
   * The script is identified by its ARGV count:
   *   - 1 ARGV  → DEQUEUE_ATOMIC_SCRIPT  (runningKey, pendingKey | maxConcurrent)
   *   - 3 ARGVs → ENQUEUE_ATOMIC_SCRIPT  (pendingKey, jobsKey | jobId, record, maxQueue)
   *
   * Arguments mirror the ioredis eval signature:
   *   eval(script, numkeys, key1[, key2, ...], argv1[, argv2, ...])
   *
   * IMPORTANT: all operations inside this method are performed synchronously on
   * the underlying data structures (no internal `await`).  This is critical for
   * correctly simulating the atomicity guarantee that real Redis Lua scripts
   * provide.  If `await` were used, JavaScript's event loop would yield between
   * the length-check and the insert, allowing concurrent callers to all pass the
   * check before any of them completes — exactly the TOCTOU race that #766 fixed.
   */
  async eval(_script, numkeys, ...keysAndArgs) {
    const numArgv = keysAndArgs.length - numkeys;

    if (numArgv === 1) {
      // DEQUEUE_ATOMIC_SCRIPT — synchronous to preserve atomicity
      const runningKey    = keysAndArgs[0];                       // KEYS[1]
      const pendingKey    = keysAndArgs[1];                       // KEYS[2]
      const maxConcurrent = parseInt(keysAndArgs[numkeys], 10);   // ARGV[1]

      const runningList = this.lists.get(runningKey) ?? [];
      if (runningList.length >= maxConcurrent) return null;

      // Inline lmove(pendingKey → runningKey, RIGHT → LEFT) without await
      const pendingList = this.lists.get(pendingKey) ?? [];
      if (pendingList.length === 0) return null;
      const value = pendingList.pop();
      this.lists.set(pendingKey, pendingList);
      runningList.unshift(value);
      this.lists.set(runningKey, runningList);
      return value;
    }

    // ENQUEUE_ATOMIC_SCRIPT (numArgv === 3) — synchronous to preserve atomicity
    const pendingKey = keysAndArgs[0];                         // KEYS[1]
    const jobsKey    = keysAndArgs[1];                         // KEYS[2]
    const jobId      = keysAndArgs[numkeys];                   // ARGV[1]
    const record     = keysAndArgs[numkeys + 1];               // ARGV[2]
    const maxQueue   = parseInt(keysAndArgs[numkeys + 2], 10); // ARGV[3]

    // Inline llen(pendingKey) without await
    const pendingList = this.lists.get(pendingKey) ?? [];
    if (pendingList.length >= maxQueue) return -1;

    // Inline hset(jobsKey, jobId, record) without await
    const map = this.hashes.get(jobsKey) ?? new Map();
    map.set(jobId, record);
    this.hashes.set(jobsKey, map);

    // Inline lpush(pendingKey, jobId) without await
    pendingList.unshift(jobId);
    this.lists.set(pendingKey, pendingList);
    return pendingList.length;
  }

  multi() {
    const commands = [];
    const chain = {
      hset: (key, field, value) => {
        commands.push(() => this.hset(key, field, value));
        return chain;
      },
      lpush: (key, value) => {
        commands.push(() => this.lpush(key, value));
        return chain;
      },
      lrem: (key, count, value) => {
        commands.push(() => this.lrem(key, count, value));
        return chain;
      },
      hdel: (key, field) => {
        commands.push(() => this.hdel(key, field));
        return chain;
      },
      del: (key) => {
        commands.push(() => this.del(key));
        return chain;
      },
      exec: async () => {
        for (const command of commands) {
          await command();
        }
        return [];
      },
    };
    return chain;
  }
}

describe('AoQueueStore', () => {
  it('builds stable fingerprints for equivalent jobs', () => {
    const first = buildQueueFingerprint({
      repo: 'your-org/your-project',
      issueNumber: 123,
      directive: '  Fix the bug  ',
      context: 'ctx',
      orchestrator: 'claude-code',
    });
    const second = buildQueueFingerprint({
      repo: 'your-org/your-project',
      issueNumber: 123,
      directive: 'Fix the bug',
      context: 'ctx',
      orchestrator: 'claude-code',
    });

    expect(first).toBe(second);
  });

  it('deduplicates equivalent jobs and drains them FIFO', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue', 300);

    const first = {
      id: 'job-1',
      queuedAt: '2026-03-30T00:00:00.000Z',
      repo: 'your-org/your-project',
      issueNumber: 101,
      cleanupIssueNumber: 101,
      claimPr: null,
      directive: 'Fix issue 101',
      context: '',
      orchestrator: 'claude-code',
    };
    const second = {
      ...first,
      id: 'job-2',
    };

    const enqueued = await queue.enqueue(first);
    const duplicate = await queue.enqueue(second);
    const dequeued = await queue.dequeue();

    expect(enqueued.accepted).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.id).toBe('job-1');
    expect(dequeued?.id).toBe('job-1');

    await queue.complete(dequeued);
    const metrics = await queue.metrics();
    expect(metrics.pendingCount).toBe(0);
    expect(metrics.runningCount).toBe(0);
  });

  it('enforces maxQueue atomically – rejects when queue is at capacity', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue:maxq', 300);
    const maxQueue = 2;

    const makeJob = (n) => ({
      id: `job-mq-${n}`,
      queuedAt: new Date().toISOString(),
      repo: 'your-org/your-project',
      issueNumber: n,
      cleanupIssueNumber: n,
      claimPr: null,
      directive: `issue ${n}`,
      context: '',
      orchestrator: '',
    });

    const r1 = await queue.enqueue(makeJob(1), maxQueue);
    const r2 = await queue.enqueue(makeJob(2), maxQueue);
    const r3 = await queue.enqueue(makeJob(3), maxQueue);

    expect(r1.accepted).toBe(true);
    expect(r1.queuePosition).toBe(1);
    expect(r2.accepted).toBe(true);
    expect(r2.queuePosition).toBe(2);

    // Third job must be rejected because the queue is full.
    expect(r3.accepted).toBe(false);
    expect(r3.queueFull).toBe(true);
    expect(r3.duplicate).toBe(false);

    // Dedup key must have been cleaned up so the same job can be retried later.
    const metrics = await queue.metrics();
    expect(metrics.pendingCount).toBe(2);
  });

  // Regression test for #766: concurrent /spawn requests must not be able to
  // all pass the depth check and then all enqueue, overrunning MAX_QUEUE.
  // The atomic Lua script prevents this by making the check + push a single
  // indivisible Redis operation.
  it('regression #766: concurrent enqueues cannot exceed maxQueue', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue:766', 300);
    const maxQueue = 3;

    const makeJob = (n) => ({
      id: `job-766-${n}`,
      queuedAt: new Date().toISOString(),
      repo: 'your-org/your-project',
      issueNumber: n,
      cleanupIssueNumber: n,
      claimPr: null,
      directive: `issue ${n}`,
      context: '',
      orchestrator: '',
    });

    // Simulate concurrent admission: fire all enqueues simultaneously before
    // any of them resolves (mirrors the race described in #766).
    const results = await Promise.all([
      queue.enqueue(makeJob(1), maxQueue),
      queue.enqueue(makeJob(2), maxQueue),
      queue.enqueue(makeJob(3), maxQueue),
      queue.enqueue(makeJob(4), maxQueue), // must be rejected
      queue.enqueue(makeJob(5), maxQueue), // must be rejected
    ]);

    const accepted = results.filter((r) => r.accepted);
    const rejected = results.filter((r) => r.queueFull);

    // Exactly maxQueue jobs must be accepted regardless of concurrency.
    expect(accepted).toHaveLength(maxQueue);
    // The remaining jobs must be cleanly rejected with queueFull.
    expect(rejected).toHaveLength(2);

    // Dedup keys for rejected jobs must be cleaned up so they can be retried.
    for (const r of rejected) {
      expect(r.duplicate).toBe(false);
    }

    const metrics = await queue.metrics();
    expect(metrics.pendingCount).toBe(maxQueue);
  });

  it('recovers running jobs back to pending on startup', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue:recover', 300);

    const job = {
      id: 'job-recover',
      queuedAt: new Date().toISOString(),
      repo: 'your-org/your-project',
      issueNumber: 202,
      cleanupIssueNumber: 202,
      claimPr: null,
      directive: '',
      context: '',
      orchestrator: '',
      fingerprint: 'fp-1',
    };

    await redis.hset(queue.jobsKey(), job.id, JSON.stringify(job));
    await redis.lpush(queue.runningKey(), job.id);

    const recovered = await queue.recoverRunningJobs();
    const dequeued = await queue.dequeue();

    expect(recovered).toBe(1);
    expect(dequeued?.id).toBe('job-recover');
  });

  it('dequeue without maxConcurrent uses non-atomic path', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue:nomax', 300);

    const job = {
      id: 'job-nomax',
      queuedAt: new Date().toISOString(),
      repo: 'your-org/your-project',
      issueNumber: 300,
      cleanupIssueNumber: 300,
      claimPr: null,
      directive: 'issue 300',
      context: '',
      orchestrator: '',
    };

    await queue.enqueue(job);
    const dequeued = await queue.dequeue(); // no maxConcurrent – original path

    expect(dequeued?.id).toBe('job-nomax');
    const metrics = await queue.metrics();
    expect(metrics.pendingCount).toBe(0);
    expect(metrics.runningCount).toBe(1);
  });

  it('dequeue with maxConcurrent enforces global cap atomically', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue:maxc', 300);
    const maxConcurrent = 2;

    const makeJob = (n) => ({
      id: `job-mc-${n}`,
      queuedAt: new Date().toISOString(),
      repo: 'your-org/your-project',
      issueNumber: n,
      cleanupIssueNumber: n,
      claimPr: null,
      directive: `issue ${n}`,
      context: '',
      orchestrator: '',
    });

    // Enqueue 3 jobs.
    await queue.enqueue(makeJob(1));
    await queue.enqueue(makeJob(2));
    await queue.enqueue(makeJob(3));

    // Dequeue up to the global cap – both should succeed.
    const d1 = await queue.dequeue(maxConcurrent);
    const d2 = await queue.dequeue(maxConcurrent);
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();

    // Third dequeue must be blocked because running count == maxConcurrent.
    const d3 = await queue.dequeue(maxConcurrent);
    expect(d3).toBeNull();

    const metrics = await queue.metrics();
    expect(metrics.runningCount).toBe(2);
    expect(metrics.pendingCount).toBe(1);
  });

  it('dequeue with maxConcurrent returns null when pending list is empty', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue:empty', 300);

    const result = await queue.dequeue(2);
    expect(result).toBeNull();
  });

  it('dequeue with maxConcurrent allows dequeue again after a job completes', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:queue:complete', 300);
    const maxConcurrent = 1;

    const job = {
      id: 'job-complete',
      queuedAt: new Date().toISOString(),
      repo: 'your-org/your-project',
      issueNumber: 400,
      cleanupIssueNumber: 400,
      claimPr: null,
      directive: 'issue 400',
      context: '',
      orchestrator: '',
    };
    const job2 = { ...job, id: 'job-complete-2', issueNumber: 401, cleanupIssueNumber: 401, directive: 'issue 401' };

    await queue.enqueue(job);
    await queue.enqueue(job2);

    const d1 = await queue.dequeue(maxConcurrent);
    expect(d1?.id).toBe('job-complete');

    // Cap is reached – second dequeue blocked.
    const d2 = await queue.dequeue(maxConcurrent);
    expect(d2).toBeNull();

    // Complete the first job.
    await queue.complete(d1);

    // Now a slot is free and the second job can be dequeued.
    const d3 = await queue.dequeue(maxConcurrent);
    expect(d3?.id).toBe('job-complete-2');
  });
});

// ── Session lock tests ────────────────────────────────────────────────────────

describe('AoQueueStore – session locks', () => {
  it('acquires a lock and reports it as held', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks', 300);

    const acquired = await queue.acquireSessionLock('sess-abc');
    expect(acquired).toBe(true);

    const isLocked = await queue.isSessionLocked('sess-abc');
    expect(isLocked).toBe(true);
  });

  it('rejects a second acquire while lock is held', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks:dup', 300);

    await queue.acquireSessionLock('sess-dup');
    const second = await queue.acquireSessionLock('sess-dup');
    expect(second).toBe(false);
  });

  it('reports lock as not held after release', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks:rel', 300);

    await queue.acquireSessionLock('sess-rel');
    await queue.releaseSessionLock('sess-rel');

    const isLocked = await queue.isSessionLocked('sess-rel');
    expect(isLocked).toBe(false);
  });

  it('allows re-acquire after release', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks:reacq', 300);

    await queue.acquireSessionLock('sess-reacq');
    await queue.releaseSessionLock('sess-reacq');
    const reacquired = await queue.acquireSessionLock('sess-reacq');
    expect(reacquired).toBe(true);
  });

  it('renew returns true for an existing lock', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks:renew', 300);

    await queue.acquireSessionLock('sess-renew');
    const renewed = await queue.renewSessionLock('sess-renew');
    expect(renewed).toBe(true);
  });

  it('renew returns false for a non-existent lock', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks:renew2', 300);

    const renewed = await queue.renewSessionLock('sess-ghost');
    expect(renewed).toBe(false);
  });

  it('lists all active session lock IDs', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks:list', 300);

    await queue.acquireSessionLock('sess-x');
    await queue.acquireSessionLock('sess-y');

    const active = await queue.listActiveSessionLocks();
    expect(active).toHaveLength(2);
    expect(active).toContain('sess-x');
    expect(active).toContain('sess-y');
  });

  it('listActiveSessionLocks excludes released locks', async () => {
    const redis = new FakeRedis();
    const queue = new AoQueueStore(redis, 'test:ao:locks:list2', 300);

    await queue.acquireSessionLock('sess-keep');
    await queue.acquireSessionLock('sess-drop');
    await queue.releaseSessionLock('sess-drop');

    const active = await queue.listActiveSessionLocks();
    expect(active).toContain('sess-keep');
    expect(active).not.toContain('sess-drop');
  });
});
