import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DepartmentSeeder } from '../src/onboarding/department-seeder.js';
import type { OnboardingSession, ArtifactDraft, OnboardingAsset } from '../src/onboarding/types.js';

function createMockCollection() {
  const store = new Map<string, any>();
  return {
    createIndex: vi.fn(),
    updateOne: vi.fn(async (_filter: any, update: any, _opts: any) => {
      const doc = update.$set;
      store.set(doc.slug, doc);
      return { modifiedCount: 1 };
    }),
    _store: store,
  };
}

function createMockDb() {
  const collections = new Map<string, ReturnType<typeof createMockCollection>>();
  return {
    collection: vi.fn((name: string) => {
      if (!collections.has(name)) collections.set(name, createMockCollection());
      return collections.get(name)!;
    }),
    _getCollection: (name: string) => collections.get(name),
  };
}

function createSession(overrides?: Partial<OnboardingSession>): OnboardingSession {
  return {
    sessionId: 'test-session',
    operatorId: 'op_root',
    orgId: 'yclaw',
    stage: 'departments',
    currentQuestion: 0,
    answers: {
      org_departments: 'Development, Marketing, Support',
    },
    artifacts: [],
    assets: [],
    status: 'active',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DepartmentSeeder', () => {
  let db: ReturnType<typeof createMockDb>;
  let seeder: DepartmentSeeder;

  beforeEach(() => {
    db = createMockDb();
    seeder = new DepartmentSeeder(db as any);
  });

  it('seeds departments from answers when no artifact', async () => {
    const session = createSession();
    const configs = await seeder.seedFromSession(session, 'op_root');

    expect(configs.length).toBe(3);
    expect(configs.map(c => c.slug)).toContain('development');
    expect(configs.map(c => c.slug)).toContain('marketing');
    expect(configs.map(c => c.slug)).toContain('support');
  });

  it('uses preset data for known departments', async () => {
    const session = createSession();
    const configs = await seeder.seedFromSession(session, 'op_root');

    const dev = configs.find(c => c.slug === 'development');
    expect(dev).toBeDefined();
    expect(dev!.agents).toContain('architect');
    expect(dev!.charter).toBeTruthy();
    expect(dev!.recurringTasks.length).toBeGreaterThan(0);
  });

  it('creates fallback preset for unknown departments', async () => {
    const session = createSession({
      answers: { org_departments: 'Engineering, Design' },
    });
    const configs = await seeder.seedFromSession(session, 'op_root');

    const eng = configs.find(c => c.slug === 'engineering');
    expect(eng).toBeDefined();
    expect(eng!.name).toBe('Engineering');
    expect(eng!.agents).toEqual([]);
  });

  it('maps assets to departments by classification', async () => {
    const session = createSession({
      assets: [
        {
          assetId: 'asset-1',
          source: 'file',
          sourceUri: 'spec.md',
          filename: 'spec.md',
          contentHash: 'abc',
          summary: 'Tech spec',
          classification: 'technical_spec',
          extractedText: 'content',
          importJobId: 'job-1',
          importedAt: new Date(),
          sizeBytes: 100,
          objectKey: 'onboarding/assets/asset-1',
        } satisfies OnboardingAsset,
      ],
    });

    const configs = await seeder.seedFromSession(session, 'op_root');
    const dev = configs.find(c => c.slug === 'development');
    expect(dev!.assets).toContain('asset-1');
  });

  it('uses approved DEPARTMENTS.yaml artifact', async () => {
    const artifact: ArtifactDraft = {
      id: 'art-1',
      type: 'departments',
      filename: 'DEPARTMENTS.yaml',
      content: `- name: Engineering\n  description: Build things\n- name: Growth\n  description: Grow things`,
      status: 'approved',
      generatedAt: new Date(),
      approvedAt: new Date(),
    };

    const session = createSession({ artifacts: [artifact] });
    const configs = await seeder.seedFromSession(session, 'op_root');

    expect(configs.map(c => c.slug)).toContain('engineering');
    expect(configs.map(c => c.slug)).toContain('growth');
  });

  it('falls back to presets when artifact is malformed', async () => {
    const artifact: ArtifactDraft = {
      id: 'art-1',
      type: 'departments',
      filename: 'DEPARTMENTS.yaml',
      content: 'this is not valid yaml: [[[',
      status: 'approved',
      generatedAt: new Date(),
      approvedAt: new Date(),
    };

    const session = createSession({ artifacts: [artifact] });
    const configs = await seeder.seedFromSession(session, 'op_root');

    // Falls back to all 6 preset departments
    expect(configs.length).toBe(6);
  });

  it('upserts to MongoDB', async () => {
    const session = createSession({
      answers: { org_departments: 'Development' },
    });
    await seeder.seedFromSession(session, 'op_root');

    const collection = db._getCollection('departments')!;
    expect(collection.updateOne).toHaveBeenCalled();
    const stored = collection._store.get('development');
    expect(stored).toBeDefined();
    expect(stored.createdBy).toBe('op_root');
  });
});
