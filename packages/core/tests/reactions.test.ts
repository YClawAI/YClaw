import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ReactionsManager } from '../src/reactions/manager.js';
import { ReactionEvaluator } from '../src/reactions/evaluator.js';
import { EscalationManager } from '../src/reactions/escalation.js';
import { DEFAULT_REACTION_RULES } from '../src/reactions/rules.js';
import type { ReactionRule, ReactionContext } from '../src/reactions/types.js';

// ─── Mock Redis ─────────────────────────────────────────────────────────────

function createMockRedis() {
  const store = new Map<string, string>();
  const zset = new Map<string, number>();
  const hash = new Map<string, Map<string, string>>();

  return {
    get: vi.fn(async (key: string) => store.get(key) || null),
    set: vi.fn(async (key: string, value: string, ...args: any[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    exists: vi.fn(async (key: string) => store.has(key) ? 1 : 0),
    lpush: vi.fn(async () => 1),
    ltrim: vi.fn(async () => 'OK'),
    expire: vi.fn(async () => 1),
    zadd: vi.fn(async (_key: string, score: string, member: string) => {
      zset.set(member, parseFloat(score));
      return 1;
    }),
    zrangebyscore: vi.fn(async () => []),
    zrem: vi.fn(async (_key: string, member: string) => { zset.delete(member); return 1; }),
    hset: vi.fn(async (key: string, field: string, value: string) => {
      if (!hash.has(key)) hash.set(key, new Map());
      hash.get(key)!.set(field, value);
      return 1;
    }),
    hget: vi.fn(async (key: string, field: string) => {
      return hash.get(key)?.get(field) || null;
    }),
    hdel: vi.fn(async (key: string, field: string) => {
      hash.get(key)?.delete(field);
      return 1;
    }),
    _store: store,
    _zset: zset,
    _hash: hash,
  } as any;
}

// ─── Mock Deps ──────────────────────────────────────────────────────────────

function createMockDeps(redis: any) {
  return {
    redis,
    githubToken: 'test-token',
    triggerAgent: vi.fn(async () => {}),
    publishEvent: vi.fn(async () => {}),
    executeGitHubAction: vi.fn(async () => ({ success: true })),
    executeSlackAction: vi.fn(async () => {}),
    executeTaskAction: vi.fn(async () => {}),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ReactionsManager', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let deps: ReturnType<typeof createMockDeps>;
  let manager: ReactionsManager;

  beforeEach(() => {
    redis = createMockRedis();
    deps = createMockDeps(redis);
  });

  afterEach(() => {
    manager?.stop();
  });

  describe('Rule Matching', () => {
    it('should match rules by event type', async () => {
      const rules: ReactionRule[] = [{
        id: 'test-ci-fail',
        enabled: true,
        trigger: { event: 'github:ci_fail' },
        actions: [{ type: 'agent:trigger', params: { agent: 'builder', task: 'Fix CI' } }],
      }];

      manager = new ReactionsManager({ ...deps, rules });
      await manager.handleEvent('github:ci_fail', {
        owner: 'yclaw-ai',
        repo: 'yclaw',
        branch: 'fix/test',
        workflow: 'CI',
        commit_sha: 'abc123',
        url: 'https://github.com/...',
      });

      expect(deps.triggerAgent).toHaveBeenCalledWith('builder', 'Fix CI', undefined, expect.any(Object));
    });

    it('should filter by event payload fields', async () => {
      const rules: ReactionRule[] = [{
        id: 'test-approved',
        enabled: true,
        trigger: { event: 'github:pr_review_submitted', filter: { review_state: 'approved' } },
        actions: [{ type: 'slack:message', params: { channel: 'C123', text: 'Approved!' } }],
      }];

      manager = new ReactionsManager({ ...deps, rules });

      // Should NOT match — wrong review_state
      await manager.handleEvent('github:pr_review_submitted', {
        owner: 'yclaw-ai', repo: 'yclaw',
        review_state: 'changes_requested',
        pr_number: 42,
      });
      expect(deps.executeSlackAction).not.toHaveBeenCalled();

      // Should match
      await manager.handleEvent('github:pr_review_submitted', {
        owner: 'yclaw-ai', repo: 'yclaw',
        review_state: 'approved',
        pr_number: 42,
      });
      expect(deps.executeSlackAction).toHaveBeenCalledWith('C123', 'Approved!');
    });

    it('should skip disabled rules', async () => {
      const rules: ReactionRule[] = [{
        id: 'disabled',
        enabled: false,
        trigger: { event: 'github:ci_fail' },
        actions: [{ type: 'agent:trigger', params: { agent: 'builder', task: 'Fix CI' } }],
      }];

      manager = new ReactionsManager({ ...deps, rules });
      await manager.handleEvent('github:ci_fail', { owner: 'yclaw-ai', repo: 'yclaw' });
      expect(deps.triggerAgent).not.toHaveBeenCalled();
    });
  });

  describe('Template Interpolation', () => {
    it('should interpolate {{field}} placeholders from payload', async () => {
      const rules: ReactionRule[] = [{
        id: 'test-template',
        enabled: true,
        trigger: { event: 'github:ci_fail' },
        actions: [{
          type: 'agent:trigger',
          params: { agent: 'builder', task: 'Fix PR #{{pr_number}} on branch {{branch}}' },
        }],
      }];

      manager = new ReactionsManager({ ...deps, rules });
      await manager.handleEvent('github:ci_fail', {
        owner: 'yclaw-ai', repo: 'yclaw',
        pr_number: 42,
        branch: 'fix/test',
      });

      expect(deps.triggerAgent).toHaveBeenCalledWith('builder', 'Fix PR #42 on branch fix/test', undefined, expect.any(Object));
    });

    it('should replace missing fields with empty string', async () => {
      const rules: ReactionRule[] = [{
        id: 'test-missing',
        enabled: true,
        trigger: { event: 'github:ci_fail' },
        actions: [{
          type: 'agent:trigger',
          params: { agent: 'builder', task: 'Fix {{nonexistent}} issue' },
        }],
      }];

      manager = new ReactionsManager({ ...deps, rules });
      await manager.handleEvent('github:ci_fail', { owner: 'yclaw-ai', repo: 'yclaw' });
      expect(deps.triggerAgent).toHaveBeenCalledWith('builder', 'Fix  issue', undefined, expect.any(Object));
    });
  });

  describe('Dedup Lock', () => {
    it('should prevent duplicate execution of the same rule on the same PR', async () => {
      const rules: ReactionRule[] = [{
        id: 'test-dedup',
        enabled: true,
        trigger: { event: 'github:ci_fail' },
        actions: [{ type: 'agent:trigger', params: { agent: 'builder', task: 'Fix it' } }],
      }];

      manager = new ReactionsManager({ ...deps, rules });

      // First call should execute
      await manager.handleEvent('github:ci_fail', {
        owner: 'yclaw-ai', repo: 'yclaw', pr_number: 42,
      });
      expect(deps.triggerAgent).toHaveBeenCalledTimes(1);

      // Second call should be blocked by dedup lock
      await manager.handleEvent('github:ci_fail', {
        owner: 'yclaw-ai', repo: 'yclaw', pr_number: 42,
      });
      expect(deps.triggerAgent).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('Default Rules', () => {
    it('should have all expected default rules', () => {
      expect(DEFAULT_REACTION_RULES).toHaveLength(11);
      const ids = DEFAULT_REACTION_RULES.map(r => r.id);
      expect(ids).toContain('ci-failed-on-pr');
      expect(ids).toContain('changes-requested');
      expect(ids).toContain('auto-update-behind-branch');
      expect(ids).toContain('auto-merge-on-ci-pass');
      expect(ids).toContain('auto-merge-on-approval');
      expect(ids).toContain('pr-merged-close-issues');
      expect(ids).toContain('issue-closed-task-cleanup');
      expect(ids).toContain('new-issue-auto-assign');
      expect(ids).toContain('stale-review-re-request');
    });

    it('should have all rules enabled by default', () => {
      for (const rule of DEFAULT_REACTION_RULES) {
        expect(rule.enabled).toBe(true);
      }
    });
  });
});

describe('ReactionEvaluator', () => {
  describe('extractLinkedIssues', () => {
    let evaluator: ReactionEvaluator;

    beforeEach(() => {
      evaluator = new ReactionEvaluator(createMockRedis() as any, 'test');
    });

    it('should extract "Fixes #N" patterns', () => {
      expect(evaluator.extractLinkedIssues('Fixes #42')).toEqual([42]);
      expect(evaluator.extractLinkedIssues('fixes #42')).toEqual([42]);
    });

    it('should extract "Closes #N" patterns', () => {
      expect(evaluator.extractLinkedIssues('Closes #10')).toEqual([10]);
    });

    it('should extract "Resolves #N" patterns', () => {
      expect(evaluator.extractLinkedIssues('Resolves #99')).toEqual([99]);
    });

    it('should extract multiple linked issues', () => {
      const body = 'Fixes #1, Closes #2, and Resolves #3';
      expect(evaluator.extractLinkedIssues(body)).toEqual([1, 2, 3]);
    });

    it('should deduplicate', () => {
      expect(evaluator.extractLinkedIssues('Fixes #42 Closes #42')).toEqual([42]);
    });

    it('should return empty array for null/undefined', () => {
      expect(evaluator.extractLinkedIssues(null)).toEqual([]);
      expect(evaluator.extractLinkedIssues(undefined)).toEqual([]);
    });

    it('should return empty array when no patterns match', () => {
      expect(evaluator.extractLinkedIssues('Just a regular PR body')).toEqual([]);
    });
  });
});

describe('EscalationManager', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let escalation: EscalationManager;

  beforeEach(() => {
    redis = createMockRedis();
    escalation = new EscalationManager(redis as any);
  });

  afterEach(() => {
    escalation.stop();
  });

  it('should schedule escalation in Redis ZSET', async () => {
    const ctx: ReactionContext = {
      eventType: 'github:ci_fail',
      payload: {},
      prNumber: 42,
      owner: 'yclaw-ai',
      repo: 'yclaw',
    };

    await escalation.schedule('test-rule', 30000, {
      type: 'slack:message',
      params: { channel: 'C123', text: 'Escalation!' },
    }, ctx);

    expect(redis.zadd).toHaveBeenCalledTimes(1);
    const [key, score, member] = redis.zadd.mock.calls[0];
    expect(key).toBe('reaction:escalations');
    expect(parseFloat(score)).toBeGreaterThan(Date.now() - 1000);
    // Member is now a dedup key (ruleId:resource), not full JSON
    expect(member).toBe('test-rule:pr:42');

    // Full entry stored in hash
    expect(redis.hset).toHaveBeenCalledTimes(1);
    const [hkey, hfield, hvalue] = redis.hset.mock.calls[0];
    expect(hkey).toBe('reaction:escalation_data');
    const parsed = JSON.parse(hvalue);
    expect(parsed.ruleId).toBe('test-rule');
    expect(parsed.action.type).toBe('slack:message');
  });
});
