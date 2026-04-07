/**
 * Tests for the OpenRouter provider tool schema conversion.
 *
 * Verifies that array-type parameters include `items`, non-array parameters
 * do not include `items`, and missing `items` on an array param does not throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function loadOpenRouter() {
  vi.resetModules();
  const mod = await import('../src/llm/openrouter.js');
  return mod;
}

function mockSuccessResponse() {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: { content: 'ok', tool_calls: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }),
  };
}

/** Extract the `tools` array from the body sent to fetch. */
function getCapturedTools(call: unknown[]): Array<{
  type: string;
  function: {
    name: string;
    parameters: {
      properties: Record<string, { type: string; description?: string; items?: unknown }>;
      required: string[];
    };
  };
}> {
  const opts = call[1] as { body: string };
  const body = JSON.parse(opts.body) as { tools: ReturnType<typeof getCapturedTools> };
  return body.tools;
}

describe('OpenRouterProvider – tool schema conversion', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('includes `items` for array-type parameters that have items defined', async () => {
    const { OpenRouterProvider } = await loadOpenRouter();
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());

    const provider = new OpenRouterProvider('sk-test');
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      {
        model: 'anthropic/claude-sonnet-4-5-20250929',
        tools: [
          {
            name: 'list_items',
            description: 'Returns a list',
            parameters: {
              tags: {
                type: 'array',
                description: 'List of tags',
                required: true,
                items: { type: 'string' },
              },
            },
          },
        ],
      },
    );

    const tools = getCapturedTools(mockFetch.mock.calls[0] as unknown[]);
    const tagsProp = tools[0]?.function.parameters.properties['tags'];
    expect(tagsProp?.type).toBe('array');
    expect(tagsProp?.items).toEqual({ type: 'string' });
  });

  it('does NOT include `items` for non-array parameters', async () => {
    const { OpenRouterProvider } = await loadOpenRouter();
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());

    const provider = new OpenRouterProvider('sk-test');
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      {
        model: 'anthropic/claude-sonnet-4-5-20250929',
        tools: [
          {
            name: 'greet',
            description: 'Greets a user',
            parameters: {
              name: {
                type: 'string',
                description: 'User name',
                required: true,
              },
              count: {
                type: 'number',
                description: 'How many times',
                required: false,
              },
            },
          },
        ],
      },
    );

    const tools = getCapturedTools(mockFetch.mock.calls[0] as unknown[]);
    const nameProp = tools[0]?.function.parameters.properties['name'];
    const countProp = tools[0]?.function.parameters.properties['count'];

    expect(nameProp?.type).toBe('string');
    expect('items' in (nameProp ?? {})).toBe(false);

    expect(countProp?.type).toBe('number');
    expect('items' in (countProp ?? {})).toBe(false);
  });

  it('does NOT include `items` for an array parameter without items defined', async () => {
    const { OpenRouterProvider } = await loadOpenRouter();
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());

    const provider = new OpenRouterProvider('sk-test');
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      {
        model: 'anthropic/claude-sonnet-4-5-20250929',
        tools: [
          {
            name: 'collect',
            description: 'Collect values',
            parameters: {
              values: {
                type: 'array',
                description: 'Some values',
                required: true,
                // intentionally no `items` field
              },
            },
          },
        ],
      },
    );

    const tools = getCapturedTools(mockFetch.mock.calls[0] as unknown[]);
    const valuesProp = tools[0]?.function.parameters.properties['values'];

    expect(valuesProp?.type).toBe('array');
    // items must not be present when not provided on the input
    expect('items' in (valuesProp ?? {})).toBe(false);
  });

  it('correctly marks required parameters', async () => {
    const { OpenRouterProvider } = await loadOpenRouter();
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());

    const provider = new OpenRouterProvider('sk-test');
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      {
        model: 'anthropic/claude-sonnet-4-5-20250929',
        tools: [
          {
            name: 'mixed',
            description: 'Mixed params',
            parameters: {
              required_param: { type: 'string', description: 'Required', required: true },
              optional_param: { type: 'string', description: 'Optional', required: false },
            },
          },
        ],
      },
    );

    const tools = getCapturedTools(mockFetch.mock.calls[0] as unknown[]);
    const required = tools[0]?.function.parameters.required;
    expect(required).toContain('required_param');
    expect(required).not.toContain('optional_param');
  });

  it('wraps parameters in a JSON Schema object envelope with type "function"', async () => {
    const { OpenRouterProvider } = await loadOpenRouter();
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());

    const provider = new OpenRouterProvider('sk-test');
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      {
        model: 'anthropic/claude-sonnet-4-5-20250929',
        tools: [
          {
            name: 'envelope_check',
            description: 'Verifies the outer schema envelope',
            parameters: {
              value: { type: 'string', description: 'A value', required: true },
            },
          },
        ],
      },
    );

    const tools = getCapturedTools(mockFetch.mock.calls[0] as unknown[]);
    const tool = tools[0];

    // Top-level tool envelope must have type "function"
    expect(tool?.type).toBe('function');

    // Parameters root must be a JSON Schema object
    const params = tool?.function.parameters as Record<string, unknown>;
    expect(params?.['type']).toBe('object');
    expect(params?.['properties']).toBeDefined();
    expect(params?.['required']).toBeDefined();
  });
});
