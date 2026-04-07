import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock external I/O before the route module is imported so that vitest
// intercepts every import of these specifiers (including those inside
// route.ts itself).
// ---------------------------------------------------------------------------
vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redisPublish: vi.fn().mockResolvedValue(undefined),
  redisSet: vi.fn().mockResolvedValue(undefined),
}));
// Mock auth to bypass the RBAC check added in Phase 2
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

const { getDb } = await import('@/lib/mongodb');
const { redisPublish, redisSet } = await import('@/lib/redis');
const { PATCH } = await import('../src/app/api/org/settings/route.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake db whose collections return the provided settings doc. */
function makeDb(settingsDoc: Record<string, unknown> | null) {
  const auditInsertOne = vi.fn().mockResolvedValue({ insertedId: 'fake' });
  const settingsUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const settingsFindOne = vi.fn().mockResolvedValue(settingsDoc);

  const collections: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {
    org_settings: { findOne: settingsFindOne, updateOne: settingsUpdateOne },
    org_settings_audit: { insertOne: auditInsertOne },
  };

  return {
    db: { collection: (name: string) => collections[name] },
    auditInsertOne,
    settingsFindOne,
  };
}

/** Craft a minimal PATCH Request carrying JSON body. */
function patchRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/org/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/org/settings – auditLogging wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes audit entry and publishes audit:events when auditLogging is not set (default on)', async () => {
    // No auditLogging key in the persisted doc → defaults to enabled
    const { db, auditInsertOne } = makeDb({ defaultModel: 'claude-sonnet-4-6' });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const res = await PATCH(patchRequest({ defaultModel: 'claude-haiku-4-5' }));

    expect(res.status).toBe(200);
    expect(auditInsertOne).toHaveBeenCalledOnce();
    expect(vi.mocked(redisPublish)).toHaveBeenCalledWith(
      'audit:events',
      expect.stringContaining('setting_change'),
    );
  });

  it('writes audit entry and publishes audit:events when auditLogging is explicitly true', async () => {
    const { db, auditInsertOne } = makeDb({ auditLogging: true });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const res = await PATCH(patchRequest({ defaultModel: 'claude-haiku-4-5' }));

    expect(res.status).toBe(200);
    expect(auditInsertOne).toHaveBeenCalledOnce();
    expect(vi.mocked(redisPublish)).toHaveBeenCalledWith(
      'audit:events',
      expect.any(String),
    );
  });

  it('skips audit entry and audit:events publish when auditLogging is false in persisted settings', async () => {
    // Existing persisted settings already have auditLogging: false
    const { db, auditInsertOne } = makeDb({ auditLogging: false });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const res = await PATCH(patchRequest({ defaultModel: 'claude-haiku-4-5' }));

    expect(res.status).toBe(200);
    expect(auditInsertOne).not.toHaveBeenCalled();
    // redisPublish may be called for fleet:status etc., but NOT for audit:events
    const publishedChannels = vi.mocked(redisPublish).mock.calls.map(([ch]) => ch);
    expect(publishedChannels).not.toContain('audit:events');
  });

  it('skips audit writes when the PATCH itself disables auditLogging', async () => {
    // The request turns auditLogging off; the effective flag after the write is false
    // so no audit entry should be written for this very change.
    const { db, auditInsertOne } = makeDb({ auditLogging: true });
    vi.mocked(getDb).mockResolvedValue(db as any);

    // Simulate the db returning the updated doc (auditLogging now false)
    const { settingsFindOne } = makeDb({ auditLogging: false });
    (db.collection('org_settings') as any).findOne = settingsFindOne;

    const res = await PATCH(patchRequest({ auditLogging: false }));

    expect(res.status).toBe(200);
    expect(auditInsertOne).not.toHaveBeenCalled();
    const publishedChannels = vi.mocked(redisPublish).mock.calls.map(([ch]) => ch);
    expect(publishedChannels).not.toContain('audit:events');
  });

  it('still updates fleet:mode via redis even when auditLogging is false', async () => {
    const { db } = makeDb({ auditLogging: false, fleetMode: 'active' });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const res = await PATCH(patchRequest({ fleetMode: 'paused' }));

    expect(res.status).toBe(200);
    expect(vi.mocked(redisSet)).toHaveBeenCalledWith('fleet:mode', 'paused');
    expect(vi.mocked(redisPublish)).toHaveBeenCalledWith(
      'fleet:status',
      expect.any(String),
    );
    // But audit:events must remain silent
    const publishedChannels = vi.mocked(redisPublish).mock.calls.map(([ch]) => ch);
    expect(publishedChannels).not.toContain('audit:events');
  });
});
