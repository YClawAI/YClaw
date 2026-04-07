import type { ModelConfig } from '../config/schema.js';
import type { LLMProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenRouterProvider } from './openrouter.js';
import { LiteLLMProvider } from './litellm.js';

const providerCache = new Map<string, LLMProvider>();

/**
 * Create a direct provider without LiteLLM routing.
 * Used as the fallback when LiteLLM is unreachable.
 */
function createDirectProvider(config: ModelConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openrouter':
      return new OpenRouterProvider();
    case 'ollama':
      throw new Error('Ollama provider not yet implemented');
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export function createProvider(config: ModelConfig): LLMProvider {
  const cacheKey = `${config.provider}:${config.model}`;

  if (providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey)!;
  }

  const litellmUrl = process.env.LITELLM_PROXY_URL;
  let provider: LLMProvider;

  if (litellmUrl) {
    // Route through LiteLLM proxy for unified cost tracking.
    // Falls back to the direct provider if the proxy is unreachable.
    const litellmKey = process.env.LITELLM_API_KEY ?? '';
    const directProvider = createDirectProvider(config);
    provider = new LiteLLMProvider(litellmUrl, litellmKey, directProvider);
  } else {
    provider = createDirectProvider(config);
  }

  providerCache.set(cacheKey, provider);
  return provider;
}

export function clearProviderCache(): void {
  providerCache.clear();
}

export { type LLMProvider, type LLMMessage, type LLMOptions, type LLMResponse, type ToolCall } from './types.js';
