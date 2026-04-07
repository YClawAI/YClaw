import { randomUUID } from 'node:crypto';
import type { ReviewRequest, ReviewResult } from '../config/schema.js';
import { loadPrompt } from '../config/loader.js';
import { createProvider } from '../llm/provider.js';
import type { LLMMessage } from '../llm/types.js';
import { createLogger } from '../logging/logger.js';
import { SLACK_CHANNELS } from '../actions/slack.js';

const logger = createLogger('reviewer');

const reviewModel = process.env.REVIEW_MODEL || 'claude-sonnet-4-5-20250929';

/** Patterns that unconditionally block content regardless of fail-open policy. */
const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,          // AWS access keys
  /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, // Private keys
  /ghp_[A-Za-z0-9_]{36,}/,     // GitHub tokens
  /sk-[A-Za-z0-9]{20,}/,       // OpenAI keys
  /xoxb-[A-Za-z0-9\-]+/,       // Slack bot tokens
];

/**
 * Brand Review Gate — the single most important safety mechanism.
 *
 * Every piece of external content passes through this gate.
 * Uses the highest-accuracy model available (Opus/Sonnet) for review.
 *
 * IMMUTABLE: Agents cannot modify this file or the review-rules.md prompt.
 */

const REVIEW_SYSTEM_PROMPT = `You are the YClaw Brand Reviewer. Your job is to ensure every piece of external content matches the YClaw brand voice and complies with all rules.

You will be given content to review along with the brand voice guide and review rules.

For each piece of content, evaluate:

1. VOICE MATCH (0-100): Does it sound like YClaw? Warm restraint, no hype?
2. TERMINOLOGY: Any banned terms? (moon, pump, alpha, degen, WAGMI, NFA, etc.)
3. EXCLAMATION MARKS: Zero tolerance. Any "!" = instant flag.
4. FINANCIAL CLAIMS: Any implied promises? APY mentions? Price predictions?
5. FACTUAL ACCURACY: Do claims match known protocol facts?
6. PLATFORM FIT: Is the format appropriate for the target platform?
7. COMPETITOR MENTIONS: Any direct comparisons?

Respond with ONLY a JSON object:
{
  "approved": boolean,
  "flags": ["list of specific issues found"],
  "severity": "low" | "medium" | "high",
  "voiceScore": 0-100,
  "rewrite": "suggested rewrite if flagged (null if approved)"
}

Severity guide:
- low: Minor terminology swap needed (auto-rewrite ok)
- medium: Tone issues, borderline hype (needs human review)
- high: Financial claims, legal risk, major brand violation (content blocked)

Be strict. When in doubt, flag it. Better to hold content than publish something off-brand.`;

export class ReviewGate {
  private brandVoice: string = '';
  private reviewRules: string = '';
  private slackAlerter: ((message: string, channel?: string) => Promise<void>) | null = null;

  async initialize(): Promise<void> {
    try {
      this.brandVoice = loadPrompt('brand-voice.md');
    } catch {
      logger.warn('brand-voice.md not found — review will use defaults');
    }
    try {
      this.reviewRules = loadPrompt('review-rules.md');
    } catch {
      logger.warn('review-rules.md not found — review will use defaults');
    }
    logger.info('Review gate initialized');
  }

  setSlackAlerter(alerter: (message: string, channel?: string) => Promise<void>): void {
    this.slackAlerter = alerter;
  }

