/**
 * Tests for InfrastructureFactory and config schema.
 */

import { describe, it, expect } from 'vitest';
import { YclawConfigSchema } from '../src/infrastructure/config-schema.js';

describe('YclawConfigSchema', () => {
  it('parses empty config with defaults', () => {
    const config = YclawConfigSchema.parse({});

    expect(config.storage.state.type).toBe('mongodb');
    expect(config.storage.events.type).toBe('redis');
    expect(config.storage.memory.type).toBe('postgresql');
    expect(config.storage.objects.type).toBe('local');
    expect(config.secrets.provider).toBe('env');
    expect(config.channels).toEqual({});
  });

  it('parses full config', () => {
    const config = YclawConfigSchema.parse({
      storage: {
        state: { type: 'mongodb', uri: 'mongodb://localhost:27017', database: 'test' },
        events: { type: 'redis', url: 'redis://localhost:6379' },
        memory: { type: 'postgresql', url: 'postgresql://localhost/test' },
        objects: { type: 's3', bucket: 'my-bucket', prefix: 'yclaw/' },
      },
      secrets: { provider: 'aws-secrets-manager', prefix: 'prod/' },
      channels: {
        slack: { enabled: true, config: { token: 'xoxb-test' } },
        discord: { enabled: false },
      },
    });

    expect(config.storage.state.type).toBe('mongodb');
    expect(config.storage.objects.type).toBe('s3');
    if (config.storage.objects.type === 's3') {
      expect(config.storage.objects.bucket).toBe('my-bucket');
    }
    expect(config.secrets.provider).toBe('aws-secrets-manager');
    expect(config.channels.slack?.enabled).toBe(true);
    expect(config.channels.discord?.enabled).toBe(false);
  });

  it('rejects unknown storage types', () => {
    expect(() => YclawConfigSchema.parse({
      storage: { state: { type: 'dynamodb' } },
    })).toThrow();
  });

  it('rejects unknown secrets providers', () => {
    expect(() => YclawConfigSchema.parse({
      secrets: { provider: 'vault' },
    })).toThrow();
  });

  it('allows channel config with arbitrary keys', () => {
    const config = YclawConfigSchema.parse({
      channels: {
        slack: { enabled: true, config: { token: 'xoxb-test', webhook: 'https://...' } },
        custom_channel: { enabled: false },
      },
    });

    expect(config.channels.slack?.enabled).toBe(true);
    expect(config.channels.custom_channel?.enabled).toBe(false);
  });
});
