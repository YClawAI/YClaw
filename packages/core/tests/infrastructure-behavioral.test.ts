/**
 * Behavioral tests for infrastructure adapters.
 * Tests actual behavior, not just interface shapes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NullStateStore } from '../src/adapters/state/MongoStateStore.js';
import { LocalFileStore } from '../src/adapters/storage/LocalFileStore.js';
import { EnvSecretProvider } from '../src/adapters/secrets/EnvSecretProvider.js';
import { HealthAggregator } from '../src/observability/health.js';
import { YclawConfigSchema } from '../src/infrastructure/config-schema.js';
import { InfrastructureFactory } from '../src/infrastructure/InfrastructureFactory.js';
import type { Infrastructure } from '../src/infrastructure/types.js';
import type { IEventBus } from '../src/interfaces/IEventBus.js';

// ─── RedisEventBus fail-closed semantics (#6) ───────────────────────────────

describe('RedisEventBus fail-closed semantics', () => {
  it('setnx returns false when Redis is absent (fail-closed for locks)', async () => {
    // Create a RedisEventBus with no Redis URL — should be degraded
    const { RedisEventBus } = await import('../src/adapters/events/RedisEventBus.js');
    const bus = new RedisEventBus('');
    // setnx must return false (deny lock) when Redis is unavailable
    const acquired = await bus.setnx('test-lock', 'owner', 30);
    expect(acquired).toBe(false);
    await bus.disconnect();
  });

  it('healthy() returns false when no Redis connection', async () => {
    const { RedisEventBus } = await import('../src/adapters/events/RedisEventBus.js');
    const bus = new RedisEventBus('');
    expect(bus.healthy()).toBe(false);
    await bus.disconnect();
  });

  it('get/set return null/void when Redis is absent (graceful degradation)', async () => {
    const { RedisEventBus } = await import('../src/adapters/events/RedisEventBus.js');
    const bus = new RedisEventBus('');
    expect(await bus.get('key')).toBeNull();
    await bus.set('key', 'value');  // no-op, no throw
    await bus.del('key');           // no-op, no throw
    await bus.disconnect();
  });
});

// ─── LocalFileStore path traversal (#11) ────────────────────────────────────

describe('LocalFileStore path traversal defense', () => {
  it('rejects paths that traverse above basePath', () => {
    const store = new LocalFileStore('/tmp/test-store');
    expect(() => (store as any).resolvePath('../../etc/passwd')).toThrow('Path traversal detected');
  });

  it('allows nested paths within basePath', () => {
    const store = new LocalFileStore('/tmp/test-store');
    const resolved = (store as any).resolvePath('assets/images/logo.png');
    expect(resolved).toBe('/tmp/test-store/assets/images/logo.png');
  });

  it('strips leading slashes', () => {
    const store = new LocalFileStore('/tmp/test-store');
    const resolved = (store as any).resolvePath('/assets/file.txt');
    expect(resolved).toBe('/tmp/test-store/assets/file.txt');
  });
});

// ─── EnvSecretProvider ──────────────────────────────────────────────────────

describe('EnvSecretProvider', () => {
  let provider: EnvSecretProvider;

  beforeEach(() => {
    provider = new EnvSecretProvider();
  });

  it('reads existing env vars', async () => {
    // PATH is always set
    const value = await provider.get('PATH');
    expect(value).toBeTruthy();
  });

  it('returns null for missing keys', async () => {
    expect(await provider.get('YCLAW_TEST_NONEXISTENT_KEY_12345')).toBeNull();
  });

  it('getRequired throws for missing keys', async () => {
    await expect(provider.getRequired('YCLAW_TEST_NONEXISTENT_KEY_12345'))
      .rejects.toThrow('Required secret');
  });

  it('has() returns false for missing keys', async () => {
    expect(await provider.has('YCLAW_TEST_NONEXISTENT_KEY_12345')).toBe(false);
  });
});

// ─── InfrastructureFactory.loadConfig ───────────────────────────────────────

describe('InfrastructureFactory.loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await InfrastructureFactory.loadConfig('/nonexistent/path.yaml');
    expect(config.storage.state.type).toBe('mongodb');
    expect(config.storage.events.type).toBe('redis');
    expect(config.secrets.provider).toBe('env');
  });

  it('rejects invalid YAML content', async () => {
    // Create a temp file with invalid config
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const tmpPath = '/tmp/yclaw-test-invalid.yaml';
    writeFileSync(tmpPath, 'storage:\n  state:\n    type: dynamodb\n');
    try {
      await expect(InfrastructureFactory.loadConfig(tmpPath)).rejects.toThrow();
    } finally {
      unlinkSync(tmpPath);
    }
  });
});

// ─── HealthAggregator ───────────────────────────────────────────────────────

describe('HealthAggregator', () => {
  it('reports unhealthy when state store is down', async () => {
    const mockInfra: Infrastructure = {
      stateStore: new NullStateStore(),  // healthy() returns false
      eventBus: {
        connect: async () => {},
        disconnect: async () => {},
        healthy: () => false,
        publish: async () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        zadd: async () => {},
        zrem: async () => {},
        zrangebyscore: async () => [],
        hset: async () => {},
        hget: async () => null,
        hdel: async () => {},
        get: async () => null,
        set: async () => {},
        setnx: async () => false,
        del: async () => {},
        increment: async () => 0,
        exists: async () => 0,
      } satisfies IEventBus,
      channels: new Map(),
      secrets: new EnvSecretProvider(),
      objectStore: new LocalFileStore('/tmp/yclaw-health-test'),
    };

    const aggregator = new HealthAggregator(mockInfra);
    const health = await aggregator.check();
    expect(health.healthy).toBe(false);
    expect(health.components.find(c => c.name === 'stateStore')?.healthy).toBe(false);
  });

  it('includes objectStore in health check', async () => {
    const mockInfra: Infrastructure = {
      stateStore: new NullStateStore(),
      eventBus: {
        connect: async () => {},
        disconnect: async () => {},
        healthy: () => false,
        publish: async () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        zadd: async () => {},
        zrem: async () => {},
        zrangebyscore: async () => [],
        hset: async () => {},
        hget: async () => null,
        hdel: async () => {},
        get: async () => null,
        set: async () => {},
        setnx: async () => false,
        del: async () => {},
        increment: async () => 0,
        exists: async () => 0,
      } satisfies IEventBus,
      channels: new Map(),
      secrets: new EnvSecretProvider(),
      objectStore: new LocalFileStore('/tmp/yclaw-health-test'),
    };

    const aggregator = new HealthAggregator(mockInfra);
    const health = await aggregator.check();
    const objectStoreHealth = health.components.find(c => c.name === 'objectStore');
    expect(objectStoreHealth).toBeDefined();
  });
});

// ─── Capability consistency (#9) ────────────────────────────────────────────

describe('Channel adapter capability consistency', () => {
  it('adapters with supportsX=false do not expose the method', async () => {
    const { TwitterChannelAdapter } = await import('../src/adapters/channels/TwitterChannelAdapter.js');
    const adapter = new TwitterChannelAdapter();
    // Twitter reports false for all optional capabilities
    expect(adapter.supportsReactions()).toBe(false);
    expect(adapter.supportsThreads()).toBe(false);
    expect(adapter.supportsFileUpload()).toBe(false);
    expect(adapter.supportsIdentityOverride()).toBe(false);
  });

  it('Slack reports false for all unimplemented capabilities', async () => {
    const { SlackChannelAdapter } = await import('../src/adapters/channels/SlackChannelAdapter.js');
    const adapter = new SlackChannelAdapter();
    expect(adapter.supportsReactions()).toBe(false);
    expect(adapter.supportsFileUpload()).toBe(false);
    expect(adapter.supportsInboundListening()).toBe(false);
  });
});
