import { describe, it, expect, vi } from 'vitest';
import { bootstrapRootOperator } from '../src/deploy/operator-bootstrap.js';

const BASE_CONFIG = {
  storage: {
    state: { type: 'mongodb' as const },
    events: { type: 'redis' as const },
    memory: { type: 'postgresql' as const },
    objects: { type: 'local' as const },
  },
  secrets: { provider: 'env' as const },
  channels: {
    slack: { enabled: false },
    telegram: { enabled: false },
    twitter: { enabled: false },
    discord: { enabled: false },
  },
  networking: { apiPort: 3000 },
};

describe('bootstrapRootOperator', () => {
  it('returns success with API key on 201', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ operatorId: 'op_root_abc', apiKey: 'gzop_live_xyz' }),
    });

    const result = await bootstrapRootOperator(BASE_CONFIG, 'test-token', mockFetch as any);
    expect(result.success).toBe(true);
    expect(result.operatorId).toBe('op_root_abc');
    expect(result.apiKey).toBe('gzop_live_xyz');

    // Verify auth header was sent
    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[1].headers.Authorization).toBe('Bearer test-token');
  });

  it('returns alreadyExists on 409', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ error: 'Operators already exist' }),
    });

    const result = await bootstrapRootOperator(BASE_CONFIG, 'test-token', mockFetch as any);
    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(true);
  });

  it('returns error on 403 (bad token)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 403,
      text: async () => '{"error":"Invalid setup token"}',
    });

    const result = await bootstrapRootOperator(BASE_CONFIG, 'bad-token', mockFetch as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });

  it('handles connection errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await bootstrapRootOperator(BASE_CONFIG, 'test-token', mockFetch as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('uses correct port from config', async () => {
    const config = { ...BASE_CONFIG, networking: { apiPort: 4000 } };
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ operatorId: 'op_root_abc', apiKey: 'key' }),
    });

    await bootstrapRootOperator(config, 'test-token', mockFetch as any);
    expect(mockFetch.mock.calls[0]![0]).toContain(':4000');
  });

  it('returns error on 429 (rate limited)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 429,
      text: async () => '{"error":"Bootstrap locked"}',
    });

    const result = await bootstrapRootOperator(BASE_CONFIG, 'test-token', mockFetch as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('429');
  });

  it('sends JSON body with displayName and email', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ operatorId: 'op_root', apiKey: 'key' }),
    });

    await bootstrapRootOperator(BASE_CONFIG, 'test-token', mockFetch as any);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.displayName).toBe('Root Operator');
    expect(body.email).toBe('root@localhost');
  });
});
