import { describe, it, expect } from 'vitest';
import { checkNodeVersion } from '../src/validators/node.js';
import {
  checkCredential,
  checkRequiredCredentials,
} from '../src/validators/credentials.js';

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
