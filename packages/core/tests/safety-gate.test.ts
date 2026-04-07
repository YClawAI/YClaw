import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyGate } from '../src/self/safety.js';
import type { SelfModification } from '../src/config/schema.js';

function makeMod(overrides: Partial<SelfModification> = {}): SelfModification {
  return {
    id: 'test-mod-1',
    agent: 'ember',
    type: 'config',
    description: 'test modification',
    changes: {},
    safetyLevel: 'auto_approved',
    status: 'pending',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('SafetyGate', () => {
  let gate: SafetyGate;
  let slackMessages: { message: string; severity: string }[];

  beforeEach(() => {
    gate = new SafetyGate();
    slackMessages = [];
    gate.setSlackAlerter(async (message, severity) => {
      slackMessages.push({ message, severity });
    });
  });

  // ─── classify() ─────────────────────────────────────────────────────────

  describe('classify()', () => {
    it('classifies config changes as auto_approved', () => {
      expect(gate.classify('update_config', {})).toBe('auto_approved');
    });

    it('classifies schedule changes as auto_approved', () => {
      expect(gate.classify('update_schedule', {})).toBe('auto_approved');
    });

    it('classifies model changes as agent_reviewed', () => {
      expect(gate.classify('update_model', {})).toBe('agent_reviewed');
    });

    it('classifies memory writes as auto_approved', () => {
      expect(gate.classify('memory_write', {})).toBe('auto_approved');
    });

    it('classifies prompt updates as agent_reviewed', () => {
      expect(gate.classify('update_prompt', {})).toBe('agent_reviewed');
    });

    it('classifies tool creation as agent_reviewed', () => {
      expect(gate.classify('create_tool', {})).toBe('agent_reviewed');
    });

    it('classifies data source requests as agent_reviewed', () => {
      expect(gate.classify('request_new_data_source', {})).toBe('agent_reviewed');
    });

    it('classifies code changes as human_reviewed', () => {
      expect(gate.classify('propose_code_change', {})).toBe('human_reviewed');
    });

    it('defaults unknown methods to human_reviewed (strictest)', () => {
      expect(gate.classify('some_unknown_method', {})).toBe('human_reviewed');
      expect(gate.classify('delete_agent', {})).toBe('human_reviewed');
      expect(gate.classify('', {})).toBe('human_reviewed');
    });
  });

  // ─── Immutable path protection ──────────────────────────────────────────

  describe('immutable path protection', () => {
    const IMMUTABLE_PATHS = [
      '/packages/core/src/self/safety.ts',
      '/packages/core/src/logging/audit.ts',
      '/packages/core/src/review/reviewer.ts',
      '/packages/core/src/agent/executor.ts',
      '/prompts/review-rules.md',
      '/prompts/mission_statement.md',
    ];

    for (const path of IMMUTABLE_PATHS) {
      it(`blocks modification of ${path}`, async () => {
        const mod = makeMod({
          changes: { path, content: 'hacked' },
        });
        const result = await gate.evaluate(mod);
        expect(result).toBe(false);
      });
    }

    it('blocks when immutable path appears anywhere in changes object', async () => {
      const mod = makeMod({
        changes: {
          nested: {
            deeply: {
              target: '/packages/core/src/self/safety.ts',
            },
          },
        },
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(false);
    });

    it('blocks when immutable path is in an array value', async () => {
      const mod = makeMod({
        changes: {
          files: ['/prompts/mission_statement.md'],
        },
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(false);
    });

    it('sends critical Slack alert when immutable path is targeted', async () => {
      const mod = makeMod({
        changes: { path: '/prompts/mission_statement.md' },
      });
      await gate.evaluate(mod);
      expect(slackMessages).toHaveLength(1);
      expect(slackMessages[0].severity).toBe('critical');
      expect(slackMessages[0].message).toContain('immutable safety file');
    });

    it('allows modification of non-immutable paths', async () => {
      const mod = makeMod({
        changes: { path: '/prompts/brand-voice.md', content: 'updated voice guide' },
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true);
    });

    it('allows modification of agent config files', async () => {
      const mod = makeMod({
        changes: { path: '/departments/marketing/ember.yaml', content: 'updated' },
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true);
    });
  });

  // ─── Protected config keys ──────────────────────────────────────────────

  describe('protected config key protection', () => {
    it('blocks modification of review_bypass config key', async () => {
      const mod = makeMod({
        type: 'config',
        changes: { review_bypass: ['*'] },
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(false);
    });

    it('blocks review_bypass even when nested in changes key', async () => {
      const mod = makeMod({
        type: 'config',
        changes: { changes: { review_bypass: ['telegram:daily_stats'] } },
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(false);
    });

    it('sends critical Slack alert for protected config key', async () => {
      const mod = makeMod({
        type: 'config',
        changes: { review_bypass: ['*'] },
      });
      await gate.evaluate(mod);
      expect(slackMessages).toHaveLength(1);
      expect(slackMessages[0].severity).toBe('critical');
      expect(slackMessages[0].message).toContain('protected config key');
    });

    it('allows modification of non-protected config keys', async () => {
      const mod = makeMod({
        type: 'config',
        changes: { temperature: 0.5, content_weights: { explainer: 3 } },
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true);
    });

    it('only checks protected keys for config type modifications', async () => {
      // review_bypass in a non-config mod type should be treated differently
      // (still caught by immutable path check if relevant, but not by config key check)
      const mod = makeMod({
        type: 'prompt',
        safetyLevel: 'agent_reviewed',
        changes: { review_bypass: ['test'] },
      });
      const result = await gate.evaluate(mod);
      // prompt mods go to agent_reviewed → approved in Phase 1
      expect(result).toBe(true);
    });
  });

  // ─── Safety level routing ─────────────────────────────────────────────

  describe('safety level routing', () => {
    it('auto-approves Layer 1 modifications', async () => {
      const mod = makeMod({ safetyLevel: 'auto_approved' });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true);
    });

    it('logs info-level Slack alert for auto-approved mods', async () => {
      const mod = makeMod({ safetyLevel: 'auto_approved', description: 'bumped temperature' });
      await gate.evaluate(mod);
      expect(slackMessages).toHaveLength(1);
      expect(slackMessages[0].severity).toBe('info');
      expect(slackMessages[0].message).toContain('auto-approved');
    });

    it('approves agent-reviewed mods in Phase 1 (with logging)', async () => {
      const mod = makeMod({
        safetyLevel: 'agent_reviewed',
        type: 'prompt',
        description: 'updated FAQ entry',
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true);
      expect(slackMessages[0].severity).toBe('warning');
      expect(slackMessages[0].message).toContain('needs review');
    });

    it('approves human-reviewed code proposals (creates PR, not direct change)', async () => {
      const mod = makeMod({
        safetyLevel: 'human_reviewed',
        type: 'code',
        description: 'proposed code optimization',
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true); // Returns true because proposals are saved, not applied
      expect(slackMessages[0].severity).toBe('critical');
      expect(slackMessages[0].message).toContain('NEEDS HUMAN APPROVAL');
    });

    it('blocks human-reviewed non-code modifications', async () => {
      const mod = makeMod({
        safetyLevel: 'human_reviewed',
        type: 'new_agent',
        description: 'attempted to create agent',
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(false);
    });

    it('blocks unknown safety levels', async () => {
      const mod = makeMod({
        safetyLevel: 'unknown_level' as any,
      });
      const result = await gate.evaluate(mod);
      expect(result).toBe(false);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles null changes gracefully', async () => {
      const mod = makeMod({ changes: null });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true); // auto_approved with no immutable paths
    });

    it('handles undefined changes gracefully', async () => {
      const mod = makeMod({ changes: undefined });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true);
    });

    it('handles empty changes object', async () => {
      const mod = makeMod({ changes: {} });
      const result = await gate.evaluate(mod);
      expect(result).toBe(true);
    });

    it('works without a Slack alerter configured', async () => {
      const noSlackGate = new SafetyGate();
      const mod = makeMod({
        changes: { path: '/prompts/mission_statement.md' },
      });
      // Should not throw even without Slack alerter
      const result = await noSlackGate.evaluate(mod);
      expect(result).toBe(false);
    });

    it('continues evaluation even if Slack alerter throws', async () => {
      gate.setSlackAlerter(async () => {
        throw new Error('Slack is down');
      });
      const mod = makeMod({
        changes: { path: '/prompts/mission_statement.md' },
      });
      // Should still block the modification even if Slack fails
      const result = await gate.evaluate(mod);
      expect(result).toBe(false);
    });
  });
});
