import { describe, it, expect, vi } from 'vitest';
import {
  buildVerificationChecks,
  runCheck,
  type VerificationCheck,
} from '../src/deploy/verification.js';

describe('buildVerificationChecks', () => {
  it('returns core-health, infra-health, and mission-control checks', () => {
    const config = {
      storage: {
        state: { type: 'mongodb' as const },
        events: { type: 'redis' as const },
        memory: { type: 'postgresql' as const },
        objects: { type: 'local' as const },
      },
      secrets: { provider: 'env' as const },
      channels: {
        slack: { enabled: false },
        telegram: { enabled: false },
        twitter: { enabled: false },
        discord: { enabled: false },
      },
      networking: { apiPort: 4000 },
    };

    const checks = buildVerificationChecks(config);
    expect(checks).toHaveLength(3);
    expect(checks[0]!.id).toBe('core-health');
    expect(checks[0]!.url).toContain(':4000');
    expect(checks[0]!.critical).toBe(true);
    expect(checks[1]!.id).toBe('infra-health');
    expect(checks[2]!.id).toBe('mission-control');
    expect(checks[2]!.critical).toBe(false);
  });

  it('uses default port 3000 when networking is not set', () => {
    const config = {
      storage: {
        state: { type: 'mongodb' as const },
        events: { type: 'redis' as const },
        memory: { type: 'postgresql' as const },
        objects: { type: 'local' as const },
      },
      secrets: { provider: 'env' as const },
      channels: {
        slack: { enabled: false },
        telegram: { enabled: false },
        twitter: { enabled: false },
        discord: { enabled: false },
      },
    };

    const checks = buildVerificationChecks(config);
    expect(checks[0]!.url).toContain(':3000');
  });
});

describe('runCheck', () => {
  it('returns pass on successful fetch', async () => {
    const check: VerificationCheck = {
      id: 'test',
      title: 'Test check',
      url: 'http://localhost:3000/health',
      critical: true,
      maxRetries: 1,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await runCheck(check, mockFetch as any);
    expect(result.status).toBe('pass');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on connection error and eventually fails', async () => {
    const check: VerificationCheck = {
      id: 'test',
      title: 'Test check',
      url: 'http://localhost:3000/health',
      critical: true,
      maxRetries: 2,
    };

    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runCheck(check, mockFetch as any);
    expect(result.status).toBe('fail');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on non-OK response', async () => {
    const check: VerificationCheck = {
      id: 'test',
      title: 'Test check',
      url: 'http://localhost:3000/health',
      critical: true,
      maxRetries: 2,
    };

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await runCheck(check, mockFetch as any);
    expect(result.status).toBe('pass');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('marks non-critical check as fail without crashing', async () => {
    const check: VerificationCheck = {
      id: 'mc',
      title: 'Mission Control',
      url: 'http://localhost:3001/',
      critical: false,
      maxRetries: 1,
    };

    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runCheck(check, mockFetch as any);
    expect(result.status).toBe('fail');
    expect(result.critical).toBe(false);
  });
});
