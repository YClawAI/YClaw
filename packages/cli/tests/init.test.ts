import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { runNonInteractive } from '../src/wizard/runner.js';
import { generateConfigYaml } from '../src/generators/config-yaml.js';
import { generateEnvFile } from '../src/generators/env-file.js';
import { generateDockerCompose } from '../src/generators/docker-compose.js';
import { CliConfigSchema } from '../src/schema/cli-config-schema.js';
import { YclawConfigSchema } from '@yclaw/core/infrastructure';

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
});
