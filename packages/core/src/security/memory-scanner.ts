import { createLogger } from '../logging/logger.js';

const logger = createLogger('memory-scanner');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScanResult {
  blocked: boolean;
  issues: string[];
}

export interface ScanContext {
  agentName: string;
  key: string;
  operation: 'memory_write' | 'knowledge_propose' | 'skill_draft';
}

/** Minimal interface for the event bus — avoids circular dependency with triggers/event.ts */
export interface EventBusLike {
  publish(
    source: string,
    type: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void>;
}

// ─── Detection Patterns ──────────────────────────────────────────────────────

/**
 * Patterns that indicate prompt injection attempts embedded in memory values.
 * Designed to catch LLM jailbreaks that could be replayed into future prompts.
 */
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous\s+)?(?:my\s+)?(?:your\s+)?instructions/i,
  /disregard\s+(all|previous)\s+(instructions|directives)/i,
  /forget\s+(your|all)\s+(instructions|training|rules)/i,
  /override\s+(previous|all)\s+(instructions|directives)/i,
  /\[(system|user|assistant)\]\s*:/i,           // fake role delimiters
  /<\|(?:system|user|assistant|endoftext)\|>/i,  // GPT-style special tokens
  /you\s+are\s+now\s+(?:a|an)\s+/i,
  /pretend\s+(?:to\s+be|you\s+are)\s+/i,
  /act\s+as\s+(?:if\s+you\s+(?:are|were)|a|an)\s+/i,
  /SYSTEM_OVERRIDE|PROMPT_INJECTION|AUTOEXEC_SYSTEM/i,
  /\[\s*INST\s*\]|\[\/INST\]/i,                 // Llama-style instruction tags
];

/**
 * Patterns that indicate credential/secret leakage.
 * Mirrors the patterns in outbound-safety.ts — identical coverage, same source.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /sk-ant-api[a-zA-Z0-9_-]{20,}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /xoxb-[a-zA-Z0-9-]+/,
  /xoxp-[a-zA-Z0-9-]+/,
  /ghp_[a-zA-Z0-9]{36,}/,
  /ghs_[a-zA-Z0-9]{36,}/,
  /AKIA[A-Z0-9]{16}/,
  /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/,
  /rediss?:\/\/[^:]+:[^@]+@/,
  /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY/,
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,  // JWT token
];

/**
 * Patterns that suggest data exfiltration endpoints.
 * Webhook relay services and ephemeral tunnels are common exfil channels.
 */
const EXFIL_URL_PATTERNS: RegExp[] = [
  /https?:\/\/(?:webhook\.site|requestbin\.(?:com|net)|pipedream\.net|hookbin\.com|beeceptor\.com)/i,
  /https?:\/\/[a-z0-9-]+\.(?:ngrok\.io|loca\.lt|serveo\.net|localtunnel\.me)/i,
  /https?:\/\/[a-f0-9]{8,16}\.x\.pipedream\.net/i,
];

/**
 * Match any invisible, zero-width, or RTL-override Unicode characters.
 * These are commonly used in steganographic attacks and homoglyph injection.
 * Ranges:
 *   U+200B–U+200F  zero-width and directional marks
 *   U+202A–U+202E  bidirectional control characters (incl. RTL override U+202E)
 *   U+FEFF         BOM / zero-width no-break space (outside start-of-file)
 *   U+FE00–U+FE0F  variation selectors
 *   U+2060–U+2064  word joiner and invisible operators
 *   U+206A–U+206F  deprecated formatting characters
 */
const INVISIBLE_UNICODE_PATTERN = /[\u200B-\u200F\u202A-\u202E\uFEFF\uFE00-\uFE0F\u2060-\u2064\u206A-\u206F]/;

// ─── Scanner ─────────────────────────────────────────────────────────────────

/**
 * MemoryWriteScanner — automated WAF layer for all agent memory writes.
 *
 * Scans content for prompt injection, credentials, exfiltration URLs, and
 * invisible unicode before the write reaches persistent storage. This is the
 * fast, deterministic path — no LLM cost, runs on every write.
 *
 * Feature flag: process.env.FF_MEMORY_SCANNER (default: "false")
 * When disabled, scan() always returns { blocked: false, issues: [] }.
 *
 * On detection:
 *   1. Logs a warning with issue details
 *   2. Emits EventEnvelope "security:write_blocked" on the event bus
 *   3. Returns { blocked: true, issues } — caller must enforce the block
 */
export class MemoryWriteScanner {
  private readonly eventBus: EventBusLike | null;

  constructor(eventBus?: EventBusLike | null) {
    this.eventBus = eventBus ?? null;
  }

  /**
   * Scan content before writing to memory.
   *
   * @param content  The string value to be written.
   * @param context  Who is writing, where, and what kind of write.
   * @returns        { blocked: false } if clean, { blocked: true, issues } if suspicious.
   */
  scan(content: string, context: ScanContext): ScanResult {
    const enabled = process.env['FF_MEMORY_SCANNER'] === 'true';
    if (!enabled) {
      return { blocked: false, issues: [] };
    }

    const issues = this.runPatternChecks(content);

    if (issues.length > 0) {
      logger.warn('Memory write blocked', {
        agent: context.agentName,
        key: context.key,
        operation: context.operation,
        issueCount: issues.length,
        issues,
      });
      void this.emitBlockedEvent(context, issues);
    }

    return { blocked: issues.length > 0, issues };
  }

  // ─── Pattern Checks ────────────────────────────────────────────────────

  private runPatternChecks(content: string): string[] {
    const issues: string[] = [];

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        issues.push(`Prompt injection: ${pattern.source.substring(0, 60)}`);
      }
    }

    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(content)) {
        issues.push(`Credential pattern: ${pattern.source.substring(0, 40)}`);
      }
    }

    for (const pattern of EXFIL_URL_PATTERNS) {
      if (pattern.test(content)) {
        issues.push(`Exfiltration URL: ${pattern.source.substring(0, 60)}`);
      }
    }

    if (INVISIBLE_UNICODE_PATTERN.test(content)) {
      const invisible = Array.from(content).filter(c => INVISIBLE_UNICODE_PATTERN.test(c));
      const codes = [
        ...new Set(
          invisible.map(c => {
            const cp = c.codePointAt(0);
            return cp !== undefined ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : 'U+????';
          }),
        ),
      ];
      issues.push(`Invisible unicode: ${codes.join(', ')}`);
    }

    return issues;
  }

  // ─── Event Emission ────────────────────────────────────────────────────

  private async emitBlockedEvent(context: ScanContext, issues: string[]): Promise<void> {
    if (!this.eventBus) return;
    try {
      await this.eventBus.publish('security', 'write_blocked', {
        agentName: context.agentName,
        key: context.key,
        operation: context.operation,
        issueCount: issues.length,
        issues,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Failed to emit security:write_blocked', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
