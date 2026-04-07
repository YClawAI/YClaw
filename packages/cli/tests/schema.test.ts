/**
 * Tests for the CLI config schema extension.
 */

import { describe, it, expect } from 'vitest';
import { CliConfigSchema } from '../src/schema/cli-config-schema.js';
import { YclawConfigSchema } from '@yclaw/core/infrastructure';

describe('CliConfigSchema', () => {
  it('parses empty config with defaults', () => {
    const config = CliConfigSchema.parse({});
    expect(config.storage.state.type).toBe('mongodb');
    expect(config.storage.events.type).toBe('redis');
    expect(config.secrets.provider).toBe('env');
    expect(config.llm?.defaultProvider).toBe('anthropic');
    expect(config.networking?.apiPort).toBe(3000);
    expect(config.observability?.logLevel).toBe('info');
  });

  it('accepts deployment section', () => {
    const config = CliConfigSchema.parse({
      deployment: { target: 'docker-compose' },
    });
    expect(config.deployment?.target).toBe('docker-compose');
  });

  it('accepts manual deployment target', () => {
    const config = CliConfigSchema.parse({
      deployment: { target: 'manual' },
    });
    expect(config.deployment?.target).toBe('manual');
  });

  it('rejects unknown deployment targets', () => {
    expect(() => CliConfigSchema.parse({
      deployment: { target: 'kubernetes' },
    })).toThrow();
  });

  it('accepts full config with all sections', () => {
    const config = CliConfigSchema.parse({
      storage: {
        state: { type: 'mongodb' },
        events: { type: 'redis' },
        memory: { type: 'postgresql' },
        objects: { type: 's3', bucket: 'my-bucket' },
      },
      secrets: { provider: 'aws-secrets-manager', prefix: 'prod/' },
      channels: {
        slack: { enabled: true },
        discord: { enabled: true },
      },
      deployment: { target: 'manual' },
      llm: { defaultProvider: 'openai', defaultModel: 'gpt-4o' },
      networking: { apiPort: 8080, webhookPort: 8081, missionControlPort: 8082 },
      observability: { logLevel: 'debug' },
    });
    expect(config.deployment?.target).toBe('manual');
    expect(config.llm?.defaultProvider).toBe('openai');
    expect(config.networking?.apiPort).toBe(8080);
  });

  it('rejects unknown top-level keys (strict mode)', () => {
    expect(() => CliConfigSchema.parse({
      unknownField: 'value',
    })).toThrow();
  });

  it('core subset of CLI config validates against core schema', () => {
    const cliConfig = CliConfigSchema.parse({
      deployment: { target: 'docker-compose' },
      llm: { defaultProvider: 'anthropic' },
    });

    // Extract only the core-recognized fields
    const coreSubset = {
      storage: cliConfig.storage,
      secrets: cliConfig.secrets,
      channels: cliConfig.channels,
    };

    // Must validate against the strict core schema
    expect(() => YclawConfigSchema.parse(coreSubset)).not.toThrow();
  });
});
