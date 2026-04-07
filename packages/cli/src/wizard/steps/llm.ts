import { select } from '@inquirer/prompts';
import type { WizardState } from '../../types.js';

const PROVIDER_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  openrouter: 'anthropic/claude-sonnet-4-20250514',
};

export async function llmStep(
  state: WizardState,
): Promise<WizardState> {
  const provider = await select({
    message: 'Which LLM provider will you use?',
    choices: [
      { name: 'Anthropic (Claude) — recommended', value: 'anthropic' },
      { name: 'OpenAI (GPT)', value: 'openai' },
      { name: 'OpenRouter (multi-provider)', value: 'openrouter' },
    ],
    default: state.llm.provider,
  });

  const model = PROVIDER_MODELS[provider] ?? 'claude-sonnet-4-20250514';

  return {
    ...state,
    llm: {
      provider: provider as WizardState['llm']['provider'],
      model,
    },
  };
}
