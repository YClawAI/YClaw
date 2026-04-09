/**
 * AgentRegistry — Agent identity metadata for notifications.
 *
 * Centralizes agent display information (emoji, color, department, avatar)
 * so both Slack and Discord renderers produce consistent agent identity.
 * Extends the existing AGENT_EMOJI and AGENT_DEPARTMENT maps in
 * channel-routing.ts with richer metadata needed for Discord embeds
 * and webhook identity.
 */

import type { Department } from './types.js';

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

export const AGENT_REGISTRY: Record<string, AgentIdentity> = {
  strategist:  { id: 'strategist',  name: 'Strategist',  emoji: '\u{1F9E0}',       department: 'executive',   color: 0x7C3AED },
  architect:   { id: 'architect',   name: 'Architect',    emoji: '\u{1F3D7}\uFE0F', department: 'development', color: 0x2563EB },
  builder:     { id: 'builder',     name: 'Builder',      emoji: '\u{1F6E0}\uFE0F', department: 'development', color: 0x6366F1 },
  deployer:    { id: 'deployer',    name: 'Deployer',     emoji: '\u{1F680}',       department: 'development', color: 0x0891B2 },
  designer:    { id: 'designer',    name: 'Designer',     emoji: '\u{1F3A8}',       department: 'development', color: 0xEC4899 },
  reviewer:    { id: 'reviewer',    name: 'Reviewer',     emoji: '\u{1F50D}',       department: 'executive',   color: 0x059669 },
  ember:       { id: 'ember',       name: 'Ember',        emoji: '\u{1F525}',       department: 'marketing',   color: 0xF97316 },
  treasurer:   { id: 'treasurer',   name: 'Treasurer',    emoji: '\u{1F4B0}',       department: 'finance',     color: 0xEAB308 },
  scout:       { id: 'scout',       name: 'Scout',        emoji: '\u{1F52D}',       department: 'marketing',   color: 0x8B5CF6 },
  keeper:      { id: 'keeper',      name: 'Keeper',       emoji: '\u{1F6E1}\uFE0F', department: 'support',     color: 0x0EA5E9 },
  sentinel:    { id: 'sentinel',    name: 'Sentinel',     emoji: '\u{1F510}',       department: 'operations',  color: 0xDC2626 },
  forge:       { id: 'forge',       name: 'Forge',        emoji: '\u2692\uFE0F',    department: 'marketing',   color: 0x78716C },
  guide:       { id: 'guide',       name: 'Guide',        emoji: '\u{1F4D8}',       department: 'support',     color: 0x0284C7 },
  signal:      { id: 'signal',      name: 'Signal',       emoji: '\u{1F4CA}',       department: 'operations',  color: 0x6366F1 },
};

/** Look up agent identity. Returns a generic fallback for unknown agents. */
export function getAgentIdentity(agentId: string): AgentIdentity {
  return AGENT_REGISTRY[agentId] ?? {
    id: agentId,
    name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
    emoji: '\u{1F514}', // 🔔
    department: 'general' as Department,
    color: 0x6B7280,
  };
}
