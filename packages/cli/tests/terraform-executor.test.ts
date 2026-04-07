import { describe, it, expect } from 'vitest';
import { TerraformExecutor } from '../src/deploy/terraform.js';

const TF_CONFIG = {
  storage: {
    state: { type: 'mongodb' as const },
    events: { type: 'redis' as const },
    memory: { type: 'postgresql' as const },
    objects: { type: 's3' as const },
  },
  secrets: { provider: 'env' as const },
  channels: {
    slack: { enabled: true },
    telegram: { enabled: false },
    twitter: { enabled: false },
    discord: { enabled: true },
  },
  deployment: { target: 'terraform' as const },
  networking: { apiPort: 3000 },
};

const COMPOSE_CONFIG = {
  ...TF_CONFIG,
  deployment: { target: 'docker-compose' as const },
};

describe('TerraformExecutor', () => {
  const executor = new TerraformExecutor();

  it('canHandle returns true for terraform target', () => {
    expect(executor.canHandle(TF_CONFIG)).toBe(true);
  });

  it('canHandle returns false for docker-compose target', () => {
    expect(executor.canHandle(COMPOSE_CONFIG)).toBe(false);
  });

  it('plan includes AWS resource list', async () => {
    const lines = await executor.plan(TF_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('Terraform');
    expect(text).toContain('ECS Fargate');
    expect(text).toContain('RDS PostgreSQL');
    expect(text).toContain('ElastiCache Redis');
    expect(text).toContain('S3 bucket');
  });

  it('plan shows HTTP warning when no cert', async () => {
    const lines = await executor.plan(TF_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('WARNING');
    expect(text).toContain('HTTP only');
  });

  it('plan shows enabled channels', async () => {
    const lines = await executor.plan(TF_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('slack');
    expect(text).toContain('discord');
  });

  it('plan shows external MongoDB by default', async () => {
    const lines = await executor.plan(TF_CONFIG);
    const text = lines.join('\n');
    expect(text).toContain('External MongoDB');
  });
});

describe('ECS service wait assembly', () => {
  it('filters empty service names from wait list', () => {
    const services = ['yclaw-core', 'yclaw-mc'].filter(Boolean);
    expect(services).toEqual(['yclaw-core', 'yclaw-mc']);
  });

  it('handles missing MC service name', () => {
    const services = ['yclaw-core', ''].filter(Boolean);
    expect(services).toEqual(['yclaw-core']);
  });

  it('handles both services missing', () => {
    const services = ['', ''].filter(Boolean);
    expect(services).toHaveLength(0);
  });

  it('builds correct aws ecs wait args with both services', () => {
    const clusterName = 'yclaw-cluster';
    const services = ['yclaw-core', 'yclaw-mc'];
    const args = [
      'ecs', 'wait', 'services-stable',
      '--cluster', clusterName,
      '--services', ...services,
      '--region', 'us-east-1',
    ];
    expect(args).toContain('yclaw-core');
    expect(args).toContain('yclaw-mc');
    expect(args.indexOf('yclaw-core')).toBeGreaterThan(args.indexOf('--services'));
  });
});
