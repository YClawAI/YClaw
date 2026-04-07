import { createLogger } from '../logging/logger.js';

const logger = createLogger('outbound-safety');

// ─── Outbound Safety Gate ────────────────────────────────────────────────────
//
// Security-focused review of ALL outbound actions. Sits between the agent
// executor and action execution. Different from the ReviewGate (brand voice):
//
//   ReviewGate:        "Does this sound like our brand?"
//   OutboundSafetyGate: "Is this agent being exploited?"
//
// Deterministic checks (regex) — instant block, no LLM cost.
//
// IMMUTABLE: Agents cannot modify this file.

// ─── Deterministic Patterns ──────────────────────────────────────────────────

/** Patterns that indicate credential/secret leakage */
const CREDENTIAL_PATTERNS = [
  /sk-ant-api[a-zA-Z0-9_-]{20,}/,          // Anthropic API key
  /sk-[a-zA-Z0-9]{20,}/,                    // OpenAI-style key
  /xoxb-[a-zA-Z0-9-]+/,                     // Slack bot token
  /xoxp-[a-zA-Z0-9-]+/,                     // Slack user token
  /ghp_[a-zA-Z0-9]{36,}/,                   // GitHub personal access token
  /ghs_[a-zA-Z0-9]{36,}/,                   // GitHub app token
  /AKIA[A-Z0-9]{16}/,                       // AWS access key ID
  /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/,       // MongoDB URI with credentials
  /rediss?:\/\/[^:]+:[^@]+@/,               // Redis URI with credentials
  /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY/, // Private key
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, // JWT token
];

