import { createLogger } from '../logging/logger.js';
import { createProvider } from '../llm/provider.js';
import type { LLMMessage } from '../llm/types.js';
import type { Template, ChannelConfig, CrossChannelInsight } from './types.js';

const log = createLogger('growth-engine:mutator');

const MUTATOR_SYSTEM_PROMPT = `You are an expert growth marketer optimizing marketing templates through A/B testing.
You will receive:
1. A channel type and goal
2. The current champion template
3. Which variable to modify
4. Brand/compliance constraints
5. Cross-channel learnings from other experiments

Your job: generate ONE variant that changes ONLY the specified variable.
Keep all other variables identical to the champion.

Rules:
- Change ONLY the specified variable. Every other variable must be copied exactly.
- Your change should be meaningfully different from the champion (not just synonym swaps).
- Stay within the brand voice and compliance constraints.
- Explain your hypothesis for why this change should improve the target metric.

Respond with JSON only:
\`\`\`json
{
  "mutatedValue": "the new value for the variable",
  "hypothesis": "one-sentence explanation of why this should perform better"
}
\`\`\``;

// ─── Mutator ──────────────────────────────────────────────────────────────────

/**
 * Generates template variants by modifying one variable at a time.
 * Uses LLM to generate creative mutations within baseline constraints.
 *
 * Variable selection uses round-robin through the channel's variablesToTest list.
 */
export class Mutator {
  private readonly log = createLogger('growth-engine:mutator');

  /**
   * Generate a variant of the champion template.
   *
   * @param channelConfig - Channel configuration (goal, variables to test)
   * @param champion - Current champion template
   * @param variableIndex - Which variable to mutate (index into variablesToTest)
   * @param baseline - The baseline.md content (immutable constraints)
   * @param insights - Recent cross-channel learnings
   */
  async mutate(
    channelConfig: ChannelConfig,
    champion: Template,
    variableIndex: number,
    baseline: string,
    insights: CrossChannelInsight[],
  ): Promise<Template> {
    const variableToTest = channelConfig.variablesToTest[variableIndex % channelConfig.variablesToTest.length];
    if (!variableToTest) {
      throw new Error(`No variable at index ${variableIndex} for channel ${channelConfig.name}`);
    }

    const currentValue = champion.variables[variableToTest];
    if (currentValue === undefined) {
      throw new Error(`Variable "${variableToTest}" not found in champion template for ${channelConfig.name}`);
    }

    this.log.info('Generating mutation', {
      channel: channelConfig.name,
      variable: variableToTest,
      currentValue: currentValue.slice(0, 80),
    });

    const prompt = buildMutationPrompt(channelConfig, champion, variableToTest, baseline, insights);
    const result = await this.callLLM(prompt);
    const parsed = parseMutationResponse(result);

    if (!parsed) {
      throw new Error('Failed to parse mutation response from LLM');
    }

    // Increment version
    const versionParts = champion.version.split('.');
    const minor = parseInt(versionParts[1] ?? '0', 10) + 1;
    const newVersion = `${versionParts[0]}.${minor}.0`;

    const variant: Template = {
      channel: champion.channel,
      version: newVersion,
      body: champion.body,
      subject: champion.subject,
      variables: { ...champion.variables, [variableToTest]: parsed.mutatedValue },
      metadata: {
        mutationVariable: variableToTest,
        mutationDescription: parsed.hypothesis,
        parentVersion: champion.version,
      },
    };

    this.log.info('Mutation generated', {
      channel: channelConfig.name,
      variable: variableToTest,
      newVersion,
      hypothesis: parsed.hypothesis.slice(0, 100),
    });

    return variant;
  }

  private async callLLM(userPrompt: string): Promise<string> {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0.7,
      maxTokens: 2048,
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: MUTATOR_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await provider.chat(messages, {
      model: 'claude-sonnet-4-6',
      temperature: 0.7,
      maxTokens: 2048,
    });

    return response.content;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMutationPrompt(
  channelConfig: ChannelConfig,
  champion: Template,
  variableToTest: string,
  baseline: string,
  insights: CrossChannelInsight[],
): string {
  let prompt = `## Channel: ${channelConfig.name}\n`;
  prompt += `## Goal: ${channelConfig.goal}\n`;
  prompt += `## Metric to optimize: ${channelConfig.scoringMetric}\n\n`;

  prompt += `## Brand & Compliance Constraints\n${baseline}\n\n`;

  prompt += `## Current Champion Template (v${champion.version})\n`;
  prompt += `Variables:\n`;
  for (const [key, value] of Object.entries(champion.variables)) {
    prompt += `- ${key}: "${value}"\n`;
  }
  prompt += `\n`;

  prompt += `## Variable to Modify: ${variableToTest}\n`;
  prompt += `Current value: "${champion.variables[variableToTest] ?? ''}"\n\n`;

  if (insights.length > 0) {
    prompt += `## Cross-Channel Learnings (proven winners from other channels)\n`;
    for (const insight of insights.slice(0, 5)) {
      prompt += `- [${insight.sourceChannel}] ${insight.insight} (+${insight.liftPercent.toFixed(1)}% lift)\n`;
    }
    prompt += `\n`;
  }

  prompt += `Generate ONE variant that changes ONLY "${variableToTest}". Respond with JSON only.`;
  return prompt;
}

function parseMutationResponse(content: string): { mutatedValue: string; hypothesis: string } | null {
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1]! : content;

  try {
    const parsed = JSON.parse(jsonStr) as { mutatedValue?: string; hypothesis?: string };
    if (typeof parsed.mutatedValue !== 'string' || typeof parsed.hypothesis !== 'string') return null;
    return { mutatedValue: parsed.mutatedValue, hypothesis: parsed.hypothesis };
  } catch {
    return null;
  }
}
