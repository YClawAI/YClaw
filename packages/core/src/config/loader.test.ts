import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vol } from 'memfs';

// Mock node:fs with memfs for isolated file system testing
vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return {
    readFileSync: memfs.vol.readFileSync.bind(memfs.vol),
    readdirSync: memfs.vol.readdirSync.bind(memfs.vol),
    existsSync: memfs.vol.existsSync.bind(memfs.vol),
    statSync: memfs.vol.statSync.bind(memfs.vol),
  };
});

// Must import after mocking
import {
  loadPrompt,
  loadPromptWithMetadata,
  getPromptCacheStats,
  clearPromptCache,
  getPromptsDir,
} from './loader.js';

describe('Prompt cache', () => {
  beforeEach(() => {
    clearPromptCache();
    vol.reset();
  });

  it('should return content from file on first call', () => {
    const promptsDir = getPromptsDir();
    vol.mkdirSync(promptsDir, { recursive: true });
    vol.writeFileSync(
      `${promptsDir}/test-prompt.md`,
      '# Test Prompt\nContent here.',
    );

    const content = loadPrompt('test-prompt.md');
    expect(content).toBe('# Test Prompt\nContent here.');

    const stats = getPromptCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
    expect(stats.size).toBe(1);
  });

  it('should return cached content on second call', () => {
    const promptsDir = getPromptsDir();
    vol.mkdirSync(promptsDir, { recursive: true });
    vol.writeFileSync(
      `${promptsDir}/cached.md`,
      'Cached content',
    );

    loadPrompt('cached.md');
    const content = loadPrompt('cached.md');

    expect(content).toBe('Cached content');
    const stats = getPromptCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.hitRate).toBeGreaterThan(0);
  });

  it('should invalidate cache when file mtime changes', () => {
    const promptsDir = getPromptsDir();
    vol.mkdirSync(promptsDir, { recursive: true });
    vol.writeFileSync(
      `${promptsDir}/changing.md`,
      'Version 1',
    );

    const v1 = loadPrompt('changing.md');
    expect(v1).toBe('Version 1');

    // Simulate file modification by writing new content
    // memfs updates mtime on write
    vol.writeFileSync(
      `${promptsDir}/changing.md`,
      'Version 2',
    );

    const v2 = loadPrompt('changing.md');
    expect(v2).toBe('Version 2');

    const stats = getPromptCacheStats();
    expect(stats.misses).toBe(2);
  });

  it('should clear cache and reset stats', () => {
    const promptsDir = getPromptsDir();
    vol.mkdirSync(promptsDir, { recursive: true });
    vol.writeFileSync(`${promptsDir}/a.md`, 'A');
    vol.writeFileSync(`${promptsDir}/b.md`, 'B');

    loadPrompt('a.md');
    loadPrompt('b.md');
    loadPrompt('a.md');

    expect(getPromptCacheStats().size).toBe(2);
    expect(getPromptCacheStats().hits).toBe(1);

    clearPromptCache();

    expect(getPromptCacheStats().size).toBe(0);
    expect(getPromptCacheStats().hits).toBe(0);
    expect(getPromptCacheStats().misses).toBe(0);
  });

  it('should throw on path traversal', () => {
    expect(() => loadPrompt('../../../etc/passwd')).toThrow(
      'Path traversal detected',
    );
  });

  it('should throw on missing file', () => {
    expect(() => loadPrompt('nonexistent.md')).toThrow(
      'Prompt not found',
    );
  });

  it('should calculate hit rate correctly', () => {
    const promptsDir = getPromptsDir();
    vol.mkdirSync(promptsDir, { recursive: true });
    vol.writeFileSync(`${promptsDir}/rate.md`, 'Rate test');

    // 1 miss, 4 hits = 80% hit rate
    loadPrompt('rate.md');
    loadPrompt('rate.md');
    loadPrompt('rate.md');
    loadPrompt('rate.md');
    loadPrompt('rate.md');

    const stats = getPromptCacheStats();
    expect(stats.hits).toBe(4);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.8);
  });
});

describe('loadPromptWithMetadata', () => {
  beforeEach(() => {
    clearPromptCache();
    vol.reset();
  });

  it('should return content, path, and token estimate', () => {
    const promptsDir = getPromptsDir();
    vol.mkdirSync(promptsDir, { recursive: true });
    // 40 chars = ~10 tokens
    vol.writeFileSync(
      `${promptsDir}/meta.md`,
      'A'.repeat(40),
    );

    const result = loadPromptWithMetadata('meta.md');
    expect(result.content).toBe('A'.repeat(40));
    expect(result.path).toContain('meta.md');
    expect(result.tokens).toBe(10);
  });

  it('should use cache on repeated calls', () => {
    const promptsDir = getPromptsDir();
    vol.mkdirSync(promptsDir, { recursive: true });
    vol.writeFileSync(`${promptsDir}/meta2.md`, 'Metadata test');

    loadPromptWithMetadata('meta2.md');
    loadPromptWithMetadata('meta2.md');

    const stats = getPromptCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});
