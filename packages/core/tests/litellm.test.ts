import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider } from '../src/llm/types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Fresh module per test to avoid singleton cache cross-contamination
async function loadLiteLLM() {
  vi.resetModules();
  const mod = await import('../src/llm/litellm.js');
  return mod;
}

function mockSuccessResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: { content, tool_calls: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  };
}

describe('LiteLLMProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('chat()', () => {
    it('calls the proxy with OpenAI-compat format', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce(mockSuccessResponse('Hello'));

      const provider = new LiteLLMProvider('http://litellm:4000', 'sk-test');
      const result = await provider.chat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'claude-sonnet-4-6', maxTokens: 100, temperature: 0.5 },
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe('http://litellm:4000/v1/chat/completions');
      expect(opts.headers['Authorization']).toBe('Bearer sk-test');
      expect(opts.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body.model).toBe('claude-sonnet-4-6');
      expect(body.max_tokens).toBe(100);
      expect(body.temperature).toBe(0.5);
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);

      expect(result.content).toBe('Hello');
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
      expect(result.stopReason).toBe('end_turn');
    });

    it('strips trailing slash from proxy URL', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce(mockSuccessResponse('ok'));

      const provider = new LiteLLMProvider('http://litellm:4000/', 'key');
      await provider.chat([{ role: 'user', content: 'Hi' }], { model: 'gpt-5.2' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('http://litellm:4000/v1/chat/completions');
    });

    it('maps tool messages to user role (OpenAI compat)', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce(mockSuccessResponse('done'));

      const provider = new LiteLLMProvider('http://litellm:4000', 'key');
      await provider.chat(
        [
          { role: 'user', content: 'call tool' },
          { role: 'tool', content: 'result', toolCallId: 'call_1' },
        ],
        { model: 'claude-sonnet-4-6' },
      );

      const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
        messages: Array<{ role: string }>;
      };
      expect(body.messages[1]?.role).toBe('user');
    });

    it('parses tool_calls in response', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_abc',
                    function: { name: 'slack_message', arguments: '{"channel":"#dev","text":"hello"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 8 },
        }),
      });

      const provider = new LiteLLMProvider('http://litellm:4000', 'key');
      const result = await provider.chat(
        [{ role: 'user', content: 'post a message' }],
        { model: 'claude-sonnet-4-6' },
      );

      expect(result.stopReason).toBe('tool_use');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.id).toBe('call_abc');
      expect(result.toolCalls[0]?.name).toBe('slack_message');
      expect(result.toolCalls[0]?.arguments).toEqual({ channel: '#dev', text: 'hello' });
    });

    it('throws on non-2xx proxy response without fallback', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const provider = new LiteLLMProvider('http://litellm:4000', 'bad-key');
      await expect(
        provider.chat([{ role: 'user', content: 'Hi' }], { model: 'claude-sonnet-4-6' }),
      ).rejects.toThrow('401');
    });

    it('throws when proxy returns no choices', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }),
      });

      const provider = new LiteLLMProvider('http://litellm:4000', 'key');
      await expect(
        provider.chat([{ role: 'user', content: 'Hi' }], { model: 'claude-sonnet-4-6' }),
      ).rejects.toThrow('no choices');
    });
  });

  describe('fallback behaviour', () => {
    it('falls back to direct provider on ECONNREFUSED', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();

      const connError = new Error('fetch failed: ECONNREFUSED ::1:4000');
      mockFetch.mockRejectedValueOnce(connError);

      const fallback: LLMProvider = {
        name: 'mock-fallback',
        chat: vi.fn().mockResolvedValueOnce({
          content: 'fallback response',
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 3 },
          stopReason: 'end_turn' as const,
        }),
      };

      const provider = new LiteLLMProvider('http://litellm:4000', 'key', fallback);
      const result = await provider.chat(
        [{ role: 'user', content: 'Hi' }],
        { model: 'claude-sonnet-4-6' },
      );

      expect(fallback.chat).toHaveBeenCalledOnce();
      expect(result.content).toBe('fallback response');
    });

    it('falls back on ENOTFOUND (DNS resolution failure)', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();

      mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND litellm.yclaw-internal'));

      const fallback: LLMProvider = {
        name: 'mock-fallback',
        chat: vi.fn().mockResolvedValueOnce({
          content: 'from fallback',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'end_turn' as const,
        }),
      };

      const provider = new LiteLLMProvider('http://litellm.yclaw-internal:4000', 'key', fallback);
      await provider.chat([{ role: 'user', content: 'Hi' }], { model: 'claude-sonnet-4-6' });

      expect(fallback.chat).toHaveBeenCalledOnce();
    });

    it('does NOT fall back on auth errors (401)', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const fallback: LLMProvider = {
        name: 'mock-fallback',
        chat: vi.fn(),
      };

      const provider = new LiteLLMProvider('http://litellm:4000', 'bad-key', fallback);
      await expect(
        provider.chat([{ role: 'user', content: 'Hi' }], { model: 'claude-sonnet-4-6' }),
      ).rejects.toThrow('401');

      expect(fallback.chat).not.toHaveBeenCalled();
    });

    it('throws network errors when no fallback is configured', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();

      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = new LiteLLMProvider('http://litellm:4000', 'key');
      await expect(
        provider.chat([{ role: 'user', content: 'Hi' }], { model: 'claude-sonnet-4-6' }),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('prompt caching delegation', () => {
    it('delegates to fallback when cacheStrategy is set', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();

      const fallback: LLMProvider = {
        name: 'mock-anthropic',
        chat: vi.fn().mockResolvedValueOnce({
          content: 'cached response',
          toolCalls: [],
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheCreationInputTokens: 80,
            cacheReadInputTokens: 0,
          },
          stopReason: 'end_turn' as const,
        }),
      };

      const provider = new LiteLLMProvider('http://litellm:4000', 'key', fallback);
      const messages = [
        { role: 'system' as const, content: 'You are a helpful agent' },
        { role: 'user' as const, content: 'Hello' },
      ];
      const result = await provider.chat(messages, {
        model: 'claude-sonnet-4-6',
        cacheStrategy: 'system_and_3',
      });

      // Should use fallback, NOT the proxy
      expect(fallback.chat).toHaveBeenCalledOnce();
      expect(fallback.chat).toHaveBeenCalledWith(messages, {
        model: 'claude-sonnet-4-6',
        cacheStrategy: 'system_and_3',
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.content).toBe('cached response');
      expect(result.usage.cacheCreationInputTokens).toBe(80);
    });

    it('uses proxy when cacheStrategy is not set', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce(mockSuccessResponse('proxy response'));

      const fallback: LLMProvider = {
        name: 'mock-anthropic',
        chat: vi.fn(),
      };

      const provider = new LiteLLMProvider('http://litellm:4000', 'key', fallback);
      const result = await provider.chat(
        [{ role: 'user', content: 'Hello' }],
        { model: 'claude-sonnet-4-6' },
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(fallback.chat).not.toHaveBeenCalled();
      expect(result.content).toBe('proxy response');
    });

    it('uses proxy when cacheStrategy is set but no fallback exists', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      mockFetch.mockResolvedValueOnce(mockSuccessResponse('proxy only'));

      const provider = new LiteLLMProvider('http://litellm:4000', 'key');
      const result = await provider.chat(
        [{ role: 'user', content: 'Hello' }],
        { model: 'claude-sonnet-4-6', cacheStrategy: 'system_and_3' },
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result.content).toBe('proxy only');
    });
  });

  describe('provider name', () => {
    it('exposes name as "litellm"', async () => {
      const { LiteLLMProvider } = await loadLiteLLM();
      const provider = new LiteLLMProvider('http://litellm:4000', 'key');
      expect(provider.name).toBe('litellm');
    });
  });
});