  async review(request: ReviewRequest): Promise<ReviewResult> {
    logger.info(`Reviewing content from ${request.agent}: ${request.contentType} → ${request.targetPlatform}`);

    // Hard-block content containing secrets regardless of fail-open strategy
    if (this.containsSecrets(request.content)) {
      logger.error('Content contains secrets — hard blocked', { agent: request.agent });
      const result: ReviewResult = {
        requestId: request.id,
        approved: false,
        flags: ['Content contains embedded secrets/credentials — blocked unconditionally'],
        severity: 'high',
        reviewedAt: new Date().toISOString(),
      };
      await this.handleFlagged(request, result);
      return result;
    }

    const provider = createProvider({
      provider: 'anthropic',
      model: reviewModel,
      temperature: 0.0, // Deterministic for review
      maxTokens: 2048,
    });

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: [
          REVIEW_SYSTEM_PROMPT,
          this.brandVoice ? `\n---\n# Brand Voice Guide\n${this.brandVoice}` : '',
          this.reviewRules ? `\n---\n# Review Rules\n${this.reviewRules}` : '',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `## Content to Review`,
          `**Agent**: ${request.agent}`,
          `**Type**: ${request.contentType}`,
          `**Platform**: ${request.targetPlatform}`,
          `**Timestamp**: ${request.timestamp}`,
          '',
          '```',
          request.content,
          '```',
          '',
          request.metadata ? `**Additional Context**: ${JSON.stringify(request.metadata)}` : '',
        ].join('\n'),
      },
    ];

    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 2000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await provider.chat(messages, {
          temperature: 0.0,
          maxTokens: 1024,
        });

        const parsed = this.parseReviewResponse(response.content);

        const result: ReviewResult = {
          requestId: request.id,
          approved: parsed.approved,
          flags: parsed.flags || [],
          severity: parsed.severity,
          rewrite: parsed.rewrite || undefined,
          voiceScore: parsed.voiceScore,
          reviewedAt: new Date().toISOString(),
        };

        if (!result.approved) {
          await this.handleFlagged(request, result);
        }

        return result;
      } catch (error) {
        lastError = error;
        logger.warn(`Review attempt ${attempt}/${MAX_RETRIES} failed`, { error });

        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — check failure strategy
    const failOpen = process.env.REVIEW_FAILURE_STRATEGY !== 'FAIL_CLOSED';

    if (failOpen) {
      logger.warn('Review failed after all retries — fail-open: allowing content', { error: lastError });

      return {
        requestId: request.id,
        approved: true,
        flags: ['Review system error — content approved via fail-open policy'],
        severity: 'low',
        reviewedAt: new Date().toISOString(),
      };
    }

    logger.error('Review failed after all retries — fail-closed: blocking content', { error: lastError });

    const result: ReviewResult = {
      requestId: request.id,
      approved: false,
      flags: ['Review system error — content blocked (FAIL_CLOSED policy)'],
      severity: 'high',
      reviewedAt: new Date().toISOString(),
    };

    await this.handleFlagged(request, result);
    return result;
  }

  private containsSecrets(content: string): boolean {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }

  private parseReviewResponse(content: string): {
    approved: boolean;
    flags: string[];
    severity: 'low' | 'medium' | 'high';
    voiceScore: number;
    rewrite: string | null;
  } {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      return JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn('Failed to parse review response — treating as flagged');
      return {
        approved: false,
        flags: ['Failed to parse review response'],
        severity: 'medium',
        voiceScore: 0,
        rewrite: null,
      };
    }
  }

  private async handleFlagged(request: ReviewRequest, result: ReviewResult): Promise<void> {
    const severityEmoji: Record<string, string> = {
      low: '🟡',
      medium: '🟠',
      high: '🔴',
    };

    const emoji = severityEmoji[result.severity || 'medium'] || '🟠';

    const message = [
      `${emoji} **Content Flagged** (${result.severity})`,
      `Agent: ${request.agent}`,
      `Type: ${request.contentType} → ${request.targetPlatform}`,
      `Flags: ${result.flags.join(', ')}`,
      `Voice Score: ${result.voiceScore ?? 'N/A'}/100`,
      '',
      `Content:`,
      `> ${request.content.substring(0, 500)}${request.content.length > 500 ? '...' : ''}`,
      '',
      result.rewrite ? `Suggested rewrite:\n> ${result.rewrite}` : '',
    ].join('\n');

    logger.warn(`Content flagged: ${result.severity}`, {
      agent: request.agent,
      flags: result.flags,
    });

    if (this.slackAlerter) {
      try {
        await this.slackAlerter(message, SLACK_CHANNELS.executive);
      } catch (err) {
        logger.error('Failed to send Slack alert for flagged content', { error: err });
      }
    }
  }
}
