// ─── Objective Manager ──────────────────────────────────────────────────────
//
// Manages the 2-level hierarchy: Objectives (human-set goals) → Tasks (agent work).
// Provides creation, lifecycle management, cost rollup, and causal tracing.

import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { createLogger } from '../logging/logger.js';
import type { EventBus } from '../triggers/event.js';
import type { CostTracker } from '../costs/cost-tracker.js';
import type {
  Objective,
  ObjectiveStatus,
  CreateObjectiveInput,
  ObjectiveTrace,
} from './types.js';

const logger = createLogger('objective-manager');

export class ObjectiveManager {
  private collection: Collection<Objective> | null = null;
  private activityLog: Collection | null = null;

  constructor(
    private db: Db | null,
    private eventBus: EventBus,
    private costTracker: CostTracker | null = null,
  ) {}

  get hasPersistence(): boolean {
    return this.collection !== null;
  }

  async initialize(): Promise<void> {
    if (!this.db) {
      logger.warn('No MongoDB — objective tracking disabled');
      return;
    }

    this.collection = this.db.collection<Objective>('objectives');
    this.activityLog = this.db.collection('activity_log');

    await this.collection.createIndex({ id: 1 }, { unique: true });
    await this.collection.createIndex({ status: 1 });
    await this.collection.createIndex({ department: 1 });
    await this.collection.createIndex({ ownerAgentId: 1 });
    await this.collection.createIndex({ priority: 1, status: 1 });

    logger.info('Objective manager initialized');
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  async create(input: CreateObjectiveInput): Promise<Objective> {
    if (!this.collection) {
      throw new Error('Objective manager has no persistence');
    }

    const now = new Date().toISOString();
    const objective: Objective = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      department: input.department,
      status: 'active',
      priority: input.priority,
      createdBy: input.createdBy,
      ownerAgentId: input.ownerAgentId,
      kpis: (input.kpis ?? []).map(k => ({
        metric: k.metric,
        target: k.target,
        current: k.current ?? 0,
        unit: k.unit,
      })),
      costBudgetCents: input.costBudgetCents ?? 0,
      costSpentCents: 0,
      childTaskIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.collection.insertOne({ ...objective });

    await this.eventBus.publish('objective', 'created', {
      objectiveId: objective.id,
      title: objective.title,
      department: objective.department,
      priority: objective.priority,
      ownerAgentId: objective.ownerAgentId,
    });

    void this.writeAuditEntry('objective_created', {
      objectiveId: objective.id,
      title: objective.title,
      createdBy: input.createdBy,
      department: objective.department,
      priority: objective.priority,
    });

    logger.info('Objective created', {
      id: objective.id,
      title: objective.title,
      priority: objective.priority,
    });

    return objective;
  }

  async get(id: string): Promise<Objective | null> {
    if (!this.collection) return null;
    return this.collection.findOne({ id });
  }

  async list(filters?: {
    status?: ObjectiveStatus;
    department?: string;
    ownerAgentId?: string;
  }): Promise<Objective[]> {
    if (!this.collection) return [];
    const query: Record<string, unknown> = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.department) query.department = filters.department;
    if (filters?.ownerAgentId) query.ownerAgentId = filters.ownerAgentId;
    return this.collection.find(query).sort({ priority: 1, createdAt: -1 }).toArray();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async updateStatus(id: string, status: ObjectiveStatus, reason?: string): Promise<Objective | null> {
    if (!this.collection) return null;

    const now = new Date().toISOString();
    const result = await this.collection.findOneAndUpdate(
      { id },
      { $set: { status, updatedAt: now } },
      { returnDocument: 'after' },
    );

    if (!result) return null;

    await this.eventBus.publish('objective', 'updated', {
      objectiveId: id,
      status,
      reason,
    });

    if (status === 'completed') {
      await this.eventBus.publish('objective', 'completed', {
        objectiveId: id,
        title: result.title,
        costSpentCents: result.costSpentCents,
      });
    }

    void this.writeAuditEntry(`objective_${status}`, {
      objectiveId: id,
      reason,
    });

    logger.info(`Objective ${status}`, { id, reason });
    return result;
  }

  async updateKPI(id: string, metric: string, current: number): Promise<Objective | null> {
    if (!this.collection) return null;

    const objective = await this.collection.findOne({ id });
    if (!objective) return null;

    const kpis = objective.kpis.map(kpi =>
      kpi.metric === metric ? { ...kpi, current } : kpi,
    );

    const now = new Date().toISOString();
    const result = await this.collection.findOneAndUpdate(
      { id },
      { $set: { kpis, updatedAt: now } },
      { returnDocument: 'after' },
    );

    if (result) {
      await this.eventBus.publish('objective', 'updated', {
        objectiveId: id,
        kpiUpdate: { metric, current },
      });
    }

    return result;
  }

  /**
   * Link a task to an objective by appending its ID to childTaskIds.
   */
  async addChildTask(objectiveId: string, taskId: string): Promise<void> {
    if (!this.collection) return;

    await this.collection.updateOne(
      { id: objectiveId },
      {
        $addToSet: { childTaskIds: taskId },
        $set: { updatedAt: new Date().toISOString() },
      },
    );
  }

  // ─── Cost Rollup ────────────────────────────────────────────────────────────

  /**
   * Roll up cost from a completed task execution into the parent objective.
   * Called after execution completes when the trigger payload carries an objectiveId.
   */
  async rollupCost(objectiveId: string, costCents: number): Promise<void> {
    if (!this.collection || costCents <= 0) return;

    const result = await this.collection.findOneAndUpdate(
      { id: objectiveId },
      {
        $inc: { costSpentCents: costCents },
        $set: { updatedAt: new Date().toISOString() },
      },
      { returnDocument: 'after' },
    );

    if (result && result.costBudgetCents > 0 && result.costSpentCents > result.costBudgetCents) {
      await this.eventBus.publish('objective', 'budget_exceeded', {
        objectiveId,
        title: result.title,
        budgetCents: result.costBudgetCents,
        spentCents: result.costSpentCents,
      });

      logger.warn('Objective budget exceeded', {
        id: objectiveId,
        budget: result.costBudgetCents,
        spent: result.costSpentCents,
      });
    }
  }

  // ─── Auto-Complete ──────────────────────────────────────────────────────────

  /**
   * Check if all child tasks under an objective are terminal (completed/failed).
   * If so, auto-update the objective status.
   */
  async checkAutoComplete(objectiveId: string, executionsDb: Db | null): Promise<void> {
    if (!this.collection || !executionsDb) return;

    const objective = await this.collection.findOne({ id: objectiveId });
    if (!objective || objective.status !== 'active') return;
    if (objective.childTaskIds.length === 0) return;

    const executions = executionsDb.collection('executions');
    const childTasks = await executions.find({
      id: { $in: objective.childTaskIds },
    }).toArray();

    if (childTasks.length === 0) return;

    const allTerminal = childTasks.every(
      t => t.status === 'completed' || t.status === 'failed',
    );
    if (!allTerminal) return;

    const allFailed = childTasks.every(t => t.status === 'failed');
    const newStatus: ObjectiveStatus = allFailed ? 'failed' : 'completed';

    await this.updateStatus(objectiveId, newStatus, 'All child tasks reached terminal state');
  }

  // ─── Causal Tracing ─────────────────────────────────────────────────────────

  /**
   * Build a full trace tree for an objective: tasks, costs, and events.
   */
  async trace(objectiveId: string): Promise<ObjectiveTrace | null> {
    if (!this.collection || !this.db) return null;

    const objective = await this.collection.findOne({ id: objectiveId });
    if (!objective) return null;

    // Query executions linked to this objective
    const executions = this.db.collection('executions');
    const tasks = await executions.find({
      $or: [
        { id: { $in: objective.childTaskIds } },
        { 'triggerPayload.objectiveId': objectiveId },
      ],
    }).sort({ startedAt: -1 }).limit(200).toArray();

    // Query cost events linked to this objective
    let totalCostCents = objective.costSpentCents;
    if (this.costTracker) {
      // Cost is already rolled up in the objective, use that
    }

    // Query activity log for events related to this objective
    const events: ObjectiveTrace['events'] = [];
    if (this.activityLog) {
      const activityEntries = await this.activityLog.find({
        'details.objectiveId': objectiveId,
      }).sort({ timestamp: -1 }).limit(100).toArray();

      for (const entry of activityEntries) {
        events.push({
          type: entry.action as string,
          timestamp: entry.timestamp as string,
          details: entry.details as Record<string, unknown>,
        });
      }
    }

    return {
      objective,
      tasks: tasks.map(t => ({
        id: t.id as string,
        status: t.status as string,
        agent: t.agent as string,
        task: t.task as string,
        costCents: (t.costCents as number) ?? 0,
        startedAt: t.startedAt as string,
        completedAt: t.completedAt as string | undefined,
      })),
      totalCostCents,
      events,
    };
  }

  // ─── Pause/Resume ───────────────────────────────────────────────────────────

  /**
   * Pause an objective — downstream scheduling should check objective status
   * before executing tasks linked to this objectiveId.
   */
  async pause(id: string, reason: string): Promise<Objective | null> {
    return this.updateStatus(id, 'paused', reason);
  }

  async resume(id: string): Promise<Objective | null> {
    return this.updateStatus(id, 'active', 'Resumed');
  }

  /**
   * Check if an objective is paused. Used by the executor to skip gated tasks.
   */
  async isPaused(objectiveId: string): Promise<boolean> {
    if (!this.collection) return false;
    const obj = await this.collection.findOne({ id: objectiveId }, { projection: { status: 1 } });
    return obj?.status === 'paused';
  }

  // ─── Audit Trail ────────────────────────────────────────────────────────────

  private async writeAuditEntry(
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!this.activityLog) return;
    try {
      await this.activityLog.insertOne({
        action,
        subsystem: 'objectives',
        details,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to write objective audit entry', { error: msg, action });
    }
  }
}
