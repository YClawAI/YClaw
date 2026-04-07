/**
 * Communication Style Resolution
 *
 * Resolves the effective communication style for an agent based on
 * the precedence chain: agent override > department override > global default > fallback.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentConfig, CommunicationStyle } from './schema.js';
import type { YclawConfig } from '../infrastructure/config-schema.js';
import { loadPrompt } from './loader.js';
import { getPromptsDir } from './loader.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('communication-style');

/** Agents whose primary role is content creation — warn if set to 'concise'. */
const CONTENT_CREATING_ROLES = new Set([
  'ember', 'forge', 'guide', 'keeper', 'scout',
]);

/**
 * Resolve the effective communication style for an agent.
 *
 * Precedence (highest wins):
 * 1. Agent-level override (from agent YAML `communication.style`)
 * 2. Agent-level override (from `communication.style.agent_overrides` in main config)
 * 3. Department-level override (from `communication.style.department_overrides`)
 * 4. Global default (from `communication.style.default`)
 * 5. Fallback: 'balanced'
 */
export function resolveCommunicationStyle(
  agentName: string,
  departmentName: string,
  config?: YclawConfig,
  agentConfig?: AgentConfig,
): CommunicationStyle {
  const style =
    agentConfig?.communication?.style ??
    config?.communication?.style?.agent_overrides?.[agentName] ??
    config?.communication?.style?.department_overrides?.[departmentName] ??
    config?.communication?.style?.default ??
    'balanced';

  // Warn if a content-creating agent is set to 'concise'
  if (style === 'concise' && CONTENT_CREATING_ROLES.has(agentName)) {
    logger.warn(
      `Agent "${agentName}" is a content-creating role but communication style is "concise". ` +
      `Consider using "detailed" instead for better output quality.`,
    );
  }

  return style;
}

/**
 * Load the communication style prompt content for a resolved style.
 * Returns the file content, or null if the style file does not exist.
 */
export function loadStylePrompt(style: CommunicationStyle): string | null {
  const stylePath = resolve(getPromptsDir(), 'styles', `${style}.md`);
  if (!existsSync(stylePath)) {
    logger.warn(`Communication style file not found: styles/${style}.md`);
    return null;
  }
  return loadPrompt(`styles/${style}.md`);
}

/**
 * Validate that all configured style values have corresponding prompt files.
 * Returns an array of missing style file paths.
 */
export function validateStyleFiles(config?: YclawConfig): string[] {
  const missing: string[] = [];
  if (!config?.communication?.style) return missing;

  const stylesToCheck = new Set<string>();

  // Global default
  stylesToCheck.add(config.communication.style.default);

  // Department overrides
  for (const style of Object.values(config.communication.style.department_overrides)) {
    stylesToCheck.add(style);
  }

  // Agent overrides
  for (const style of Object.values(config.communication.style.agent_overrides)) {
    stylesToCheck.add(style);
  }

  for (const style of stylesToCheck) {
    const stylePath = resolve(getPromptsDir(), 'styles', `${style}.md`);
    if (!existsSync(stylePath)) {
      missing.push(`styles/${style}.md`);
    }
  }

  return missing;
}
