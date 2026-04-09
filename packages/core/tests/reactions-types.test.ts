/**
 * Tests for reactions type definitions and rule structure validation.
 *
 * Validates that DEFAULT_REACTION_RULES conform to the ReactionRule interface
 * and that all rule IDs are unique, all triggers reference valid event types,
 * and all actions reference valid action types.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_REACTION_RULES } from '../src/reactions/rules.js';
import type {
  ReactionRule,
  ReactionAction,
  ReactionCondition,
  SafetyGate,
  ReactionContext,
  ReactionAuditEntry,
} from '../src/reactions/types.js';

describe('DEFAULT_REACTION_RULES', () => {
  it('exports a non-empty array of rules', () => {
    expect(Array.isArray(DEFAULT_REACTION_RULES)).toBe(true);
    expect(DEFAULT_REACTION_RULES.length).toBeGreaterThan(0);
  });

  it('has unique rule IDs', () => {
    const ids = DEFAULT_REACTION_RULES.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('every rule has required fields', () => {
    for (const rule of DEFAULT_REACTION_RULES) {
      expect(rule.id).toBeTruthy();
      expect(typeof rule.enabled).toBe('boolean');
      expect(rule.trigger).toBeDefined();
      expect(rule.trigger.event).toBeTruthy();
      expect(Array.isArray(rule.actions)).toBe(true);
      expect(rule.actions.length).toBeGreaterThan(0);
    }
  });

  it('all action types are valid', () => {
    const validActionTypes = new Set([
      'github:merge_pr',
      'github:close_issue',
      'github:pr_comment',
      'agent:trigger',
      'task:update',
      'task:create',
      'event:publish',
      'discord:message',
      'github:update_branch',
    ]);

    for (const rule of DEFAULT_REACTION_RULES) {
      for (const action of rule.actions) {
        expect(validActionTypes.has(action.type)).toBe(true);
      }
      if (rule.escalation) {
        expect(validActionTypes.has(rule.escalation.action.type)).toBe(true);
      }
    }
  });

  it('all condition types are valid', () => {
    const validConditionTypes = new Set([
      'pr_approved',
      'ci_green',
      'has_linked_issue',
      'task_exists',
      'label_present',
      'label_absent',
    ]);

    for (const rule of DEFAULT_REACTION_RULES) {
      if (rule.conditions) {
        for (const cond of rule.conditions) {
          expect(validConditionTypes.has(cond.type)).toBe(true);
        }
      }
    }
  });

  it('all safety gate types are valid', () => {
    const validGateTypes = new Set([
      'all_checks_passed',
      'min_approvals',
      'no_merge_conflicts',
      'no_label',
      'dod_gate_passed',
      'required_reviewer',
      'comment_approved',
      'branch_up_to_date',
    ]);

    for (const rule of DEFAULT_REACTION_RULES) {
      if (rule.safetyGates) {
        for (const gate of rule.safetyGates) {
          expect(validGateTypes.has(gate.type)).toBe(true);
        }
      }
    }
  });

  it('escalation rules have positive afterMs', () => {
    for (const rule of DEFAULT_REACTION_RULES) {
      if (rule.escalation) {
        expect(rule.escalation.afterMs).toBeGreaterThan(0);
        expect(rule.escalation.action).toBeDefined();
      }
    }
  });

  it('retry rules have positive max and delayMs', () => {
    for (const rule of DEFAULT_REACTION_RULES) {
      if (rule.retry) {
        expect(rule.retry.max).toBeGreaterThan(0);
        expect(rule.retry.delayMs).toBeGreaterThan(0);
      }
    }
  });
});

describe('ReactionContext type', () => {
  it('accepts a minimal context', () => {
    const ctx: ReactionContext = {
      eventType: 'github:ci_pass',
      payload: { branch: 'main' },
      owner: 'yclaw-ai',
      repo: 'yclaw',
    };
    expect(ctx.eventType).toBe('github:ci_pass');
    expect(ctx.correlationId).toBeUndefined();
  });

  it('accepts a full context with optional fields', () => {
    const ctx: ReactionContext = {
      eventType: 'github:pr_review_submitted',
      payload: { review_state: 'approved' },
      prNumber: 42,
      issueNumber: 17,
      owner: 'yclaw-ai',
      repo: 'yclaw',
      correlationId: 'corr-123',
    };
    expect(ctx.prNumber).toBe(42);
    expect(ctx.correlationId).toBe('corr-123');
  });
});

describe('ReactionAuditEntry type', () => {
  it('accepts a valid audit entry', () => {
    const entry: ReactionAuditEntry = {
      timestamp: Date.now(),
      ruleId: 'auto-merge-on-ci-pass',
      eventType: 'github:ci_pass',
      resource: 'pr:42',
      conditionsPassed: true,
      gatesPassed: true,
      actionsExecuted: ['github:merge_pr', 'slack:message'],
      actionsFailed: [],
    };
    expect(entry.ruleId).toBe('auto-merge-on-ci-pass');
    expect(entry.error).toBeUndefined();
  });

  it('accepts an audit entry with error', () => {
    const entry: ReactionAuditEntry = {
      timestamp: Date.now(),
      ruleId: 'ci-failed-on-pr',
      eventType: 'github:ci_fail',
      resource: 'pr:99',
      conditionsPassed: true,
      gatesPassed: false,
      actionsExecuted: [],
      actionsFailed: ['agent:trigger'],
      error: 'Agent trigger timed out',
    };
    expect(entry.gatesPassed).toBe(false);
    expect(entry.error).toBeTruthy();
  });
});

describe('specific rules', () => {
  it('ci-failed-on-pr rule triggers builder', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'ci-failed-on-pr');
    expect(rule).toBeDefined();
    expect(rule!.trigger.event).toBe('github:ci_fail');
    expect(rule!.enabled).toBe(true);

    const agentAction = rule!.actions.find((a) => a.type === 'agent:trigger');
    expect(agentAction).toBeDefined();
    expect(agentAction!.params.agent).toBe('builder');
  });

  it('changes-requested rule triggers builder', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'changes-requested');
    expect(rule).toBeDefined();
    expect(rule!.trigger.event).toBe('github:pr_review_submitted');
    expect(rule!.trigger.filter).toEqual({ review_state: 'changes_requested' });
  });

  it('auto-merge-on-ci-pass has safety gates including comment_approved', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'auto-merge-on-ci-pass');
    expect(rule).toBeDefined();
    expect(rule!.safetyGates).toBeDefined();
    expect(rule!.safetyGates!.length).toBeGreaterThanOrEqual(4);

    const gateTypes = rule!.safetyGates!.map((g) => g.type);
    expect(gateTypes).toContain('all_checks_passed');
    expect(gateTypes).toContain('comment_approved');
    expect(gateTypes).toContain('no_merge_conflicts');
    expect(gateTypes).toContain('dod_gate_passed');
  });

  it('auto-merge-on-ci-pass comment_approved gate specifies reviewer from env', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'auto-merge-on-ci-pass');
    expect(rule).toBeDefined();

    const commentGate = rule!.safetyGates!.find((g) => g.type === 'comment_approved');
    expect(commentGate).toBeDefined();
    expect(commentGate!.params).toHaveProperty('reviewers');
    expect((commentGate!.params as { reviewers: string[] }).reviewers).toHaveLength(1);
  });

  it('auto-merge-on-approval has comment_approved gate', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'auto-merge-on-approval');
    expect(rule).toBeDefined();

    const gateTypes = rule!.safetyGates!.map((g) => g.type);
    expect(gateTypes).toContain('comment_approved');

    const commentGate = rule!.safetyGates!.find((g) => g.type === 'comment_approved');
    expect(commentGate!.params).toHaveProperty('reviewers');
    expect((commentGate!.params as { reviewers: string[] }).reviewers).toHaveLength(1);
  });

  it('auto-merge-on-approval checks ci_green condition', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'auto-merge-on-approval');
    expect(rule).toBeDefined();
    expect(rule!.conditions).toBeDefined();

    const condTypes = rule!.conditions!.map((c) => c.type);
    expect(condTypes).toContain('ci_green');
  });

  it('pr-merged-close-issues checks has_linked_issue', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'pr-merged-close-issues');
    expect(rule).toBeDefined();
    expect(rule!.conditions).toBeDefined();

    const condTypes = rule!.conditions!.map((c) => c.type);
    expect(condTypes).toContain('has_linked_issue');
  });

  it('new-issue-auto-assign excludes human-only label', () => {
    const rule = DEFAULT_REACTION_RULES.find((r) => r.id === 'new-issue-auto-assign');
    expect(rule).toBeDefined();
    expect(rule!.conditions).toBeDefined();

    const labelCond = rule!.conditions!.find((c) => c.type === 'label_absent');
    expect(labelCond).toBeDefined();
    expect(labelCond!.params).toEqual({ label: 'human-only' });
  });
});
