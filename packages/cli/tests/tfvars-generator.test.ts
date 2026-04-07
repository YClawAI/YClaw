import { describe, it, expect } from 'vitest';
import { generateTfvars, serializeTfvars } from '../src/generators/tfvars.js';

const BASE_CONFIG = {
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
  llm: { defaultProvider: 'anthropic' as const, defaultModel: 'claude-sonnet-4-20250514' },
  networking: { apiPort: 3000 },
};

describe('generateTfvars', () => {
  it('generates default values with empty env', () => {
    const vars = generateTfvars({ config: BASE_CONFIG, env: {} });
    expect(vars.project_name).toBe('yclaw');
    expect(vars.aws_region).toBe('us-east-1');
    expect(vars.cost_tier).toBe('starter');
    expect(vars.database_type).toBe('external');
    expect(vars.llm_provider).toBe('anthropic');
  });

  it('reads values from environment', () => {
    const vars = generateTfvars({
      config: BASE_CONFIG,
      env: {
        AWS_REGION: 'eu-west-1',
        YCLAW_COST_TIER: 'production',
        YCLAW_DATABASE_TYPE: 'documentdb',
        MONGODB_URI: 'mongodb+srv://test',
        ANTHROPIC_API_KEY: 'sk-ant-test',
        YCLAW_SETUP_TOKEN: 'abc123',
        EVENT_BUS_SECRET: 'secret',
      },
    });
    expect(vars.aws_region).toBe('eu-west-1');
    expect(vars.cost_tier).toBe('production');
    expect(vars.database_type).toBe('documentdb');
    expect(vars.mongodb_uri).toBe('mongodb+srv://test');
    expect(vars.llm_api_key).toBe('sk-ant-test');
    expect(vars.setup_token).toBe('abc123');
  });

  it('maps LLM provider to correct env key', () => {
    const openaiConfig = {
      ...BASE_CONFIG,
      llm: { defaultProvider: 'openai' as const, defaultModel: 'gpt-4' },
    };
    const vars = generateTfvars({
      config: openaiConfig,
      env: { OPENAI_API_KEY: 'sk-openai' },
    });
    expect(vars.llm_provider).toBe('openai');
    expect(vars.llm_api_key).toBe('sk-openai');
  });

  it('includes optional overrides when env vars set', () => {
    const vars = generateTfvars({
      config: BASE_CONFIG,
      env: {
        YCLAW_ACM_CERT_ARN: 'arn:aws:acm:us-east-1:123:certificate/abc',
        YCLAW_DOMAIN: 'agents.example.com',
        YCLAW_ECS_CPU: '1024',
        YCLAW_ECS_MEMORY: '2048',
      },
    });
    expect(vars.acm_certificate_arn).toBe('arn:aws:acm:us-east-1:123:certificate/abc');
    expect(vars.domain_name).toBe('agents.example.com');
    expect(vars.ecs_cpu).toBe(1024);
    expect(vars.ecs_memory).toBe(2048);
  });

  it('omits optional overrides when env vars not set', () => {
    const vars = generateTfvars({ config: BASE_CONFIG, env: {} });
    expect(vars.acm_certificate_arn).toBeUndefined();
    expect(vars.domain_name).toBeUndefined();
    expect(vars.ecs_cpu).toBeUndefined();
  });
});

describe('serializeTfvars', () => {
  it('produces valid JSON', () => {
    const vars = generateTfvars({ config: BASE_CONFIG, env: {} });
    const json = serializeTfvars(vars);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('ends with newline', () => {
    const json = serializeTfvars({ foo: 'bar' });
    expect(json.endsWith('\n')).toBe(true);
  });
});
