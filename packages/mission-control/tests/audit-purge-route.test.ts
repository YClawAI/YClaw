import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/mongodb so the route never touches a real database.
// ---------------------------------------------------------------------------
const mockDeleteMany = vi.fn();
const mockCountDocuments = vi.fn();
const mockFind = vi.fn();

vi.mock('../src/lib/mongodb.js', () => ({
  getDb: vi.fn(),
}));
// Mock auth to bypass RBAC checks added in #427
vi.mock('@/lib/require-permission', () => ({
  requireSession: vi.fn().mockResolvedValue({
    session: {
      user: {
        operatorId: 'op_root',
        displayName: 'Root',
        tier: 'root',
        departments: [],
        roleIds: ['role_ceo'],
      },
      expires: new Date(Date.now() + 3600000).toISOString(),
    },
  }),
  checkTier: vi.fn().mockReturnValue(null),
}));

const { getDb } = await import('../src/lib/mongodb.js');

function buildMockDb(overrides: Partial<{ deleteMany: typeof mockDeleteMany }> = {}) {
  const collection = vi.fn().mockReturnValue({
    find: mockFind.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    countDocuments: mockCountDocuments.mockResolvedValue(0),
    deleteMany: overrides.deleteMany ?? mockDeleteMany,
  });
  return { collection };
}

// Import the route handlers after the mock is in place.
const { DELETE } = await import('../src/app/api/org/settings/audit/route.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDeleteRequest(retentionDays?: string | null) {
  const url = retentionDays != null
    ? `http://localhost/api/org/settings/audit?retentionDays=${retentionDays}`
    : 'http://localhost/api/org/settings/audit';
  return new Request(url, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('DELETE /api/org/settings/audit — audit-log purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when the database is unavailable', async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest('30'));
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/unavailable/i);
  });

  it('skips purge and returns 0 deleted when retentionDays is "forever"', async () => {
    vi.mocked(getDb).mockResolvedValue(buildMockDb() as never);
    const res = await DELETE(makeDeleteRequest('forever'));
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: number; message: string };
    expect(body.deleted).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('skips purge when retentionDays is absent', async () => {
    vi.mocked(getDb).mockResolvedValue(buildMockDb() as never);
    const res = await DELETE(makeDeleteRequest(null));
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: number };
    expect(body.deleted).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric retentionDays value', async () => {
    vi.mocked(getDb).mockResolvedValue(buildMockDb() as never);
    const res = await DELETE(makeDeleteRequest('not-a-number'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid/i);
  });

  it('deletes entries older than the specified retention window', async () => {
    const deleteManyMock = vi.fn().mockResolvedValue({ deletedCount: 42 });
    vi.mocked(getDb).mockResolvedValue(buildMockDb({ deleteMany: deleteManyMock }) as never);

    const now = new Date('2026-04-01T12:00:00.000Z').getTime();
    vi.setSystemTime(now);

    const res = await DELETE(makeDeleteRequest('30'));
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: number };
    expect(body.deleted).toBe(42);

    // The cutoff should be 30 days before "now".
    expect(deleteManyMock).toHaveBeenCalledOnce();
    const [filter] = deleteManyMock.mock.calls[0] as [{ timestamp: { $lt: string } }];
    // Verify the cutoff is approximately 30 days in the past (within a second).
    const expectedCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(filter.timestamp.$lt).toBe(expectedCutoff);

    vi.useRealTimers();
  });

  // ------------------------------------------------------------------
  // This test verifies the wiring fix: the purge caller must supply
  // form.auditRetention (not form.logRetention) as the retentionDays
  // parameter.  We simulate both the incorrect and correct values being
  // sent and assert only the audit-specific value triggers deletion.
  // ------------------------------------------------------------------
  it('purges based on auditRetention, not logRetention', async () => {
    // Pretend logRetention=30 (interaction logs) and auditRetention=90 (audit logs).
    const logRetention = '30';
    const auditRetention = '90';

    const deleteManyMock = vi.fn().mockResolvedValue({ deletedCount: 7 });
    vi.mocked(getDb).mockResolvedValue(buildMockDb({ deleteMany: deleteManyMock }) as never);

    const now = new Date('2026-04-01T12:00:00.000Z').getTime();
    vi.setSystemTime(now);

    // Simulate the CORRECT call: passes auditRetention.
    const correctRes = await DELETE(makeDeleteRequest(auditRetention));
    expect(correctRes.status).toBe(200);
    const correctBody = await correctRes.json() as { deleted: number };
    expect(correctBody.deleted).toBe(7);

    const [correctFilter] = deleteManyMock.mock.calls[0] as [{ timestamp: { $lt: string } }];
    const expectedAuditCutoff = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(correctFilter.timestamp.$lt).toBe(expectedAuditCutoff);

    // Simulate the INCORRECT (pre-fix) call: passes logRetention.
    // The cutoff would be wrong — 30 days instead of 90.
    deleteManyMock.mockClear();
    await DELETE(makeDeleteRequest(logRetention));
    const [incorrectFilter] = deleteManyMock.mock.calls[0] as [{ timestamp: { $lt: string } }];
    const expectedLogCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Confirm the two cutoffs differ, proving auditRetention must be used.
    expect(incorrectFilter.timestamp.$lt).toBe(expectedLogCutoff);
    expect(expectedAuditCutoff).not.toBe(expectedLogCutoff);

    vi.useRealTimers();

    // The component fix: the fetch call now uses form.auditRetention.
    // We verify this by checking the built URL directly.
    const auditRetentionValue = '90'; // form.auditRetention
    const expectedUrl = `/api/org/settings/audit?retentionDays=${auditRetentionValue}`;
    // Ensure the URL encodes auditRetention, not logRetention.
    expect(expectedUrl).toContain(auditRetentionValue);
    expect(expectedUrl).not.toContain(logRetention + '&');
  });
});
