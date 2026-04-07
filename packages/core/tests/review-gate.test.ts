import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReviewGate } from '../src/review/reviewer.js';
import type { ReviewRequest } from '../src/config/schema.js';

// Mock the LLM provider — we don't want real API calls in tests
vi.mock('../src/llm/provider.js', () => ({
  createProvider: vi.fn(() => ({
    chat: vi.fn(),
  })),
}));

// Mock the config loader — we don't want to read real files
vi.mock('../src/config/loader.js', () => ({
  loadPrompt: vi.fn((name: string) => {
    if (name === 'brand-voice.md') return 'Mock brand voice guide';
    if (name === 'review-rules.md') return 'Mock review rules';
    throw new Error(`Prompt not found: ${name}`);
  }),
}));

import { createProvider } from '../src/llm/provider.js';

function makeRequest(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: 'req-1',
    agent: 'ember',
    contentType: 'tweet',
    content: 'Your attention is already valuable. YClaw makes it visible.',
    targetPlatform: 'x',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function mockLLMResponse(responseJson: Record<string, unknown>) {
  const mockChat = vi.fn().mockResolvedValue({
    content: JSON.stringify(responseJson),
    model: 'claude-sonnet-4-5-20250929',
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);
  return mockChat;
}

describe('ReviewGate', () => {
  let gate: ReviewGate;
  let slackMessages: { message: string; channel?: string }[];

  beforeEach(async () => {
    vi.clearAllMocks();
    gate = new ReviewGate();
    slackMessages = [];
    gate.setSlackAlerter(async (message, channel) => {
      slackMessages.push({ message, channel });
    });
    await gate.initialize();
  });

  // ─── Fail-open behavior (default: retries then approves) ────────────────

  describe('fail-open: approves content after retries exhausted', () => {
    beforeEach(() => {
      // Speed up retries — no real delays in tests
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('approves content when LLM call fails (fail-open default)', async () => {
      const mockChat = vi.fn().mockRejectedValue(new Error('API timeout'));
      vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);

      const reviewPromise = gate.review(makeRequest());

      // Advance through all retry delays (2s + 4s + 8s)
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);

      const result = await reviewPromise;

      expect(result.approved).toBe(true);
      expect(result.severity).toBe('low');
      expect(result.flags).toContain('Review system error — content approved via fail-open policy');
      expect(mockChat).toHaveBeenCalledTimes(3); // 3 retry attempts
    });

    it('does not send Slack alert on fail-open approval', async () => {
      const mockChat = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);

      const reviewPromise = gate.review(makeRequest());

      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);

      await reviewPromise;

      expect(slackMessages).toHaveLength(0);
    });

    it('blocks content when LLM returns unparseable response', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: 'This is not JSON at all, just random text.',
        model: 'test',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);

      const result = await gate.review(makeRequest());

      expect(result.approved).toBe(false);
      expect(result.flags).toContain('Failed to parse review response');
    });

    it('blocks content when LLM returns empty response', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: '',
        model: 'test',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);

      const result = await gate.review(makeRequest());

      expect(result.approved).toBe(false);
    });
  });

  // ─── Approved content ─────────────────────────────────────────────────

  describe('approved content', () => {
    it('approves clean content', async () => {
      mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 95,
        rewrite: null,
      });

      const result = await gate.review(makeRequest());

      expect(result.approved).toBe(true);
      expect(result.flags).toEqual([]);
      expect(result.voiceScore).toBe(95);
    });

    it('does not send Slack alert for approved content', async () => {
      mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 90,
        rewrite: null,
      });

      await gate.review(makeRequest());

      expect(slackMessages).toHaveLength(0);
    });
  });

  // ─── Flagged content ──────────────────────────────────────────────────

  describe('flagged content', () => {
    it('flags content with exclamation marks', async () => {
      mockLLMResponse({
        approved: false,
        flags: ['Exclamation mark detected'],
        severity: 'medium',
        voiceScore: 60,
        rewrite: 'Your attention is already valuable. YClaw makes it visible.',
      });

      const result = await gate.review(
        makeRequest({ content: 'Your attention is valuable! Start earning now!' }),
      );

      expect(result.approved).toBe(false);
      expect(result.flags).toContain('Exclamation mark detected');
      expect(result.rewrite).toBeDefined();
    });

    it('sends Slack alert for flagged content', async () => {
      mockLLMResponse({
        approved: false,
        flags: ['Hype language detected'],
        severity: 'high',
        voiceScore: 20,
        rewrite: null,
      });

      await gate.review(makeRequest({ content: 'TO THE MOON' }));

      expect(slackMessages).toHaveLength(1);
      expect(slackMessages[0].channel).toBe('#yclaw-executive');
      expect(slackMessages[0].message).toContain('Content Flagged');
      expect(slackMessages[0].message).toContain('high');
    });

    it('includes agent name in Slack alert', async () => {
      mockLLMResponse({
        approved: false,
        flags: ['test'],
        severity: 'medium',
        voiceScore: 50,
        rewrite: null,
      });

      await gate.review(makeRequest({ agent: 'scout' }));

      expect(slackMessages[0].message).toContain('scout');
    });

    it('truncates long content in Slack alerts (500 char limit)', async () => {
      mockLLMResponse({
        approved: false,
        flags: ['Too long'],
        severity: 'low',
        voiceScore: 70,
        rewrite: null,
      });

      const longContent = 'A'.repeat(1000);
      await gate.review(makeRequest({ content: longContent }));

      expect(slackMessages[0].message).toContain('...');
      // The content in the alert should be truncated
      expect(slackMessages[0].message.length).toBeLessThan(longContent.length + 500);
    });
  });

  // ─── Review model configuration ───────────────────────────────────────

  describe('review model configuration', () => {
    it('uses temperature 0 for deterministic review', async () => {
      const mockChat = mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 90,
        rewrite: null,
      });

      await gate.review(makeRequest());

      // The chat call should include temperature 0
      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ temperature: 0.0 }),
      );
    });

    it('uses Sonnet model for reviews (Anthropic provider)', async () => {
      mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 90,
        rewrite: null,
      });

      await gate.review(makeRequest());

      // The provider creation should specify anthropic + sonnet
      expect(createProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
        }),
      );
    });
  });

  // ─── Content passed to LLM ────────────────────────────────────────────

  describe('content passed to LLM', () => {
    it('includes brand voice and review rules in system prompt', async () => {
      const mockChat = mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 90,
        rewrite: null,
      });

      await gate.review(makeRequest());

      const messages = mockChat.mock.calls[0][0];
      const systemMessage = messages[0].content;
      expect(systemMessage).toContain('Brand Voice Guide');
      expect(systemMessage).toContain('Review Rules');
    });

    it('includes content, agent, platform in user message', async () => {
      const mockChat = mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 90,
        rewrite: null,
      });

      await gate.review(
        makeRequest({
          agent: 'ember',
          content: 'Test content here',
          targetPlatform: 'telegram',
          contentType: 'announcement',
        }),
      );

      const messages = mockChat.mock.calls[0][0];
      const userMessage = messages[1].content;
      expect(userMessage).toContain('ember');
      expect(userMessage).toContain('Test content here');
      expect(userMessage).toContain('telegram');
      expect(userMessage).toContain('announcement');
    });
  });

  // ─── Resilience ───────────────────────────────────────────────────────

  describe('resilience', () => {
    it('continues review even if Slack alerter throws', async () => {
      gate.setSlackAlerter(async () => {
        throw new Error('Slack is down');
      });

      mockLLMResponse({
        approved: false,
        flags: ['test flag'],
        severity: 'high',
        voiceScore: 10,
        rewrite: null,
      });

      // Should not throw
      const result = await gate.review(makeRequest());
      expect(result.approved).toBe(false);
      expect(result.flags).toContain('test flag');
    });

    it('includes requestId in result', async () => {
      mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 90,
        rewrite: null,
      });

      const result = await gate.review(makeRequest({ id: 'my-custom-id' }));
      expect(result.requestId).toBe('my-custom-id');
    });

    it('includes reviewedAt timestamp in result', async () => {
      mockLLMResponse({
        approved: true,
        flags: [],
        severity: 'low',
        voiceScore: 90,
        rewrite: null,
      });

      const before = new Date().toISOString();
      const result = await gate.review(makeRequest());
      const after = new Date().toISOString();

      expect(result.reviewedAt).toBeDefined();
      expect(result.reviewedAt >= before).toBe(true);
      expect(result.reviewedAt <= after).toBe(true);
    });
  });
});
