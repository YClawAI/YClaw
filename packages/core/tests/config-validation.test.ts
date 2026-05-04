/**
 * CI gate: validates every YAML file in departments/ against the Zod schema.
 *
 * A failure here means a config change would cause a runtime Zod parse error —
 * exactly the class of bug that crashed production for 5+ hours.
 *
 * Run via: npx turbo test (or vitest run)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getPromptsDir, validateAllConfigs } from '../src/config/loader.js';
import { DataSourceSchema, AgentConfigSchema } from '../src/config/schema.js';
import { DEFAULT_ACL } from '../src/triggers/event-acl.js';

function explicitWorkflowTasks(markdown: string): Set<string> {
  const tasks = new Set<string>();
  const pattern = /^##\s+Task:\s+([A-Za-z0-9_-]+)/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    tasks.add(match[1].toLowerCase());
  }
  return tasks;
}

function triggerEvents(trigger: { type: string; event?: string; events?: string[] }): string[] {
  if (trigger.type === 'event' && trigger.event) return [trigger.event];
  if (trigger.type === 'batch_event' && Array.isArray(trigger.events)) return trigger.events;
  return [];
}

// ── Real YAML files ──────────────────────────────────────────────────────────

describe('validateAllConfigs: all department YAML files', () => {
  it('all configs parse without Zod errors', () => {
    const { valid, errors } = validateAllConfigs();

    if (errors.length > 0) {
      const details = errors
        .map(({ file, error }) => {
          const issues = error.issues
            .map(i => {
              const path = i.path.length > 0 ? i.path.join('.') : '(root)';
              return `    ${path}: ${i.message}`;
            })
            .join('\n');
          return `  ${file}:\n${issues}`;
        })
        .join('\n\n');
      throw new Error(`Config validation failed for ${errors.length} file(s):\n\n${details}`);
    }

    expect(errors).toHaveLength(0);
    expect(valid.length).toBeGreaterThan(0);
  });

  it('loads at least one agent per expected department', () => {
    const { valid } = validateAllConfigs();
    const departments = new Set(valid.map(c => c.department));
    const expected = ['executive', 'development', 'marketing', 'operations', 'finance', 'support'];
    for (const dept of expected) {
      expect(departments, `No agents loaded for department: ${dept}`).toContain(dept);
    }
  });
});

// ── Runtime wiring drift guards ──────────────────────────────────────────────

describe('validateAllConfigs: trigger workflow coverage', () => {
  it('every configured trigger task in a workflow-backed agent has an explicit workflow section', () => {
    const { valid } = validateAllConfigs();
    const missing: string[] = [];

    for (const config of valid) {
      const workflowPrompt = config.system_prompts.find(p => p.includes('workflow'));
      if (!workflowPrompt) continue;

      const workflowPath = join(getPromptsDir(), workflowPrompt);
      if (!existsSync(workflowPath)) {
        missing.push(`${config.name}: workflow prompt file does not exist: ${workflowPrompt}`);
        continue;
      }

      const tasks = explicitWorkflowTasks(readFileSync(workflowPath, 'utf8'));
      for (const trigger of config.triggers) {
        const task = trigger.task.toLowerCase();
        if (task !== 'none' && !tasks.has(task)) {
          missing.push(
            `${config.name}: trigger task "${trigger.task}" is missing "## Task: ${trigger.task}" in ${workflowPrompt}`,
          );
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Configured trigger task(s) have no explicit workflow instructions:\n` +
        missing.map(item => `  - ${item}`).join('\n') +
        `\nFix: add a matching "## Task: <task>" section or remove/rename the trigger.`,
      );
    }

    expect(missing).toHaveLength(0);
  });
});

describe('validateAllConfigs: event ACL coverage', () => {
  it('every configured event is present in DEFAULT_ACL and every publication is source-authorized', () => {
    const { valid } = validateAllConfigs();
    const configuredEvents = new Map<string, Set<string>>();
    const unauthorizedPublications: string[] = [];

    const remember = (event: string, detail: string): void => {
      const details = configuredEvents.get(event) ?? new Set<string>();
      details.add(detail);
      configuredEvents.set(event, details);
    };

    for (const config of valid) {
      for (const event of config.event_publications) {
        remember(event, `${config.name} publishes it`);
        const allowedSources = DEFAULT_ACL[event];
        if (allowedSources && !allowedSources.includes(config.name)) {
          unauthorizedPublications.push(
            `${config.name} publishes "${event}" but DEFAULT_ACL allows only: ${allowedSources.join(', ')}`,
          );
        }
      }

      for (const event of config.event_subscriptions) {
        remember(event, `${config.name} subscribes to it`);
      }

      for (const trigger of config.triggers) {
        for (const event of triggerEvents(trigger)) {
          remember(event, `${config.name} triggers on it`);
        }
      }
    }

    const missingAcl = [...configuredEvents.entries()]
      .filter(([event]) => !DEFAULT_ACL[event])
      .map(([event, details]) => `${event} (${[...details].sort().join('; ')})`)
      .sort();

    if (missingAcl.length > 0 || unauthorizedPublications.length > 0) {
      throw new Error(
        `Configured event ACL drift detected:\n` +
        [
          ...missingAcl.map(item => `  - Missing DEFAULT_ACL entry: ${item}`),
          ...unauthorizedPublications.sort().map(item => `  - Unauthorized publication: ${item}`),
        ].join('\n') +
        `\nFix: add the event to DEFAULT_ACL with the actual publisher namespace(s), or remove the stale config reference.`,
      );
    }

    expect(missingAcl).toHaveLength(0);
    expect(unauthorizedPublications).toHaveLength(0);
  });
});

// ── Cross-agent publication/subscription drift guard ────────────────────────
//
// These tests enforce that strategist:*_directive events are consistently named
// on both the publisher (strategist) and subscriber (target agent) sides.
// They catch the exact class of bug described in issue #768, where strategist
// published `strategist:X_directive` but agent X still listened on `X:directive`.
//
// Scope: only agent-targeted directives of the form `strategist:{agentname}_directive`,
// where a config for `{agentname}` actually exists. Broadcast events like
// `strategist:weekly_directive` (no corresponding single-agent config) are
// intentionally excluded.

describe('validateAllConfigs: strategist directive pub/sub alignment', () => {
  it('every strategist:{agent}_directive publication is subscribed to by the named agent', () => {
    const { valid } = validateAllConfigs();
    const configs = new Map(valid.map(c => [c.name, c]));

    const strategistConfig = configs.get('strategist');
    if (!strategistConfig) {
      throw new Error('strategist config not found — cannot validate directive routing');
    }

    // Only check directives where the embedded name matches a real agent config
    const agentDirectives = strategistConfig.event_publications.filter(e => {
      if (!e.startsWith('strategist:') || !e.endsWith('_directive')) return false;
      const agentName = e.slice('strategist:'.length, -'_directive'.length);
      return configs.has(agentName);
    });

    const unrouted = agentDirectives.filter(evt => {
      const agentName = evt.slice('strategist:'.length, -'_directive'.length);
      const agentConfig = configs.get(agentName);
      return !agentConfig?.event_subscriptions.includes(evt);
    });

    if (unrouted.length > 0) {
      throw new Error(
        `Strategist publishes agent directive(s) that the target agent does not subscribe to:\n` +
        unrouted.map(d => {
          const name = d.slice('strategist:'.length, -'_directive'.length);
          return `  - ${d}  (${name} must add it to event_subscriptions)`;
        }).join('\n') +
        `\nFix: ensure each named agent lists the event in event_subscriptions AND triggers.`,
      );
    }

    expect(unrouted).toHaveLength(0);
  });

  it('every agent subscribing to a strategist:{agent}_directive is also published by strategist', () => {
    const { valid } = validateAllConfigs();
    const configs = new Map(valid.map(c => [c.name, c]));

    const strategistConfig = configs.get('strategist');
    if (!strategistConfig) {
      throw new Error('strategist config not found — cannot validate directive routing');
    }

    const published = new Set(strategistConfig.event_publications);

    const orphaned: string[] = [];
    for (const [name, config] of configs) {
      if (name === 'strategist') continue;
      for (const sub of config.event_subscriptions) {
        if (sub.startsWith('strategist:') && sub.endsWith('_directive') && !published.has(sub)) {
          orphaned.push(`${name} subscribes to "${sub}" but strategist does not publish it`);
        }
      }
    }

    if (orphaned.length > 0) {
      throw new Error(
        `Agent(s) subscribe to strategist directives that strategist never publishes:\n` +
        orphaned.map(msg => `  - ${msg}`).join('\n') +
        `\nFix: add the event to strategist's event_publications.`,
      );
    }

    expect(orphaned).toHaveLength(0);
  });

  it('every agent that triggers on a strategist:{agent}_directive also lists it in event_subscriptions', () => {
    const { valid } = validateAllConfigs();

    const mismatches: string[] = [];
    for (const config of valid) {
      const triggerEvents = config.triggers
        .filter(t => t.type === 'event' && typeof (t as { event?: string }).event === 'string')
        .map(t => (t as { event: string }).event)
        .filter(e => e.startsWith('strategist:') && e.endsWith('_directive'));

      for (const evt of triggerEvents) {
        if (!config.event_subscriptions.includes(evt)) {
          mismatches.push(
            `${config.name} triggers on "${evt}" but it is missing from event_subscriptions`,
          );
        }
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Trigger/subscription mismatch for strategist directives:\n` +
        mismatches.map(m => `  - ${m}`).join('\n'),
      );
    }

    expect(mismatches).toHaveLength(0);
  });
});

// ── DataSource unit tests ────────────────────────────────────────────────────

describe('DataSourceSchema', () => {
  it('rejects invalid enum value in type with a clear error', () => {
    const result = DataSourceSchema.safeParse({ type: 'github_project', name: 'test' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const typeIssue = result.error.issues.find(i => i.path[0] === 'type');
      expect(typeIssue).toBeDefined();
      // Zod uses code 'invalid_enum_value' for enum mismatches
      expect(typeIssue?.code).toBe('invalid_enum_value');
    }
  });

  it('accepts all known enum values', () => {
    const knownTypes = [
      'mcp', 'api', 'solana_rpc', 'yclaw_api', 'mongodb', 'cloudwatch',
      'teller', 'openrouter_usage', 'aws_cost', 'mongodb_atlas',
      'redis_cloud', 'litellm_spend', 'github_repo',
    ] as const;
    for (const type of knownTypes) {
      const result = DataSourceSchema.safeParse({ type, name: 'ds' });
      expect(result.success, `Expected type '${type}' to be valid`).toBe(true);
    }
  });

  it('accepts data source without name and defaults to "unnamed"', () => {
    const result = DataSourceSchema.safeParse({ type: 'mcp' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('unnamed');
    }
  });

  it('passes through unknown extra fields (passthrough schema)', () => {
    const result = DataSourceSchema.safeParse({
      type: 'api',
      name: 'my-api',
      endpoint: 'https://api.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['endpoint']).toBe('https://api.example.com');
    }
  });
});

// ── AgentConfig unit tests ───────────────────────────────────────────────────

const BASE_CONFIG = {
  name: 'test_agent',
  department: 'development' as const,
  description: 'Test agent',
  model: { provider: 'anthropic' as const, model: 'claude-3-5-sonnet-20241022' },
  system_prompts: ['base.md'],
  triggers: [],
  actions: [],
};

describe('AgentConfigSchema', () => {
  it('accepts a valid minimal config', () => {
    const result = AgentConfigSchema.safeParse(BASE_CONFIG);
    expect(result.success).toBe(true);
  });

  it('rejects a config with invalid data_sources type', () => {
    const result = AgentConfigSchema.safeParse({
      ...BASE_CONFIG,
      data_sources: [{ type: 'not_a_real_type', name: 'ds' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i =>
        i.path.some(p => p === 'data_sources'),
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects a config with missing required name field', () => {
    const { name: _omit, ...withoutName } = BASE_CONFIG;
    const result = AgentConfigSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path[0] === 'name');
      expect(issue).toBeDefined();
    }
  });

  it('rejects a config with invalid department', () => {
    const result = AgentConfigSchema.safeParse({
      ...BASE_CONFIG,
      department: 'unknown_dept',
    });
    expect(result.success).toBe(false);
  });

  it('defaults data_sources to [] when omitted', () => {
    const result = AgentConfigSchema.safeParse(BASE_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_sources).toEqual([]);
    }
  });
});
