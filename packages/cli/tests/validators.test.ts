import { describe, it, expect } from 'vitest';
import { checkNodeVersion } from '../src/validators/node.js';
import {
  checkCredential,
  checkRequiredCredentials,
} from '../src/validators/credentials.js';
import { checkGitHubReadiness } from '../src/validators/github-readiness.js';

const TEST_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'test-key-body',
  '-----END PRIVATE KEY-----',
].join('\n');

describe('checkNodeVersion', () => {
  it('passes on current Node.js (should be >= 20)', () => {
    const result = checkNodeVersion();
    expect(result.status).toBe('pass');
    expect(result.id).toBe('node-version');
    expect(result.critical).toBe(true);
  });
});

describe('checkCredential', () => {
  it('passes for valid Anthropic key', () => {
    const result = checkCredential(
      'ANTHROPIC_API_KEY',
      'sk-ant-api03-test-key',
    );
    expect(result?.status).toBe('pass');
  });

  it('fails for missing Anthropic key (H3)', () => {
    const result = checkCredential('ANTHROPIC_API_KEY', undefined);
    expect(result?.status).toBe('fail');
    expect(result?.fix).toContain('ANTHROPIC_API_KEY');
  });

  it('fails for empty Anthropic key (H3)', () => {
    const result = checkCredential('ANTHROPIC_API_KEY', '');
    expect(result?.status).toBe('fail');
  });

  it('warns for malformatted Anthropic key', () => {
    const result = checkCredential('ANTHROPIC_API_KEY', 'wrong-prefix');
    expect(result?.status).toBe('warn');
    expect(result?.what).toContain('unexpected format');
  });

  it('passes for valid Slack token', () => {
    const result = checkCredential('SLACK_BOT_TOKEN', 'xoxb-test-token');
    expect(result?.status).toBe('pass');
  });

  it('returns null for unknown credential', () => {
    const result = checkCredential('UNKNOWN_KEY', 'value');
    expect(result).toBeNull();
  });
});

describe('checkRequiredCredentials', () => {
  it('checks all required credentials', () => {
    const results = checkRequiredCredentials(
      ['ANTHROPIC_API_KEY', 'SLACK_BOT_TOKEN'],
      {
        ANTHROPIC_API_KEY: 'sk-ant-test',
        SLACK_BOT_TOKEN: undefined,
      },
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('pass');
    expect(results[1]?.status).toBe('fail');
  });
});

describe('checkGitHubReadiness', () => {
  it('fails closed when GitHub auth, repo target, and webhook secret are missing', () => {
    const results = checkGitHubReadiness({});

    expect(results.find(r => r.id === 'github-auth')?.status).toBe('fail');
    expect(results.find(r => r.id === 'github-repo-target')?.status).toBe('fail');
    expect(results.find(r => r.id === 'github-webhook-secret')?.status).toBe('fail');
  });

  it('fails partial GitHub App configuration with a concrete missing key list', () => {
    const results = checkGitHubReadiness({
      GITHUB_APP_ID: '12345',
      GITHUB_OWNER: 'example-org',
      GITHUB_REPO: 'example-repo',
      GITHUB_WEBHOOK_SECRET: 'webhook-secret',
    });

    const auth = results.find(r => r.id === 'github-auth');
    expect(auth?.status).toBe('fail');
    expect(auth?.why).toContain('GITHUB_APP_PRIVATE_KEY');
    expect(auth?.why).toContain('GITHUB_APP_INSTALLATION_ID');
  });

  it('passes with a complete GitHub App, explicit repo target, and webhook secret', () => {
    const results = checkGitHubReadiness({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY,
      GITHUB_APP_INSTALLATION_ID: '67890',
      GITHUB_OWNER: 'example-org',
      GITHUB_REPO: 'example-repo',
      GITHUB_WEBHOOK_SECRET: 'webhook-secret',
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'github-auth', status: 'pass' }),
        expect.objectContaining({ id: 'github-repo-target', status: 'pass' }),
        expect.objectContaining({ id: 'github-webhook-secret', status: 'pass' }),
      ]),
    );
  });

  it('warns when using PAT fallback instead of GitHub App auth', () => {
    const results = checkGitHubReadiness({
      GITHUB_TOKEN: 'ghp_testtoken',
      GITHUB_OWNER: 'example-org',
      GITHUB_REPO: 'example-repo',
      GITHUB_WEBHOOK_SECRET: 'webhook-secret',
    });

    const auth = results.find(r => r.id === 'github-auth');
    expect(auth?.status).toBe('warn');
    expect(auth?.fix).toContain('GITHUB_APP_ID');
  });
});
