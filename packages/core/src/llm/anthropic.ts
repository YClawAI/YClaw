import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  ToolCall,
  CacheableBlock,
} from './types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('anthropic');

/** Maximum number of retry attempts for transient Anthropic errors. */
const MAX_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff (1s, 2s, 4s). */
const BASE_DELAY_MS = 1000;

/** Maximum jitter in milliseconds added to backoff delay. */
const MAX_JITTER_MS = 500;

/**
 * Anthropic content block with optional cache_control.
 * Matches the Anthropic API's TextBlockParam shape.
 */
interface CacheableTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/**
 * Anthropic tool_result content block with optional cache_control.
 * The Anthropic SDK's ToolResultBlockParam type omits cache_control in its
 * TypeScript definitions, but the API accepts it for prompt caching.
 */
interface CacheableToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  cache_control?: { type: 'ephemeral' };
}

/**
 * Apply "system_and_3" cache_control markers to conversation messages.
 *
 * Marks the last message before each of the first `maxMarks` new assistant turns
 * with cache_control: { type: 'ephemeral' }, creating cache checkpoints in the
 * conversation body that Anthropic caches between rounds.
 *
 * A new turn starts when an assistant message follows any prior message.
 * The cache_control is placed on the PREVIOUS message (end of the prior turn).
 *
 * Example (3 turns, 1 tool per turn):
 *   [user, a1, t1, a2, t2, a3, t3]
 *   → t1.cacheControl = ephemeral  (end of turn 1)
 *   → t2.cacheControl = ephemeral  (end of turn 2)
 *   → t3.cacheControl = ephemeral  (end of turn 3)
 *
 * Pure function — returns a new array; original messages are not mutated.
 */
