import { z } from 'zod';
import type { Db, Collection, Filter } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('operator-tasks');

// ─── Task Schema ───────────────────────────────────────────────────────────────

export const OperatorTaskSchema = z.object({
  taskId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),

  // What
  target: z.object({
    type: z.enum(['department', 'agent']),
    id: z.string(),
  }),
  action: z.string(),
  payload: z.record(z.unknown()).optional(),

  // Control
  priority: z.number(),

  // Locking
  resourceKey: z.string().optional(),

  // Status
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'pending_approval', 'blocked', 'preempted']),
  executionIds: z.array(z.string()).default([]),
  realExecutionId: z.string().optional(),

  // Parent/child for department fan-out
  parentTaskId: z.string().optional(),
  childTaskIds: z.array(z.string()).optional(),

  // Cross-department
  crossDepartment: z.object({
    requested: z.boolean().default(false),
    targetDepartment: z.string().optional(),
    reason: z.string().optional(),
    approvedBy: z.string().optional(),
    approvedAt: z.date().optional(),
  }).default({ requested: false }),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),

  // Audit
  cancelledBy: z.string().optional(),
  cancelReason: z.string().optional(),
});

export type OperatorTask = z.infer<typeof OperatorTaskSchema>;

// ─── Input Schemas ─────────────────────────────────────────────────────────────

export const CreateTaskInput = z.object({
  agent: z.string().optional(),
  department: z.string().optional(),
  task: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
  resourceKey: z.string().optional(),
}).refine(
  (data) => data.agent || data.department,
  { message: 'Either agent or department must be specified' },
);

export const CancelTaskInput = z.object({
  reason: z.string().min(1).max(500).optional(),
});

// ─── Task Store ────────────────────────────────────────────────────────────────

export class OperatorTaskStore {
  private readonly collection: Collection<OperatorTask>;

  constructor(db: Db) {
    this.collection = db.collection<OperatorTask>('operator_tasks');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ taskId: 1 }, { unique: true });
    await this.collection.createIndex({ operatorId: 1 });
    await this.collection.createIndex({ status: 1 });
    await this.collection.createIndex({ 'target.id': 1 });
    await this.collection.createIndex({ createdAt: -1 });
    logger.info('Operator task store indexes ensured');
  }

  async create(task: OperatorTask): Promise<OperatorTask> {
    await this.collection.insertOne(task as any);
    logger.info('Operator task created', { taskId: task.taskId, operatorId: task.operatorId, target: task.target });
    return task;
  }

  async getByTaskId(taskId: string): Promise<OperatorTask | null> {
    return this.collection.findOne({ taskId } as Filter<OperatorTask>) as Promise<OperatorTask | null>;
  }

  async updateStatus(taskId: string, status: OperatorTask['status']): Promise<void> {
    const update: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === 'completed' || status === 'failed') update.completedAt = new Date();
    await this.collection.updateOne({ taskId } as Filter<OperatorTask>, { $set: update });
  }

  /** Update status and set the real executionId from executor.execute() result. */
  async updateStatusWithExecutionId(taskId: string, status: OperatorTask['status'], realExecutionId: string): Promise<void> {
    const update: Record<string, unknown> = { status, realExecutionId, updatedAt: new Date() };
    if (status === 'completed' || status === 'failed') update.completedAt = new Date();
    await this.collection.updateOne({ taskId } as Filter<OperatorTask>, { $set: update });
  }

  async cancel(taskId: string, cancelledBy: string, reason?: string): Promise<void> {
    await this.collection.updateOne(
      { taskId } as Filter<OperatorTask>,
      { $set: { status: 'cancelled', cancelledBy, cancelReason: reason, updatedAt: new Date(), completedAt: new Date() } },
    );
    logger.info('Operator task cancelled', { taskId, cancelledBy });
  }

  async listTasks(filter: {
    operatorId?: string;
    status?: string;
    departmentIds?: string[];
    agentIds?: string[];
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: OperatorTask[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (filter.operatorId) query.operatorId = filter.operatorId;
    if (filter.status) query.status = filter.status;
    if (filter.departmentIds?.length) {
      query['target.id'] = { $in: [...filter.departmentIds, ...(filter.agentIds ?? [])] };
    }

    const total = await this.collection.countDocuments(query as Filter<OperatorTask>);
    const tasks = await this.collection
      .find(query as Filter<OperatorTask>)
      .sort({ createdAt: -1 })
      .skip(filter.offset ?? 0)
      .limit(filter.limit ?? 50)
      .toArray() as OperatorTask[];

    return { tasks, total };
  }

  async countByOperatorAndStatus(operatorId: string, status: string): Promise<number> {
    return this.collection.countDocuments({ operatorId, status } as Filter<OperatorTask>);
  }
}
