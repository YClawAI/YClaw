import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig, ExecutionRecord, ToolDefinition } from '../config/schema.js';
import type { LLMResponse } from '../llm/types.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockChat = vi.fn();
vi.mock('../llm/provider.js', () => ({
  createProvider: () => ({ chat: mockChat }),
}));

vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../config/loader.js', () => ({
  loadPromptWithMetadata: (name: string) => ({
    content: `Mock prompt: ${name}`,
    path: `/prompts/${name}`,
    tokens: 100,
  }),
}));

vi.mock('../actions/schemas.js', () => ({
  ACTION_SCHEMAS: {},
  ACTION_DEFAULTS: {},
}));

vi.mock('../actions/slack.js', () => ({
  AGENT_IDENTITIES: {},
  SLACK_CHANNELS: {},
}));

// Import after mocks
import { AgentExecutor } from './executor.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: 'test_agent',
    department: 'development',
    description: 'Test agent',
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0.2,
      maxTokens: 4096,
    },
    system_prompts: ['test-prompt.md'],
    triggers: [],
    actions: [],
    data_sources: [],
    event_subscriptions: [],
    event_publications: [],
    review_bypass: [],
    ...overrides,
  };
}

function makeLLMResponse(overrides?: Partial<LLMResponse>): LLMResponse {
  return {
    content: 'Done.',
    toolCalls: [],
    usage: {
      inputTokens: 5000,
      outputTokens: 200,
    },
    stopReason: 'end_turn',
    ...overrides,
  };
}

function makeAuditLog() {
  return {
    recordExecution: vi.fn(),
    recordSelfModification: vi.fn(),
    recordReview: vi.fn(),
    getAgentHistory: vi.fn().mockResolvedValue([]),
    getAgentStats: vi.fn().mockResolvedValue({
      totalExecutions: 0,
      successRate: 0,
      failureRate: 0,
      averageDurationMs: null,
      mostCommonFlag: undefined,
      bestPerformingContentType: undefined,
      worstPerformingContentType: undefined,
      totalSelfModifications: 0,
      totalReviews: 0,
      reviewApprovalRate: 0,
      cache: {
        executionsWithCache: 0,
        averageCacheHitRate: 0,
        averageSavingsRate: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
      },
    }),
  };
}

function makeSelfModTools() {
  return { execute: vi.fn() };
}

function makeSafetyGate() {
  return {
    classify: vi.fn().mockReturnValue('auto_approved'),
    evaluate: vi.fn().mockResolvedValue(true),
  };
}

function makeReviewGate() {
  return { review: vi.fn() };
}

function makeOutboundSafety() {
  return { check: vi.fn().mockResolvedValue({ safe: true }) };
}

function makeActionRegistry() {
  return { execute: vi.fn().mockResolvedValue({ success: true }) };
}

