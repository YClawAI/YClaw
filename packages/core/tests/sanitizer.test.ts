import { describe, it, expect } from 'vitest';
import {
  containsSensitiveContent,
  sanitizeField,
  sanitizeEventSummary,
  roundToMinute,
} from '../src/public/sanitizer.js';

describe('containsSensitiveContent', () => {
  it('detects Anthropic/OpenAI API keys', () => {
    expect(containsSensitiveContent('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(containsSensitiveContent('sk-proj-1234567890abcdefghij')).toBe(true);
  });

  it('detects GitHub tokens', () => {
    expect(containsSensitiveContent('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')).toBe(true);
    expect(containsSensitiveContent('github_pat_1234567890ABCDEFGHIJKL')).toBe(true);
  });

  it('detects Slack tokens', () => {
    expect(containsSensitiveContent('xoxb-123456789-abcdefghij')).toBe(true);
    expect(containsSensitiveContent('xoxp-some-slack-token-here')).toBe(true);
  });

  it('detects Ethereum addresses', () => {
    expect(containsSensitiveContent('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18')).toBe(true);
  });

  it('detects MongoDB URIs', () => {
    expect(containsSensitiveContent('mongodb+srv://user:pass@cluster.mongodb.net/db')).toBe(true);
    expect(containsSensitiveContent('mongodb://localhost:27017/mydb')).toBe(true);
  });

  it('detects Redis URIs', () => {
    expect(containsSensitiveContent('redis://user:pass@host:6379/0')).toBe(true);
  });

  it('detects internal IP URLs', () => {
    expect(containsSensitiveContent('http://10.0.1.42:3000')).toBe(true);
    expect(containsSensitiveContent('https://192.168.1.1/api')).toBe(true);
  });

  it('detects bare IP addresses', () => {
    expect(containsSensitiveContent('Connect to 10.0.1.42 for details')).toBe(true);
  });

  it('detects AWS ARNs', () => {
    expect(containsSensitiveContent('arn:aws:iam::123456789:role/my-role')).toBe(true);
  });

  it('detects AWS resource IDs', () => {
    expect(containsSensitiveContent('subnet-0abc123def456')).toBe(true);
    expect(containsSensitiveContent('sg-0abc123def456')).toBe(true);
    expect(containsSensitiveContent('i-0abc123def456789a')).toBe(true);
  });

  it('detects AWS access keys', () => {
    expect(containsSensitiveContent('AKIAIOSFODNN7EXAMPLE')).toBe(true);
  });

  it('detects JWT tokens', () => {
    expect(containsSensitiveContent('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0')).toBe(true);
  });

  it('passes clean agent status messages', () => {
    expect(containsSensitiveContent('Architect completed PR review')).toBe(false);
    expect(containsSensitiveContent('Scout analyzing market trends')).toBe(false);
    expect(containsSensitiveContent('Builder deployed feature to staging')).toBe(false);
  });

  it('passes clean department names and descriptions', () => {
    expect(containsSensitiveContent('Executive department')).toBe(false);
    expect(containsSensitiveContent('Marketing strategy agent')).toBe(false);
  });
});

describe('sanitizeField', () => {
  it('returns fallback for null/undefined', () => {
    expect(sanitizeField(null, 'default')).toBe('default');
    expect(sanitizeField(undefined, 'default')).toBe('default');
  });

  it('returns [redacted] for sensitive content', () => {
    expect(sanitizeField('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')).toBe('[redacted]');
  });

  it('passes clean strings through', () => {
    expect(sanitizeField('Architect')).toBe('Architect');
    expect(sanitizeField('Task completed successfully')).toBe('Task completed successfully');
  });
});

describe('sanitizeEventSummary', () => {
  it('returns generic fallback for null/undefined/empty', () => {
    expect(sanitizeEventSummary(null)).toBe('Agent processing task');
    expect(sanitizeEventSummary(undefined)).toBe('Agent processing task');
    expect(sanitizeEventSummary('')).toBe('Agent processing task');
    expect(sanitizeEventSummary('   ')).toBe('Agent processing task');
  });

  it('passes clean summaries through', () => {
    expect(sanitizeEventSummary('Architect reviewing PR #42')).toBe('Architect reviewing PR #42');
  });

  it('redacts embedded secrets in mixed content', () => {
    const mixed = 'Deploying with key sk-ant-api03-abcdefghijklmnopqrstuvwxyz to production';
    const result = sanitizeEventSummary(mixed);
    expect(result).not.toContain('sk-ant-api03');
    expect(result).toContain('[redacted]');
  });

  it('truncates long summaries', () => {
    const long = 'A'.repeat(300);
    const result = sanitizeEventSummary(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/\.\.\.$/);
  });

  it('returns generic fallback when too many redactions', () => {
    const manySecrets = 'Key1: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA Key2: ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB Key3: ghp_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    expect(sanitizeEventSummary(manySecrets)).toBe('Agent processing task');
  });
});

describe('roundToMinute', () => {
  it('rounds seconds and milliseconds to zero', () => {
    const result = roundToMinute(new Date('2026-04-09T10:30:45.123Z'));
    expect(result).toBe('2026-04-09T10:30:00.000Z');
  });

  it('accepts ISO string input', () => {
    const result = roundToMinute('2026-04-09T10:30:45.123Z');
    expect(result).toBe('2026-04-09T10:30:00.000Z');
  });
});
