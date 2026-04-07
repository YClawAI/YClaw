import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMMessage, LLMOptions } from './types.js';

// Mock the Anthropic SDK before importing the provider
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

// Mock the logger to avoid console noise and enable assertions
const mockLoggerWarn = vi.fn();
vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks are set up
import { AnthropicProvider } from './anthropic.js';

function makeAnthropicResponse(overrides?: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: 'Hello from Claude' }],
    usage: {
      input_tokens: 1000,
      output_tokens: 50,
      ...(overrides?.usage as Record<string, number> | undefined),
    },
    stop_reason: 'end_turn',
    ...overrides,
  };
}

function make529Error(): Error & { status: number } {
  const err = new Error('Overloaded') as Error & { status: number };
  err.status = 529;
  return err;
}

function make500Error(): Error & { status: number } {
  const err = new Error('Internal Server Error') as Error & { status: number };
  err.status = 500;
  return err;
}

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Seed Math.random to make jitter deterministic in tests
    vi.spyOn(Math, 'random').mockReturnValue(0);
    provider = new AnthropicProvider('test-api-key');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('system prompt handling', () => {
    it('should send plain string when no cacheableBlocks present', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];
      const options: LLMOptions = { model: 'claude-sonnet-4-5-20250929' };

      await provider.chat(messages, options);

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toBe('You are a helpful assistant.');
      expect(typeof callArgs.system).toBe('string');
    });

    it('should send content block array when cacheableBlocks present', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: 'Layer 1\n\nLayer 2\n\nLayer 3',
          cacheableBlocks: [
            {
              text: 'Layer 1: Global prompts',
              cacheControl: { type: 'ephemeral' },
              label: 'global',
            },
            {
              text: 'Layer 2: Department prompts',
              cacheControl: { type: 'ephemeral' },
              label: 'department',
            },
            {
              text: 'Layer 3: Dynamic content',
              label: 'dynamic',
            },
          ],
        },
        { role: 'user', content: 'Hello' },
      ];
      const options: LLMOptions = { model: 'claude-sonnet-4-5-20250929' };

      await provider.chat(messages, options);

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0][0];

      // Should be an array, not a string
      expect(Array.isArray(callArgs.system)).toBe(true);
      expect(callArgs.system).toHaveLength(3);

      // Block 1: cached
      expect(callArgs.system[0]).toEqual({
        type: 'text',
        text: 'Layer 1: Global prompts',
        cache_control: { type: 'ephemeral' },
      });

      // Block 2: cached
      expect(callArgs.system[1]).toEqual({
        type: 'text',
        text: 'Layer 2: Department prompts',
        cache_control: { type: 'ephemeral' },
      });

      // Block 3: no cache_control
      expect(callArgs.system[2]).toEqual({
        type: 'text',
        text: 'Layer 3: Dynamic content',
      });
    });

    it('should concatenate multiple system messages without blocks', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'system', content: 'First system message.' },
        { role: 'system', content: 'Second system message.' },
        { role: 'user', content: 'Hello' },
      ];
      const options: LLMOptions = {};

      await provider.chat(messages, options);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toBe(
        'First system message.\n\nSecond system message.',
      );
    });

    it('should handle mixed system messages (some with blocks, some without)', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: 'Cached content',
          cacheableBlocks: [
            {
              text: 'Cached block',
              cacheControl: { type: 'ephemeral' },
            },
          ],
        },
        {
          role: 'system',
          content: 'Plain system message',
        },
        { role: 'user', content: 'Hello' },
      ];
      const options: LLMOptions = {};

      await provider.chat(messages, options);

      const callArgs = mockCreate.mock.calls[0][0];
      // Should use block format because at least one message has blocks
      expect(Array.isArray(callArgs.system)).toBe(true);
      expect(callArgs.system).toHaveLength(2);
      expect(callArgs.system[0].cache_control).toEqual({
        type: 'ephemeral',
      });
      // Second message has no blocks — included as plain text block
      expect(callArgs.system[1]).toEqual({
        type: 'text',
        text: 'Plain system message',
      });
    });

    it('should return undefined system when no system messages', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const options: LLMOptions = {};

      await provider.chat(messages, options);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toBeUndefined();
    });

    it('should return undefined system when system content is empty', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'system', content: '' },
        { role: 'user', content: 'Hello' },
      ];
      const options: LLMOptions = {};

      await provider.chat(messages, options);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toBeUndefined();
    });
  });

  describe('retry logic for 529 overloaded errors', () => {
    // Note: Math.random is mocked to return 0, so jitter is always 0ms.
    // This makes backoff delays deterministic: 1000ms, 2000ms, 4000ms.

    it('should retry on 529 and succeed on second attempt', async () => {
      mockCreate
        .mockRejectedValueOnce(make529Error())
        .mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const chatPromise = provider.chat(messages, {});

      // Advance past the 1s backoff delay (attempt 0 → delay = 1000ms + 0ms jitter)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await chatPromise;

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello from Claude');
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('retry 1/3'),
      );
    });

    it('should retry up to 3 times then throw on persistent 529', async () => {
      mockCreate
        .mockRejectedValueOnce(make529Error())
        .mockRejectedValueOnce(make529Error())
        .mockRejectedValueOnce(make529Error())
        .mockRejectedValueOnce(make529Error());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const chatPromise = provider.chat(messages, {});

      // Advance through all backoff delays: 1s + 2s + 4s = 7s (jitter = 0)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);

      await expect(chatPromise).rejects.toThrow('Overloaded');
      // Initial attempt + 3 retries = 4 total calls
      expect(mockCreate).toHaveBeenCalledTimes(4);
      expect(mockLoggerWarn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-529 errors', async () => {
      mockCreate.mockRejectedValueOnce(make500Error());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      await expect(provider.chat(messages, {})).rejects.toThrow(
        'Internal Server Error',
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should retry on error with overloaded_error type', async () => {
      const overloadErr = Object.assign(new Error('overloaded'), {
        error: { type: 'overloaded_error' },
      });
      mockCreate
        .mockRejectedValueOnce(overloadErr)
        .mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const chatPromise = provider.chat(messages, {});
      await vi.advanceTimersByTimeAsync(1000);

      const result = await chatPromise;
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello from Claude');
    });

    it('should succeed on third attempt after two 529 errors', async () => {
      mockCreate
        .mockRejectedValueOnce(make529Error())
        .mockRejectedValueOnce(make529Error())
        .mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const chatPromise = provider.chat(messages, {});

      // First retry after 1s
      await vi.advanceTimersByTimeAsync(1000);
      // Second retry after 2s
      await vi.advanceTimersByTimeAsync(2000);

      const result = await chatPromise;
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result.content).toBe('Hello from Claude');
    });

    it('should include jitter in backoff delay', async () => {
      // Restore real Math.random for this test, then mock with known value
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      mockCreate
        .mockRejectedValueOnce(make529Error())
        .mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const chatPromise = provider.chat(messages, {});

      // With Math.random() = 0.5, jitter = floor(0.5 * 500) = 250ms
      // Total delay = 1000 + 250 = 1250ms
      // Advancing 1000ms should NOT be enough
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Advancing the remaining 250ms should trigger the retry
      await vi.advanceTimersByTimeAsync(250);

      const result = await chatPromise;
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello from Claude');
    });
  });

  describe('cache metrics in response', () => {
    it('should extract cache_creation_input_tokens from response', async () => {
      mockCreate.mockResolvedValueOnce(
        makeAnthropicResponse({
          usage: {
            input_tokens: 10000,
            output_tokens: 500,
            cache_creation_input_tokens: 8000,
            cache_read_input_tokens: 0,
          },
        }),
      );

      const messages: LLMMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await provider.chat(messages, {});

      expect(result.usage.cacheCreationInputTokens).toBe(8000);
      expect(result.usage.cacheReadInputTokens).toBe(0);
      expect(result.usage.inputTokens).toBe(10000);
      expect(result.usage.outputTokens).toBe(500);
    });

    it('should extract cache_read_input_tokens on cache hit', async () => {
      mockCreate.mockResolvedValueOnce(
        makeAnthropicResponse({
          usage: {
            input_tokens: 10000,
            output_tokens: 300,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 8000,
          },
        }),
      );

      const messages: LLMMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await provider.chat(messages, {});

      expect(result.usage.cacheCreationInputTokens).toBe(0);
      expect(result.usage.cacheReadInputTokens).toBe(8000);
    });

    it('should leave cache fields undefined when not in response', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await provider.chat(messages, {});

      expect(result.usage.cacheCreationInputTokens).toBeUndefined();
      expect(result.usage.cacheReadInputTokens).toBeUndefined();
    });
  });

  describe('tool schema generation', () => {
    it('should include items: { type: "string" } for array parameters', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [{ role: 'user', content: 'Create issue' }];
      await provider.chat(messages, {
        tools: [
          {
            name: 'github:create_issue',
            description: 'Create a GitHub issue',
            parameters: {
              title: { type: 'string', description: 'Issue title', required: true },
              labels: { type: 'array', description: 'Label names' },
            },
          },
        ],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const labelsSchema = callArgs.tools[0].input_schema.properties.labels;
      expect(labelsSchema.type).toBe('array');
      expect(labelsSchema.items).toEqual({ type: 'string' });
    });

    it('should not add items for non-array parameters', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];
      await provider.chat(messages, {
        tools: [
          {
            name: 'some_tool',
            description: 'A tool',
            parameters: {
              query: { type: 'string', description: 'Search query', required: true },
              count: { type: 'number', description: 'Result count' },
            },
          },
        ],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const querySchema = callArgs.tools[0].input_schema.properties.query;
      const countSchema = callArgs.tools[0].input_schema.properties.count;
      expect(querySchema.items).toBeUndefined();
      expect(countSchema.items).toBeUndefined();
    });

    it('should respect explicit items type from ToolDefinition', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];
      await provider.chat(messages, {
        tools: [
          {
            name: 'some_tool',
            description: 'A tool',
            parameters: {
              ids: {
                type: 'array',
                description: 'Numeric IDs',
                items: { type: 'number' },
              },
            },
          },
        ],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const idsSchema = callArgs.tools[0].input_schema.properties.ids;
      expect(idsSchema.type).toBe('array');
      expect(idsSchema.items).toEqual({ type: 'number' });
    });
  });

  describe('tool call handling', () => {
    it('should parse tool_use blocks from response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me search for that.' },
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'x_search',
            input: { query: 'yclaw protocol' },
          },
        ],
        usage: { input_tokens: 500, output_tokens: 100 },
        stop_reason: 'tool_use',
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Search for yclaw protocol' },
      ];

      const result = await provider.chat(messages, {
        tools: [
          {
            name: 'x_search',
            description: 'Search tweets',
            parameters: {
              query: {
                type: 'string',
                description: 'Search query',
                required: true,
              },
            },
          },
        ],
      });

      expect(result.content).toBe('Let me search for that.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_123',
        name: 'x_search',
        arguments: { query: 'yclaw protocol' },
      });
      expect(result.stopReason).toBe('tool_use');
    });
  });

  describe('message conversion', () => {
    it('should convert tool result messages to user role', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Search for something' },
        {
          role: 'assistant',
          content: 'Searching...',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { q: 'test' } },
          ],
        },
        {
          role: 'tool',
          content: '{"results": []}',
          toolCallId: 'call_1',
        },
      ];

      await provider.chat(messages, {});

      const callArgs = mockCreate.mock.calls[0][0];
      // Tool result should be converted to user message
      expect(callArgs.messages[1].role).toBe('user');
      expect(callArgs.messages[1].content[0].type).toBe('tool_result');
      expect(callArgs.messages[1].content[0].tool_use_id).toBe('call_1');
    });

    it('should convert assistant messages with tool calls', async () => {
      mockCreate.mockResolvedValueOnce(makeAnthropicResponse());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Do something' },
        {
          role: 'assistant',
          content: 'I will use a tool.',
          toolCalls: [
            {
              id: 'call_abc',
              name: 'github_create_pr',
              arguments: { title: 'Test PR' },
            },
          ],
        },
        {
          role: 'tool',
          content: '{"success": true}',
          toolCallId: 'call_abc',
        },
      ];

      await provider.chat(messages, {});

      const callArgs = mockCreate.mock.calls[0][0];
      const assistantMsg = callArgs.messages[0];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toHaveLength(2);
      expect(assistantMsg.content[0]).toEqual({
        type: 'text',
        text: 'I will use a tool.',
      });
      expect(assistantMsg.content[1]).toEqual({
        type: 'tool_use',
        id: 'call_abc',
        name: 'github_create_pr',
        input: { title: 'Test PR' },
      });
    });
  });
});
