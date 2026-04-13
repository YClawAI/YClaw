/**
 * channel-routing — Platform-agnostic department/channel routing.
 *
 * Replaces the hardcoded DEPARTMENT_CHANNEL map in slack-blocks.ts. Every
 * channel notifier (Slack, Discord, Telegram, …) resolves an agent name to
 * a platform-specific channel ID through `getChannelForAgent(agent, platform)`.
 *
 * Channel IDs are loaded from environment variables so operators can wire
 * the same agent to different channels on different platforms without
 * touching code:
 *
 *   SLACK_CHANNEL_EXECUTIVE    DISCORD_CHANNEL_EXECUTIVE
 *   SLACK_CHANNEL_DEVELOPMENT  DISCORD_CHANNEL_DEVELOPMENT
 *   SLACK_CHANNEL_ALERTS       DISCORD_CHANNEL_ALERTS
 *   … etc.
 *
 * For Slack, if a per-department env var is unset, the routing falls back
 * to the legacy `#yclaw-<dept>` channel-name defaults so existing installs
 * keep working without any config changes.
 *
 * Discord has no default fallback — unset env vars mean "no channel", and
 * the notifier routes to the `general` channel (or skips the post entirely
 * if general is also unset).
 */

// ─── Agent Emoji Map ────────────────────────────────────────────────────────

/**
 * Agent → emoji for notification headers. Used by both Slack Block Kit
 * and Discord markdown formatters.
 */
export const AGENT_EMOJI: Record<string, string> = {
  strategist: '\u{1F9E0}',       // 🧠
  builder: '\u{1F6E0}\uFE0F',    // 🛠️
  architect: '\u{1F4D0}',        // 📐
  designer: '\u{1F3A8}',         // 🎨
  deployer: '\u{1F680}',         // 🚀
  reviewer: '\u{1F4CB}',         // 📋
  scout: '\u{1F50D}',            // 🔍
  ember: '\u{1F525}',            // 🔥
  forge: '\u2692\uFE0F',         // ⚒️
  sentinel: '\u{1F6E1}\uFE0F',   // 🛡️
  treasurer: '\u{1F4B0}',        // 💰
  keeper: '\u{1F3E0}',           // 🏠
  guide: '\u{1F4DA}',            // 📚
  signal: '\u{1F4E1}',           // 📡
};

// ─── Agent → Department Mapping ─────────────────────────────────────────────

/**
 * Agent → department routing. One source of truth for every notifier.
 */
export const AGENT_DEPARTMENT: Record<string, string> = {
  strategist: 'executive',
  reviewer: 'executive',
  architect: 'development',
  builder: 'development',
  deployer: 'development',
  designer: 'development',
  ember: 'marketing',
  forge: 'marketing',
  scout: 'marketing',
  sentinel: 'operations',
  signal: 'operations',
  treasurer: 'finance',
  guide: 'support',
  keeper: 'support',
};

// ─── Supported Platforms ────────────────────────────────────────────────────

export type ChannelPlatform = 'slack' | 'discord';

/** Canonical department keys used for routing. */
export type Department =
  | 'executive'
  | 'development'
  | 'marketing'
  | 'operations'
  | 'finance'
  | 'support'
  | 'alerts'
  | 'audit'
  | 'general';

// ─── Slack Legacy Defaults ──────────────────────────────────────────────────
// Preserved so any install that previously relied on channel NAMES (not IDs)
// and never set the SLACK_CHANNEL_* env vars keeps working.

const SLACK_DEFAULT_CHANNELS: Record<Department, string> = {
  general: '#yclaw-general',
  executive: '#yclaw-executive',
  marketing: '#yclaw-marketing',
  development: '#yclaw-development',
  operations: '#yclaw-operations',
  finance: '#yclaw-finance',
  support: '#yclaw-support',
  alerts: '#yclaw-alerts',
  audit: '#yclaw-audit',
};

// ─── Env Var Lookup ─────────────────────────────────────────────────────────

/**
 * Returns the env var key for a (platform, department) pair — e.g.,
 * ("discord", "executive") → "DISCORD_CHANNEL_EXECUTIVE".
 */
function envKey(platform: ChannelPlatform, dept: Department): string {
  return `${platform.toUpperCase()}_CHANNEL_${dept.toUpperCase()}`;
}

/**
 * Resolve a department to a channel ID for the given platform. Returns
 * `undefined` when nothing is configured.
 *
 * Resolution order (Slack):
 *   1. SLACK_CHANNEL_<DEPT> env var
 *   2. SLACK_DEFAULT_CHANNELS[dept] (legacy `#yclaw-<dept>`)
 *
 * Resolution order (Discord):
 *   1. DISCORD_CHANNEL_<DEPT> env var
 *   2. undefined (no defaults)
 */
export function getChannelForDepartment(
  dept: Department,
  platform: ChannelPlatform,
): string | undefined {
  const fromEnv = process.env[envKey(platform, dept)]?.trim();
  if (fromEnv) return fromEnv;
  if (platform === 'slack') return SLACK_DEFAULT_CHANNELS[dept];
  return undefined;
}

/**
 * Resolve an agent name to the correct channel ID for the given platform.
 *
 * Routing:
 *   1. Look up AGENT_DEPARTMENT[agent] → department
 *   2. Delegate to getChannelForDepartment(dept, platform)
 *   3. If that returns undefined, fall back to the `general` channel
 *
 * Returns `undefined` only when neither the department channel nor the
 * `general` channel is configured for this platform — callers should
 * treat that as "no channel; skip this post".
 */
export function getChannelForAgent(
  agent: string,
  platform: ChannelPlatform,
): string | undefined {
  const dept = (AGENT_DEPARTMENT[agent] as Department | undefined) ?? 'general';
  const direct = getChannelForDepartment(dept, platform);
  if (direct) return direct;
  // Fall back to general
  if (dept !== 'general') return getChannelForDepartment('general', platform);
  return undefined;
}

/** Resolve the alerts/escalation channel ID for a platform. */
export function getAlertsChannel(platform: ChannelPlatform): string | undefined {
  return getChannelForDepartment('alerts', platform);
}

/** Get the emoji for an agent. Returns 🔔 for unknown agents. */
export function getAgentEmoji(agent: string): string {
  return AGENT_EMOJI[agent] || '\u{1F514}'; // 🔔
}

/** Get the department name for an agent. */
export function getDepartmentForAgent(agent: string): string | undefined {
  return AGENT_DEPARTMENT[agent];
}

// ─── Legacy Slack channel name map ──────────────────────────────────────────
// Re-exported for backward compatibility with code that imports
// SLACK_CHANNELS from actions/slack.ts. Keyed by department, value is the
// raw channel name/ID that Slack's postMessage accepts.

export const SLACK_CHANNELS = SLACK_DEFAULT_CHANNELS;
