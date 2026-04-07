import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, ToolCall } from './types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('litellm');

/** Classify a fetch error as a network connectivity failure (proxy unreachable). */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('connection refused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout')
  );
}

/**
 * LiteLLM proxy provider.
 *
 * Routes every LLM call through the LiteLLM proxy for unified cost tracking
 * across all providers. Exposes an OpenAI-compatible `/v1/chat/completions`
 * endpoint that LiteLLM translates to the appropriate backend.
 *
 * Falls back to `fallback` provider when the proxy is unreachable (e.g.,
 * during cold start or proxy restart). Non-network errors (4xx/5xx from the
 * proxy itself) are always surfaced without fallback.
 *
 * Prompt caching: When `options.cacheStrategy` is set, delegates to the
 * direct fallback provider so that Anthropic cache_control markers are
 * preserved. The OpenAI-compat endpoint does not support cache_control.
 */
export class LiteLLMProvider implements LLMProvider {
  readonly name = 'litellm';
  private readonly proxyUrl: string;
  private readonly apiKey: string;
  private readonly fallback: LLMProvider | undefined;

  constructor(proxyUrl: string, apiKey: string, fallback?: LLMProvider) {
    this.proxyUrl = proxyUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fallback = fallback;
  }

  async chat(messages: LLMMessage[], options: LLMOptions): Promise<LLMResponse> {
    // Prompt caching requires Anthropic-native cache_control markers that the
    // OpenAI-compat endpoint strips. Delegate to the direct provider so
    // cache_control blocks are preserved end-to-end.
    if (options.cacheStrategy && this.fallback) {
      logger.debug('Delegating to direct provider for prompt caching');
      return this.fallback.chat(messages, options);
    }

    try {
      return await this.callProxy(messages, options);
    } catch (err) {
      if (this.fallback && isNetworkError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `LiteLLM proxy unreachable (${msg}), falling back to direct provider`,
        );
        return this.fallback.chat(messages, options);
      }
      throw err;
    }
  }

  private async callProxy(
    messages: LLMMessage[],
    options: LLMOptions,
  ): Promise<LLMResponse> {
    const openAIMessages = messages.map(m => ({
      role: m.role === 'tool' ? ('user' as const) : m.role,
      content: m.content,
    }));

    const tools = options.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(t.parameters).map(([key, param]) => [
              key,
              { type: param.type, description: param.description },
            ]),
          ),
          required: Object.entries(t.parameters)
            .filter(([, param]) => param.required)
            .map(([key]) => key),
        },
      },
    }));

    const response = await fetch(`${this.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: openAIMessages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        tools: tools?.length ? tools : undefined,
        stop: options.stopSequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LiteLLM proxy error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as LiteLLMResponse;
    return this.parseResponse(data);
  }

  private parseResponse(data: LiteLLMResponse): LLMResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('LiteLLM returned no choices in response');
    }

    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        });
      }
    }

    return {
      content: choice.message.content ?? '',
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    };
  }
}

interface LiteLLMResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}
