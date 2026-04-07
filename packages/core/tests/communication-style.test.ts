/**
 * Tests for the Communication Style feature.
 *
 * Covers:
 * - resolveCommunicationStyle() — all precedence levels
 * - CommunicationConfigSchema validation — rejects invalid style values
 * - Agent YAML schema — accepts communication.style field
 * - Style file existence — all built-in styles have prompt files
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CommunicationStyleEnum,
  CommunicationConfigSchema,
  AgentConfigSchema,
} from '../src/config/schema.js';
import { resolveCommunicationStyle, validateStyleFiles, loadStylePrompt } from '../src/config/communication-style.js';
import { getPromptsDir } from '../src/config/loader.js';
import type { YclawConfig } from '../src/infrastructure/config-schema.js';
import type { AgentConfig } from '../src/config/schema.js';

// ── Helper: minimal YclawConfig with communication ──────────────────────────

function makeYclawConfig(communication?: YclawConfig['communication']): YclawConfig {
  return {
    storage: {
      state: { type: 'mongodb' },
      events: { type: 'redis' },
      memory: { type: 'postgresql' },
      objects: { type: 'local' },
    },
    secrets: { provider: 'env' },
    channels: {},
    communication,
  } as YclawConfig;
}

// ── Helper: minimal AgentConfig ─────────────────────────────────────────────

const BASE_AGENT: AgentConfig = {
  name: 'test_agent',
  department: 'development',
  description: 'Test agent',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.7, maxTokens: 4096 },
  system_prompts: ['base.md'],
  triggers: [],
  actions: [],
  data_sources: [],
  event_subscriptions: [],
  event_publications: [],
  review_bypass: [],
  selfModifications: [],
} as unknown as AgentConfig;

// ── resolveCommunicationStyle() ─────────────────────────────────────────────

describe('resolveCommunicationStyle', () => {
  it('returns "balanced" when no config is provided', () => {
    expect(resolveCommunicationStyle('architect', 'development')).toBe('balanced');
  });

  it('returns global default from YclawConfig', () => {
    const config = makeYclawConfig({
      style: { default: 'concise', department_overrides: {}, agent_overrides: {} },
    });
    expect(resolveCommunicationStyle('architect', 'development', config)).toBe('concise');
  });

  it('department override takes precedence over global default', () => {
    const config = makeYclawConfig({
      style: {
        default: 'balanced',
        department_overrides: { development: 'concise' },
        agent_overrides: {},
      },
    });
    expect(resolveCommunicationStyle('architect', 'development', config)).toBe('concise');
  });

  it('agent override in main config takes precedence over department override', () => {
    const config = makeYclawConfig({
      style: {
        default: 'balanced',
        department_overrides: { development: 'concise' },
        agent_overrides: { architect: 'detailed' },
      },
    });
    expect(resolveCommunicationStyle('architect', 'development', config)).toBe('detailed');
  });

  it('agent YAML override takes precedence over everything', () => {
    const config = makeYclawConfig({
      style: {
        default: 'balanced',
        department_overrides: { development: 'concise' },
        agent_overrides: { architect: 'detailed' },
      },
    });
    const agentConfig = {
      ...BASE_AGENT,
      name: 'architect',
      communication: { style: 'concise' as const },
    };
    expect(resolveCommunicationStyle('architect', 'development', config, agentConfig)).toBe('concise');
  });

  it('falls back through the chain correctly', () => {
    const config = makeYclawConfig({
      style: {
        default: 'detailed',
        department_overrides: {},
        agent_overrides: {},
      },
    });
    // No agent override, no department override → falls to global default
    expect(resolveCommunicationStyle('sentinel', 'operations', config)).toBe('detailed');
  });

  it('handles undefined communication in YclawConfig', () => {
    const config = makeYclawConfig(undefined);
    expect(resolveCommunicationStyle('architect', 'development', config)).toBe('balanced');
  });

  it('handles agent config without communication field', () => {
    const config = makeYclawConfig({
      style: { default: 'concise', department_overrides: {}, agent_overrides: {} },
    });
    const agentConfig = { ...BASE_AGENT, communication: undefined };
    expect(resolveCommunicationStyle('test_agent', 'development', config, agentConfig)).toBe('concise');
  });
});

// ── Schema validation ───────────────────────────────────────────────────────

describe('CommunicationStyleEnum', () => {
  it('accepts valid style values', () => {
    expect(CommunicationStyleEnum.safeParse('detailed').success).toBe(true);
    expect(CommunicationStyleEnum.safeParse('balanced').success).toBe(true);
    expect(CommunicationStyleEnum.safeParse('concise').success).toBe(true);
  });

  it('rejects invalid style values', () => {
    expect(CommunicationStyleEnum.safeParse('verbose').success).toBe(false);
    expect(CommunicationStyleEnum.safeParse('minimal').success).toBe(false);
    expect(CommunicationStyleEnum.safeParse('').success).toBe(false);
  });
});

describe('CommunicationConfigSchema', () => {
  it('accepts a valid communication config', () => {
    const result = CommunicationConfigSchema.safeParse({
      style: {
        default: 'balanced',
        department_overrides: { development: 'concise' },
        agent_overrides: { strategist: 'detailed' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid style in department_overrides', () => {
    const result = CommunicationConfigSchema.safeParse({
      style: {
        default: 'balanced',
        department_overrides: { development: 'invalid_style' },
        agent_overrides: {},
      },
    });
    expect(result.success).toBe(false);
  });

  it('defaults to balanced when style.default is omitted', () => {
    const result = CommunicationConfigSchema.safeParse({
      style: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.style?.default).toBe('balanced');
    }
  });
});

describe('AgentConfigSchema with communication', () => {
  it('accepts agent config with communication.style', () => {
    const result = AgentConfigSchema.safeParse({
      ...BASE_AGENT,
      communication: { style: 'concise' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.communication?.style).toBe('concise');
    }
  });

  it('accepts agent config without communication field', () => {
    const result = AgentConfigSchema.safeParse(BASE_AGENT);
    expect(result.success).toBe(true);
  });

  it('rejects agent config with invalid communication.style', () => {
    const result = AgentConfigSchema.safeParse({
      ...BASE_AGENT,
      communication: { style: 'invalid' },
    });
    expect(result.success).toBe(false);
  });
});

// ── Style file existence ────────────────────────────────────────────────────

describe('Style prompt files', () => {
  const STYLES = ['detailed', 'balanced', 'concise'] as const;

  for (const style of STYLES) {
    it(`prompts/styles/${style}.md exists`, () => {
      const stylePath = resolve(getPromptsDir(), 'styles', `${style}.md`);
      expect(existsSync(stylePath), `Missing style file: ${stylePath}`).toBe(true);
    });
  }

  it('loadStylePrompt returns content for all built-in styles', () => {
    for (const style of STYLES) {
      const content = loadStylePrompt(style);
      expect(content, `loadStylePrompt("${style}") returned null`).not.toBeNull();
      expect(content!.length).toBeGreaterThan(0);
      expect(content).toContain(`Communication Style`);
    }
  });
});

// ── validateStyleFiles ──────────────────────────────────────────────────────

describe('validateStyleFiles', () => {
  it('returns empty array for valid config', () => {
    const config = makeYclawConfig({
      style: { default: 'balanced', department_overrides: {}, agent_overrides: {} },
    });
    expect(validateStyleFiles(config)).toEqual([]);
  });

  it('returns empty array when communication is undefined', () => {
    expect(validateStyleFiles(undefined)).toEqual([]);
  });
});
