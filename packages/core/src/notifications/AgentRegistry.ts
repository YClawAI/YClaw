/**
 * AgentRegistry — Single source of truth for agent identity/routing.
 *
 * Populated at bootstrap from agent YAML configs via initAgentRegistry().
 * When a new agent YAML is added to departments/, routing and identity
 * Just Work — no code changes needed.
 *
 * Display overrides (emoji, color, avatar) live here because they are NOT
 * part of the YAML schema. Everything else (name, department) comes from
 * the loaded AgentConfig objects.
 */

import type { Department } from './types.js';
import type { AgentConfig } from '../config/schema.js';

export interface AgentIdentity {
  id: string;
  name: string;
  emoji: string;
  department: Department;
  /** Hex color for Discord embeds. */
  color: number;
  /** Avatar URL for Discord webhook identity. */
  avatarUrl?: string;
}

// ─── Display Overrides ──────────────────────────────────────────────────────
// Optional enrichments for known agents. If an agent isn't here, it gets
// defaults (🔔 emoji, grey color).

const DISPLAY_OVERRIDES: Record<string, Partial<Pick<AgentIdentity, 'emoji' | 'color' | 'avatarUrl'>>> = {
  strategist:  { emoji: '\u{1F9E0}',       color: 0x7C3AED }, // 🧠
  architect:   { emoji: '\u{1F3D7}\uFE0F', color: 0x2563EB }, // 🏗️
  designer:    { emoji: '\u{1F3A8}',        color: 0xEC4899 }, // 🎨
  reviewer:    { emoji: '\u{1F50D}',        color: 0x059669 }, // 🔍
  ember:       { emoji: '\u{1F525}',        color: 0xF97316 }, // 🔥
  treasurer:   { emoji: '\u{1F4B0}',        color: 0xEAB308 }, // 💰
  scout:       { emoji: '\u{1F52D}',        color: 0x8B5CF6 }, // 🔭
  keeper:      { emoji: '\u{1F6E1}\uFE0F',  color: 0x0EA5E9 }, // 🛡️
  sentinel:    { emoji: '\u{1F510}',        color: 0xDC2626 }, // 🔐
  forge:       { emoji: '\u2692\uFE0F',     color: 0x78716C }, // ⚒️
  guide:       { emoji: '\u{1F4D8}',        color: 0x0284C7 }, // 📘
  signal:      { emoji: '\u{1F4CA}',        color: 0x6366F1 }, // 📊
  librarian:   { emoji: '\u{1F4DA}',        color: 0x8B5CF6 }, // 📚
  mechanic:    { emoji: '\u{1F527}',        color: 0x475569 }, // 🔧
};

// Slack-specific emoji names (cannot use Unicode in Slack's icon_emoji field)
const SLACK_EMOJI_OVERRIDES: Record<string, string> = {
  strategist: ':chess_pawn:',
  reviewer:   ':mag:',
  ember:      ':fire:',
  scout:      ':telescope:',
  forge:      ':hammer_and_wrench:',
  architect:  ':building_construction:',
  sentinel:   ':shield:',
  signal:     ':satellite:',
  keeper:     ':key:',
  treasurer:  ':bank:',
  guide:      ':compass:',
  designer:   ':art:',
  librarian:  ':books:',
  mechanic:   ':wrench:',
};

// ─── Mutable Registry ───────────────────────────────────────────────────────

const registry = new Map<string, AgentIdentity>();
let initialized = false;

function assertInitialized(): void {
  if (!initialized) {
    throw new Error(
      'AgentRegistry accessed before initAgentRegistry() was called. Fix bootstrap ordering.',
    );
  }
}

/**
 * Populate the registry from loaded AgentConfig objects.
 * Called once at bootstrap after loadAllAgentConfigs().
 * MUST run before any routing, Discord listeners, or event consumers start.
 */
export function initAgentRegistry(configs: Map<string, AgentConfig>): void {
  registry.clear();
  for (const [name, config] of configs) {
    const overrides = DISPLAY_OVERRIDES[name] ?? {};
    registry.set(name, {
      id: name,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      emoji: overrides.emoji ?? '\u{1F514}', // 🔔
      department: config.department as Department,
      color: overrides.color ?? 0x6B7280,
      avatarUrl: overrides.avatarUrl,
    });
  }
  initialized = true;
}

/** Strict lookup — returns undefined if agent not registered. */
export function findAgentIdentity(agentId: string): AgentIdentity | undefined {
  assertInitialized();
  return registry.get(agentId);
}

/** Look up agent identity. Returns a generic fallback for unknown agents. */
export function getAgentIdentity(agentId: string): AgentIdentity {
  assertInitialized();
  return registry.get(agentId) ?? {
    id: agentId,
    name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
    emoji: '\u{1F514}', // 🔔
    department: 'general' as Department,
    color: 0x6B7280,
  };
}

/** Get all registered agent IDs. */
export function getRegisteredAgents(): string[] {
  assertInitialized();
  return [...registry.keys()];
}

/** Get Slack-specific emoji name for an agent. */
export function getSlackEmoji(agentId: string): string {
  return SLACK_EMOJI_OVERRIDES[agentId] ?? ':bell:';
}

/** Reset for tests only. */
export function resetAgentRegistryForTests(): void {
  registry.clear();
  initialized = false;
}

// ─── Backward-Compatible Export ─────────────────────────────────────────────
// Proxied object so existing code that imports AGENT_REGISTRY as a record
// continues to work. Implements full trap set so Object.keys() etc. work.

/** @deprecated Use getAgentIdentity() instead */
export const AGENT_REGISTRY: Record<string, AgentIdentity> = new Proxy(
  {} as Record<string, AgentIdentity>,
  {
    get: (_target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      return findAgentIdentity(prop);
    },
    has: (_target, prop) => {
      if (typeof prop === 'symbol') return false;
      return registry.has(prop);
    },
    ownKeys: () => [...registry.keys()],
    getOwnPropertyDescriptor: (_target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      const val = registry.get(prop as string);
      return val
        ? { configurable: true, enumerable: true, value: val }
        : undefined;
    },
  },
);
