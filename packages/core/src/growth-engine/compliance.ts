import { createLogger } from '../logging/logger.js';
import { createProvider } from '../llm/provider.js';
import type { LLMMessage } from '../llm/types.js';
import type { Template, ComplianceResult } from './types.js';

const log = createLogger('growth-engine:compliance');

// ─── Content Safety Checks ────────────────────────────────────────────────────
// Static regex patterns for content that should never appear in public communications.
// Profile-aware: 'oss-framework' (default) checks for credential leaks and harmful content.
// 'financial-regulated' profile available for organizations with financial compliance needs.

type ComplianceProfile = 'financial-regulated' | 'oss-framework';

const PROFILE: ComplianceProfile =
  (process.env.COMPLIANCE_PROFILE as ComplianceProfile) || 'oss-framework';

// OSS content safety checks — prevents credential leaks, destructive content, impersonation
const OSS_HARD_BLOCKS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(password|secret|api[_-]?key|private[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}/i, label: 'potential credential leak' },
  { pattern: /\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xox[bpsa]-[a-zA-Z0-9-]+)/i, label: 'API key pattern detected' },
  { pattern: /\b(rm\s+-rf\s+\/(?!tmp|node_modules)|DROP\s+TABLE|DELETE\s+FROM\s+\w+\s*;)/i, label: 'destructive command' },
  { pattern: /\bsudo\s+chmod\s+777\s+\//i, label: 'dangerous permission change' },
];

// Financial/SEC compliance checks — for 'financial-regulated' profile only
const FINANCIAL_HARD_BLOCKS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(guaranteed|guarantee)\b/i, label: 'guarantee language' },
  { pattern: /\b(investment|invest)\b/i, label: 'investment language' },
  { pattern: /\b(profit|profits|profitable)\b/i, label: 'profit language' },
  { pattern: /\b(returns?\b.*\bguaranteed|guaranteed\b.*\breturns?)\b/i, label: 'guaranteed returns' },
  { pattern: /\b(yield|yields|APY|APR)\b/i, label: 'yield/APY language' },
  { pattern: /\b(early\s+mover|first\s+mover)\b/i, label: 'first mover language' },
  { pattern: /\b(moon|mooning|100x|10x)\b/i, label: 'hype language' },
  { pattern: /\b(not\s+financial\s+advice|NFA)\b/i, label: 'NFA disclaimer (red flag)' },
  { pattern: /\b(securities|security\s+offering)\b/i, label: 'securities language' },
  { pattern: /\bROI\b/i, label: 'ROI language' },
  { pattern: /\b(token\s+appreciation|price\s+increase|going\s+up)\b/i, label: 'price prediction' },
  { pattern: /\b(DYOR|LFG|wen\b|to\s+the\s+moon)\b/i, label: 'crypto hype' },
];

const HARD_BLOCKS: Array<{ pattern: RegExp; label: string }> =
  PROFILE === 'financial-regulated'
    ? [...OSS_HARD_BLOCKS, ...FINANCIAL_HARD_BLOCKS]
    : OSS_HARD_BLOCKS;

const OSS_COMPLIANCE_PROMPT = `You are a content safety reviewer for an open-source software project's public communications.

Your job is to check whether content contains any of these issues:
- Credential leaks (API keys, tokens, passwords, private keys)
- Impersonation of real people or organizations
- Fabricated benchmarks, statistics, or testimonials without attribution
- Malicious code or instructions that could harm users' systems
- Privacy violations (posting someone's personal information)
- Deceptive claims about software capabilities (promising features that don't exist)

Normal developer content is ALWAYS allowed, including:
- Technical discussions using words like "return," "yield," "invest," "profit" in programming/engineering context
- Performance benchmarks with methodology
- Competitive comparisons with factual basis
- Roadmap discussions with appropriate caveats
- Community calls to action

Respond with a JSON object:
{"passed": true} or {"passed": false, "reason": "explanation of what's problematic"}

Be permissive. Only flag genuinely harmful content. Developer jargon is never a violation.`;

const FINANCIAL_COMPLIANCE_PROMPT = `You are a regulatory compliance reviewer for marketing content in the Web3/crypto space.

Your ONLY job is to determine whether the marketing copy implies financial returns, investment potential, or token appreciation.

Rules:
- "infrastructure", "developer tools", "agent systems" = OK (technical)
- "vision", "what we're building", "community growth" = OK
- ANY implication of financial gain, even subtle = NOT OK
- "early access", "exclusive opportunity" in financial context = NOT OK
- Technical capability claims = OK
- Community/developer adoption metrics = OK (non-financial)

Respond with a JSON object:
{"passed": true} or {"passed": false, "reason": "explanation of what's problematic"}

Be strict. When in doubt, reject.`;

