import { normalize } from 'node:path';
import type { SelfModification, SafetyLevelType } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('safety-gate');

/**
 * Three-layer safety gate for self-modifications.
 *
 * Layer 1: Auto-approved (logged) — config, schedule, model, memory changes
 * Layer 2: Agent-reviewed — prompt modifications, new tools
 * Layer 3: Human-reviewed — code changes, new agents
 *
 * IMMUTABLE SAFETY FLOOR (cannot be modified by any agent):
 * - This file (safety gate implementation)
 * - Audit logging system
 * - Review gate mechanism
 * - Slack alerting
 * - Self-modification tool definitions
 */

// Methods that are auto-approved (Layer 1)
const AUTO_APPROVED_METHODS = new Set([
  'update_config',
  'update_schedule',
  'memory_write',
]);

// Methods that require agent review (Layer 2)
const AGENT_REVIEWED_METHODS = new Set([
  'update_prompt',
  'create_tool',
  'request_new_data_source',
  'update_model',       // Model swap can undermine safety — requires review
  'cross_write_memory', // Cross-agent writes influence downstream behavior — requires review
]);

// Methods that require human review (Layer 3)
const HUMAN_REVIEWED_METHODS = new Set([
  'propose_code_change',
]);

// Files/paths that agents can NEVER modify (immutable safety floor)
const IMMUTABLE_PATHS = new Set([
  '/packages/core/src/self/safety.ts',
  '/packages/core/src/logging/audit.ts',
  '/packages/core/src/review/reviewer.ts',
  '/packages/core/src/review/outbound-safety.ts',
  '/packages/core/src/agent/executor.ts',
  '/prompts/review-rules.md',
  '/prompts/mission_statement.md',
]);

// Config keys that agents cannot modify
const PROTECTED_CONFIG_KEYS = new Set([
  'review_bypass',   // Can't exempt yourself from review
  'department',      // Privilege escalation → executive
  'name',            // Identity spoofing
  'actions',         // Unauthorized action grants
  'triggers',        // Cron/event injection
  'model',           // Swap to weak/jailbreakable model undermines all safety layers
  'system_prompts',  // Prompt injection can override safety behavior
  'data_sources',    // Malicious data source → context poisoning or exfiltration
]);

export class SafetyGate {
  private slackAlerter: ((message: string, severity: string) => Promise<void>) | null = null;

  setSlackAlerter(alerter: (message: string, severity: string) => Promise<void>): void {
    this.slackAlerter = alerter;
  }

  classify(method: string, _args: Record<string, unknown>): SafetyLevelType {
    if (AUTO_APPROVED_METHODS.has(method)) return 'auto_approved';
    if (AGENT_REVIEWED_METHODS.has(method)) return 'agent_reviewed';
    if (HUMAN_REVIEWED_METHODS.has(method)) return 'human_reviewed';
    return 'human_reviewed'; // Default to strictest
  }

  async evaluate(modification: SelfModification): Promise<boolean> {
    const { agent, type, safetyLevel, changes } = modification;

    logger.info(
      `Evaluating self-modification: ${agent} → ${type} (${safetyLevel})`,
    );

    // Check immutable paths
    if (this.touchesImmutablePath(changes)) {
      logger.warn(`BLOCKED: ${agent} attempted to modify immutable path`);
      await this.alert(
        `SECURITY: Agent ${agent} attempted to modify an immutable safety file.`,
        'critical',
      );
      return false;
    }

    // Check protected config keys
    if (type === 'config' && this.touchesProtectedConfigKey(changes)) {
      logger.warn(`BLOCKED: ${agent} attempted to modify protected config key`);
      await this.alert(
        `SECURITY: Agent ${agent} attempted to modify a protected config key.`,
        'critical',
      );
      return false;
    }

    switch (safetyLevel) {
      case 'auto_approved':
        logger.info(`Auto-approved: ${agent} → ${type}`);
        // Only alert Slack for non-memory auto-approved actions
        // memory_write is routine and floods #yclaw-operations with noise
        if (type !== 'memory') {
          await this.alert(
            `Self-modification (auto-approved): ${agent} → ${type}: ${modification.description}`,
            'info',
          );
        }
        return true;

      case 'agent_reviewed':
        logger.info(`Agent-reviewed: ${agent} → ${type} — pending REVIEWER approval`);
        await this.alert(
          `Self-modification (needs review): ${agent} → ${type}: ${modification.description}`,
          'warning',
        );
        // In Phase 1, auto-approve agent-reviewed mods with logging
        // In later phases, this routes to REVIEWER agent for actual review
        return true;

      case 'human_reviewed':
        logger.info(`Human-reviewed: ${agent} → ${type} — requires human approval`);
        await this.alert(
          `Self-modification (NEEDS HUMAN APPROVAL): ${agent} → ${type}: ${modification.description}`,
          'critical',
        );
        // Code changes are saved as proposals, not applied directly
        // Return true here because the tool itself creates a proposal (not a direct change)
        return type === 'code';

      default:
        logger.warn(`Unknown safety level: ${safetyLevel}`);
        return false;
    }
  }

  private touchesImmutablePath(changes: unknown): boolean {
    if (!changes || typeof changes !== 'object') return false;

    // Extract all string values from the changes object and normalize paths
    const allStrings = this.extractStrings(changes);
    for (const str of allStrings) {
      const normalized = normalize(str);
      for (const immutablePath of IMMUTABLE_PATHS) {
        if (normalized.includes(normalize(immutablePath))) return true;
      }
    }
    return false;
  }

  /** Recursively extract all string values from an object. */
  private extractStrings(obj: unknown): string[] {
    if (typeof obj === 'string') return [obj];
    if (!obj || typeof obj !== 'object') return [];
    const strings: string[] = [];
    for (const value of Object.values(obj as Record<string, unknown>)) {
      strings.push(...this.extractStrings(value));
    }
    return strings;
  }

  private touchesProtectedConfigKey(changes: unknown): boolean {
    if (!changes || typeof changes !== 'object') return false;

    const changesObj = changes as Record<string, unknown>;
    // Check if 'changes' key exists (from update_config args)
    const actualChanges = (changesObj.changes || changesObj) as Record<string, unknown>;

    for (const key of Object.keys(actualChanges)) {
      if (PROTECTED_CONFIG_KEYS.has(key)) return true;
    }
    return false;
  }

  private async alert(message: string, severity: string): Promise<void> {
    if (this.slackAlerter) {
      try {
        await this.slackAlerter(message, severity);
      } catch (err) {
        logger.error('Failed to send Slack alert', { error: err });
      }
    }
  }
}