function makeEventBus() {
  return { publish: vi.fn() };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AgentExecutor — cache metrics integration', () => {
  let executor: AgentExecutor;
  let auditLog: ReturnType<typeof makeAuditLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    auditLog = makeAuditLog();
    executor = new AgentExecutor(
      auditLog as any,
      makeSelfModTools() as any,
      makeSafetyGate() as any,
      makeReviewGate() as any,
      makeOutboundSafety() as any,
      makeActionRegistry() as any,
      makeEventBus() as any,
    );
  });

  it('should include cache metrics in tokenUsage when caching is active', async () => {
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      usage: {
        inputTokens: 10000,
        outputTokens: 500,
        cacheCreationInputTokens: 8000,
        cacheReadInputTokens: 0,
      },
    }));

    const config = makeConfig();
    const record = await executor.execute(config, 'test task', 'manual');

    expect(record.status).toBe('completed');
    expect(record.tokenUsage).toBeDefined();
    expect(record.tokenUsage!.input).toBe(10000);
    expect(record.tokenUsage!.output).toBe(500);
    expect(record.tokenUsage!.cacheCreationInputTokens).toBe(8000);
    expect(record.tokenUsage!.cacheReadInputTokens).toBeUndefined();
    // First request = cache miss, so hit rate is 0
    expect(record.tokenUsage!.cacheHitRate).toBe(0);
    expect(record.tokenUsage!.estimatedSavingsRate).toBe(0);
  });

  it('should report cache hit rate on subsequent rounds', async () => {
    // Round 1: cache creation (tool call triggers round 2)
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      toolCalls: [{
        id: 'call_1',
        name: 'self_read_config',
        arguments: {},
      }],
      usage: {
        inputTokens: 10000,
        outputTokens: 200,
        cacheCreationInputTokens: 8000,
        cacheReadInputTokens: 0,
      },
    }));

    // Round 2: cache hit (no more tool calls)
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      usage: {
        inputTokens: 12000,
        outputTokens: 300,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 8000,
      },
    }));

    const config = makeConfig();
    const record = await executor.execute(config, 'test task', 'manual');

    expect(record.status).toBe('completed');
    expect(record.tokenUsage).toBeDefined();

    // Totals: input=22000, output=500, cacheCreation=8000, cacheRead=8000
    expect(record.tokenUsage!.input).toBe(22000);
    expect(record.tokenUsage!.output).toBe(500);
    expect(record.tokenUsage!.cacheCreationInputTokens).toBe(8000);
    expect(record.tokenUsage!.cacheReadInputTokens).toBe(8000);

    // Hit rate: 8000 / (8000 + (22000 - 8000)) = 8000 / 22000 ≈ 0.364
    expect(record.tokenUsage!.cacheHitRate).toBeGreaterThan(0);
    expect(record.tokenUsage!.cacheHitRate).toBeLessThan(1);

    // Savings: 8000 * 0.9 / 22000 ≈ 0.327
    expect(record.tokenUsage!.estimatedSavingsRate).toBeGreaterThan(0);
    expect(record.tokenUsage!.estimatedSavingsRate).toBeLessThan(1);
  });

  it('should omit cache fields when no caching occurred', async () => {
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      usage: {
        inputTokens: 5000,
        outputTokens: 200,
      },
    }));

    const config = makeConfig();
    const record = await executor.execute(config, 'test task', 'manual');

    expect(record.status).toBe('completed');
    expect(record.tokenUsage).toBeDefined();
    expect(record.tokenUsage!.input).toBe(5000);
    expect(record.tokenUsage!.output).toBe(200);
    // No cache activity — fields should be undefined
    expect(record.tokenUsage!.cacheCreationInputTokens).toBeUndefined();
    expect(record.tokenUsage!.cacheReadInputTokens).toBeUndefined();
    expect(record.tokenUsage!.cacheHitRate).toBeUndefined();
    expect(record.tokenUsage!.estimatedSavingsRate).toBeUndefined();
  });

  it('should pass cache metrics to audit log', async () => {
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      usage: {
        inputTokens: 10000,
        outputTokens: 500,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 8000,
      },
    }));

    const config = makeConfig();
    await executor.execute(config, 'test task', 'manual');

    expect(auditLog.recordExecution).toHaveBeenCalledOnce();
    const recorded = auditLog.recordExecution.mock.calls[0][0] as ExecutionRecord;
    expect(recorded.tokenUsage!.cacheReadInputTokens).toBe(8000);
    expect(recorded.tokenUsage!.cacheHitRate).toBeGreaterThan(0);
    expect(recorded.tokenUsage!.estimatedSavingsRate).toBeGreaterThan(0);
  });

  it('should include cache in checkpoint internalState', async () => {
    const mockSaveCheckpoint = vi.fn();
    const mockMemoryManager = {
      getContext: vi.fn().mockResolvedValue([]),
      storeResource: vi.fn().mockResolvedValue({ id: 'res-1' }),
      saveCheckpoint: mockSaveCheckpoint,
      flushWorkingMemory: vi.fn().mockResolvedValue({ flushed: 0, stored: 0, rejected: 0 }),
    };

    const executorWithMemory = new AgentExecutor(
      auditLog as any,
      makeSelfModTools() as any,
      makeSafetyGate() as any,
      makeReviewGate() as any,
      makeOutboundSafety() as any,
      makeActionRegistry() as any,
      makeEventBus() as any,
      undefined,
      undefined,
      mockMemoryManager as any,
    );

    // Round 1: tool call with cache data
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      toolCalls: [{
        id: 'call_1',
        name: 'self_read_config',
        arguments: {},
      }],
      usage: {
        inputTokens: 10000,
        outputTokens: 200,
        cacheCreationInputTokens: 8000,
        cacheReadInputTokens: 0,
      },
    }));

    // Round 2: done
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      usage: {
        inputTokens: 12000,
        outputTokens: 300,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 8000,
      },
    }));

    const config = makeConfig();
    await executorWithMemory.execute(config, 'test task', 'manual');

    // Checkpoint should have been saved for round 1 (tool call round)
    expect(mockSaveCheckpoint).toHaveBeenCalled();
    const checkpointData = mockSaveCheckpoint.mock.calls[0][3];
    expect(checkpointData.internalState.cache).toBeDefined();
    expect(checkpointData.internalState.cache.totalCacheCreationTokens).toBe(8000);
  });

  it('should handle 100% cache hit rate correctly', async () => {
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      usage: {
        inputTokens: 10000,
        outputTokens: 500,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 10000,
      },
    }));

    const config = makeConfig();
    const record = await executor.execute(config, 'test task', 'manual');

    expect(record.tokenUsage!.cacheHitRate).toBe(1);
    expect(record.tokenUsage!.estimatedSavingsRate).toBe(0.9);
  });

  it('should accumulate cache metrics across many rounds', async () => {
    // 5 rounds of tool calls + 1 final round
    for (let i = 0; i < 5; i++) {
      mockChat.mockResolvedValueOnce(makeLLMResponse({
        toolCalls: [{
          id: `call_${i}`,
          name: 'self_read_config',
          arguments: {},
        }],
        usage: {
          inputTokens: 1000,
          outputTokens: 100,
          cacheCreationInputTokens: i === 0 ? 800 : 0,
          cacheReadInputTokens: i > 0 ? 800 : 0,
        },
      }));
    }
    // Final round — no tool calls
    mockChat.mockResolvedValueOnce(makeLLMResponse({
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 800,
      },
    }));

    const config = makeConfig();
    const record = await executor.execute(config, 'test task', 'manual');

    // 6 rounds × 1000 = 6000 input, 6 × 100 = 600 output
    expect(record.tokenUsage!.input).toBe(6000);
    expect(record.tokenUsage!.output).toBe(600);
    // 1 creation round (800) + 5 read rounds (800 each = 4000)
    expect(record.tokenUsage!.cacheCreationInputTokens).toBe(800);
    expect(record.tokenUsage!.cacheReadInputTokens).toBe(4000);
    // Hit rate and savings should reflect the accumulated totals
    expect(record.tokenUsage!.cacheHitRate).toBeGreaterThan(0.5);
    expect(record.tokenUsage!.estimatedSavingsRate).toBeGreaterThan(0.3);
  });
});
