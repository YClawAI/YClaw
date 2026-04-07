import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HumanizationGate } from '../src/review/humanizer.js';

// Mock the LLM provider
vi.mock('../src/llm/provider.js', () => ({
  createProvider: vi.fn(() => ({
    chat: vi.fn(),
  })),
}));

// Mock the config loader
vi.mock('../src/config/loader.js', () => ({
  loadPrompt: vi.fn((name: string) => {
    if (name === 'brand-voice.md') return 'Mock brand voice guide';
    if (name === 'humanizer-guide.md') return 'Mock humanizer guide with 24 patterns';
    throw new Error(`Prompt not found: ${name}`);
  }),
}));

import { createProvider } from '../src/llm/provider.js';
import { loadPrompt } from '../src/config/loader.js';

function mockLLMResponse(responseJson: Record<string, unknown>) {
  const mockChat = vi.fn().mockResolvedValue({
    content: JSON.stringify(responseJson),
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);
  return mockChat;
}

describe('HumanizationGate', () => {
  let gate: HumanizationGate;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Explicitly restore loadPrompt mock implementation (vi.clearAllMocks does NOT reset mockImplementation)
    vi.mocked(loadPrompt).mockImplementation((name: string) => {
      if (name === 'brand-voice.md') return 'Mock brand voice guide';
      if (name === 'humanizer-guide.md') return 'Mock humanizer guide with 24 patterns';
      throw new Error(`Prompt not found: ${name}`);
    });
    gate = new HumanizationGate();
    await gate.initialize();
  });

  // ─── Fail-open behavior (most critical — opposite of ReviewGate) ──────

  describe('fail-open: passes content through on error', () => {
    it('returns original content when LLM call fails', async () => {
      const mockChat = vi.fn().mockRejectedValue(new Error('API timeout'));
      vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);

      const result = await gate.humanize({
        content: 'Original content here',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      expect(result.changed).toBe(false);
      expect(result.humanized).toBe('Original content here');
      expect(result.original).toBe('Original content here');
      expect(result.patternsFound).toEqual([]);
    });

    it('returns original content when humanizer-guide.md is missing', async () => {
      vi.mocked(loadPrompt).mockImplementation((name: string) => {
        if (name === 'brand-voice.md') return 'Mock brand voice guide';
        throw new Error(`Prompt not found: ${name}`);
      });

      const gateNoGuide = new HumanizationGate();
      await gateNoGuide.initialize();

      const result = await gateNoGuide.humanize({
        content: 'Content without guide',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      expect(result.changed).toBe(false);
      expect(result.humanized).toBe('Content without guide');
      // Should NOT call LLM at all
      expect(createProvider).not.toHaveBeenCalled();
    });

    it('returns original content when LLM returns unparseable response', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: 'Not JSON at all, just random text',
        model: 'test',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      vi.mocked(createProvider).mockReturnValue({ chat: mockChat } as any);

      const result = await gate.humanize({
        content: 'Test content',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      // Unparseable response: patterns is empty, so changed = false
      expect(result.changed).toBe(false);
      expect(result.humanized).toBe('Test content');
    });
  });

  // ─── Clean content pass-through ──────────────────────────────────────

  describe('clean content', () => {
    it('passes through content with no AI patterns', async () => {
      mockLLMResponse({
        humanized: 'Your attention is already valuable. YClaw makes it visible.',
        patterns: [],
      });

      const result = await gate.humanize({
        content: 'Your attention is already valuable. YClaw makes it visible.',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      expect(result.changed).toBe(false);
      expect(result.patternsFound).toEqual([]);
    });
  });

  // ─── Humanization ────────────────────────────────────────────────────

  describe('humanization', () => {
    it('rewrites content with AI patterns', async () => {
      mockLLMResponse({
        humanized: 'YClaw is an attention rewards protocol on Solana.',
        patterns: ['copula_avoidance', 'significance_inflation'],
      });

      const result = await gate.humanize({
        content: 'It is important to note that YClaw serves as an attention rewards protocol on Solana.',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      expect(result.changed).toBe(true);
      expect(result.humanized).toBe('YClaw is an attention rewards protocol on Solana.');
      expect(result.patternsFound).toContain('copula_avoidance');
      expect(result.patternsFound).toContain('significance_inflation');
    });

    it('preserves original in result for auditing', async () => {
      const originalContent = 'Additionally, it serves as a mechanism for value creation.';
      mockLLMResponse({
        humanized: 'It creates value.',
        patterns: ['additive_transition', 'copula_avoidance'],
      });

      const result = await gate.humanize({
        content: originalContent,
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      expect(result.original).toBe(originalContent);
      expect(result.humanized).not.toBe(originalContent);
    });

    it('includes humanizedAt timestamp', async () => {
      mockLLMResponse({
        humanized: 'Clean content.',
        patterns: [],
      });

      const before = new Date().toISOString();
      const result = await gate.humanize({
        content: 'Clean content.',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });
      const after = new Date().toISOString();

      expect(result.humanizedAt).toBeDefined();
      expect(result.humanizedAt >= before).toBe(true);
      expect(result.humanizedAt <= after).toBe(true);
    });
  });

  // ─── Model configuration ─────────────────────────────────────────────

  describe('model configuration', () => {
    it('uses Haiku model at temperature 0.3', async () => {
      const mockChat = mockLLMResponse({
        humanized: 'test',
        patterns: [],
      });

      await gate.humanize({
        content: 'test',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      expect(createProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          temperature: 0.3,
        }),
      );

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ temperature: 0.3 }),
      );
    });

    it('includes brand voice and humanizer guide in system prompt', async () => {
      const mockChat = mockLLMResponse({
        humanized: 'test',
        patterns: [],
      });

      await gate.humanize({
        content: 'test',
        agent: 'ember',
        contentType: 'tweet',
        targetPlatform: 'x',
      });

      const messages = mockChat.mock.calls[0][0];
      const systemMessage = messages[0].content;
      expect(systemMessage).toContain('Brand Voice Guide');
      expect(systemMessage).toContain('AI Writing Patterns');
    });
  });
});
