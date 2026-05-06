import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { runNonInteractive } from '../src/wizard/runner.js';
import { generateConfigYaml } from '../src/generators/config-yaml.js';
import { generateEnvFile } from '../src/generators/env-file.js';
import { generateDockerCompose } from '../src/generators/docker-compose.js';
import { CliConfigSchema } from '../src/schema/cli-config-schema.js';
import { YclawConfigSchema } from '@yclaw/core/infrastructure';

const GITHUB_ENV_KEYS = [
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_TOKEN',
  'GITHUB_WEBHOOK_SECRET',
];

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of GITHUB_ENV_KEYS) {
    originalEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of GITHUB_ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

describe('Non-interactive init', () => {
  it('local-demo: produces valid config + env + compose', () => {
    const plan = runNonInteractive('local-demo');

    // Config round-trips
    const configYaml = generateConfigYaml(plan);
    const parsed = parseYaml(configYaml);
    expect(() => CliConfigSchema.parse(parsed)).not.toThrow();

    // Core subset validates
    const coreSubset = {
      storage: parsed.storage,
      secrets: parsed.secrets,
      channels: parsed.channels,
    };
    expect(() => YclawConfigSchema.parse(coreSubset)).not.toThrow();

    // Env file has expected keys
    const envFile = generateEnvFile(plan);
    expect(envFile).toContain('MONGODB_URI=');
    expect(envFile).toContain('ANTHROPIC_API_KEY=');
    expect(envFile).toContain('EVENT_BUS_SECRET=');

    // Docker compose is generated
    expect(plan.compose).not.toBeNull();
    const composeYaml = generateDockerCompose(plan);
    const composeParsed = parseYaml(composeYaml);
    expect(composeParsed.services.yclaw).toBeDefined();
    expect(composeParsed.services['mission-control']).toBeDefined();
    expect(composeParsed.services.ao).toBeDefined();
  });

  it('small-team: includes Slack token in env', () => {
    const plan = runNonInteractive('small-team');
    const envFile = generateEnvFile(plan);
    expect(envFile).toContain('SLACK_BOT_TOKEN=');
  });

  it('aws-production: no docker-compose, has S3 config', () => {
    const plan = runNonInteractive('aws-production');
    expect(plan.compose).toBeNull();

    const configYaml = generateConfigYaml(plan);
    const parsed = parseYaml(configYaml);
    expect(parsed.storage.objects.type).toBe('s3');
  });

  it('rejects unknown preset', () => {
    expect(() => runNonInteractive('nonexistent')).toThrow('Unknown preset');
  });

  it('each preset generates unique EVENT_BUS_SECRET', () => {
    const plan1 = runNonInteractive('local-demo');
    const plan2 = runNonInteractive('local-demo');
    expect(plan1.env.EVENT_BUS_SECRET).not.toBe(plan2.env.EVENT_BUS_SECRET);
  });

  // M12: Integration test — generated YAML passes the ACTUAL runtime loader
  it('generated config passes strict core YclawConfigSchema (runtime compat)', () => {
    for (const preset of ['local-demo', 'small-team', 'aws-production'] as const) {
      const plan = runNonInteractive(preset);
      const configYaml = generateConfigYaml(plan);
      const parsed = parseYaml(configYaml);

      // This is the exact same parse the runtime uses in InfrastructureFactory.loadConfig()
      expect(() => YclawConfigSchema.parse(parsed)).not.toThrow();
    }
  });

  it('aws-production: manual env has DB placeholders', () => {
    const plan = runNonInteractive('aws-production');
    const envFile = generateEnvFile(plan);
    expect(envFile).toContain('MONGODB_URI=');
    expect(envFile).toContain('REDIS_URL=');
    expect(envFile).toContain('MEMORY_DATABASE_URL=');
    expect(envFile).toContain('YCLAW_S3_BUCKET=');
  });

  it('aws-production: secrets provider is env (not aws-secrets-manager)', () => {
    const plan = runNonInteractive('aws-production');
    expect(plan.config.secrets.provider).toBe('env');
  });

  it('passes GitHub readiness values from environment into generated env', () => {
    process.env.GITHUB_OWNER = 'ExampleOrg';
    process.env.GITHUB_REPO = 'example-repo';
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
    process.env.GITHUB_APP_INSTALLATION_ID = '67890';
    process.env.GITHUB_WEBHOOK_SECRET = 'from-env-webhook-secret';

    const plan = runNonInteractive('local-demo');

    expect(plan.env.GITHUB_OWNER).toBe('ExampleOrg');
    expect(plan.env.GITHUB_REPO).toBe('example-repo');
    expect(plan.env.GITHUB_APP_ID).toBe('12345');
    expect(plan.env.GITHUB_APP_INSTALLATION_ID).toBe('67890');
    expect(plan.env.GITHUB_WEBHOOK_SECRET).toBe('from-env-webhook-secret');
  });
});
