import type { Express, Request, Response } from 'express';
import { createLogger } from '../logging/logger.js';
import { requireTier } from './middleware.js';
import type { TaskLockManager } from './task-locks.js';
import type { CrossDeptStore } from './cross-dept.js';
import { CrossDeptApproveInput, CrossDeptRejectInput } from './cross-dept.js';
import type { OperatorTaskStore } from './task-model.js';
import type { OperatorAuditLogger } from './audit-logger.js';
import type { OperatorRequest } from './types.js';
import type { AgentContext } from '../bootstrap/agents.js';
import { buildOperatorPreamble } from './task-routes.js';
import type { OperatorContext } from './task-routes.js';
import { randomUUID } from 'node:crypto';
import { buildAgentDepartmentMap } from './permission-engine.js';
import type { OperatorEventStream } from './event-stream.js';
import type { OperatorSlackNotifier } from './slack-notifier.js';
import type { createTaskExecutor } from './task-executor.js';

const logger = createLogger('conflict-routes');

export function registerConflictRoutes(
  app: Express,
  lockManager: TaskLockManager | null,
  crossDeptStore: CrossDeptStore,
  taskStore: OperatorTaskStore,
  auditLogger: OperatorAuditLogger,
  agents: AgentContext,
  eventStream: OperatorEventStream | null,
  slackNotifier: OperatorSlackNotifier | null,
  executeAgentTask?: ReturnType<typeof createTaskExecutor>,
): void {
  const { router } = agents;
  const allConfigs = router.getAllConfigs();
  const agentDepartmentMap = buildAgentDepartmentMap(allConfigs);

  // ─── GET /v1/locks (root only) ──────────────────────────────────────

  app.get('/v1/locks', requireTier('root'), async (req: Request, res: Response) => {
    try {
      if (!lockManager) {
        res.json({ locks: [], note: 'Lock manager not available (Redis disabled)' });
        return;
      }
      const locks = await lockManager.listLocks();
      res.json({ locks });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to list locks', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/locks/:resourceKey/release (root only) ──────────────

  app.post('/v1/locks/:resourceKey/release', requireTier('root'), async (req: Request, res: Response) => {
    try {
      if (!lockManager) {
        res.status(503).json({ error: 'Lock manager not available' });
        return;
      }

      const operator = (req as OperatorRequest).operator!;
      const resourceKey = decodeURIComponent(req.params.resourceKey);
      const released = await lockManager.forceRelease(resourceKey);

      auditLogger.log({
        timestamp: new Date(),
        operatorId: operator.operatorId,
        action: 'lock.force_release',
        resource: { type: 'lock', id: resourceKey },
        request: { method: 'POST', path: req.path, ip: getIp(req) },
        decision: 'allowed',
      });

      res.json({ released, resourceKey });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to force-release lock', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/tasks/:id/conflicts ──────────────────────────────────

  app.get('/v1/tasks/:id/conflicts', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const task = await taskStore.getByTaskId(req.params.id);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      // Only owner or root
      if (operator.tier !== 'root' && task.operatorId !== operator.operatorId) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const conflicts: Record<string, unknown> = {
        taskId: task.taskId,
        status: task.status,
      };

      // Check cross-department status
      if (task.crossDepartment?.requested) {
        conflicts.crossDepartment = task.crossDepartment;
      }

      // Check if blocked by a lock
      if (task.status === 'blocked' && task.resourceKey && lockManager) {
        const lock = await lockManager.getLock(task.resourceKey);
        if (lock) {
          conflicts.blockedByLock = lock;
        }
      }

      res.json(conflicts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get task conflicts', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/approvals/cross-dept ────────────────────────────────

  app.get('/v1/approvals/cross-dept', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Root sees all; dept heads see their departments
      let requests;
      if (operator.tier === 'root' || operator.departments.includes('*')) {
        requests = await crossDeptStore.listPending();
      } else if (operator.tier === 'department_head') {
        // Get requests targeting any of the operator's departments
        const allPending = await crossDeptStore.listPending();
        requests = allPending.filter((r) => operator.departments.includes(r.targetDepartment));
      } else {
        // Contributors/observers see their own requests only
        const allPending = await crossDeptStore.listPending();
        requests = allPending.filter((r) => r.requestingOperatorId === operator.operatorId);
      }

      res.json({ requests });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to list cross-dept requests', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/approvals/cross-dept/:id/approve ──────────────────

  app.post('/v1/approvals/cross-dept/:id/approve', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const parsed = CrossDeptApproveInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
        return;
      }

      const request = await crossDeptStore.getById(req.params.id);
      if (!request) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }

      // Check expiry BEFORE status check
      if (request.expiresAt < new Date()) {
        res.status(410).json({ error: 'Request has expired' });
        return;
      }

      if (request.status !== 'pending') {
        res.status(409).json({ error: `Request already ${request.status}` });
        return;
      }

      // Authorize: root or head of target department
      const isRoot = operator.tier === 'root' || operator.departments.includes('*');
      const isTargetDeptHead = operator.tier === 'department_head'
        && operator.departments.includes(request.targetDepartment);

      if (!isRoot && !isTargetDeptHead) {
        res.status(403).json({ error: 'Only root or target department head can approve' });
        return;
      }

      const config = router.getConfig(request.targetAgent);
      if (!config) {
        res.status(500).json({ error: `Target agent ${request.targetAgent} no longer exists` });
        return;
      }

      // Use original requester's params (priority, tier, departments)
      const taskId = request.pendingTaskId || `optask_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const executionIds = [randomUUID()];
      const now = new Date();

      // Atomically approve — prevents race condition with concurrent approvers
      const approved = await crossDeptStore.approve(
        request.requestId, operator.operatorId, parsed.data?.note, taskId,
      );
      if (!approved) {
        res.status(409).json({ error: 'Request was already decided by another approver' });
        return;
      }

      // Update the pending task to queued (or create if no pending task exists)
      if (request.pendingTaskId) {
        await taskStore.updateStatus(request.pendingTaskId, 'queued');
      } else {
        await taskStore.create({
          taskId,
          operatorId: request.requestingOperatorId,
          operatorName: request.requestingOperatorName,
          target: { type: 'agent', id: request.targetAgent },
          action: request.task,
          payload: request.payload,
          resourceKey: request.resourceKey,
          priority: request.requesterPriority,
          status: 'queued',
          executionIds,
          crossDepartment: {
            requested: true,
            targetDepartment: request.targetDepartment,
            reason: request.reason,
            approvedBy: operator.operatorId,
            approvedAt: now,
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      // Execute through the shared task executor (respects queue, locks, counters)
      if (executeAgentTask) {
        const operatorPreamble = buildOperatorPreamble({
          operatorId: request.requestingOperatorId,
          operatorName: request.requestingOperatorName,
          role: request.requesterTier,
          tier: request.requesterTier,
          departments: request.requesterDepartments,
        });

        executeAgentTask({
          taskId,
          agentName: request.targetAgent,
          department: request.targetDepartment,
          task: request.task,
          payload: request.payload,
          operatorId: request.requestingOperatorId,
          operatorPreamble,
          priority: request.requesterPriority,
          resourceKey: request.resourceKey,
        });
      }

      auditLogger.log({
        timestamp: new Date(),
        operatorId: operator.operatorId,
        action: 'cross_dept.approve',
        resource: { type: 'cross_dept_request', id: request.requestId },
        request: { method: 'POST', path: req.path, ip: getIp(req) },
        decision: 'allowed',
      });

      // Emit event + notify requester
      if (eventStream) {
        eventStream.emit({
          type: 'approval.decided',
          departmentId: request.targetDepartment,
          operatorId: operator.operatorId,
          summary: `Cross-dept request approved: ${request.task}`,
          details: { requestId: request.requestId, taskId, decision: 'approved' },
        });
      }
      if (slackNotifier) {
        void slackNotifier.notify({
          operatorId: request.requestingOperatorId,
          type: 'cross_dept_decided',
          summary: `Your cross-dept request to ${request.targetAgent} was approved by ${operator.displayName}`,
        });
      }

      res.json({
        requestId: request.requestId,
        status: 'approved',
        resultingTaskId: taskId,
        executionIds,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to approve cross-dept request', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/approvals/cross-dept/:id/reject ──────────────────

  app.post('/v1/approvals/cross-dept/:id/reject', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const parsed = CrossDeptRejectInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
        return;
      }

      const request = await crossDeptStore.getById(req.params.id);
      if (!request) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }

      // Check expiry
      if (request.expiresAt < new Date()) {
        res.status(410).json({ error: 'Request has expired' });
        return;
      }

      if (request.status !== 'pending') {
        res.status(409).json({ error: `Request already ${request.status}` });
        return;
      }

      const isRoot = operator.tier === 'root' || operator.departments.includes('*');
      const isTargetDeptHead = operator.tier === 'department_head'
        && operator.departments.includes(request.targetDepartment);

      if (!isRoot && !isTargetDeptHead) {
        res.status(403).json({ error: 'Only root or target department head can reject' });
        return;
      }

      // Atomic reject — prevents race
      const rejected = await crossDeptStore.reject(request.requestId, operator.operatorId, parsed.data?.note);
      if (!rejected) {
        res.status(409).json({ error: 'Request was already decided by another reviewer' });
        return;
      }

      // Cancel the pending task
      if (request.pendingTaskId) {
        await taskStore.cancel(request.pendingTaskId, operator.operatorId, 'Cross-dept request rejected');
      }

      auditLogger.log({
        timestamp: new Date(),
        operatorId: operator.operatorId,
        action: 'cross_dept.reject',
        resource: { type: 'cross_dept_request', id: request.requestId },
        request: { method: 'POST', path: req.path, ip: getIp(req) },
        decision: 'allowed',
      });

      res.json({ requestId: request.requestId, status: 'rejected' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to reject cross-dept request', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Meta-contract route aliases ────────────────────────────────────
  // The meta prompt specifies /v1/approvals/:id/approve|reject
  // These alias the cross-dept routes for API compatibility.
  app.post('/v1/approvals/:id/approve', (req: Request, res: Response) => {
    req.url = `/v1/approvals/cross-dept/${req.params.id}/approve`;
    (app as unknown as { handle(req: Request, res: Response): void }).handle(req, res);
  });
  app.post('/v1/approvals/:id/reject', (req: Request, res: Response) => {
    req.url = `/v1/approvals/cross-dept/${req.params.id}/reject`;
    (app as unknown as { handle(req: Request, res: Response): void }).handle(req, res);
  });

  logger.info('Conflict & cross-dept routes registered (/v1/locks/*, /v1/approvals/*)');
}

function getIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
}