/** Patterns that suggest data exfiltration — match VALUES, not bare variable names. */
const EXFIL_PATTERNS = [
  /(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|SLACK_BOT_TOKEN|SLACK_APP_TOKEN|GITHUB_TOKEN|MONGODB_URI|REDIS_URL|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|DATABASE_URL|API_KEY|SECRET_KEY|PRIVATE_KEY)\s*[:=]\s*['"][^'"]{10,}['"]/i,
  /['"]?(?:secret|token|password|api_key|apikey|access_key)['"]?\s*[:=]\s*['"][^'"]{10,}['"]/i,
  /(?:postgres|mysql|mongodb|redis|amqp)(?:\+\w+)?:\/\/[^:]+:[^@]+@[^\s'"]+/i,
];

/** Actions that are outbound (reach external services) */
const OUTBOUND_ACTIONS = new Set([
  'twitter', 'telegram', 'email', 'instagram', 'tiktok',
]);

/** Actions exempt from review (internal only) */
const INTERNAL_ACTIONS = new Set([
  'event',
]);

/**
 * Semi-trusted actions — run deterministic checks but skip outbound filtering.
 * Used for internal comms (Slack) and dev workflow (GitHub) where agents
 * routinely share technical content.
 */
const SEMI_TRUSTED_ACTIONS = new Set([
  'slack',
  'github',
]);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SafetyCheckResult {
  safe: boolean;
  reason: string;
  blocked_by: 'deterministic' | null;
  details?: string[];
}

// ─── Safety Gate ─────────────────────────────────────────────────────────────

export class OutboundSafetyGate {
  private slackAlerter: ((message: string, severity: string) => Promise<void>) | null = null;

  setSlackAlerter(alerter: (message: string, severity: string) => Promise<void>): void {
    this.slackAlerter = alerter;
  }

  /**
   * Check an outbound action for safety before execution.
   * Returns { safe: true } if the action should proceed, { safe: false, reason } if blocked.
   */
  async check(
    agentName: string,
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<SafetyCheckResult> {
    const actionPrefix = actionName.split(':')[0];

    // Skip internal actions
    if (INTERNAL_ACTIONS.has(actionPrefix)) {
      return { safe: true, reason: 'Internal action — exempt', blocked_by: null };
    }

    // Semi-trusted actions — deterministic checks only
    if (SEMI_TRUSTED_ACTIONS.has(actionPrefix)) {
      const deterministicResult = this.deterministicCheck(agentName, actionName, params);
      if (!deterministicResult.safe) {
        await this.alert(agentName, actionName, deterministicResult);
        return deterministicResult;
      }
      return { safe: true, reason: 'Semi-trusted action — deterministic checks passed', blocked_by: null };
    }

    // Skip non-outbound actions
    if (!OUTBOUND_ACTIONS.has(actionPrefix)) {
      return { safe: true, reason: 'Not an outbound action', blocked_by: null };
    }

    // Deterministic checks — fast, free, always on
    const deterministicResult = this.deterministicCheck(agentName, actionName, params);
    if (!deterministicResult.safe) {
      await this.alert(agentName, actionName, deterministicResult);
      return deterministicResult;
    }

    return { safe: true, reason: 'Deterministic checks passed', blocked_by: null };
  }

  // ─── Deterministic Checks ─────────────────────────────────────────────────

  private deterministicCheck(
    agentName: string,
    actionName: string,
    params: Record<string, unknown>,
  ): SafetyCheckResult {
    const content = JSON.stringify(params);
    const flags: string[] = [];

    // Check for credential patterns
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(content)) {
        flags.push(`Credential pattern detected: ${pattern.source.substring(0, 30)}...`);
      }
    }

    if (flags.length > 0) {
      logger.warn(`BLOCKED (credentials): ${agentName} → ${actionName}`, { flags });
      return {
        safe: false,
        reason: 'Outbound content contains credential/secret patterns',
        blocked_by: 'deterministic',
        details: flags,
      };
    }

    // Check for exfiltration patterns in content fields
    const actionPrefix = actionName.split(':')[0];
    const isSemiTrusted = SEMI_TRUSTED_ACTIONS.has(actionPrefix);
    const contentFields = this.extractContentFields(params);
    for (const field of contentFields) {
      for (const pattern of EXFIL_PATTERNS) {
        if (pattern.test(field)) {
          if (isSemiTrusted) {
            logger.warn('EXFIL_PATTERN match on semi-trusted action (audit only)', {
              action: actionName,
              agent: agentName,
              pattern: pattern.source,
              contentPreview: field.substring(0, 100),
            });
          } else {
            flags.push(`Exfiltration pattern in content: ${pattern.source}`);
          }
        }
      }
    }

    if (flags.length > 0) {
      logger.warn(`BLOCKED (exfiltration): ${agentName} → ${actionName}`, { flags });
      return {
        safe: false,
        reason: 'Outbound content contains potential data exfiltration patterns',
        blocked_by: 'deterministic',
        details: flags,
      };
    }

    return { safe: true, reason: 'Passed deterministic checks', blocked_by: null };
  }

  /** Extract text content fields from action params for pattern matching. */
  private extractContentFields(params: Record<string, unknown>): string[] {
    const fields: string[] = [];
    const contentKeys = ['text', 'body', 'htmlBody', 'content', 'message', 'subject', 'caption', 'title', 'description'];

    for (const key of contentKeys) {
      if (typeof params[key] === 'string') {
        fields.push(params[key] as string);
      }
    }

    if (params.params && typeof params.params === 'object') {
      fields.push(...this.extractContentFields(params.params as Record<string, unknown>));
    }

    return fields;
  }

  // ─── Alerting ──────────────────────────────────────────────────────────────

  private async alert(
    agentName: string,
    actionName: string,
    result: SafetyCheckResult,
  ): Promise<void> {
    const message = [
      `🚨 **OUTBOUND ACTION BLOCKED**`,
      `Agent: ${agentName}`,
      `Action: ${actionName}`,
      `Blocked by: ${result.blocked_by}`,
      `Reason: ${result.reason}`,
      result.details?.length ? `Details: ${result.details.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    logger.error(message);

    if (this.slackAlerter) {
      try {
        await this.slackAlerter(message, 'critical');
      } catch (err) {
        logger.error('Failed to send safety alert', { error: err });
      }
    }
  }
}
