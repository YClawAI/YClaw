import { describe, it, expect } from 'vitest';
import {
  buildCacheableBlocks,
  classifyPromptLayer,
  estimateTokens,
  mergeBlocksToSystemContent,
} from './context-cache.js';

describe('classifyPromptLayer', () => {
  // classifyPromptLayer is still exported and functional, even though
  // buildCacheableBlocks no longer calls it (Layer 1+2 merged).
  // Keep tests to guard the classification logic if it's re-used elsewhere.

  it('should classify mission_statement.md as Layer 1', () => {
    expect(classifyPromptLayer('mission_statement.md')).toBe(1);
  });

  it('should classify chain-of-command.md as Layer 1', () => {
    expect(classifyPromptLayer('chain-of-command.md')).toBe(1);
  });

  it('should classify protocol-overview.md as Layer 1', () => {
    expect(classifyPromptLayer('protocol-overview.md')).toBe(1);
  });

  it('should classify engineering-standards.md as Layer 2', () => {
    expect(classifyPromptLayer('engineering-standards.md')).toBe(2);
  });

  it('should classify chain-of-command.md as Layer 2', () => {
    expect(classifyPromptLayer('chain-of-command.md')).toBe(2);
  });

  it('should classify unknown prompts as Layer 2', () => {
    expect(classifyPromptLayer('custom-prompt.md')).toBe(2);
  });
});

describe('estimateTokens', () => {
  it('should estimate ~1 token per 4 characters', () => {
    const text = 'a'.repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });

  it('should round up for non-divisible lengths', () => {
    const text = 'a'.repeat(401);
    expect(estimateTokens(text)).toBe(101);
  });

  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('buildCacheableBlocks', () => {
  const manifestYaml = '_self:\n  name: builder\n  department: development';

  const promptContents = new Map([
    ['mission_statement.md', '# Mission\nYour attention is valuable.'],
    ['chain-of-command.md', '# Chain of Command\nTroy → Elon → Strategist'],
    ['engineering-standards.md', '# Engineering Standards\nNo speculative features.'],
    ['chain-of-command.md', '# Chain of Command\nFollow these sequences.'],
  ]);

  const memoryContent = '## Organizational Knowledge\norg.identity: YClaw';
  const dynamicContent = '## Auto-Recall\nRecent execution context here.';

  it('should produce 3 blocks for full context (Layer 1+2 merged)', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      dynamicContent,
    );
    expect(blocks).toHaveLength(3);
  });

  it('should merge Layer 1+2 into a single cached block', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      dynamicContent,
    );
    const static12 = blocks.find(b => b.label === 'layer1+2-static');
    expect(static12).toBeDefined();
    expect(static12!.cacheControl).toEqual({ type: 'ephemeral' });
    // Should contain both global (Layer 1) and department (Layer 2) prompts
    expect(static12!.text).toContain('Mission');
    expect(static12!.text).toContain('Chain of Command');
    expect(static12!.text).toContain('Engineering Standards');
    expect(static12!.text).toContain('Builder Workflow');
    // Should contain the agent manifest
    expect(static12!.text).toContain('Agent Self-Awareness Manifest');
  });

  it('should mark Layer 3 with cache_control ephemeral', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      dynamicContent,
    );
    const layer3 = blocks.find(b => b.label === 'layer3-memory');
    expect(layer3).toBeDefined();
    expect(layer3!.cacheControl).toEqual({ type: 'ephemeral' });
    expect(layer3!.text).toContain('Organizational Knowledge');
  });

  it('should NOT mark Layer 4 with cache_control', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      dynamicContent,
    );
    const layer4 = blocks.find(b => b.label === 'layer4-dynamic');
    expect(layer4).toBeDefined();
    expect(layer4!.cacheControl).toBeUndefined();
    expect(layer4!.text).toContain('Auto-Recall');
  });

  it('should include estimatedTokens on all blocks', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      dynamicContent,
    );
    for (const block of blocks) {
      expect(block.estimatedTokens).toBeDefined();
      expect(block.estimatedTokens).toBeGreaterThan(0);
    }
  });

  it('should omit Layer 3 when memoryContent is empty', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      '',
      dynamicContent,
    );
    const layer3 = blocks.find(b => b.label === 'layer3-memory');
    expect(layer3).toBeUndefined();
    expect(blocks).toHaveLength(2);
  });

  it('should omit Layer 3 when memoryContent is undefined', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      undefined,
      dynamicContent,
    );
    const layer3 = blocks.find(b => b.label === 'layer3-memory');
    expect(layer3).toBeUndefined();
  });

  it('should omit Layer 4 when dynamicContent is empty', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      '',
    );
    const layer4 = blocks.find(b => b.label === 'layer4-dynamic');
    expect(layer4).toBeUndefined();
    expect(blocks).toHaveLength(2);
  });

  it('should omit Layer 4 when dynamicContent is undefined', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      undefined,
    );
    const layer4 = blocks.find(b => b.label === 'layer4-dynamic');
    expect(layer4).toBeUndefined();
  });

  it('should handle empty promptContents', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      new Map(),
      memoryContent,
      dynamicContent,
    );
    // Layer 1+2 should still exist with manifest only
    const static12 = blocks.find(b => b.label === 'layer1+2-static');
    expect(static12).toBeDefined();
    expect(static12!.text).toContain('Agent Self-Awareness Manifest');
  });

  it('should handle empty manifestYaml', () => {
    const blocks = buildCacheableBlocks(
      '',
      promptContents,
      memoryContent,
      dynamicContent,
    );
    // Layer 1+2 should still exist with prompts only
    const static12 = blocks.find(b => b.label === 'layer1+2-static');
    expect(static12).toBeDefined();
    expect(static12!.text).not.toContain('Agent Self-Awareness Manifest');
    expect(static12!.text).toContain('mission_statement.md');
  });

  it('should have at most 2 cached blocks (staying within Anthropic 4-block limit)', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      dynamicContent,
    );
    const cachedBlocks = blocks.filter(b => b.cacheControl);
    // Layer 1+2 (cached) + Layer 3 (cached) = 2 system cached blocks
    // Leaves 2 slots for conversation turn caching within Anthropic's 4-block limit
    expect(cachedBlocks.length).toBeLessThanOrEqual(2);
  });

  it('should include all prompts in the merged static block', () => {
    const blocks = buildCacheableBlocks(
      manifestYaml,
      promptContents,
      memoryContent,
      dynamicContent,
    );
    const static12 = blocks.find(b => b.label === 'layer1+2-static');

    // All prompt files should be in the single merged block
    expect(static12!.text).toContain('mission_statement.md');
    expect(static12!.text).toContain('chain-of-command.md');
    expect(static12!.text).toContain('engineering-standards.md');
    expect(static12!.text).toContain('chain-of-command.md');
  });
});

describe('mergeBlocksToSystemContent', () => {
  it('should merge blocks into a single content string', () => {
    const blocks = [
      { text: 'Block 1', cacheControl: { type: 'ephemeral' as const }, label: 'l1' },
      { text: 'Block 2', cacheControl: { type: 'ephemeral' as const }, label: 'l2' },
      { text: 'Block 3', label: 'l3' },
    ];
    const result = mergeBlocksToSystemContent(blocks);
    expect(result.content).toBe('Block 1\n\nBlock 2\n\nBlock 3');
    expect(result.cacheableBlocks).toBe(blocks);
  });

  it('should return empty content for empty blocks', () => {
    const result = mergeBlocksToSystemContent([]);
    expect(result.content).toBe('');
    expect(result.cacheableBlocks).toHaveLength(0);
  });
});
