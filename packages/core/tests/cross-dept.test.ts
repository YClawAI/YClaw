import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrossDeptStore } from '../src/operators/cross-dept.js';

function createMockCollection() {
  const docs: any[] = [];
  return {
    _docs: docs,
    createIndex: vi.fn().mockResolvedValue(undefined),
    insertOne: vi.fn().mockImplementation(async (doc: any) => {
      docs.push({ ...doc });
      return { insertedId: doc.requestId };
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
          if (typeof v === 'object' && v !== null && '$lt' in v) {
            if (!(d[k] < v.$lt)) return false;
          } else if (d[k] !== v) {
            return false;
          }
        }
        return true;
      });
      return {
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(results),
        }),
      };
    }),
    updateOne: vi.fn().mockImplementation(async (filter: any, update: any) => {
      const doc = docs.find((d) => {
        for (const [k, v] of Object.entries(filter)) {
          if (typeof v === 'object' && v !== null && '$lt' in v) {
            if (!(d[k] < v.$lt)) return false;
          } else if (d[k] !== v) {
            return false;
          }
        }
        return true;
      });
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { modifiedCount: doc ? 1 : 0 };
    }),
    updateMany: vi.fn().mockImplementation(async (filter: any, update: any) => {
      let count = 0;
      for (const doc of docs) {
        let matches = true;
        for (const [k, v] of Object.entries(filter)) {
          if (typeof v === 'object' && v !== null && '$lt' in v) {
            if (!(doc[k] < v.$lt)) { matches = false; break; }
          } else if (doc[k] !== v) {
            matches = false; break;
          }
        }
        if (matches && update.$set) {
          Object.assign(doc, update.$set);
          count++;
        }
      }
      return { modifiedCount: count };
    }),
  };
}

function createMockDb() {
  const collections: Record<string, ReturnType<typeof createMockCollection>> = {};
  return {
    collection: vi.fn().mockImplementation((name: string) => {
      if (!collections[name]) collections[name] = createMockCollection();
      return collections[name];
    }),
  };
}

describe('CrossDeptStore', () => {
  let db: ReturnType<typeof createMockDb>;
  let store: CrossDeptStore;

  beforeEach(async () => {
    db = createMockDb();
    store = new CrossDeptStore(db as any);
    await store.ensureIndexes();
  });

  it('creates a cross-dept request', async () => {
    const req = await store.create({
      requestingOperatorId: 'op_cmo',
      requestingOperatorName: 'CMO',
      requestingDepartment: 'marketing',
      requesterTier: 'department_head',
      requesterPriority: 70,
      requesterDepartments: ['marketing'],
      targetDepartment: 'development',
      targetAgent: 'builder',
      task: 'Build landing page',
      reason: 'Need frontend help',
    });

    expect(req.requestId).toMatch(/^xdept_/);
    expect(req.status).toBe('pending');
    expect(req.targetDepartment).toBe('development');
  });

  it('retrieves a request by ID', async () => {
    const created = await store.create({
      requestingOperatorId: 'op_cmo',
      requestingOperatorName: 'CMO',
      requestingDepartment: 'marketing',
      requesterTier: 'department_head',
      requesterPriority: 70,
      requesterDepartments: ['marketing'],
      targetDepartment: 'development',
      targetAgent: 'builder',
      task: 'Build page',
      reason: 'Need help',
    });

    const found = await store.getById(created.requestId);
    expect(found).not.toBeNull();
    expect(found!.requestingOperatorId).toBe('op_cmo');
  });

  it('approves a request', async () => {
    const req = await store.create({
      requestingOperatorId: 'op_cmo',
      requestingOperatorName: 'CMO',
      requestingDepartment: 'marketing',
      requesterTier: 'department_head',
      requesterPriority: 70,
      requesterDepartments: ['marketing'],
      targetDepartment: 'development',
      targetAgent: 'builder',
      task: 'Build page',
      reason: 'Need help',
    });

    const approved = await store.approve(req.requestId, 'op_root', 'Approved', 'optask_123');
    expect(approved).toBe(true);
    const found = await store.getById(req.requestId);
    expect(found!.status).toBe('approved');
    expect(found!.decidedBy).toBe('op_root');
    expect(found!.resultingTaskId).toBe('optask_123');

    // Double-approve should fail (atomic)
    const secondApprove = await store.approve(req.requestId, 'op_other', 'Also approved');
    expect(secondApprove).toBe(false);
  });

  it('rejects a request', async () => {
    const req = await store.create({
      requestingOperatorId: 'op_cmo',
      requestingOperatorName: 'CMO',
      requestingDepartment: 'marketing',
      requesterTier: 'department_head',
      requesterPriority: 70,
      requesterDepartments: ['marketing'],
      targetDepartment: 'development',
      targetAgent: 'builder',
      task: 'Build page',
      reason: 'Need help',
    });

    const rejected = await store.reject(req.requestId, 'op_cto', 'Too busy');
    expect(rejected).toBe(true);
    const found = await store.getById(req.requestId);
    expect(found!.status).toBe('rejected');
    expect(found!.decidedBy).toBe('op_cto');
    expect(found!.decisionNote).toBe('Too busy');

    // Double-reject should fail (atomic)
    const secondReject = await store.reject(req.requestId, 'op_other', 'Also rejected');
    expect(secondReject).toBe(false);
  });

  it('lists pending requests', async () => {
    await store.create({
      requestingOperatorId: 'op_a', requestingOperatorName: 'A',
      requestingDepartment: 'marketing', targetDepartment: 'development',
      targetAgent: 'builder', task: 'Task 1', reason: 'R1',
    });
    await store.create({
      requestingOperatorId: 'op_b', requestingOperatorName: 'B',
      requestingDepartment: 'support', requesterTier: 'contributor', requesterPriority: 50, requesterDepartments: ['support'], targetDepartment: 'development',
      targetAgent: 'architect', task: 'Task 2', reason: 'R2',
    });

    const pending = await store.listPending();
    expect(pending).toHaveLength(2);

    const devOnly = await store.listPending('development');
    expect(devOnly).toHaveLength(2); // both target development
  });

  it('expires old pending requests', async () => {
    const req = await store.create({
      requestingOperatorId: 'op_a', requestingOperatorName: 'A',
      requestingDepartment: 'marketing', targetDepartment: 'development',
      targetAgent: 'builder', task: 'Task', reason: 'R',
    });

    // Manually backdate the expiresAt
    const collection = db.collection('cross_dept_requests');
    const doc = collection._docs.find((d: any) => d.requestId === req.requestId);
    doc.expiresAt = new Date(Date.now() - 1000); // expired 1 second ago

    const expired = await store.expirePending();
    expect(expired).toBe(1);

    const found = await store.getById(req.requestId);
    expect(found!.status).toBe('expired');
  });
});
