import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalEnv = { ...process.env };

function makeFluxExecutor() {
  return import('../src/actions/flux.js').then(m => new m.FluxExecutor());
}

describe('FluxExecutor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ─── healthCheck ──────────────────────────────────────────────────────

  describe('healthCheck()', () => {
    it('returns false when XAI_API_KEY is missing', async () => {
      delete process.env.XAI_API_KEY;
      const executor = await makeFluxExecutor();
      expect(await executor.healthCheck()).toBe(false);
    });

    it('returns true when XAI_API_KEY is set', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();
      expect(await executor.healthCheck()).toBe(true);
    });
  });

  // ─── validation ───────────────────────────────────────────────────────

  describe('validation', () => {
    it('returns error when XAI_API_KEY is missing', async () => {
      delete process.env.XAI_API_KEY;
      const executor = await makeFluxExecutor();
      const result = await executor.execute('generate', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing XAI_API_KEY');
    });

    it('returns error when prompt is missing', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();
      const result = await executor.execute('generate', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('prompt');
    });

    it('returns error for unknown action', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();
      const result = await executor.execute('unknown', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown flux action');
    });
  });

  // ─── request format ───────────────────────────────────────────────────

  describe('request format', () => {
    it('sends correct URL, headers, and body to xAI API', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ url: 'https://xai.example.com/image.jpg', revised_prompt: 'a glowing orb in space' }],
        }),
      });

      await executor.execute('generate', { prompt: 'a glowing orb', aspectRatio: '16:9', resolution: '2k' });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.x.ai/v1/images/generations');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Authorization']).toBe('Bearer test-key');
      expect(opts.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts.body);
      expect(body.prompt).toBe('a glowing orb');
      expect(body.model).toBe('grok-imagine-image');
      expect(body.aspect_ratio).toBe('16:9');
      expect(body.resolution).toBe('2k');
      expect(body.response_format).toBe('url');
      expect(body.n).toBe(1);
    });

    it('uses custom model from params', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://xai.example.com/image.jpg' }] }),
      });

      await executor.execute('generate', { prompt: 'test', model: 'grok-2-image-1212' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('grok-2-image-1212');
    });

    it('clamps n to 1-10 range', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://xai.example.com/image.jpg' }] }),
      });

      await executor.execute('generate', { prompt: 'test', n: 15 });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).n).toBe(10);
    });

    it('defaults invalid aspect ratio to 1:1', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://xai.example.com/image.jpg' }] }),
      });

      await executor.execute('generate', { prompt: 'test', aspectRatio: 'invalid' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).aspect_ratio).toBe('1:1');
    });
  });

  // ─── success path ─────────────────────────────────────────────────────

  describe('success path', () => {
    it('returns image URL on success', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ url: 'https://xai.example.com/generated.jpg', revised_prompt: 'enhanced prompt' }],
        }),
      });

      const result = await executor.execute('generate', { prompt: 'a sunset' });
      expect(result.success).toBe(true);
      expect(result.data?.imageUrl).toBe('https://xai.example.com/generated.jpg');
      expect(result.data?.prompt).toBe('a sunset');
      expect(result.data?.revisedPrompt).toBe('enhanced prompt');
      expect(result.data?.aspectRatio).toBe('1:1');
      expect(result.data?.resolution).toBe('1k');
      expect(result.data?.imageCount).toBe(1);
      expect(result.data?.allImageUrls).toBeUndefined(); // single image, no array
    });

    it('includes allImageUrls when multiple images requested', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { url: 'https://xai.example.com/img1.jpg' },
            { url: 'https://xai.example.com/img2.jpg' },
            { url: 'https://xai.example.com/img3.jpg' },
          ],
        }),
      });

      const result = await executor.execute('generate', { prompt: 'test', n: 3 });
      expect(result.success).toBe(true);
      expect(result.data?.imageCount).toBe(3);
      expect(result.data?.allImageUrls).toEqual(['https://xai.example.com/img1.jpg', 'https://xai.example.com/img2.jpg', 'https://xai.example.com/img3.jpg']);
    });
  });

  // ─── error handling ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error when API returns non-OK status', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      const result = await executor.execute('generate', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('429');
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('returns error on network failure', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await executor.execute('generate', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('returns error when API returns empty data array', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const result = await executor.execute('generate', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('no images');
    });

    it('returns error when API returns empty URL', async () => {
      process.env.XAI_API_KEY = 'test-key';
      const executor = await makeFluxExecutor();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: '' }] }),
      });

      const result = await executor.execute('generate', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('no image URL');
    });
  });
});
