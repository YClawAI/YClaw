import { z } from 'zod';
import type { Db, Collection, Filter } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('cross-dept');

const DEFAULT_EXPIRY_HOURS = 24;

// ─── Schema ────────────────────────────────────────────────────────────────────

export const CrossDeptRequestSchema = z.object({
  requestId: z.string(),
  requestingOperatorId: z.string(),
  requestingOperatorName: z.string(),
  requestingDepartment: z.string(),
  requesterTier: z.string(),
  requesterPriority: z.number(),
  requesterDepartments: z.array(z.string()),
  targetDepartment: z.string(),
  targetAgent: z.string(),
  task: z.string(),
  reason: z.string(),
  payload: z.record(z.unknown()).optional(),
  resourceKey: z.string().optional(),
  pendingTaskId: z.string().optional(),

  status: z.enum(['pending', 'approved', 'rejected', 'expired']),

  decidedBy: z.string().nullable().default(null),
  decidedAt: z.date().nullable().default(null),
  decisionNote: z.string().nullable().default(null),

  resultingTaskId: z.string().nullable().default(null),

  createdAt: z.date(),
  expiresAt: z.date(),
});

export type CrossDeptRequest = z.infer<typeof CrossDeptRequestSchema>;

export const CrossDeptApproveInput = z.object({
  note: z.string().max(500).optional(),
});

export const CrossDeptRejectInput = z.object({
  note: z.string().max(500).optional(),
});

// ─── Store ─────────────────────────────────────────────────────────────────────

export class CrossDeptStore {
  private readonly collection: Collection<CrossDeptRequest>;

  constructor(db: Db) {
    this.collection = db.collection<CrossDeptRequest>('cross_dept_requests');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ requestId: 1 }, { unique: true });
    await this.collection.createIndex({ status: 1 });
    await this.collection.createIndex({ targetDepartment: 1 });
    await this.collection.createIndex({ requestingOperatorId: 1 });
    await this.collection.createIndex({ expiresAt: 1 });
    logger.info('Cross-department request indexes ensured');
  }

  async create(params: {
    requestingOperatorId: string;
    requestingOperatorName: string;
    requestingDepartment: string;
    requesterTier: string;
    requesterPriority: number;
    requesterDepartments: string[];
    targetDepartment: string;
    targetAgent: string;
    task: string;
    reason: string;
    payload?: Record<string, unknown>;
    resourceKey?: string;
    pendingTaskId?: string;
  }): Promise<CrossDeptRequest> {
    const now = new Date();
    const request: CrossDeptRequest = {
      requestId: `xdept_${randomUUID().slice(0, 12)}`,
      ...params,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      resultingTaskId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000),
    };

    await this.collection.insertOne(request as any);
    logger.info('Cross-dept request created', {
      requestId: request.requestId,
      from: params.requestingDepartment,
      to: params.targetDepartment,
    });
    return request;
  }

  async getById(requestId: string): Promise<CrossDeptRequest | null> {
    return this.collection.findOne({ requestId } as Filter<CrossDeptRequest>) as Promise<CrossDeptRequest | null>;
  }

  async listPending(targetDepartment?: string): Promise<CrossDeptRequest[]> {
    const query: Record<string, unknown> = { status: 'pending' };
    if (targetDepartment) query.targetDepartment = targetDepartment;
    return this.collection.find(query as Filter<CrossDeptRequest>)
      .sort({ createdAt: -1 })
      .toArray() as Promise<CrossDeptRequest[]>;
  }

  /** Atomically approve — returns true if this call won the race. */
  async approve(requestId: string, decidedBy: string, note?: string, resultingTaskId?: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { requestId, status: 'pending' } as Filter<CrossDeptRequest>,
      {
        $set: {
          status: 'approved',
          decidedBy,
          decidedAt: new Date(),
          decisionNote: note ?? null,
          resultingTaskId: resultingTaskId ?? null,
        },
      },
    );
    if (result.modifiedCount === 0) return false; // Lost the race
    logger.info('Cross-dept request approved', { requestId, decidedBy });
    return true;
  }

  /** Atomically reject — returns true if this call won the race. */
  async reject(requestId: string, decidedBy: string, note?: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { requestId, status: 'pending' } as Filter<CrossDeptRequest>,
      {
        $set: {
          status: 'rejected',
          decidedBy,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        },
      },
    );
    if (result.modifiedCount === 0) return false;
    logger.info('Cross-dept request rejected', { requestId, decidedBy });
    return true;
  }

  /** Expire pending requests past their expiresAt. Returns count expired. */
  async expirePending(): Promise<number> {
    const result = await this.collection.updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } } as Filter<CrossDeptRequest>,
      { $set: { status: 'expired' } },
    );
    if (result.modifiedCount > 0) {
      logger.info(`Expired ${result.modifiedCount} cross-dept request(s)`);
    }
    return result.modifiedCount;
  }
}
