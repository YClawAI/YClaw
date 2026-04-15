import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  initAgentRegistry,
  resetAgentRegistryForTests,
  getAgentIdentity,
  findAgentIdentity,
  getRegisteredAgents,
} from '../src/notifications/AgentRegistry.js';
import {
  getAgentEmoji,
  getAlertsChannel,
  getChannelForAgent,
  getChannelForDepartment,
  getDepartmentForAgent,
  SLACK_CHANNELS,
} from '../src/utils/channel-routing.js';
import type { AgentConfig } from '../src/config/schema.js';

// ─── Mock Agent Configs ─────────────────────────────────────────────────────

function mockConfigs(): Map<string, AgentConfig> {
  const configs = new Map<string, AgentConfig>();

  const base = {
    description: 'test',
    model: { provider: 'anthropic' as const, model: 'claude-sonnet-4-20250514', maxTokens: 4096, temperature: 0.3 },
    system_prompts: [],
    triggers: [],
    actions: [],
    data_sources: [],
    event_subscriptions: [],
    event_publications: [],
    review_bypass: [],
  };

  configs.set('strategist', { ...base, name: 'strategist', department: 'executive' });
  configs.set('architect', { ...base, name: 'architect', department: 'development' });
  configs.set('designer', { ...base, name: 'designer', department: 'development' });
  configs.set('ember', { ...base, name: 'ember', department: 'marketing' });
  configs.set('sentinel', { ...base, name: 'sentinel', department: 'operations' });
  configs.set('treasurer', { ...base, name: 'treasurer', department: 'finance' });
  configs.set('keeper', { ...base, name: 'keeper', department: 'support' });
  configs.set('librarian', { ...base, name: 'librarian', department: 'operations' });
  configs.set('mechanic', { ...base, name: 'mechanic', department: 'development' });

  return configs;
}

