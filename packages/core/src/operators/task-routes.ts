import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import { evaluatePermission, buildAgentDepartmentMap } from './permission-engine.js';
import type { OperatorAuditLogger } from './audit-logger.js';
import type { OperatorTaskStore, OperatorTask } from './task-model.js';
import { CreateTaskInput, CancelTaskInput } from './task-model.js';
import type { RoleStore } from './roles.js';
import type { Role } from './roles.js';
import type { Operator, OperatorRequest } from './types.js';
import type { AgentContext } from '../bootstrap/agents.js';
import type { ServiceContext } from '../bootstrap/services.js';
import type { TaskLockManager } from './task-locks.js';
import type { CrossDeptStore } from './cross-dept.js';
import type { OperatorEventStream } from './event-stream.js';
import type { OperatorRateLimiter } from './rate-limiter.js';
import type { OperatorSlackNotifier } from './slack-notifier.js';
import { createTaskExecutor } from './task-executor.js';

const logger = createLogger('task-routes');

// ─── Operator Context for Agent Injection ──────────────────────────────────────

export interface OperatorContext {
  operatorId: string;
  operatorName: string;
  role: string;
  tier: string;
  departments: string[];
}

export function buildOperatorPreamble(ctx: OperatorContext): string {
  return (
    `[Operator Context]\n` +
    `This task was requested by ${ctx.operatorName} (${ctx.role}), a ${ctx.tier}-level operator ` +
    `with access to ${ctx.departments.includes('*') ? 'all departments' : ctx.departments.join(', ')}.\n` +
    `If this task conflicts with a directive from a higher-priority operator, flag the conflict and do not proceed until resolved.`
  );
}

// ─── In-flight Execution Tracking (for cancellation) ───────────────────────────

const activeAbortControllers = new Map<string, AbortController>();

// ─── Department Name Map ───────────────────────────────────────────────────────

const DEPARTMENT_NAMES: Record<string, string> = {
  executive: 'Executive',
  development: 'Development',
  marketing: 'Marketing',
  finance: 'Finance',
  operations: 'Operations',
  support: 'Support',
};

// ─── Route Registration ────────────────────────────────────────────────────────

