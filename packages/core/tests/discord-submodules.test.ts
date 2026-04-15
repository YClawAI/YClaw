/**
 * Unit tests for the decomposed Discord executor sub-modules.
 *
 * Each sub-module is tested in isolation to verify the decomposition
 * works correctly. This complements the integration tests in
 * discord-executor.test.ts which test the full DiscordExecutor via
 * the public API.
 *
 * Covers:
 *   - discord/index.ts       — public re-export surface
 *   - discord/channel-resolver.ts — resolveChannelId
 *   - discord/rate-limiter.ts     — fingerprint
 *   - discord/thread-manager.ts   — chunkText
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── index.ts — public re-export surface ────────────────────────────────────

describe('discord/index.ts exports', () => {
  it('re-exports DiscordExecutor from the public API surface', async () => {
    const mod = await import('../src/actions/discord/index.js');
    expect(typeof mod.DiscordExecutor).toBe('function');
  });

  it('does not accidentally export internal helpers', async () => {
    const mod = await import('../src/actions/discord/index.js') as Record<string, unknown>;
    // Internal helpers should not leak through the public index
    expect(mod.resolveChannelId).toBeUndefined();
    expect(mod.fingerprint).toBeUndefined();
    expect(mod.chunkText).toBeUndefined();
    expect(mod.isDuplicate).toBeUndefined();
  });
});

// ─── channel-resolver.ts ────────────────────────────────────────────────────

vi.mock('../src/utils/channel-routing.js', () => ({
  getChannelForDepartment: vi.fn((dept: string) => {
    const map: Record<string, string> = {
      general:     '2222222222222222222',
      development: '3333333333333333333',
      support:     '1111111111111111111',
    };
    return map[dept] ?? undefined;
  }),
  getChannelForAgent: vi.fn().mockReturnValue(undefined),
}));

describe('channel-resolver.resolveChannelId', () => {
  it('accepts raw Discord snowflake IDs (17–20 digits)', async () => {
    const { resolveChannelId } = await import('../src/actions/discord/channel-resolver.js');
    expect(resolveChannelId('1489421589941325904')).toBe('1489421589941325904');
    expect(resolveChannelId('12345678901234567')).toBe('12345678901234567'); // 17 digits
    expect(resolveChannelId('12345678901234567890')).toBe('12345678901234567890'); // 20 digits
  });

  it('resolves symbolic department names via env-var routing', async () => {
    const { resolveChannelId } = await import('../src/actions/discord/channel-resolver.js');
    expect(resolveChannelId('development')).toBe('3333333333333333333');
    expect(resolveChannelId('support')).toBe('1111111111111111111');
  });

  it('falls back to general for unknown symbolic names', async () => {
    const { resolveChannelId } = await import('../src/actions/discord/channel-resolver.js');
    expect(resolveChannelId('totally-unknown-dept')).toBe('2222222222222222222');
  });

  it('trims whitespace from input', async () => {
    const { resolveChannelId } = await import('../src/actions/discord/channel-resolver.js');
    expect(resolveChannelId('  support  ')).toBe('1111111111111111111');
  });

  it('throws when even the general channel is unconfigured', async () => {
    // getChannelForDepartment is called twice inside resolveChannelId:
    //   1. for the requested dept  → undefined (no such dept)
    //   2. for the 'general' fallback → undefined (override the module-level mock)
    // getChannelForAgent is mocked separately above to always return undefined.
    const { getChannelForDepartment } = await import('../src/utils/channel-routing.js') as {
      getChannelForDepartment: ReturnType<typeof vi.fn>;
    };
    getChannelForDepartment
      .mockReturnValueOnce(undefined) // dept lookup for 'no-such-channel'
      .mockReturnValueOnce(undefined); // general fallback — no general configured

    const { resolveChannelId } = await import('../src/actions/discord/channel-resolver.js');
    expect(() => resolveChannelId('no-such-channel')).toThrow(/Unknown Discord channel/);
  });
});

// ─── rate-limiter.ts ─────────────────────────────────────────────────────────

describe('rate-limiter.fingerprint', () => {
  it('returns a 32-char hex string', async () => {
    const { fingerprint } = await import('../src/actions/discord/rate-limiter.js');
    const fp = fingerprint('chan-1', 'hello world');
    expect(fp).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
  });

  it('produces the same fingerprint for identical inputs', async () => {
    const { fingerprint } = await import('../src/actions/discord/rate-limiter.js');
    expect(fingerprint('chan-1', 'same message')).toBe(fingerprint('chan-1', 'same message'));
  });

  it('produces different fingerprints for different channels', async () => {
    const { fingerprint } = await import('../src/actions/discord/rate-limiter.js');
    expect(fingerprint('chan-1', 'msg')).not.toBe(fingerprint('chan-2', 'msg'));
  });

  it('normalises UUIDs so semantically equivalent messages have the same fingerprint', async () => {
    const { fingerprint } = await import('../src/actions/discord/rate-limiter.js');
    const msg1 = 'Task dep-123-abc started for 550e8400-e29b-41d4-a716-446655440000';
    const msg2 = 'Task dep-456-xyz started for 6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(fingerprint('chan', msg1)).toBe(fingerprint('chan', msg2));
  });

  it('normalises timestamps', async () => {
    const { fingerprint } = await import('../src/actions/discord/rate-limiter.js');
    const fp1 = fingerprint('c', 'scheduled at 2026-01-01T12:00:00');
    const fp2 = fingerprint('c', 'scheduled at 2026-03-15T08:30:00');
    expect(fp1).toBe(fp2);
  });

  it('normalises Discord snowflakes', async () => {
    const { fingerprint } = await import('../src/actions/discord/rate-limiter.js');
    const fp1 = fingerprint('c', 'channel 1234567890123456789 is active');
    const fp2 = fingerprint('c', 'channel 9876543210987654321 is active');
    expect(fp1).toBe(fp2);
  });
});

// ─── thread-manager.ts — chunkText ──────────────────────────────────────────

describe('thread-manager.chunkText', () => {
  it('returns the original string unchanged when within limit', async () => {
    const { chunkText } = await import('../src/actions/discord/thread-manager.js');
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits text that exceeds the limit', async () => {
    const { chunkText } = await import('../src/actions/discord/thread-manager.js');
    const long = 'a'.repeat(300);
    const chunks = chunkText(long, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('reassembles chunks to the original content (ignoring trimmed whitespace)', async () => {
    const { chunkText } = await import('../src/actions/discord/thread-manager.js');
    const text = 'word '.repeat(100).trim(); // 500 chars
    const chunks = chunkText(text, 50);
    // Rejoin and compare — trimStart removes leading whitespace between chunks
    const rejoined = chunks.join(' ');
    // The original and rejoined should contain the same words
    expect(rejoined.replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
  });

  it('prefers to break at newlines', async () => {
    const { chunkText } = await import('../src/actions/discord/thread-manager.js');
    const text = 'line one\nline two\nline three';
    // Limit forces a split; prefers the newline break
    const chunks = chunkText(text, 15);
    expect(chunks[0]).toMatch(/line one/);
  });

  it('handles empty string', async () => {
    const { chunkText } = await import('../src/actions/discord/thread-manager.js');
    const chunks = chunkText('', 100);
    // Empty string is <= maxLen so returned as single element
    expect(chunks).toEqual(['']);
  });

  it('handles exactly-at-limit strings', async () => {
    const { chunkText } = await import('../src/actions/discord/thread-manager.js');
    const text = 'x'.repeat(100);
    expect(chunkText(text, 100)).toEqual([text]);
  });
});
