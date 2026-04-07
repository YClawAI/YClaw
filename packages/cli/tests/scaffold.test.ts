/**
 * Step 1 scaffold verification tests.
 * Validates monorepo wiring and core import paths.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  YclawConfigBaseShape,
  YclawConfigSchema,
} from '@yclaw/core/infrastructure';

describe('Monorepo wiring', () => {
  it('imports YclawConfigBaseShape from @yclaw/core/infrastructure', () => {
    expect(YclawConfigBaseShape).toBeDefined();
    expect(typeof YclawConfigBaseShape.parse).toBe('function');
  });

  it('imports YclawConfigSchema (strict) from @yclaw/core/infrastructure', () => {
    expect(YclawConfigSchema).toBeDefined();
    expect(typeof YclawConfigSchema.parse).toBe('function');
  });

  it('YclawConfigBaseShape.parse({}) produces valid defaults', () => {
    const config = YclawConfigBaseShape.parse({});
    expect(config.storage.state.type).toBe('mongodb');
    expect(config.storage.events.type).toBe('redis');
    expect(config.secrets.provider).toBe('env');
  });

  it('YclawConfigBaseShape can be extended without error', () => {
    const extended = YclawConfigBaseShape.extend({
      deployment: z.object({
        target: z.enum(['docker-compose', 'manual']),
      }).optional(),
    }).strict();

    const config = extended.parse({});
    expect(config.storage.state.type).toBe('mongodb');
  });

  it('Extended schema accepts CLI-specific fields', () => {
    const extended = YclawConfigBaseShape.extend({
      deployment: z.object({
        target: z.enum(['docker-compose', 'manual']),
      }).optional(),
    }).strict();

    const config = extended.parse({
      deployment: { target: 'docker-compose' },
    });
    expect(config.deployment?.target).toBe('docker-compose');
  });

  it('Core strict schema rejects CLI-specific fields', () => {
    expect(() => YclawConfigSchema.parse({
      deployment: { target: 'docker-compose' },
    })).toThrow();
  });
});
