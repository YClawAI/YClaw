/**
 * Event Bus Authorization Policy — loaded from yclaw-event-policy.yaml.
 *
 * Defines which agents may publish which event types and which payload
 * fields are globally banned. Protected by CODEOWNERS.
 */

import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';

export interface SourcePolicy {
  allowedEventTypes: string[];
  allowedPayloadFields?: Record<string, string[]>;
}

export interface EventPolicy {
  schemaVersion: string;
  sources: Record<string, SourcePolicy>;
  globalDeniedFields: string[];
  replay: {
    maxAgeSeconds: number;
    maxClockSkewSeconds: number;
    cacheTtlSeconds: number;
  };
}

const DEFAULT_POLICY: EventPolicy = {
  schemaVersion: '1.0',
  sources: {},
  globalDeniedFields: [
    'sourcing_rule_update',
    'multiplier_table_rule',
    'system_prompt_override',
    'memory_write',
    'memory_update',
    'tool_instruction',
    'post_publication_audit',
    'prompt_override',
    'status_override',
    'gate_bypass',
    'audit_confirmed_clean',
  ],
  replay: {
    maxAgeSeconds: 120,
    maxClockSkewSeconds: 30,
    cacheTtlSeconds: 600,
  },
};

/**
 * Load event policy from a YAML file. Falls back to defaults if not found.
 */
export function loadEventPolicy(path: string): EventPolicy {
  if (!existsSync(path)) {
    return DEFAULT_POLICY;
  }

  const raw = readFileSync(path, 'utf8');
  const parsed = parseYaml(raw) as Partial<EventPolicy>;

  return {
    schemaVersion: parsed.schemaVersion ?? DEFAULT_POLICY.schemaVersion,
    sources: parsed.sources ?? DEFAULT_POLICY.sources,
    globalDeniedFields: [
      ...new Set([
        ...(parsed.globalDeniedFields ?? []),
        ...DEFAULT_POLICY.globalDeniedFields,
      ]),
    ],
    replay: {
      ...DEFAULT_POLICY.replay,
      ...(parsed.replay ?? {}),
    },
  };
}
