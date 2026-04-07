import { createLogger } from '../logging/logger.js';
import { createProvider } from '../llm/provider.js';
import type { LLMMessage } from '../llm/types.js';
import type { AgentHubClient } from '../agenthub/client.js';
import type { Template, ScoreResult, CrossChannelInsight } from './types.js';

const log = createLogger('growth-engine:propagator');

const INSIGHT_SYSTEM_PROMPT = `You are summarizing a winning A/B test result for cross-channel learning.
Given the channel, the winning variant details, and the metrics, produce a concise one-sentence insight
that other channels can use to inform their own experiments.

Focus on the WHY — what messaging angle, tone, or framing worked and why it resonated with the audience.

Respond with a JSON object:
{"insight": "one-sentence summary of what worked and why"}`;

// ─── Propagator ───────────────────────────────────────────────────────────────

/**
 * When a variant wins, propagates the insight to other channels
 * via the #cross-learn AgentHub channel.
 *
 * Other channels' Mutators read #cross-learn before generating variants,
 * incorporating proven messaging angles from sister channels.
 */
export class Propagator {
  constructor(private readonly agentHub: AgentHubClient) {}

  /**
   * Propagate a winning insight to the cross-learn channel.
   */
  async propagateInsight(
    sourceChannel: string,
    winningVariant: Template,
    score: ScoreResult,
  ): Promise<void> {
    const mutationVariable = winningVariant.metadata.mutationVariable ?? 'unknown';
    const mutationValue = winningVariant.variables[mutationVariable] ?? '';

    let insightSummary: string;
    try {
      insightSummary = await this.generateInsight(sourceChannel, winningVariant, score);
    } catch (err) {
      log.warn('Failed to generate insight via LLM, using raw data', {
        error: (err as Error).message,
      });
      insightSummary = `${sourceChannel}: changing "${mutationVariable}" to "${mutationValue.slice(0, 60)}" improved ${score.lift.toFixed(1)}%`;
    }

    const payload: CrossChannelInsight = {
      sourceChannel,
      insight: insightSummary,
      liftPercent: score.lift,
      winningVariable: mutationVariable,
      winningValue: mutationValue,
      timestamp: new Date().toISOString(),
    };

    await this.agentHub.createPost('cross-learn', JSON.stringify(payload)).catch((err) => {
      log.warn('Failed to post cross-channel insight', { error: (err as Error).message });
    });

    log.info('Propagated cross-channel insight', {
      sourceChannel,
      variable: mutationVariable,
      lift: score.lift.toFixed(1),
    });
  }

  /**
   * Read recent cross-channel insights from the #cross-learn channel.
   * Used by the Mutator to incorporate proven angles.
   */
  async getRecentInsights(limit = 10): Promise<CrossChannelInsight[]> {
    try {
      const posts = await this.agentHub.readPosts('cross-learn', limit);
      const insights: CrossChannelInsight[] = [];

      for (const post of posts) {
        try {
          const parsed = JSON.parse(post.content) as CrossChannelInsight;
          if (parsed.sourceChannel && parsed.insight) {
            insights.push(parsed);
          }
        } catch {
          // Skip malformed posts
        }
      }

      return insights;
    } catch (err) {
      log.warn('Failed to read cross-learn insights', { error: (err as Error).message });
      return [];
    }
  }

  private async generateInsight(
    sourceChannel: string,
    variant: Template,
    score: ScoreResult,
  ): Promise<string> {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.3,
      maxTokens: 256,
    });

    const userPrompt = [
      `Channel: ${sourceChannel}`,
      `Variable modified: ${variant.metadata.mutationVariable}`,
      `Old value: (from parent v${variant.metadata.parentVersion})`,
      `New value: "${variant.variables[variant.metadata.mutationVariable ?? ''] ?? ''}"`,
      `Mutation hypothesis: ${variant.metadata.mutationDescription}`,
      `Result: +${score.lift.toFixed(1)}% lift on ${score.metrics.sampleSize} samples`,
      '',
      'Summarize what worked and why in one sentence.',
    ].join('\n');

    const messages: LLMMessage[] = [
      { role: 'system', content: INSIGHT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await provider.chat(messages, {
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.3,
      maxTokens: 256,
    });

    const parsed = parseInsightResponse(response.content);
    return parsed ?? `${sourceChannel}: ${variant.metadata.mutationDescription} (+${score.lift.toFixed(1)}%)`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseInsightResponse(content: string): string | null {
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1]! : content;

  try {
    const parsed = JSON.parse(jsonStr) as { insight?: string };
    if (typeof parsed.insight === 'string') return parsed.insight;
    return null;
  } catch {
    return null;
  }
}
