import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, ToolCall } from './types.js';

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
  }

  async chat(messages: LLMMessage[], options: LLMOptions): Promise<LLMResponse> {
    const openRouterMessages = messages.map(m => ({
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
              {
                type: param.type,
                description: param.description,
                ...(param.type === 'array' && param.items ? { items: param.items } : {}),
              },
            ])
          ),
          required: Object.entries(t.parameters)
            .filter(([, param]) => param.required)
            .map(([key]) => key),
        },
      },
    }));

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://yclaw.example.com',
        'X-Title': 'YClaw Agents',
      },
      body: JSON.stringify({
        model: options.model || 'anthropic/claude-sonnet-4-5-20250929',
        messages: openRouterMessages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature,
        tools: tools?.length ? tools : undefined,
        stop: options.stopSequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${error}`);
    }

    const data = await response.json() as OpenRouterResponse;
    return this.parseResponse(data);
  }

  private parseResponse(data: OpenRouterResponse): LLMResponse {
    const choice = data.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    };
  }
}

interface OpenRouterResponse {
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
