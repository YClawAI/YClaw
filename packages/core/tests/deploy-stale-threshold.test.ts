import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeployExecutor } from '../src/actions/deploy/index.js';
import { STALE_DEPLOYMENT_THRESHOLD_MS } from '../src/actions/deploy/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAuditLog(overrides: Record<string, unknown> = {}) {
  return {
    recordDeployment: vi.fn().mockResolvedValue(undefined),
    updateDeployment: vi.fn().mockResolvedValue(undefined),
    getDeployment: vi.fn().mockResolvedValue(null),
    getDeploymentHistory: vi.fn().mockResolvedValue([]),
    clearPendingDeployments: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as import('../src/logging/audit.js').AuditLog;
}

function makeRegistry(tier: string = 'auto') {
  const config = {
    risk_tier: tier,
    deployment: { type: 'vercel', health_check_url: null },
  };
  return {
    get: vi.fn().mockReturnValue(config),
    getAll: vi.fn().mockReturnValue(new Map()),
    size: 1,
  } as unknown as import('../src/config/repo-registry.js').RepoRegistry;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('STALE_DEPLOYMENT_THRESHOLD_MS wiring', () => {
  it('exports the constant with correct 2-hour value', () => {
    expect(STALE_DEPLOYMENT_THRESHOLD_MS).toBe(2 * 60 * 60 * 1000);
  });

  describe('DeployExecutor.clearStalePendingDeployments()', () => {
    let auditLog: ReturnType<typeof makeAuditLog>;
    let executor: DeployExecutor;

    beforeEach(() => {
      auditLog = makeAuditLog();
      executor = new DeployExecutor(auditLog, makeRegistry());
    });

    it('calls auditLog.clearPendingDeployments with STALE_DEPLOYMENT_THRESHOLD_MS', async () => {
      const cleared = await executor.clearStalePendingDeployments();

      expect(auditLog.clearPendingDeployments).toHaveBeenCalledOnce();
      const [, thresholdArg] = (auditLog.clearPendingDeployments as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number];
      expect(thresholdArg).toBe(STALE_DEPLOYMENT_THRESHOLD_MS);
      expect(cleared).toBe(0);
    });

    it('passes a descriptive reason string', async () => {
      await executor.clearStalePendingDeployments();

      const [reasonArg] = (auditLog.clearPendingDeployments as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number];
      expect(typeof reasonArg).toBe('string');
      expect(reasonArg.length).toBeGreaterThan(0);
    });

    it('returns the count from auditLog', async () => {
      (auditLog.clearPendingDeployments as ReturnType<typeof vi.fn>).mockResolvedValue(3);

      const cleared = await executor.clearStalePendingDeployments();

      expect(cleared).toBe(3);
    });

    it('uses 2-hour threshold — not the 30-minute dedup TTL', async () => {
      await executor.clearStalePendingDeployments();

      const [, thresholdArg] = (auditLog.clearPendingDeployments as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number];
      // ASSESS_DEDUP_TTL is 30 min = 30 * 60 * 1000 ms
      const thirtyMinMs = 30 * 60 * 1000;
      expect(thresholdArg).toBeGreaterThan(thirtyMinMs);
      // STALE_DEPLOYMENT_THRESHOLD_MS is 2 hours
      expect(thresholdArg).toBe(2 * 60 * 60 * 1000);
    });
  });
});