const COMPLIANCE_SYSTEM_PROMPT =
  PROFILE === 'financial-regulated' ? FINANCIAL_COMPLIANCE_PROMPT : OSS_COMPLIANCE_PROMPT;

// ─── ComplianceChecker ────────────────────────────────────────────────────────

/**
 * Two-layer content safety checker (profile-aware).
 *
 * Layer 1: Deterministic regex hard blocks (instant, no LLM cost).
 * Layer 2: LLM-as-judge for contextual safety issues.
 *
 * Profile 'oss-framework' (default): credential leaks, harmful content, impersonation.
 * Profile 'financial-regulated': adds SEC/financial compliance on top of OSS checks.
 *
 * If compliance is down or the LLM call fails, the variant is REJECTED (fail-closed).
 */
export class ComplianceChecker {
  /**
   * Check a template variant against compliance rules.
   * Returns immediately on regex match; otherwise calls LLM.
   */
  async check(variant: Template, baseline: string): Promise<ComplianceResult> {
    const text = this.extractAllText(variant);

    // Layer 1: Regex hard blocks (deterministic)
    for (const { pattern, label } of HARD_BLOCKS) {
      const match = text.match(pattern);
      if (match) {
        log.info('Compliance REJECT (regex)', {
          channel: variant.channel,
          version: variant.version,
          label,
          matched: match[0],
        });
        return {
          passed: false,
          reason: `Hard block: "${match[0]}" — ${label}`,
          blockedPhrases: [match[0]],
          layer: 'regex',
        };
      }
    }

    // Layer 2: LLM-as-judge (skip for OSS profile if content is short/routine)
    if (PROFILE === 'oss-framework' && text.length < 500) {
      return { passed: true };
    }

    try {
      const result = await this.llmCheck(text, baseline);
      if (!result.passed) {
        log.info('Compliance REJECT (LLM)', {
          channel: variant.channel,
          version: variant.version,
          reason: result.reason,
        });
      }
      return result;
    } catch (err) {
      // Fail-closed: if LLM is unavailable, reject the variant
      log.error('Compliance LLM check failed — rejecting variant (fail-closed)', {
        error: (err as Error).message,
      });
      return {
        passed: false,
        reason: 'Compliance check unavailable — fail-closed rejection',
        layer: 'llm',
      };
    }
  }

  /** Extract all text from a template for scanning */
  private extractAllText(variant: Template): string {
    const parts: string[] = [];
    if (variant.subject) parts.push(variant.subject);
    if (variant.body) parts.push(variant.body);
    for (const value of Object.values(variant.variables)) {
      parts.push(value);
    }
    return parts.join('\n');
  }

  /** LLM-as-judge compliance check */
  private async llmCheck(text: string, baseline: string): Promise<ComplianceResult> {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      temperature: 0,
      maxTokens: 512,
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: COMPLIANCE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: PROFILE === 'financial-regulated'
          ? `## Baseline Constraints\n${baseline}\n\n## Marketing Copy to Review\n${text}\n\nDoes this copy imply financial returns, investment potential, or token appreciation? Respond with JSON only.`
          : `## Baseline Constraints\n${baseline}\n\n## Content to Review\n${text}\n\nDoes this content contain any safety issues (credential leaks, impersonation, fabricated claims, harmful instructions, privacy violations, or deceptive capability claims)? Respond with JSON only.`,
      },
    ];

    const response = await provider.chat(messages, {
      model: 'claude-haiku-4-5-20251001',
      temperature: 0,
      maxTokens: 512,
    });

    const parsed = parseComplianceResponse(response.content);
    if (!parsed) {
      // Unparseable response = fail-closed
      return {
        passed: false,
        reason: 'Compliance LLM returned unparseable response — fail-closed',
        layer: 'llm',
      };
    }

    return {
      ...parsed,
      layer: 'llm',
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseComplianceResponse(content: string): ComplianceResult | null {
  // Try to extract JSON from fenced block or raw content
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1]! : content;

  try {
    const parsed = JSON.parse(jsonStr) as { passed?: boolean; reason?: string };
    if (typeof parsed.passed !== 'boolean') return null;
    return {
      passed: parsed.passed,
      reason: parsed.reason,
    };
  } catch {
    // Try to extract from plain text
    const lower = content.toLowerCase().trim();
    if (lower.startsWith('{"passed":true') || lower.startsWith('{"passed": true')) {
      return { passed: true };
    }
    if (lower.startsWith('{"passed":false') || lower.startsWith('{"passed": false')) {
      const reasonMatch = content.match(/"reason"\s*:\s*"([^"]+)"/);
      return { passed: false, reason: reasonMatch?.[1] ?? 'LLM flagged content' };
    }
    return null;
  }
}
