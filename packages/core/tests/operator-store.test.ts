import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OperatorStore } from '../src/operators/operator-store.js';
import type { Operator, Invitation } from '../src/operators/types.js';

// In-memory mock of MongoDB Collection
function createMockCollection() {
  const docs: any[] = [];

  return {
    _docs: docs,
    createIndex: vi.fn().mockResolvedValue(undefined),
    insertOne: vi.fn().mockImplementation(async (doc: any) => {
      docs.push({ ...doc });
      return { insertedId: doc.operatorId || doc.invitationId };
    }),
    findOne: vi.fn().mockImplementation(async (filter: any) => {
      return docs.find((d) => {
        for (const [k, v] of Object.entries(filter)) {
          if (d[k] !== v) return false;
        }
        return true;
      }) || null;
    }),
    find: vi.fn().mockImplementation((filter: any) => {
      let results = docs.filter((d) => {
        for (const [k, v] of Object.entries(filter)) {
          if (d[k] !== v) return false;
        }
        return true;
      });
      return {
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(results),
          }),
          toArray: vi.fn().mockResolvedValue(results),
        }),
        toArray: vi.fn().mockResolvedValue(results),
      };
    }),
    updateOne: vi.fn().mockImplementation(async (filter: any, update: any) => {
      const doc = docs.find((d) => {
        for (const [k, v] of Object.entries(filter)) {
          if (d[k] !== v) return false;
        }
        return true;
      });
      if (doc && update.$set) {
        Object.assign(doc, update.$set);
      }
      return { modifiedCount: doc ? 1 : 0 };
    }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    countDocuments: vi.fn().mockImplementation(async (filter: any) => {
      return docs.filter((d) => {
        for (const [k, v] of Object.entries(filter)) {
          if (d[k] !== v) return false;
        }
        return true;
      }).length;
    }),
  };
}

function createMockDb() {
  const collections: Record<string, ReturnType<typeof createMockCollection>> = {};
  return {
    collection: vi.fn().mockImplementation((name: string) => {
      if (!collections[name]) {
        collections[name] = createMockCollection();
      }
      return collections[name];
    }),
    _collections: collections,
  };
}

describe('OperatorStore', () => {
  let db: ReturnType<typeof createMockDb>;
  let store: OperatorStore;

  beforeEach(async () => {
    db = createMockDb();
    store = new OperatorStore(db as any);
    await store.ensureIndexes();
  });

  describe('Operator CRUD', () => {
    const testOperator: Operator = {
      operatorId: 'op_test',
      displayName: 'Test User',
      role: 'Tester',
      email: 'test@example.com',
      apiKeyHash: 'hash123',
      apiKeyPrefix: 'prefix12',
      tier: 'contributor',
      departments: ['marketing'],
      priorityClass: 50,
      limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active',
      tailscaleIPs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('creates and retrieves an operator by ID', async () => {
      await store.createOperator(testOperator);
      const found = await store.getByOperatorId('op_test');
      expect(found).not.toBeNull();
      expect(found!.operatorId).toBe('op_test');
      expect(found!.email).toBe('test@example.com');
    });

    it('retrieves by API key prefix', async () => {
      await store.createOperator(testOperator);
      const found = await store.getByApiKeyPrefix('prefix12');
      expect(found).not.toBeNull();
      expect(found!.operatorId).toBe('op_test');
    });

    it('retrieves by email', async () => {
      await store.createOperator(testOperator);
      const found = await store.getByEmail('test@example.com');
      expect(found).not.toBeNull();
    });

    it('returns null for non-existent operator', async () => {
      const found = await store.getByOperatorId('op_nonexistent');
      expect(found).toBeNull();
    });

    it('updates operator status', async () => {
      await store.createOperator(testOperator);
      await store.updateStatus('op_test', 'revoked', 'Security violation');
      const found = await store.getByOperatorId('op_test');
      expect(found!.status).toBe('revoked');
      expect(found!.revokedReason).toBe('Security violation');
    });

    it('updates API key', async () => {
      await store.createOperator(testOperator);
      await store.updateApiKey('op_test', 'newhash', 'newprefi');
      const found = await store.getByOperatorId('op_test');
      expect(found!.apiKeyHash).toBe('newhash');
      expect(found!.apiKeyPrefix).toBe('newprefi');
    });

    it('lists operators with optional filter', async () => {
      await store.createOperator(testOperator);
      await store.createOperator({
        ...testOperator,
        operatorId: 'op_root',
        email: 'root@example.com',
        apiKeyPrefix: 'rootpfx1',
        tier: 'root',
        status: 'active',
      });

      const all = await store.listOperators();
      expect(all.length).toBe(2);

      const rootOnly = await store.listOperators({ tier: 'root' });
      expect(rootOnly.length).toBe(1);
      expect(rootOnly[0]!.operatorId).toBe('op_root');
    });
  });

  describe('Invitation CRUD', () => {
    const testInvitation: Invitation = {
      invitationId: 'inv_test',
      email: 'new@example.com',
      intendedDisplayName: 'Jane Smith',
      intendedRole: 'CMO',
      intendedTier: 'department_head',
      intendedDepartments: ['marketing'],
      intendedLimits: { requestsPerMinute: 120, maxConcurrentTasks: 10, dailyTaskQuota: 200 },
      tokenHash: 'tokenhash123',
      status: 'pending',
      createdBy: 'op_root',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    };

    it('creates and retrieves an invitation by token hash', async () => {
      await store.createInvitation(testInvitation);
      const found = await store.getInvitationByTokenHash('tokenhash123');
      expect(found).not.toBeNull();
      expect(found!.email).toBe('new@example.com');
    });

    it('accepts an invitation', async () => {
      await store.createInvitation(testInvitation);
      await store.acceptInvitation('inv_test', 'op_new_user');
      const found = await store.getInvitationByTokenHash('tokenhash123');
      expect(found!.status).toBe('accepted');
      expect(found!.acceptedByOperatorId).toBe('op_new_user');
    });

    it('returns null for non-existent invitation', async () => {
      const found = await store.getInvitationByTokenHash('nonexistent');
      expect(found).toBeNull();
    });
  });
});