export function registerTaskRoutes(
  app: Express,
  taskStore: OperatorTaskStore,
  roleStore: RoleStore,
  auditLogger: OperatorAuditLogger,
  agents: AgentContext,
  services: ServiceContext,
  lockManager: TaskLockManager | null,
  crossDeptStore: CrossDeptStore | null,
  eventStream: OperatorEventStream | null,
  rateLimiter: OperatorRateLimiter | null,
  slackNotifier: OperatorSlackNotifier | null,
) {
  const { router } = agents;
  const allConfigs = router.getAllConfigs();
  const agentDepartmentMap = buildAgentDepartmentMap(allConfigs);

  // Shared task executor (used by /v1/tasks and cross-dept approval)
  const executeAgentTask = createTaskExecutor(
    taskStore, agents, lockManager, eventStream, rateLimiter, slackNotifier,
  );

  async function resolveRoles(operator: Operator): Promise<Role[]> {
    const roles: Role[] = [];
    if (operator.roleIds?.length) {
      for (const roleId of operator.roleIds) {
        const role = await roleStore.getByRoleId(roleId);
        if (role) roles.push(role);
      }
    }
    const tierRole = await roleStore.getRoleForTier(operator.tier);
    if (tierRole && !roles.some((r) => r.roleId === tierRole.roleId)) {
      roles.push(tierRole);
    }
    return roles;
  }

  // ─── POST /v1/tasks ────────────────────────────────────────────────────

  app.post('/v1/tasks', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const parsed = CreateTaskInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { agent: agentName, department, task, payload, resourceKey } = parsed.data;
      const roles = await resolveRoles(operator);

      // ── Resolve target agents ──────────────────────────────────────────
      let targetAgents: Array<{ name: string; department: string }>;

      if (agentName) {
        const config = router.getConfig(agentName);
        if (!config) {
          res.status(404).json({ error: `Unknown agent: ${agentName}` });
          return;
        }
        targetAgents = [{ name: agentName, department: config.department }];
      } else if (department) {
        const deptAgents = [...allConfigs.entries()]
          .filter(([, c]) => c.department === department)
          .map(([name, c]) => ({ name, department: c.department }));
        if (deptAgents.length === 0) {
          res.status(404).json({ error: `No agents found in department: ${department}` });
          return;
        }
        targetAgents = deptAgents;
      } else {
        res.status(400).json({ error: 'Either agent or department must be specified' });
        return;
      }

      // ── Permission check ───────────────────────────────────────────────
      if (department) {
        const permResult = evaluatePermission(operator, roles, {
          operatorId: operator.operatorId,
          action: 'trigger',
          resourceType: 'department',
          resourceId: department,
        }, agentDepartmentMap);

        if (!permResult.allowed) {
          res.status(403).json({ error: `No permission to trigger department ${department}`, reason: permResult.reason });
          return;
        }
      } else {
        const permResult = evaluatePermission(operator, roles, {
          operatorId: operator.operatorId,
          action: 'trigger',
          resourceType: 'agent',
          resourceId: agentName!,
        }, agentDepartmentMap);

        if (!permResult.allowed) {
          // Cross-department workflow
          const targetDept = agentDepartmentMap.get(agentName!);
          if (permResult.reason === 'denied_no_grant' && targetDept && crossDeptStore) {
            if (operator.crossDeptPolicy === 'none') {
              res.status(403).json({ error: 'Cross-department requests disabled for this operator' });
              return;
            }

            const reason = (req.body as Record<string, unknown>).reason as string || 'Cross-department collaboration needed';
            const pendingTaskId = `optask_${Date.now()}_${randomUUID().slice(0, 8)}`;
            const now = new Date();

            await taskStore.create({
              taskId: pendingTaskId,
              operatorId: operator.operatorId,
              operatorName: operator.displayName,
              target: { type: 'agent', id: agentName! },
              action: task,
              payload,
              resourceKey,
              priority: operator.priorityClass,
              status: 'pending_approval',
              executionIds: [],
              crossDepartment: { requested: true, targetDepartment: targetDept, reason },
              createdAt: now,
              updatedAt: now,
            });

            const xdeptRequest = await crossDeptStore.create({
              requestingOperatorId: operator.operatorId,
              requestingOperatorName: operator.displayName,
              requestingDepartment: operator.departments[0] || 'unknown',
              requesterTier: operator.tier,
              requesterPriority: operator.priorityClass,
              requesterDepartments: operator.departments,
              targetDepartment: targetDept,
              targetAgent: agentName!,
              task,
              reason,
              payload,
              resourceKey,
              pendingTaskId,
            });

            if (eventStream) {
              eventStream.emit({
                type: 'approval.requested',
                departmentId: targetDept,
                agentId: agentName,
                operatorId: operator.operatorId,
                summary: `Cross-dept request: ${task} → ${agentName}`,
                details: { requestId: xdeptRequest.requestId, taskId: pendingTaskId },
              });
            }

            if (slackNotifier) {
              void slackNotifier.notifyApprovers(targetDept, `${operator.displayName} requests ${agentName}: ${task}`);
            }

            res.status(202).json({
              status: 'pending_approval',
              taskId: pendingTaskId,
              requestId: xdeptRequest.requestId,
              message: `Cross-department request submitted. Awaiting approval from CEO or ${targetDept} department head.`,
              expiresAt: xdeptRequest.expiresAt.toISOString(),
            });
            return;
          }

          res.status(403).json({ error: `No permission to trigger agent ${agentName}`, reason: permResult.reason });
          return;
        }
      }

      // ── Lock acquisition (if resourceKey provided) ─────────────────────
      const parentTaskId = `optask_${Date.now()}_${randomUUID().slice(0, 8)}`;

      if (resourceKey && lockManager) {
        const lockResult = await lockManager.acquireLock({
          resourceKey,
          taskId: parentTaskId,
          operatorId: operator.operatorId,
          priority: operator.priorityClass,
        });

        if (!lockResult.acquired) {
          const now = new Date();
          await taskStore.create({
            taskId: parentTaskId,
            operatorId: operator.operatorId,
            operatorName: operator.displayName,
            target: { type: agentName ? 'agent' : 'department', id: agentName || department! },
            action: task,
            payload,
            resourceKey,
            priority: operator.priorityClass,
            status: 'blocked',
            executionIds: [],
            crossDepartment: { requested: false },
            createdAt: now,
            updatedAt: now,
          });

          res.json({ taskId: parentTaskId, status: 'blocked', blockedBy: lockResult.currentHolder, resourceKey });
          return;
        }

        if (lockResult.preempted) {
          if (lockResult.preempted.taskId) {
            await taskStore.updateStatus(lockResult.preempted.taskId, 'preempted');
          }
          if (eventStream) {
            eventStream.emit({
              type: 'lock.preempted',
              departmentId: targetAgents[0]?.department || '',
              operatorId: operator.operatorId,
              summary: `Lock preempted on ${resourceKey}`,
              details: { preempted: lockResult.preempted },
            });
          }
          if (slackNotifier && lockResult.preempted.operatorId) {
            void slackNotifier.notify({
              operatorId: lockResult.preempted.operatorId,
              type: 'lock_preempted',
              summary: `Your lock on "${resourceKey}" was preempted by ${operator.displayName} (higher priority)`,
            });
          }
        }
      }

      // ── Create task records ────────────────────────────────────────────
      const operatorPreamble = buildOperatorPreamble({
        operatorId: operator.operatorId,
        operatorName: operator.displayName,
        role: operator.role,
        tier: operator.tier,
        departments: operator.departments,
      });

      if (rateLimiter) {
        void rateLimiter.incrementConcurrent(operator.operatorId);
        void rateLimiter.incrementDaily(operator.operatorId);
      }

      if (targetAgents.length === 1) {
        // Single agent: one task, one execution
        const now = new Date();
        await taskStore.create({
          taskId: parentTaskId,
          operatorId: operator.operatorId,
          operatorName: operator.displayName,
          target: { type: 'agent', id: targetAgents[0]!.name },
          action: task,
          payload,
          resourceKey,
          priority: operator.priorityClass,
          status: 'queued',
          executionIds: [],
          crossDepartment: { requested: false },
          createdAt: now,
          updatedAt: now,
        });

        const abortController = new AbortController();
        activeAbortControllers.set(parentTaskId, abortController);

        executeAgentTask({
          taskId: parentTaskId,
          agentName: targetAgents[0]!.name,
          department: targetAgents[0]!.department,
          task, payload, operatorId: operator.operatorId,
          operatorPreamble, priority: operator.priorityClass,
          resourceKey, abortSignal: abortController.signal,
        });

        if (eventStream) {
          eventStream.emit({
            type: 'task.created',
            departmentId: targetAgents[0]!.department,
            agentId: targetAgents[0]!.name,
            operatorId: operator.operatorId,
            summary: `Task created: ${task}`,
            details: { taskId: parentTaskId },
          });
        }

        res.json({ taskId: parentTaskId, status: 'queued', agent: targetAgents[0]!.name, department: targetAgents[0]!.department });
      } else {
        // Department fan-out: parent task + individual child tasks per agent
        const childTaskIds: string[] = [];
        const now = new Date();

        for (const target of targetAgents) {
          const childTaskId = `optask_${Date.now()}_${randomUUID().slice(0, 8)}`;
          childTaskIds.push(childTaskId);

          await taskStore.create({
            taskId: childTaskId,
            operatorId: operator.operatorId,
            operatorName: operator.displayName,
            target: { type: 'agent', id: target.name },
            action: task,
            payload,
            priority: operator.priorityClass,
            status: 'queued',
            executionIds: [],
            parentTaskId,
            crossDepartment: { requested: false },
            createdAt: now,
            updatedAt: now,
          });

          const childAbort = new AbortController();
          activeAbortControllers.set(childTaskId, childAbort);

          executeAgentTask({
            taskId: childTaskId,
            agentName: target.name,
            department: target.department,
            task, payload, operatorId: operator.operatorId,
            operatorPreamble, priority: operator.priorityClass,
            abortSignal: childAbort.signal,
          });
        }

        // Create parent task referencing children
        await taskStore.create({
          taskId: parentTaskId,
          operatorId: operator.operatorId,
          operatorName: operator.displayName,
          target: { type: 'department', id: department! },
          action: task,
          payload,
          resourceKey,
          priority: operator.priorityClass,
          status: 'running',
          executionIds: [],
          childTaskIds,
          crossDepartment: { requested: false },
          createdAt: now,
          updatedAt: now,
        });

        if (eventStream) {
          eventStream.emit({
            type: 'task.created',
            departmentId: department!,
            operatorId: operator.operatorId,
            summary: `Department task created: ${task} (${targetAgents.length} agents)`,
            details: { taskId: parentTaskId, childTaskIds },
          });
        }

        res.json({
          taskId: parentTaskId,
          childTaskIds,
          status: 'running',
          agents: targetAgents.map((t) => t.name),
          department,
        });
      }

      auditLogger.log({
        timestamp: new Date(),
        operatorId: operator.operatorId,
        action: 'task.create',
        resource: { type: 'task', id: parentTaskId },
        request: { method: 'POST', path: '/v1/tasks', ip: getIp(req) },
        decision: 'allowed',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create task', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/tasks/:id/request-cross-department (#9 API shape) ─────

  app.post('/v1/tasks/:id/request-cross-department', async (req: Request, res: Response) => {
    const operator = (req as OperatorRequest).operator;
    if (!operator) { res.status(401).json({ error: 'Authentication required' }); return; }

    const existingTask = await taskStore.getByTaskId(req.params.id);
    if (!existingTask) { res.status(404).json({ error: 'Task not found' }); return; }
    if (existingTask.operatorId !== operator.operatorId && operator.tier !== 'root') {
      res.status(403).json({ error: 'Can only request cross-dept for your own tasks' }); return;
    }

    res.status(501).json({
      error: 'Use POST /v1/tasks with an out-of-scope agent to trigger cross-department workflow automatically',
    });
  });

  // ─── GET /v1/tasks ─────────────────────────────────────────────────────

  app.get('/v1/tasks', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) { res.status(401).json({ error: 'Authentication required' }); return; }

      const { status, department, limit: limitStr, offset: offsetStr } = req.query as {
        status?: string; department?: string; limit?: string; offset?: string;
      };

      let visibleDepartments: string[] | undefined;
      let visibleAgents: string[] | undefined;
      if (operator.tier !== 'root' && !operator.departments.includes('*')) {
        if (department && !operator.departments.includes(department)) {
          res.status(403).json({ error: `No access to department: ${department}` }); return;
        }
        visibleDepartments = department ? [department] : operator.departments;
        visibleAgents = [...allConfigs.entries()]
          .filter(([, c]) => visibleDepartments!.includes(c.department))
          .map(([name]) => name);
      } else if (department) {
        visibleDepartments = [department];
        visibleAgents = [...allConfigs.entries()]
          .filter(([, c]) => c.department === department)
          .map(([name]) => name);
      }

      const limit = limitStr ? parseInt(limitStr, 10) : 50;
      const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
      const result = await taskStore.listTasks({
        status, departmentIds: visibleDepartments, agentIds: visibleAgents,
        limit: Math.min(limit, 100), offset,
      });

      res.json({ tasks: result.tasks.map(formatTask), total: result.total, limit, offset });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to list tasks', { error: msg });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/tasks/:id ────────────────────────────────────────────────

  app.get('/v1/tasks/:id', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) { res.status(401).json({ error: 'Authentication required' }); return; }

      const task = await taskStore.getByTaskId(req.params.id);
      if (!task || !canSeeTask(operator, task, agentDepartmentMap)) {
        res.status(404).json({ error: 'Task not found' }); return;
      }
      res.json(formatTask(task));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── POST /v1/tasks/:id/cancel ───────────────────────────────────────

  app.post('/v1/tasks/:id/cancel', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) { res.status(401).json({ error: 'Authentication required' }); return; }

      const parsed = CancelTaskInput.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed' }); return; }

      const task = await taskStore.getByTaskId(req.params.id);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
      if (operator.tier !== 'root' && task.operatorId !== operator.operatorId) {
        res.status(403).json({ error: 'Can only cancel your own tasks (or be root)' }); return;
      }
      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        res.status(409).json({ error: `Task already ${task.status}` }); return;
      }

      // Abort in-flight execution
      const controller = activeAbortControllers.get(task.taskId);
      if (controller) { controller.abort(); activeAbortControllers.delete(task.taskId); }

      // Also abort child tasks for department fan-out
      if (task.childTaskIds?.length) {
        for (const childId of task.childTaskIds) {
          const childCtrl = activeAbortControllers.get(childId);
          if (childCtrl) { childCtrl.abort(); activeAbortControllers.delete(childId); }
          await taskStore.cancel(childId, operator.operatorId, parsed.data?.reason);
        }
      }

      await taskStore.cancel(task.taskId, operator.operatorId, parsed.data?.reason);
      res.json({ taskId: task.taskId, status: 'cancelled', aborted: !!controller });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/departments ──────────────────────────────────────────────

  app.get('/v1/departments', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) { res.status(401).json({ error: 'Authentication required' }); return; }

      const deptMap = new Map<string, string[]>();
      for (const [name, config] of allConfigs) {
        if (!deptMap.has(config.department)) deptMap.set(config.department, []);
        deptMap.get(config.department)!.push(name);
      }

      const isRoot = operator.tier === 'root' || operator.departments.includes('*');
      const departments = await Promise.all(
        [...deptMap.entries()]
          .filter(([slug]) => isRoot || operator.departments.includes(slug))
          .map(async ([slug, agentNames]) => {
            const { total: activeTasks } = await taskStore.listTasks({
              departmentIds: [slug], agentIds: agentNames, status: 'running', limit: 0,
            });
            return { slug, name: DEPARTMENT_NAMES[slug] || slug, agentCount: agentNames.length, agents: agentNames, activeTasks };
          }),
      );

      res.json({ departments });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /v1/agents ───────────────────────────────────────────────────

  app.get('/v1/agents', (req: Request, res: Response) => {
    const operator = (req as OperatorRequest).operator;
    if (!operator) { res.status(401).json({ error: 'Authentication required' }); return; }

    const isRoot = operator.tier === 'root' || operator.departments.includes('*');
    const agentList = [...allConfigs.entries()]
      .filter(([, config]) => isRoot || operator.departments.includes(config.department))
      .map(([name, config]) => ({
        name, department: config.department, description: config.description,
        status: 'active', model: config.model.model, triggerCount: config.triggers.length,
      }));
    res.json({ agents: agentList });
  });

  // ─── GET /v1/agents/:name/status ──────────────────────────────────────

  app.get('/v1/agents/:name/status', async (req: Request, res: Response) => {
    try {
      const operator = (req as OperatorRequest).operator;
      if (!operator) { res.status(401).json({ error: 'Authentication required' }); return; }

      const agentName = req.params.name;
      const config = router.getConfig(agentName);
      if (!config) { res.status(404).json({ error: `Unknown agent: ${agentName}` }); return; }

      const isRoot = operator.tier === 'root' || operator.departments.includes('*');
      if (!isRoot && !operator.departments.includes(config.department)) {
        res.status(404).json({ error: `Unknown agent: ${agentName}` }); return;
      }

      const stats = await services.auditLog.getAgentStats(agentName);
      const history = await services.auditLog.getAgentHistory(agentName, 10);

      res.json({
        name: agentName, department: config.department, description: config.description,
        status: 'active', model: config.model.model,
        stats: { totalExecutions: stats.totalExecutions, successRate: stats.successRate, averageDurationMs: stats.averageDurationMs },
        recentExecutions: history.map((h) => ({
          id: h.id, task: h.task, trigger: h.trigger, status: h.status, startedAt: h.startedAt, completedAt: h.completedAt,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Expose executeAgentTask for cross-dept approval to use ───────────
  return { executeAgentTask, agentDepartmentMap };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
}

function canSeeTask(operator: Operator, task: OperatorTask, agentDepartmentMap: Map<string, string>): boolean {
  if (operator.tier === 'root' || operator.departments.includes('*')) return true;
  if (task.operatorId === operator.operatorId) return true;
  const targetDept = task.target.type === 'department'
    ? task.target.id : agentDepartmentMap.get(task.target.id);
  return !!targetDept && operator.departments.includes(targetDept);
}

function formatTask(task: OperatorTask): Record<string, unknown> {
  return {
    taskId: task.taskId,
    operatorId: task.operatorId,
    operatorName: task.operatorName,
    target: task.target,
    action: task.action,
    priority: task.priority,
    status: task.status,
    realExecutionId: task.realExecutionId,
    childTaskIds: task.childTaskIds,
    parentTaskId: task.parentTaskId,
    crossDepartment: task.crossDepartment,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}
