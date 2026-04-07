import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * OnboardingStore tests — unit tests with mocked MongoDB.
 *
 * Tests cover: session CRUD, unique active session constraint,
 * optimistic concurrency, stage transitions, job lifecycle.
 */

// Mock MongoDB collections
function createMockCollection(primaryKey: string, uniqueConstraint?: (doc: any, existing: any) => boolean) {
  const store = new Map<string, any>();
  return {
    _store: store,
    insertOne: vi.fn(async (doc: any) => {
      const pk = doc[primaryKey] as string;
      if (store.has(pk)) {
        throw new Error(`E11000 duplicate key error collection: ${primaryKey}`);
      }
      if (uniqueConstraint) {
        for (const existing of store.values()) {
          if (uniqueConstraint(doc, existing)) {
            throw new Error('E11000 duplicate key error collection: unique_constraint');
          }
        }
      }
      store.set(pk, { ...doc });
      return { insertedId: pk };
    }),
    findOne: vi.fn(async (filter: any) => {
      for (const doc of store.values()) {
        let matches = true;
        for (const [key, val] of Object.entries(filter)) {
          if (doc[key] !== val) { matches = false; break; }
        }
        if (matches) return { ...doc };
      }
      return null;
    }),
    findOneAndUpdate: vi.fn(async (filter: any, update: any, opts: any) => {
      for (const [id, doc] of store.entries()) {
        let matches = true;
        for (const [key, val] of Object.entries(filter)) {
          if (doc[key] !== val) { matches = false; break; }
        }
        if (matches) {
          const updated = { ...doc };
          if (update.$set) Object.assign(updated, update.$set);
          if (update.$inc) {
            for (const [k, v] of Object.entries(update.$inc)) {
              updated[k] = (updated[k] ?? 0) + (v as number);
            }
          }
          store.set(id, updated);
          return opts?.returnDocument === 'after' ? { ...updated } : { ...doc };
        }
      }
      return null;
    }),
    updateMany: vi.fn(async (filter: any, update: any) => {
      let modified = 0;
      for (const [id, doc] of store.entries()) {
        let matches = true;
        for (const [key, val] of Object.entries(filter)) {
          if (key === 'status' && typeof val === 'object' && '$in' in val) {
            if (!(val.$in as string[]).includes(doc[key])) { matches = false; break; }
          } else if (key === 'updatedAt' && typeof val === 'object' && '$lt' in val) {
            if (!(doc[key] < val.$lt)) { matches = false; break; }
          } else if (doc[key] !== val) {
            matches = false; break;
          }
        }
        if (matches) {
          if (update.$set) Object.assign(doc, update.$set);
          store.set(id, doc);
          modified++;
        }
      }
      return { modifiedCount: modified };
    }),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        toArray: vi.fn(async () => {
          return [...store.values()];
        }),
      })),
    })),
    createIndex: vi.fn(async () => 'index_name'),
  };
}

function createMockDb() {
  const collections = new Map<string, ReturnType<typeof createMockCollection>>();
  return {
    collection: vi.fn((name: string) => {
      if (!collections.has(name)) {
        if (name === 'onboarding_sessions') {
          collections.set(name, createMockCollection('sessionId', (doc, existing) =>
            doc.orgId === existing.orgId && doc.status === 'active' && existing.status === 'active',
          ));
        } else {
          collections.set(name, createMockCollection('jobId'));
        }
      }
      return collections.get(name)!;
    }),
    _getCollection: (name: string) => collections.get(name),
  };
}

// Import after mock setup (dynamic import not needed since we inject the mock db)
import { OnboardingStore } from '../src/onboarding/onboarding-store.js';
import { OnboardingConflictError, OnboardingNotFoundError } from '../src/onboarding/types.js';