// ─── Env helper ─────────────────────────────────────────────────────────────

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of keys) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const TRACKED_ENV_KEYS = [
  'SLACK_CHANNEL_GENERAL',
  'SLACK_CHANNEL_EXECUTIVE',
  'SLACK_CHANNEL_DEVELOPMENT',
  'SLACK_CHANNEL_MARKETING',
  'SLACK_CHANNEL_OPERATIONS',
  'SLACK_CHANNEL_FINANCE',
  'SLACK_CHANNEL_SUPPORT',
  'SLACK_CHANNEL_ALERTS',
  'SLACK_CHANNEL_AUDIT',
  'DISCORD_CHANNEL_GENERAL',
  'DISCORD_CHANNEL_EXECUTIVE',
  'DISCORD_CHANNEL_DEVELOPMENT',
  'DISCORD_CHANNEL_MARKETING',
  'DISCORD_CHANNEL_OPERATIONS',
  'DISCORD_CHANNEL_FINANCE',
  'DISCORD_CHANNEL_SUPPORT',
  'DISCORD_CHANNEL_ALERTS',
  'DISCORD_CHANNEL_AUDIT',
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('channel-routing', () => {
  let envSnap: Record<string, string | undefined>;

  beforeAll(() => {
    initAgentRegistry(mockConfigs());
  });

  beforeEach(() => {
    envSnap = snapshotEnv(TRACKED_ENV_KEYS);
    for (const k of TRACKED_ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  // ─── Council-mandated: Pre-init access throws ─────────────────────────

  describe('pre-init guard', () => {
    it('throws if accessed before initAgentRegistry()', () => {
      resetAgentRegistryForTests();
      expect(() => getAgentIdentity('strategist')).toThrow(
        'AgentRegistry accessed before initAgentRegistry()',
      );
      // Re-init for remaining tests
      initAgentRegistry(mockConfigs());
    });
  });

  describe('getAgentEmoji', () => {
    it('returns the expected emoji for known agents', () => {
      expect(getAgentEmoji('strategist')).toBe('\u{1F9E0}');
      expect(getAgentEmoji('architect')).toBe('\u{1F3D7}\uFE0F');
    });

    it('falls back to bell for unknown agents', () => {
      expect(getAgentEmoji('does-not-exist')).toBe('\u{1F514}');
    });
  });

  describe('getDepartmentForAgent', () => {
    it('maps development agents correctly', () => {
      expect(getDepartmentForAgent('architect')).toBe('development');
      expect(getDepartmentForAgent('mechanic')).toBe('development');
    });

    // Council-mandated: YAML-only agents route correctly
    it('maps librarian to operations (YAML-derived, no hardcoded map)', () => {
      expect(getDepartmentForAgent('librarian')).toBe('operations');
    });

    it('returns undefined for unknown agents', () => {
      expect(getDepartmentForAgent('nobody')).toBeUndefined();
    });
  });

  describe('Slack routing (default channel names)', () => {
    it('falls back to #yclaw-<dept> when no SLACK_CHANNEL_* env is set', () => {
      expect(getChannelForAgent('architect', 'slack')).toBe('#yclaw-development');
      expect(getChannelForAgent('strategist', 'slack')).toBe('#yclaw-executive');
      expect(getChannelForAgent('treasurer', 'slack')).toBe('#yclaw-finance');
    });

    // Council-mandated: YAML-only agents route correctly
    it('routes librarian to #yclaw-operations via YAML config', () => {
      expect(getChannelForAgent('librarian', 'slack')).toBe('#yclaw-operations');
    });

    it('routes mechanic to #yclaw-development via YAML config', () => {
      expect(getChannelForAgent('mechanic', 'slack')).toBe('#yclaw-development');
    });

    // Council-mandated: Unknown agent falls back to general
    it('routes unknown agents to #yclaw-general', () => {
      expect(getChannelForAgent('mystery-agent', 'slack')).toBe('#yclaw-general');
    });

    it('exposes the full SLACK_CHANNELS map for legacy consumers', () => {
      expect(SLACK_CHANNELS.executive).toBe('#yclaw-executive');
      expect(SLACK_CHANNELS.alerts).toBe('#yclaw-alerts');
      expect(SLACK_CHANNELS.general).toBe('#yclaw-general');
    });

    it('honours SLACK_CHANNEL_* env overrides when set', () => {
      process.env.SLACK_CHANNEL_DEVELOPMENT = 'C1234567890';
      expect(getChannelForAgent('architect', 'slack')).toBe('C1234567890');
      expect(getChannelForDepartment('development', 'slack')).toBe('C1234567890');
    });

    it('ignores empty-string overrides and keeps the default', () => {
      process.env.SLACK_CHANNEL_DEVELOPMENT = '   ';
      expect(getChannelForAgent('architect', 'slack')).toBe('#yclaw-development');
    });
  });

  describe('Discord routing (no default channels)', () => {
    it('returns undefined when nothing is configured', () => {
      expect(getChannelForAgent('architect', 'discord')).toBeUndefined();
      expect(getAlertsChannel('discord')).toBeUndefined();
    });

    it('reads DISCORD_CHANNEL_* env vars', () => {
      process.env.DISCORD_CHANNEL_EXECUTIVE = '1489421619821809735';
      process.env.DISCORD_CHANNEL_GENERAL = '1489421589941325904';
      expect(getChannelForAgent('strategist', 'discord')).toBe('1489421619821809735');
      expect(getChannelForAgent('unknown-agent', 'discord')).toBe('1489421589941325904');
    });

    // Council-mandated: YAML-only agents route correctly via Discord
    it('routes librarian to operations channel via Discord', () => {
      process.env.DISCORD_CHANNEL_OPERATIONS = '1489421700000000000';
      expect(getChannelForAgent('librarian', 'discord')).toBe('1489421700000000000');
    });

    it('falls back from a department to GENERAL when the department env is unset', () => {
      process.env.DISCORD_CHANNEL_GENERAL = '1489421589941325904';
      expect(getChannelForAgent('architect', 'discord')).toBe('1489421589941325904');
    });

    it('resolves the alerts channel independently', () => {
      process.env.DISCORD_CHANNEL_ALERTS = '1489421718945661049';
      expect(getAlertsChannel('discord')).toBe('1489421718945661049');
    });
  });

  // ─── Council-mandated: Agent in YAML but not in display overrides ─────

  describe('agents without display overrides', () => {
    it('gets fallback emoji (bell) + correct department routing', () => {
      // Add a synthetic agent with no display override
      const configs = mockConfigs();
      configs.set('new_agent', {
        name: 'new_agent',
        department: 'finance',
        description: 'test',
        model: { provider: 'anthropic' as const, model: 'claude-sonnet-4-20250514', maxTokens: 4096, temperature: 0.3 },
        system_prompts: [],
        triggers: [],
        actions: [],
        data_sources: [],
        event_subscriptions: [],
        event_publications: [],
        review_bypass: [],
      });
      initAgentRegistry(configs);

      expect(getAgentEmoji('new_agent')).toBe('\u{1F514}'); // 🔔 fallback
      expect(getDepartmentForAgent('new_agent')).toBe('finance');
      expect(getChannelForAgent('new_agent', 'slack')).toBe('#yclaw-finance');

      // Re-init with standard configs for remaining tests
      initAgentRegistry(mockConfigs());
    });
  });
});

// ─── AgentRegistry unit tests ───────────────────────────────────────────────

describe('AgentRegistry', () => {
  beforeAll(() => {
    initAgentRegistry(mockConfigs());
  });

  it('findAgentIdentity returns undefined for unknown agents', () => {
    expect(findAgentIdentity('nonexistent')).toBeUndefined();
  });

  it('getAgentIdentity returns fallback for unknown agents', () => {
    const ident = getAgentIdentity('nonexistent');
    expect(ident.id).toBe('nonexistent');
    expect(ident.department).toBe('general');
    expect(ident.emoji).toBe('\u{1F514}');
  });

  it('getRegisteredAgents returns all agent IDs', () => {
    const agents = getRegisteredAgents();
    expect(agents).toContain('strategist');
    expect(agents).toContain('librarian');
    expect(agents).toContain('mechanic');
    expect(agents.length).toBe(mockConfigs().size);
  });
});
