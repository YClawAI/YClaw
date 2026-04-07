import { loadPrompt } from '../config/loader.js';
import { createProvider } from '../llm/provider.js';
import type { LLMMessage } from '../llm/types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('humanizer');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HumanizationRequest {
  content: string;
  agent: string;
  contentType: string;
  targetPlatform: string;
  metadata?: Record<string, unknown>;
}

export interface HumanizationResult {
  original: string;
  humanized: string;
  changed: boolean;
  patternsFound: string[];
  humanizedAt: string;
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const HUMANIZER_SYSTEM_PROMPT = `You are a content humanizer for YClaw. Your job is to detect and rewrite AI-generated writing patterns while preserving the brand voice.

You will receive content along with the brand voice guide and a list of 24 AI writing patterns to detect.

CRITICAL: The brand voice guide ALWAYS wins over humanizer rules. If a humanizer rule conflicts with the brand voice, follow the brand voice.

For the given content:
1. Identify any AI writing patterns present (from the humanizer guide)
2. Rewrite the content to eliminate those patterns
3. Preserve the original meaning, tone, and brand voice

Respond with ONLY a JSON object:
{
  "humanized": "the rewritten content (or original if no patterns found)",
  "patterns": ["list of pattern names that were detected and fixed"]
}

If the content has no AI patterns, return it unchanged with an empty patterns array.
Keep the same length and structure. Do not add or remove information.`;

// ─── HumanizationGate ───────────────────────────────────────────────────────

/**
 * Content Humanization Gate — quality improvement layer.
 *
 * Runs between content generation and ReviewGate.
 * Uses Haiku (cheap, fast) to detect and rewrite AI writing patterns.
 *
 * FAIL-OPEN: On any error, returns original content unchanged.
 * This is a quality gate, not a safety gate — ReviewGate handles safety.
 */
export class HumanizationGate {
  private brandVoice: string = '';
  private humanizerGuide: string = '';

  async initialize(): Promise<void> {
    try {
      this.brandVoice = loadPrompt('brand-voice.md');
    } catch {
      logger.warn('brand-voice.md not found — humanizer will run without brand voice context');
    }
    try {
      this.humanizerGuide = loadPrompt('humanizer-guide.md');
    } catch {
      logger.warn('humanizer-guide.md not found — humanization disabled');
    }
    logger.info('Humanization gate initialized');
  }

  async humanize(request: HumanizationRequest): Promise<HumanizationResult> {
    const now = new Date().toISOString();

    // If no humanizer guide loaded, pass through unchanged
    if (!this.humanizerGuide) {
      return {
        original: request.content,
        humanized: request.content,
        changed: false,
        patternsFound: [],
        humanizedAt: now,
      };
    }

    try {
      logger.info(`Humanizing content from ${request.agent}: ${request.contentType} → ${request.targetPlatform}`);

      const provider = createProvider({
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        temperature: 0.3,
        maxTokens: 2048,
      });

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: [
            HUMANIZER_SYSTEM_PROMPT,
            this.brandVoice ? `\n---\n# Brand Voice Guide\n${this.brandVoice}` : '',
            `\n---\n# AI Writing Patterns to Detect\n${this.humanizerGuide}`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `## Content to Humanize`,
            `**Agent**: ${request.agent}`,
            `**Type**: ${request.contentType}`,
            `**Platform**: ${request.targetPlatform}`,
            '',
            '```',
            request.content,
            '```',
          ].join('\n'),
        },
      ];

      const response = await provider.chat(messages, {
        temperature: 0.3,
        maxTokens: 2048,
      });

      const parsed = this.parseResponse(response.content);

      const changed = parsed.humanized !== request.content && parsed.patterns.length > 0;

      if (changed) {
        logger.info(`Detected ${parsed.patterns.length} AI pattern(s): ${parsed.patterns.join(', ')}`);
      }

      return {
        original: request.content,
        humanized: changed ? parsed.humanized : request.content,
        changed,
        patternsFound: parsed.patterns,
        humanizedAt: now,
      };
    } catch (error) {
      // FAIL-OPEN: return original content on any error
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Humanization failed — passing through original content (${msg})`);

      return {
        original: request.content,
        humanized: request.content,
        changed: false,
        patternsFound: [],
        humanizedAt: now,
      };
    }
  }

  private parseResponse(content: string): { humanized: string; patterns: string[] } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        humanized: typeof parsed.humanized === 'string' ? parsed.humanized : content,
        patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      };
    } catch {
      logger.warn('Failed to parse humanizer response — using raw content');
      return { humanized: content, patterns: [] };
    }
  }
}
