import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentEmoji,
  getAlertsChannel,
  getChannelForAgent,
  getChannelForDepartment,
  getDepartmentForAgent,
  SLACK_CHANNELS,
} from '../src/utils/channel-routing.js';

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

  beforeEach(() => {
    envSnap = snapshotEnv(TRACKED_ENV_KEYS);
    for (const k of TRACKED_ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  describe('AGENT_EMOJI + getAgentEmoji', () => {
    it('returns the expected emoji for known agents', () => {
      expect(getAgentEmoji('builder')).toBe('\u{1F6E0}\uFE0F');
      expect(getAgentEmoji('strategist')).toBe('\u{1F9E0}');
    });

    it('falls back to bell for unknown agents', () => {
      expect(getAgentEmoji('does-not-exist')).toBe('\u{1F514}');
    });
  });

  describe('getDepartmentForAgent', () => {
    it('maps development agents correctly', () => {
      expect(getDepartmentForAgent('builder')).toBe('development');
      expect(getDepartmentForAgent('architect')).toBe('development');
    });

    it('returns undefined for unknown agents', () => {
      expect(getDepartmentForAgent('nobody')).toBeUndefined();
    });
  });

  describe('Slack routing (default channel names)', () => {
    it('falls back to #yclaw-<dept> when no SLACK_CHANNEL_* env is set', () => {
      expect(getChannelForAgent('builder', 'slack')).toBe('#yclaw-development');
      expect(getChannelForAgent('strategist', 'slack')).toBe('#yclaw-executive');
      expect(getChannelForAgent('treasurer', 'slack')).toBe('#yclaw-finance');
    });

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
      expect(getChannelForAgent('builder', 'slack')).toBe('C1234567890');
      expect(getChannelForDepartment('development', 'slack')).toBe('C1234567890');
    });

    it('ignores empty-string overrides and keeps the default', () => {
      process.env.SLACK_CHANNEL_DEVELOPMENT = '   ';
      expect(getChannelForAgent('builder', 'slack')).toBe('#yclaw-development');
    });
  });

  describe('Discord routing (no default channels)', () => {
    it('returns undefined when nothing is configured', () => {
      expect(getChannelForAgent('builder', 'discord')).toBeUndefined();
      expect(getAlertsChannel('discord')).toBeUndefined();
    });

    it('reads DISCORD_CHANNEL_* env vars', () => {
      process.env.DISCORD_CHANNEL_EXECUTIVE = '1489421619821809735';
      process.env.DISCORD_CHANNEL_GENERAL = '1489421589941325904';
      expect(getChannelForAgent('strategist', 'discord')).toBe('1489421619821809735');
      expect(getChannelForAgent('unknown-agent', 'discord')).toBe('1489421589941325904');
    });

    it('falls back from a department to GENERAL when the department env is unset', () => {
      process.env.DISCORD_CHANNEL_GENERAL = '1489421589941325904';
      expect(getChannelForAgent('builder', 'discord')).toBe('1489421589941325904');
    });

    it('resolves the alerts channel independently', () => {
      process.env.DISCORD_CHANNEL_ALERTS = '1489421718945661049';
      expect(getAlertsChannel('discord')).toBe('1489421718945661049');
    });
  });
});
