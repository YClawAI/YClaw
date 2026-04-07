import { describe, it, expect } from 'vitest';
import { evaluatePermission, buildAgentDepartmentMap } from '../src/operators/permission-engine.js';
import type { Operator } from '../src/operators/types.js';

// Test that scoped reads return correct filtered results based on operator tier

const agentDepartmentMap = new Map([
  ['ember', 'marketing'],
  ['designer', 'marketing'],
  ['scout', 'marketing'],
  ['builder', 'development'],
  ['architect', 'development'],
  ['deployer', 'development'],
  ['treasurer', 'finance'],
  ['sentinel', 'operations'],
  ['guide', 'support'],
  ['keeper', 'support'],
  ['strategist', 'executive'],
  ['reviewer', 'executive'],
]);

const allDepartments = ['executive', 'development', 'marketing', 'finance', 'operations', 'support'];

function getVisibleDepartments(operator: Operator): string[] {
  if (operator.tier === 'root' || operator.departments.includes('*')) {
    return allDepartments;
  }
  return operator.departments.filter((d) => allDepartments.includes(d));
}

function getVisibleAgents(operator: Operator): string[] {
  const visibleDepts = getVisibleDepartments(operator);
  return [...agentDepartmentMap.entries()]
    .filter(([, dept]) => visibleDepts.includes(dept))
    .map(([name]) => name);
}

describe('Scoped Department Reads', () => {
  it('root sees all departments', () => {
    const root: Operator = {
      operatorId: 'op_root', displayName: 'CEO', role: 'CEO', email: 'ceo@test.com',
      apiKeyHash: 'h', apiKeyPrefix: 'p', tier: 'root', departments: ['*'],
      priorityClass: 100, limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active', tailscaleIPs: [], createdAt: new Date(), updatedAt: new Date(),
    };

    expect(getVisibleDepartments(root)).toEqual(allDepartments);
  });

  it('department head sees only assigned departments', () => {
    const head: Operator = {
      operatorId: 'op_head', displayName: 'CMO', role: 'CMO', email: 'cmo@test.com',
      apiKeyHash: 'h', apiKeyPrefix: 'p', tier: 'department_head', departments: ['marketing', 'support'],
      priorityClass: 70, limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active', tailscaleIPs: [], createdAt: new Date(), updatedAt: new Date(),
    };

    const visible = getVisibleDepartments(head);
    expect(visible).toContain('marketing');
    expect(visible).toContain('support');
    expect(visible).not.toContain('development');
    expect(visible).not.toContain('finance');
    expect(visible).toHaveLength(2);
  });

  it('contributor sees only their single department', () => {
    const contributor: Operator = {
      operatorId: 'op_contrib', displayName: 'Designer', role: 'Designer', email: 'designer@test.com',
      apiKeyHash: 'h', apiKeyPrefix: 'p', tier: 'contributor', departments: ['marketing'],
      priorityClass: 50, limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active', tailscaleIPs: [], createdAt: new Date(), updatedAt: new Date(),
    };

    expect(getVisibleDepartments(contributor)).toEqual(['marketing']);
  });
});

describe('Scoped Agent Reads', () => {
  it('root sees all agents', () => {
    const root: Operator = {
      operatorId: 'op_root', displayName: 'CEO', role: 'CEO', email: 'ceo@test.com',
      apiKeyHash: 'h', apiKeyPrefix: 'p', tier: 'root', departments: ['*'],
      priorityClass: 100, limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active', tailscaleIPs: [], createdAt: new Date(), updatedAt: new Date(),
    };

    expect(getVisibleAgents(root)).toHaveLength(agentDepartmentMap.size);
  });

  it('marketing head sees only marketing agents', () => {
    const head: Operator = {
      operatorId: 'op_mktg', displayName: 'CMO', role: 'CMO', email: 'cmo@test.com',
      apiKeyHash: 'h', apiKeyPrefix: 'p', tier: 'department_head', departments: ['marketing'],
      priorityClass: 70, limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active', tailscaleIPs: [], createdAt: new Date(), updatedAt: new Date(),
    };

    const visible = getVisibleAgents(head);
    expect(visible).toContain('ember');
    expect(visible).toContain('designer');
    expect(visible).toContain('scout');
    expect(visible).not.toContain('builder');
    expect(visible).not.toContain('treasurer');
    expect(visible).toHaveLength(3);
  });

  it('multi-department head sees agents from all assigned departments', () => {
    const head: Operator = {
      operatorId: 'op_multi', displayName: 'VP', role: 'VP', email: 'vp@test.com',
      apiKeyHash: 'h', apiKeyPrefix: 'p', tier: 'department_head', departments: ['marketing', 'development'],
      priorityClass: 70, limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active', tailscaleIPs: [], createdAt: new Date(), updatedAt: new Date(),
    };

    const visible = getVisibleAgents(head);
    expect(visible).toContain('ember');
    expect(visible).toContain('builder');
    expect(visible).toContain('architect');
    expect(visible).not.toContain('treasurer');
    expect(visible).toHaveLength(6); // 3 marketing + 3 development
  });

  it('observer with read permission can read agents but permission engine blocks triggers', () => {
    const observer: Operator = {
      operatorId: 'op_obs', displayName: 'Intern', role: 'Intern', email: 'intern@test.com',
      apiKeyHash: 'h', apiKeyPrefix: 'p', tier: 'observer', departments: ['marketing'],
      priorityClass: 10, limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
      status: 'active', tailscaleIPs: [], createdAt: new Date(), updatedAt: new Date(),
    };

    // Can see marketing agents
    const visible = getVisibleAgents(observer);
    expect(visible).toContain('ember');
    expect(visible).toHaveLength(3);

    // But permission engine blocks trigger
    const triggerResult = evaluatePermission(observer, [], {
      operatorId: 'op_obs',
      action: 'trigger',
      resourceType: 'agent',
      resourceId: 'ember',
    }, agentDepartmentMap);
    expect(triggerResult.allowed).toBe(false);
    expect(triggerResult.reason).toBe('denied_observer');

    // Read is allowed
    const readResult = evaluatePermission(observer, [], {
      operatorId: 'op_obs',
      action: 'read',
      resourceType: 'agent',
      resourceId: 'ember',
    }, agentDepartmentMap);
    expect(readResult.allowed).toBe(true);
  });
});
