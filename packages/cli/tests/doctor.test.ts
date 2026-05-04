import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { runDoctor } from '../src/commands/doctor.js';

const TEST_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'test-key-body',
  '-----END PRIVATE KEY-----',
].join('\n');

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_TOKEN',
  'GITHUB_WEBHOOK_SECRET',
];

let tmpDir: string;
let originalCwd: string;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'yclaw-doctor-test-'));
  originalCwd = process.cwd();
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runDoctor', () => {
  it('includes GitHub readiness checks in preflight results', async () => {
    writeFileSync(
      join(tmpDir, 'yclaw.config.yaml'),
      stringify({
        storage: {
          state: { type: 'mongodb' },
          events: { type: 'redis' },
          memory: { type: 'postgresql' },
          objects: { type: 'local' },
        },
        secrets: { provider: 'env' },
        channels: {
          slack: { enabled: false },
          telegram: { enabled: false },
          twitter: { enabled: false },
          discord: { enabled: false },
        },
        deployment: { target: 'manual' },
        llm: {
          defaultProvider: 'anthropic',
          defaultModel: 'claude-sonnet-4-20250514',
        },
      }),
    );

    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;
    process.env.GITHUB_APP_INSTALLATION_ID = '67890';
    process.env.GITHUB_OWNER = 'example-org';
    process.env.GITHUB_REPO = 'example-repo';
    process.env.GITHUB_WEBHOOK_SECRET = 'webhook-secret';

    const results = await runDoctor();

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'github-auth', status: 'pass' }),
        expect.objectContaining({ id: 'github-repo-target', status: 'pass' }),
        expect.objectContaining({ id: 'github-webhook-secret', status: 'pass' }),
      ]),
    );
  });
});