describe('OnboardingStore', () => {
  let db: ReturnType<typeof createMockDb>;
  let store: OnboardingStore;

  beforeEach(() => {
    db = createMockDb();
    store = new OnboardingStore(db as any);
  });

  describe('session lifecycle', () => {
    it('creates a session with initial state', async () => {
      const session = await store.createSession('op_root', 'yclaw');
      expect(session.sessionId).toBeTruthy();
      expect(session.operatorId).toBe('op_root');
      expect(session.orgId).toBe('yclaw');
      expect(session.stage).toBe('org_framing');
      expect(session.currentQuestion).toBe(0);
      expect(session.status).toBe('active');
      expect(session.version).toBe(1);
      expect(session.artifacts).toEqual([]);
      expect(session.assets).toEqual([]);
      expect(session.answers).toEqual({});
    });

    it('retrieves session by ID', async () => {
      const created = await store.createSession('op_root', 'yclaw');
      const retrieved = await store.getSession(created.sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(created.sessionId);
    });

    it('retrieves active session by org', async () => {
      await store.createSession('op_root', 'yclaw');
      const active = await store.getActiveSession('yclaw');
      expect(active).not.toBeNull();
      expect(active!.orgId).toBe('yclaw');
    });

    it('rejects duplicate active session for same org', async () => {
      await store.createSession('op_root', 'yclaw');
      await expect(store.createSession('op_root', 'yclaw'))
        .rejects.toThrow(OnboardingConflictError);
    });
  });

  describe('optimistic concurrency', () => {
    it('updates session with correct version', async () => {
      const session = await store.createSession('op_root', 'yclaw');
      const updated = await store.updateSession(session.sessionId, 1, {
        stage: 'ingestion',
        currentQuestion: 0,
      });
      expect(updated.stage).toBe('ingestion');
      expect(updated.version).toBe(2);
    });

    it('rejects update with stale version', async () => {
      const session = await store.createSession('op_root', 'yclaw');
      // First update succeeds (version 1 → 2)
      await store.updateSession(session.sessionId, 1, { currentQuestion: 1 });
      // Second update with stale version 1 fails
      await expect(store.updateSession(session.sessionId, 1, { currentQuestion: 2 }))
        .rejects.toThrow(OnboardingConflictError);
    });

    it('allows sequential updates with incrementing versions', async () => {
      const session = await store.createSession('op_root', 'yclaw');
      const v2 = await store.updateSession(session.sessionId, 1, { currentQuestion: 1 });
      const v3 = await store.updateSession(session.sessionId, 2, { currentQuestion: 2 });
      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);
      expect(v3.currentQuestion).toBe(2);
    });
  });

  describe('cancel session', () => {
    it('cancels an active session', async () => {
      const session = await store.createSession('op_root', 'yclaw');
      const cancelled = await store.cancelSession(session.sessionId);
      expect(cancelled.status).toBe('cancelled');
    });

    it('throws NotFoundError for missing session', async () => {
      await expect(store.cancelSession('nonexistent'))
        .rejects.toThrow(OnboardingNotFoundError);
    });

    it('throws ConflictError for already completed session', async () => {
      const session = await store.createSession('op_root', 'yclaw');
      await store.updateSession(session.sessionId, 1, { status: 'completed' });
      await expect(store.cancelSession(session.sessionId))
        .rejects.toThrow(OnboardingConflictError);
    });
  });

  describe('ingestion jobs', () => {
    it('creates a job with queued status', async () => {
      const job = await store.createJob('session-1', 'file', 'test.pdf');
      expect(job.jobId).toBeTruthy();
      expect(job.status).toBe('queued');
      expect(job.source).toBe('file');
      expect(job.sourceUri).toBe('test.pdf');
    });

    it('retrieves job by ID', async () => {
      const created = await store.createJob('session-1', 'url', 'https://example.com');
      const retrieved = await store.getJob(created.jobId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.jobId).toBe(created.jobId);
    });

    it('updates job status and progress', async () => {
      const job = await store.createJob('session-1', 'file', 'doc.pdf');
      const updated = await store.updateJob(job.jobId, { status: 'running', progress: 50 });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('running');
      expect(updated!.progress).toBe(50);
    });

    it('cancels pending jobs for a session', async () => {
      const session = await store.createSession('op_root', 'yclaw');
      await store.createJob(session.sessionId, 'file', 'a.pdf');
      await store.createJob(session.sessionId, 'url', 'https://b.com');
      const count = await store.cancelSessionJobs(session.sessionId);
      expect(count).toBe(2);
    });
  });
});
