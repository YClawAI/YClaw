import { describe, it, expect } from 'vitest';
import { evaluatePermission, buildAgentDepartmentMap } from '../src/operators/permission-engine.js';
import type { Operator } from '../src/operators/types.js';
import type { Role } from '../src/operators/roles.js';

const baseOperator: Operator = {
  operatorId: 'op_test',
  displayName: 'Test',
  role: 'Tester',
  email: 'test@test.com',
  apiKeyHash: 'hash',
  apiKeyPrefix: 'prefix',
  tier: 'contributor',
  roleIds: ['role_contributor'],
  departments: ['marketing'],
  priorityClass: 50,
  limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
  status: 'active',
  tailscaleIPs: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const rootOperator: Operator = {
  ...baseOperator,
  operatorId: 'op_root',
  tier: 'root',
  roleIds: ['role_ceo'],
  departments: ['*'],
  priorityClass: 100,
};

const observerOperator: Operator = {
  ...baseOperator,
  operatorId: 'op_observer',
  tier: 'observer',
  roleIds: ['role_observer'],
  departments: ['marketing'],
  priorityClass: 10,
};

const deptHeadOperator: Operator = {
  ...baseOperator,
  operatorId: 'op_head',
  tier: 'department_head',
  roleIds: ['role_department_head'],
  departments: ['marketing', 'support'],
  priorityClass: 70,
};

const agentDepartmentMap = new Map([
  ['ember', 'marketing'],
  ['designer', 'marketing'],
  ['scout', 'marketing'],
  ['builder', 'development'],
  ['architect', 'development'],
  ['treasurer', 'finance'],
  ['guide', 'support'],
]);

const contributorRole: Role = {
  roleId: 'role_contributor',
  name: 'Contributor',
  grants: [],
  priorityClass: 50,
  canManageOperators: false,
  canApproveDeployments: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ceoRole: Role = {
  roleId: 'role_ceo',
  name: 'CEO',
  grants: [{ resourceType: 'department', resourceId: '*', actions: ['*'] }],
  priorityClass: 100,
  canManageOperators: true,
  canApproveDeployments: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('evaluatePermission', () => {
  it('root operator is always allowed', () => {
    const result = evaluatePermission(rootOperator, [ceoRole], {
      operatorId: 'op_root',
      action: 'trigger',
      resourceType: 'agent',
      resourceId: 'builder',
    }, agentDepartmentMap);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('root_access');
  });

  it('contributor can trigger agent in their department', () => {
    const result = evaluatePermission(baseOperator, [contributorRole], {
      operatorId: 'op_test',
      action: 'trigger',
      resourceType: 'agent',
      resourceId: 'ember',
    }, agentDepartmentMap);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('department_match');
  });

  it('contributor cannot trigger agent outside their department', () => {
    const result = evaluatePermission(baseOperator, [contributorRole], {
      operatorId: 'op_test',
      action: 'trigger',
      resourceType: 'agent',
      resourceId: 'builder',
    }, agentDepartmentMap);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied_no_grant');
  });

  it('department head can trigger agents in all assigned departments', () => {
    const r1 = evaluatePermission(deptHeadOperator, [], {
      operatorId: 'op_head', action: 'trigger', resourceType: 'agent', resourceId: 'ember',
    }, agentDepartmentMap);
    expect(r1.allowed).toBe(true);

    const r2 = evaluatePermission(deptHeadOperator, [], {
      operatorId: 'op_head', action: 'trigger', resourceType: 'agent', resourceId: 'guide',
    }, agentDepartmentMap);
    expect(r2.allowed).toBe(true);

    const r3 = evaluatePermission(deptHeadOperator, [], {
      operatorId: 'op_head', action: 'trigger', resourceType: 'agent', resourceId: 'treasurer',
    }, agentDepartmentMap);
    expect(r3.allowed).toBe(false);
  });

  it('observer can read in their department', () => {
    const result = evaluatePermission(observerOperator, [], {
      operatorId: 'op_observer', action: 'read', resourceType: 'agent', resourceId: 'ember',
    }, agentDepartmentMap);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('department_match');
  });

  it('observer cannot trigger (write action)', () => {
    const result = evaluatePermission(observerOperator, [], {
      operatorId: 'op_observer', action: 'trigger', resourceType: 'agent', resourceId: 'ember',
    }, agentDepartmentMap);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied_observer');
  });

  it('observer cannot cancel tasks', () => {
    const result = evaluatePermission(observerOperator, [], {
      operatorId: 'op_observer', action: 'cancel', resourceType: 'task', resourceId: 'task_123',
    }, agentDepartmentMap);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied_observer');
  });

  it('explicit role grant overrides department check', () => {
    const specialRole: Role = {
      ...contributorRole,
      grants: [{ resourceType: 'agent', resourceId: 'builder', actions: ['trigger'] }],
    };

    const result = evaluatePermission(baseOperator, [specialRole], {
      operatorId: 'op_test', action: 'trigger', resourceType: 'agent', resourceId: 'builder',
    }, agentDepartmentMap);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('role_grant');
    expect(result.effectiveGrants).toHaveLength(1);
  });

  it('multi-role aggregation: grants from multiple roles are combined', () => {
    const role1: Role = {
      ...contributorRole,
      roleId: 'role_custom1',
      grants: [{ resourceType: 'agent', resourceId: 'builder', actions: ['trigger'] }],
    };
    const role2: Role = {
      ...contributorRole,
      roleId: 'role_custom2',
      grants: [{ resourceType: 'agent', resourceId: 'treasurer', actions: ['read'] }],
    };

    // Can trigger builder via role1
    const r1 = evaluatePermission(baseOperator, [role1, role2], {
      operatorId: 'op_test', action: 'trigger', resourceType: 'agent', resourceId: 'builder',
    }, agentDepartmentMap);
    expect(r1.allowed).toBe(true);

    // Can read treasurer via role2
    const r2 = evaluatePermission(baseOperator, [role1, role2], {
      operatorId: 'op_test', action: 'read', resourceType: 'agent', resourceId: 'treasurer',
    }, agentDepartmentMap);
    expect(r2.allowed).toBe(true);
  });

  it('department-level permission check works for trigger', () => {
    const result = evaluatePermission(baseOperator, [contributorRole], {
      operatorId: 'op_test', action: 'trigger', resourceType: 'department', resourceId: 'marketing',
    }, agentDepartmentMap);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('department_match');
  });

  it('department match restricts to standard actions only', () => {
    // 'approve' is not a standard department action
    const result = evaluatePermission(baseOperator, [contributorRole], {
      operatorId: 'op_test', action: 'approve', resourceType: 'agent', resourceId: 'ember',
    }, agentDepartmentMap);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied_no_grant');
  });

  it('denies access to unknown agent', () => {
    const result = evaluatePermission(baseOperator, [contributorRole], {
      operatorId: 'op_test', action: 'trigger', resourceType: 'agent', resourceId: 'nonexistent',
    }, agentDepartmentMap);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied_no_grant');
  });
});

describe('buildAgentDepartmentMap', () => {
  it('builds correct map from agent configs', () => {
    const configs = new Map([
      ['ember', { department: 'marketing' }],
      ['builder', { department: 'development' }],
      ['treasurer', { department: 'finance' }],
    ]);
    const map = buildAgentDepartmentMap(configs);
    expect(map.get('ember')).toBe('marketing');
    expect(map.get('builder')).toBe('development');
    expect(map.get('treasurer')).toBe('finance');
    expect(map.size).toBe(3);
  });
});