export function applyTurnCacheMarkers(
  messages: LLMMessage[],
  maxMarks = 3,
): LLMMessage[] {
  const result = [...messages];
  let marksApplied = 0;

  for (let i = 1; i < result.length && marksApplied < maxMarks; i++) {
    const msg = result[i];
    if (msg?.role === 'assistant') {
      const prevIdx = i - 1;
      const prev = result[prevIdx];
      // Only mark tool messages (end of a complete prior turn).
      // The initial user message is NOT marked — it's the task setup, not a turn boundary.
      if (prev && prev.role === 'tool' && !prev.cacheControl) {
        result[prevIdx] = { ...prev, cacheControl: { type: 'ephemeral' } };
        marksApplied++;
      }
    }
  }

  return result;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check whether an error is a retryable Anthropic overload error (HTTP 529).
 * The Anthropic SDK throws an APIError with status 529 for overloaded_error.
 * Also retries on 529-like errors surfaced as status 529 or error type 'overloaded_error'.
 */
function isRetryableOverloadError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // Anthropic SDK APIError has a `status` property
    if (e.status === 529) return true;
    // Also check error.error.type for overloaded_error
    if (e.type === 'overloaded_error') return true;
    const inner = e.error as Record<string, unknown> | undefined;
    if (inner?.type === 'overloaded_error') return true;
  }
  return false;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async chat(messages: LLMMessage[], options: LLMOptions): Promise<LLMResponse> {
    const systemMessages = messages.filter(m => m.role === 'system');
    let nonSystemMessages = messages.filter(m => m.role !== 'system');

    const systemParam = this.buildSystemParam(systemMessages);

    // Apply conversation-turn cache markers when the caller requests it (FF_PROMPT_CACHING).
    // Anthropic allows a maximum of 4 cache_control blocks total (system + conversation).
    // Count how many the system prompt uses, then allocate the remainder to turn markers.
    if (options.cacheStrategy === 'system_and_3') {
      const systemCacheCount = Array.isArray(systemParam)
        ? systemParam.filter(b => b.cache_control).length
        : 0;
      const turnBudget = Math.max(0, 4 - systemCacheCount);
      nonSystemMessages = applyTurnCacheMarkers(nonSystemMessages, turnBudget);
    }
    const anthropicMessages = nonSystemMessages.map(m => this.toAnthropicMessage(m));

    const tools = options.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([key, param]) => {
            const schema: Record<string, unknown> = {
              type: param.type,
              description: param.description,
            };
            // Anthropic requires `items` for array parameters; without it the
            // LLM serializes the array as a JSON string instead of a proper array.
            if (param.type === 'array') {
              schema.items = param.items
                ? { type: param.items.type }
                : { type: 'string' };
            }
            return [key, schema];
          })
        ),
        required: Object.entries(t.parameters)
          .filter(([, param]) => param.required)
          .map(([key]) => key),
      },
    }));

    const requestParams = {
      model: options.model || 'claude-sonnet-4-5-20250929',
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      system: systemParam || undefined,
      messages: anthropicMessages,
      tools: tools?.length ? tools : undefined,
      stop_sequences: options.stopSequences,
    };

    const response = await this.callWithRetry(requestParams);
    return this.parseResponse(response);
  }

  /**
   * Call the Anthropic messages API with retry logic for 529 overloaded errors.
   * Retries up to MAX_RETRIES times with exponential backoff plus jitter
   * (e.g., ~1s, ~2s, ~4s) to avoid thundering herd on recovery.
   */
  private async callWithRetry(
    params: Parameters<Anthropic['messages']['create']>[0],
  ): Promise<Anthropic.Message> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.client.messages.create(params) as Anthropic.Message;
      } catch (err) {
        lastError = err;

        if (!isRetryableOverloadError(err) || attempt === MAX_RETRIES) {
          throw err;
        }

        const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * MAX_JITTER_MS);
        const delayMs = baseDelay + jitter;
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `Anthropic 529 overloaded — retry ${attempt + 1}/${MAX_RETRIES} ` +
          `in ${delayMs}ms: ${errMsg}`,
        );
        await sleep(delayMs);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError;
  }

  /**
   * Build the `system` parameter for the Anthropic API.
   *
   * If any system message has `cacheableBlocks`, convert them to
   * Anthropic's content block array format with `cache_control` markers.
   * This enables prompt caching — Anthropic caches everything up to and
   * including blocks marked with `cache_control: { type: "ephemeral" }`.
   *
   * Falls back to a plain string when no cacheable blocks are present
   * (backward compatible with existing callers).
   */
  private buildSystemParam(
    systemMessages: LLMMessage[],
  ): string | CacheableTextBlock[] | undefined {
    if (systemMessages.length === 0) return undefined;

    // Check if any system message has cacheable blocks
    const hasCacheableBlocks = systemMessages.some(
      m => m.cacheableBlocks && m.cacheableBlocks.length > 0,
    );

    if (!hasCacheableBlocks) {
      // Fallback: plain string concatenation (pre-caching behavior)
      const text = systemMessages.map(m => m.content).join('\n\n');
      return text || undefined;
    }

    // Build content block array with cache_control markers
    const blocks: CacheableTextBlock[] = [];

    for (const msg of systemMessages) {
      if (msg.cacheableBlocks && msg.cacheableBlocks.length > 0) {
        for (const block of msg.cacheableBlocks) {
          const textBlock: CacheableTextBlock = {
            type: 'text',
            text: block.text,
          };
          if (block.cacheControl) {
            textBlock.cache_control = { type: block.cacheControl.type };
          }
          blocks.push(textBlock);
        }
      } else if (msg.content) {
        // System message without blocks — include as plain text block
        blocks.push({ type: 'text', text: msg.content });
      }
    }

    if (blocks.length === 0) return undefined;

    this.logCacheBlockSummary(blocks);
    return blocks;
  }

  /**
   * Log a summary of cache-controlled blocks for observability.
   */
  private logCacheBlockSummary(blocks: CacheableTextBlock[]): void {
    const cached = blocks.filter(b => b.cache_control);
    const uncached = blocks.filter(b => !b.cache_control);
    const cachedChars = cached.reduce((sum, b) => sum + b.text.length, 0);
    const uncachedChars = uncached.reduce((sum, b) => sum + b.text.length, 0);

    logger.info(
      `System prompt: ${blocks.length} blocks ` +
      `(${cached.length} cached ~${Math.round(cachedChars / 4)} tokens, ` +
      `${uncached.length} uncached ~${Math.round(uncachedChars / 4)} tokens)`,
    );
  }

  private toAnthropicMessage(msg: LLMMessage): Anthropic.MessageParam {
    if (msg.role === 'tool') {
      const block: CacheableToolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId || '',
        content: msg.content,
      };
      if (msg.cacheControl) {
        block.cache_control = { type: msg.cacheControl.type };
      }
      // Cast through unknown: SDK type omits cache_control but the API accepts it
      return {
        role: 'user',
        content: [block as unknown as Anthropic.ToolResultBlockParam],
      };
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      if (msg.cacheControl) {
        // Add cache_control to the last content block (marks end of this turn).
        // Double-cast through unknown: SDK union type (which includes
        // RedactedThinkingBlockParam without an index signature) cannot be
        // directly widened to Record<string, unknown>.
        const last = content[content.length - 1];
        if (last) {
          (last as unknown as Record<string, unknown>)['cache_control'] = {
            type: msg.cacheControl.type,
          };
        }
      }
      return { role: 'assistant', content };
    }

    // Plain user or assistant message
    if (msg.cacheControl) {
      return {
        role: msg.role as 'user' | 'assistant',
        content: [
          {
            type: 'text',
            text: msg.content,
            cache_control: { type: msg.cacheControl.type },
          } as CacheableTextBlock,
        ],
      };
    }

    return {
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    };
  }

  private parseResponse(response: Anthropic.Message): LLMResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    // Extract cache metrics from response usage.
    // The Anthropic SDK Usage type may not include cache fields in its
    // type definition, but the API returns them when prompt caching is
    // active. Cast through `unknown` to safely access these properties.
    const usage = response.usage as unknown as Record<string, number>;
    const cacheCreation = usage.cache_creation_input_tokens ?? undefined;
    const cacheRead = usage.cache_read_input_tokens ?? undefined;

    // Log cache performance for observability
    if (cacheCreation !== undefined || cacheRead !== undefined) {
      const total = response.usage.input_tokens;
      const hitRate = cacheRead && total > 0
        ? Math.round((cacheRead / total) * 100)
        : 0;
      logger.info(
        `Cache metrics: ${cacheRead ?? 0} read, ${cacheCreation ?? 0} created, ` +
        `${total} total input tokens (${hitRate}% hit rate)`,
      );
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens: cacheCreation,
        cacheReadInputTokens: cacheRead,
      },
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
    };
  }
}
