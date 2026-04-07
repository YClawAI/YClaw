import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { loadConfig } from '../src/utils/load-config.js';

let TMP_DIR: string;

beforeEach(() => {
  TMP_DIR = mkdtempSync(join(tmpdir(), 'yclaw-config-test-'));
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads valid config', async () => {
    writeFileSync(
      join(TMP_DIR, 'yclaw.config.yaml'),
      stringify({
        storage: {
          state: { type: 'mongodb' },
          events: { type: 'redis' },
        },
        deployment: { target: 'docker-compose' },
      }),
    );

    const config = await loadConfig(TMP_DIR);
    expect(config.storage.state.type).toBe('mongodb');
    expect(config.deployment?.target).toBe('docker-compose');
  });

  it('throws CliError for missing config', async () => {
    await expect(loadConfig('/tmp/yclaw-nonexistent'))
      .rejects.toThrow('Config file not found');
  });

  it('throws CliError for invalid YAML', async () => {
    writeFileSync(
      join(TMP_DIR, 'yclaw.config.yaml'),
      '{ invalid: yaml: syntax',
    );

    await expect(loadConfig(TMP_DIR)).rejects.toThrow();
  });

  it('throws CliError for schema violations', async () => {
    writeFileSync(
      join(TMP_DIR, 'yclaw.config.yaml'),
      stringify({
        storage: { state: { type: 'dynamodb' } },
      }),
    );

    await expect(loadConfig(TMP_DIR))
      .rejects.toThrow('Config validation failed');
  });

  it('applies defaults for missing optional fields', async () => {
    writeFileSync(
      join(TMP_DIR, 'yclaw.config.yaml'),
      stringify({}),
    );

    const config = await loadConfig(TMP_DIR);
    expect(config.storage.state.type).toBe('mongodb');
    expect(config.secrets.provider).toBe('env');
    expect(config.llm?.defaultProvider).toBe('anthropic');
  });
});
