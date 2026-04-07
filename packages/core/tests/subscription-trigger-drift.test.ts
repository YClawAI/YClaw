/**
 * Unit tests for subscription→trigger drift detection (#872).
 *
 * Validates that loadAllAgentConfigs() emits a WARN to stderr for every
 * event_subscriptions entry that has no corresponding type:event trigger,
 * and stays silent when subscriptions are properly wired up.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vol } from 'memfs';

// Mock node:fs with memfs for isolated file system testing
vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return {
    readFileSync: memfs.vol.readFileSync.bind(memfs.vol),
    readdirSync: memfs.vol.readdirSync.bind(memfs.vol),
    existsSync: memfs.vol.existsSync.bind(memfs.vol),
    statSync: memfs.vol.statSync.bind(memfs.vol),
  };
});

// Must import after mocking
import {
  loadAllAgentConfigs,
  getDepartmentsDir,
  clearPromptCache,
} from '../src/config/loader.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid agent YAML string with configurable
 * triggers and event_subscriptions.
 */
function makeAgentYaml(opts: {
  name: string;
  eventSubscriptions?: string[];
  triggers?: Array<{ type: string; event?: string; schedule?: string; task: string }>;
}): string {
  const subscriptions = opts.eventSubscriptions ?? [];
  const triggers = opts.triggers ?? [];

  const subscriptionsYaml =
    subscriptions.length > 0
      ? 'event_subscriptions:\n' + subscriptions.map(s => `  - ${s}`).join('\n')
      : 'event_subscriptions: []';

  const triggersYaml =
    triggers.length > 0
      ? 'triggers:\n' +
        triggers
          .map(t => {
            let entry = `  - type: ${t.type}\n    task: ${t.task}`;
            if (t.event) entry += `\n    event: ${t.event}`;
            if (t.schedule) entry += `\n    schedule: ${t.schedule}`;
            return entry;
          })
          .join('\n')
      : 'triggers: []';

  return [
    `name: ${opts.name}`,
    'department: development',
    'description: Test agent for subscription-trigger drift validation',
    'model:',
    '  provider: anthropic',
    '  model: claude-3-5-sonnet-20241022',
    'system_prompts: []',
    'actions: []',
    triggersYaml,
    subscriptionsYaml,
  ].join('\n');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadAllAgentConfigs — subscription→trigger drift warnings (#872)', () => {
  let stderrOutput: string[] = [];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearPromptCache();
    vol.reset();
    stderrOutput = [];
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: unknown) => {
        stderrOutput.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vol.reset();
  });

  /** Convenience: collect only drift-related WARN lines */
  function driftWarnings(): string[] {
    return stderrOutput.filter(
      l => l.includes('[WARN]') && l.includes('subscribes to') && l.includes('but has no trigger'),
    );
  }

  it('emits no warning when every subscription has a matching type:event trigger', () => {
    const deptsDir = getDepartmentsDir();
    vol.mkdirSync(`${deptsDir}/development`, { recursive: true });
    vol.writeFileSync(
      `${deptsDir}/development/well_aligned.yaml`,
      makeAgentYaml({
        name: 'well_aligned',
        eventSubscriptions: ['pr.opened', 'pr.merged'],
        triggers: [
          { type: 'event', event: 'pr.opened', task: 'handle_pr_opened' },
          { type: 'event', event: 'pr.merged', task: 'handle_pr_merged' },
        ],
      }),
    );

    loadAllAgentConfigs();

    expect(driftWarnings()).toHaveLength(0);
  });

  it('emits a WARN when a subscription has no matching event trigger', () => {
    const deptsDir = getDepartmentsDir();
    vol.mkdirSync(`${deptsDir}/development`, { recursive: true });
    vol.writeFileSync(
      `${deptsDir}/development/drifted_agent.yaml`,
      makeAgentYaml({
        name: 'drifted_agent',
        eventSubscriptions: ['pr.opened'],
        triggers: [], // no event handler — drift!
      }),
    );

    loadAllAgentConfigs();

    const warnings = driftWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /Agent "drifted_agent" subscribes to "pr\.opened" but has no trigger for it/,
    );
  });

  it('emits one warning per unmatched subscription', () => {
    const deptsDir = getDepartmentsDir();
    vol.mkdirSync(`${deptsDir}/development`, { recursive: true });
    vol.writeFileSync(
      `${deptsDir}/development/multi_drift.yaml`,
      makeAgentYaml({
        name: 'multi_drift',
        eventSubscriptions: ['alpha.event', 'beta.event', 'gamma.event'],
        triggers: [
          { type: 'event', event: 'alpha.event', task: 'handle_alpha' },
          // beta.event and gamma.event are unhandled
        ],
      }),
    );

    loadAllAgentConfigs();

    const warnings = driftWarnings();
    expect(warnings).toHaveLength(2);
    expect(warnings.some(w => w.includes('"beta.event"'))).toBe(true);
    expect(warnings.some(w => w.includes('"gamma.event"'))).toBe(true);
  });

  it('does not warn when the subscription is matched by a type:event trigger even if cron triggers exist', () => {
    const deptsDir = getDepartmentsDir();
    vol.mkdirSync(`${deptsDir}/development`, { recursive: true });
    vol.writeFileSync(
      `${deptsDir}/development/mixed_triggers.yaml`,
      makeAgentYaml({
        name: 'mixed_triggers',
        eventSubscriptions: ['deploy.started'],
        triggers: [
          { type: 'cron', schedule: '0 * * * *', task: 'hourly_report' },
          { type: 'event', event: 'deploy.started', task: 'handle_deploy' },
        ],
      }),
    );

    loadAllAgentConfigs();

    expect(driftWarnings()).toHaveLength(0);
  });

  it('does not warn when event_subscriptions is empty', () => {
    const deptsDir = getDepartmentsDir();
    vol.mkdirSync(`${deptsDir}/development`, { recursive: true });
    vol.writeFileSync(
      `${deptsDir}/development/no_subs.yaml`,
      makeAgentYaml({
        name: 'no_subs',
        eventSubscriptions: [],
        triggers: [],
      }),
    );

    loadAllAgentConfigs();

    expect(driftWarnings()).toHaveLength(0);
  });

  it('warns for multiple agents independently', () => {
    const deptsDir = getDepartmentsDir();
    vol.mkdirSync(`${deptsDir}/development`, { recursive: true });

    // Agent A: fully wired up
    vol.writeFileSync(
      `${deptsDir}/development/agent_a.yaml`,
      makeAgentYaml({
        name: 'agent_a',
        eventSubscriptions: ['event.x'],
        triggers: [{ type: 'event', event: 'event.x', task: 'handle_x' }],
      }),
    );

    // Agent B: subscription without trigger
    vol.writeFileSync(
      `${deptsDir}/development/agent_b.yaml`,
      makeAgentYaml({
        name: 'agent_b',
        eventSubscriptions: ['event.y'],
        triggers: [],
      }),
    );

    loadAllAgentConfigs();

    const warnings = driftWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Agent "agent_b" subscribes to "event\.y" but has no trigger for it/);
  });
});
