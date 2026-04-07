import { describe, it, expect } from 'vitest';
import { DockerComposeExecutor } from '../src/deploy/docker-compose.js';

const COMPOSE_CONFIG = {
  storage: {
    state: { type: 'mongodb' as const },
    events: { type: 'redis' as const },
    memory: { type: 'postgresql' as const },
    objects: { type: 'local' as const },
  },
  secrets: { provider: 'env' as const },
  channels: {
    slack: { enabled: true },
    telegram: { enabled: false },
    twitter: { enabled: false },
    discord: { enabled: false },
  },
  deployment: { target: 'docker-compose' as const },
  networking: { apiPort: 3000 },
};

const MANUAL_CONFIG = {
  ...COMPOSE_CONFIG,
  deployment: { target: 'manual' as const },
};

describe('DockerComposeExecutor', () => {
  const executor = new DockerComposeExecutor();

  it('canHandle returns true for docker-compose target', () => {
    expect(executor.canHandle(COMPOSE_CONFIG)).toBe(true);
  });

  it('canHandle returns false for manual target', () => {
    expect(executor.canHandle(MANUAL_CONFIG)).toBe(false);
  });

  it('plan includes compose file path', async () => {
    const lines = await executor.plan(COMPOSE_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('deploy/docker-compose/docker-compose.yml');
  });

  it('plan includes core services', async () => {
    const lines = await executor.plan(COMPOSE_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('yclaw');
    expect(text).toContain('mission-control');
    expect(text).toContain('mongodb');
    expect(text).toContain('redis');
    expect(text).toContain('postgres');
  });

  it('plan lists enabled channels', async () => {
    const lines = await executor.plan(COMPOSE_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('slack');
  });

  it('plan shows API and MC ports', async () => {
    const lines = await executor.plan(COMPOSE_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('http://localhost:3000');
    expect(text).toContain('http://localhost:3001');
  });
});
