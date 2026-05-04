import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentDedupGate } from '../src/review/content-dedup.js';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('ContentDedupGate', () => {
  let gate: ContentDedupGate;

  beforeEach(() => {
    gate = new ContentDedupGate();
    vi.useFakeTimers();
  });

  // ── 1. Non-duplicate content is allowed ─────────────────────────────────
  it('allows content that has never been posted', () => {
    const result = gate.check('Hello world!', 'twitter');
    expect(result.isDuplicate).toBe(false);
  });

  // ── 2. Exact duplicate is blocked ────────────────────────────────────────
  it('blocks exact duplicate content on the same platform', () => {
    const content = 'Big announcement: we just shipped v2.0! 🚀';

    gate.recordOutboundContent(content, 'twitter');
    const result = gate.check(content, 'twitter');

    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toBe('exact');
  });

  // ── 3. Near-duplicate (>85% Jaccard) is blocked ──────────────────────────
  it('blocks near-duplicate content above the 85% similarity threshold', () => {
    // These two strings differ only by "amazing" → "incredible" in a long sentence.
    // Character bigram Jaccard similarity ≈ 0.898, well above the 85% threshold.
    const original =
      'Excited to share that we just crossed 1 million users! Thank you for your amazing support and trust. This milestone belongs to all of you.';
    const nearDupe =
      'Excited to share that we just crossed 1 million users! Thank you for your incredible support and trust. This milestone belongs to all of you.';

    gate.recordOutboundContent(original, 'twitter');
    const result = gate.check(nearDupe, 'twitter');

    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toBe('fuzzy');
    expect(result.similarity).toBeGreaterThan(0.85);
  });

  // ── 4. Sufficiently different content is allowed ─────────────────────────
  it('allows content that is below the similarity threshold', () => {
    const original = 'We are hiring! Join our engineering team.';
    const different = 'Check out our latest blog post on AI safety and responsible deployment.';

    gate.recordOutboundContent(original, 'twitter');
    const result = gate.check(different, 'twitter');

    expect(result.isDuplicate).toBe(false);
  });

  // ── 5. Records expire after 12 hours ─────────────────────────────────────
  it('allows content again after the 12-hour TTL has expired', () => {
    const content = 'Good morning, here is your daily update!';

    gate.recordOutboundContent(content, 'twitter');

    // Advance time by exactly 12 hours + 1 ms
    vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1);

    const result = gate.check(content, 'twitter');
    expect(result.isDuplicate).toBe(false);
  });

  // ── 6. Per-platform scope: same content on different platforms is allowed ─
  it('allows the same content on a different platform', () => {
    const content = 'We just launched our new feature — try it now!';

    gate.recordOutboundContent(content, 'twitter');

    const telegramResult = gate.check(content, 'telegram');
    expect(telegramResult.isDuplicate).toBe(false);

    // Still blocked on same platform
    const twitterResult = gate.check(content, 'twitter');
    expect(twitterResult.isDuplicate).toBe(true);
  });

  // ── 7. Fail-open: gate error does not block the post ─────────────────────
  it('returns isDuplicate=false (fail-open) when an internal error occurs', () => {
    // Force an error by breaking the internal records map via monkey-patch
    // @ts-expect-error — intentionally corrupting private state for test
    gate['records'] = {
      get: () => { throw new Error('Simulated storage failure'); },
      has: () => false,
      set: () => undefined,
    };

    const result = gate.check('Some content', 'twitter');
    expect(result.isDuplicate).toBe(false);
  });
});
