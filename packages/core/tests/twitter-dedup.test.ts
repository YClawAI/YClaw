/**
 * Tests for the Twitter post dedup gate — Issue #144.
 *
 * All Redis interactions are mocked so these tests run offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkTwitterDedup,
  recordPostedTweet,
  normalise,
  sha256,
  jaccardSimilarity,
  DEDUP_SIMILARITY_THRESHOLD,
  DEDUP_WINDOW_SECONDS,
} from '../src/actions/twitter-dedup.js';
import type { Redis } from 'ioredis';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRedis(overrides: Partial<{
  exists: (key: string) => Promise<number>;
  zrangebyscore: (key: string, min: number | string, max: number | string) => Promise<string[]>;
  pipeline: () => {
    set: () => ReturnType<typeof makeRedisPipeline>;
    zadd: () => ReturnType<typeof makeRedisPipeline>;
    zremrangebyscore: () => ReturnType<typeof makeRedisPipeline>;
    expire: () => ReturnType<typeof makeRedisPipeline>;
    exec: () => Promise<unknown[]>;
  };
}> = {}): Redis {
  const pipeline = makeRedisPipeline();
  return {
    exists: vi.fn().mockResolvedValue(0),
    zrangebyscore: vi.fn().mockResolvedValue([]),
    pipeline: vi.fn().mockReturnValue(pipeline),
    ...overrides,
  } as unknown as Redis;
}

function makeRedisPipeline() {
  const p = {
    set: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  return p;
}

// ─── normalise ────────────────────────────────────────────────────────────────

describe('normalise()', () => {
  it('lowercases text', () => {
    expect(normalise('Hello World')).toBe('hello world');
  });

  it('collapses multiple spaces', () => {
    expect(normalise('foo  bar   baz')).toBe('foo bar baz');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalise('  hello  ')).toBe('hello');
  });

  it('handles newlines as whitespace', () => {
    expect(normalise('line1\nline2')).toBe('line1 line2');
  });

  it('is idempotent', () => {
    const text = 'Hello World';
    expect(normalise(normalise(text))).toBe(normalise(text));
  });
});

// ─── sha256 ───────────────────────────────────────────────────────────────────

describe('sha256()', () => {
  it('returns a 64-character hex string', () => {
    expect(sha256('hello')).toHaveLength(64);
    expect(sha256('hello')).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(sha256('foo')).toBe(sha256('foo'));
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('foo')).not.toBe(sha256('bar'));
  });
});

// ─── jaccardSimilarity ────────────────────────────────────────────────────────

describe('jaccardSimilarity()', () => {
  it('returns 1 for identical strings', () => {
    expect(jaccardSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely disjoint strings', () => {
    expect(jaccardSimilarity('cat dog', 'fish bird')).toBe(0);
  });

  it('returns 1 for two empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1);
  });

  it('returns a value between 0 and 1 for partial overlap', () => {
    const sim = jaccardSimilarity('hello world foo', 'hello world bar');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('computes the correct value for a known pair', () => {
    // A = {hello, world}  B = {hello, foo}
    // intersection = {hello} (1)  union = {hello, world, foo} (3)
    // Jaccard = 1/3 ≈ 0.333
    const sim = jaccardSimilarity('hello world', 'hello foo');
    expect(sim).toBeCloseTo(1 / 3, 5);
  });

  it('treats word duplicates as one token (set semantics)', () => {
    // "a a b" → set {a, b}; "a b b" → set {a, b}  → Jaccard = 1
    expect(jaccardSimilarity('a a b', 'a b b')).toBe(1);
  });

  it('detects near-identical tweets above 90% threshold', () => {
    const tweet1 = 'excited to announce our new product launching today big news for ai fans';
    const tweet2 = 'excited to announce our new product launching today big news for ai enthusiasts';
    const sim = jaccardSimilarity(tweet1, tweet2);
    expect(sim).toBeGreaterThanOrEqual(DEDUP_SIMILARITY_THRESHOLD);
  });

  it('allows clearly different tweets below 90% threshold', () => {
    const tweet1 = 'the weather is lovely today so excited for spring to arrive';
    const tweet2 = 'breaking new ai model sets record on coding benchmark outperforms gpt4';
    const sim = jaccardSimilarity(tweet1, tweet2);
    expect(sim).toBeLessThan(DEDUP_SIMILARITY_THRESHOLD);
  });
});

// ─── checkTwitterDedup ────────────────────────────────────────────────────────

describe('checkTwitterDedup()', () => {
  it('returns isDuplicate=false and warns when Redis is null', async () => {
    const result = await checkTwitterDedup(null, 'hello world');
    expect(result.isDuplicate).toBe(false);
  });

  it('returns isDuplicate=false when no recent posts exist', async () => {
    const redis = makeRedis();
    const result = await checkTwitterDedup(redis, 'brand new tweet content');
    expect(result.isDuplicate).toBe(false);
    expect(result.similarity).toBeUndefined();
  });

  it('detects an exact duplicate via hash sentinel', async () => {
    const text = 'this is a duplicate tweet';
    const redis = makeRedis({
      exists: vi.fn().mockResolvedValue(1), // key already exists → exact match
    });

    const result = await checkTwitterDedup(redis, text);
    expect(result.isDuplicate).toBe(true);
    expect(result.similarity).toBe(1.0);
  });

  it('detects a near-duplicate via Jaccard similarity', async () => {
    const original = 'excited to announce our new product launching today big news for ai fans';
    const nearDuplicate = 'excited to announce our new product launching today big news for ai enthusiasts';

    const redis = makeRedis({
      exists: vi.fn().mockResolvedValue(0), // no exact match
      zrangebyscore: vi.fn().mockResolvedValue([normalise(original)]),
    });

    const result = await checkTwitterDedup(redis, nearDuplicate);
    expect(result.isDuplicate).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(DEDUP_SIMILARITY_THRESHOLD);
    expect(result.matchedText).toBe(normalise(original));
  });

  it('allows a post that is sufficiently different from recent posts', async () => {
    const recent = 'the latest ai model breaks records on benchmark tests';
    const newTweet = 'happy friday everyone enjoy the weekend sunshine and rest';

    const redis = makeRedis({
      exists: vi.fn().mockResolvedValue(0),
      zrangebyscore: vi.fn().mockResolvedValue([normalise(recent)]),
    });

    const result = await checkTwitterDedup(redis, newTweet);
    expect(result.isDuplicate).toBe(false);
  });

  it('is case-insensitive (normalises before comparing)', async () => {
    const text = 'Hello World, Big Announcement Today!';
    const redis = makeRedis({
      exists: vi.fn().mockResolvedValue(1), // exact match on normalised text
    });

    const result = await checkTwitterDedup(redis, text);
    expect(result.isDuplicate).toBe(true);
  });

  it('respects a custom similarity threshold', async () => {
    const original = 'foo bar baz qux quux corge';
    const similar  = 'foo bar baz qux quux grault'; // one word different → ~83%

    const redis = makeRedis({
      exists: vi.fn().mockResolvedValue(0),
      zrangebyscore: vi.fn().mockResolvedValue([normalise(original)]),
    });

    // At 90% threshold: should NOT be a duplicate (~83% similarity)
    const resultStrict = await checkTwitterDedup(redis, similar, { threshold: 0.90 });
    expect(resultStrict.isDuplicate).toBe(false);

    // At 80% threshold: SHOULD be a duplicate (~83% similarity)
    const resultRelaxed = await checkTwitterDedup(redis, similar, { threshold: 0.80 });
    expect(resultRelaxed.isDuplicate).toBe(true);
  });

  it('fails open (allows post) when the exact-check Redis call throws', async () => {
    const redis = makeRedis({
      exists: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
    });

    const result = await checkTwitterDedup(redis, 'some tweet text');
    expect(result.isDuplicate).toBe(false);
  });

  it('fails open (allows post) when the fuzzy-check Redis call throws', async () => {
    const redis = makeRedis({
      exists: vi.fn().mockResolvedValue(0),
      zrangebyscore: vi.fn().mockRejectedValue(new Error('Redis timeout')),
    });

    const result = await checkTwitterDedup(redis, 'some tweet text');
    expect(result.isDuplicate).toBe(false);
  });
});

// ─── recordPostedTweet ────────────────────────────────────────────────────────

describe('recordPostedTweet()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when Redis is null', async () => {
    // Should resolve without throwing
    await expect(recordPostedTweet(null, 'hello world')).resolves.toBeUndefined();
  });

  it('runs a Redis pipeline with SET, ZADD, ZREMRANGEBYSCORE, EXPIRE', async () => {
    const pipeline = makeRedisPipeline();
    const redis = {
      pipeline: vi.fn().mockReturnValue(pipeline),
    } as unknown as Redis;

    await recordPostedTweet(redis, 'hello world');

    expect(redis.pipeline).toHaveBeenCalledOnce();
    expect(pipeline.set).toHaveBeenCalledOnce();
    expect(pipeline.zadd).toHaveBeenCalledOnce();
    expect(pipeline.zremrangebyscore).toHaveBeenCalledOnce();
    expect(pipeline.expire).toHaveBeenCalledOnce();
    expect(pipeline.exec).toHaveBeenCalledOnce();
  });

  it('stores the normalised text in the sorted set', async () => {
    const pipeline = makeRedisPipeline();
    const redis = {
      pipeline: vi.fn().mockReturnValue(pipeline),
    } as unknown as Redis;

    const text = 'Hello World — Big Announcement!';
    await recordPostedTweet(redis, text);

    // The ZADD call should use the normalised text as the member
    const zaddArgs = (pipeline.zadd as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(zaddArgs[2]).toBe(normalise(text));
  });

  it('uses DEDUP_WINDOW_SECONDS as the key TTL', async () => {
    const pipeline = makeRedisPipeline();
    const redis = {
      pipeline: vi.fn().mockReturnValue(pipeline),
    } as unknown as Redis;

    await recordPostedTweet(redis, 'test tweet');

    const setArgs = (pipeline.set as ReturnType<typeof vi.fn>).mock.calls[0];
    // SET key value EX ttl — ttl is 4th arg (index 3)
    expect(setArgs[3]).toBe(DEDUP_WINDOW_SECONDS);

    const expireArgs = (pipeline.expire as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(expireArgs[1]).toBe(DEDUP_WINDOW_SECONDS);
  });

  it('does not throw if the Redis pipeline fails', async () => {
    const pipeline = {
      ...makeRedisPipeline(),
      exec: vi.fn().mockRejectedValue(new Error('Redis write failed')),
    };
    const redis = {
      pipeline: vi.fn().mockReturnValue(pipeline),
    } as unknown as Redis;

    // Should resolve (non-fatal) even when Redis write fails
    await expect(recordPostedTweet(redis, 'test tweet')).resolves.toBeUndefined();
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('module constants', () => {
  it('DEDUP_SIMILARITY_THRESHOLD is 0.90', () => {
    expect(DEDUP_SIMILARITY_THRESHOLD).toBe(0.90);
  });

  it('DEDUP_WINDOW_SECONDS is 12 hours', () => {
    expect(DEDUP_WINDOW_SECONDS).toBe(12 * 60 * 60);
  });
});
