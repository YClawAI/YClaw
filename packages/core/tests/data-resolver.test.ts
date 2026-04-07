import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamic import to get fresh module per test group
async function loadResolver() {
  vi.resetModules();
  const mod = await import('../src/data/resolver.js');
  return mod;
}

describe('DataResolver', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('resolve()', () => {
    it('returns empty map for empty sources', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([]);
      expect(results.size).toBe(0);
    });

    it('returns error for unknown fetcher type', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        { type: 'unknown_type' as any, name: 'test', config: {} },
      ]);
      expect(results.size).toBe(1);
      const result = results.get('test');
      expect(result?.error).toContain('No fetcher for type');
      expect(result?.data).toBeNull();
    });

    it('tracks duration for each fetch', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      resolver.registerFetcher('test', async () => ({ ok: true }));
      const results = await resolver.resolve([
        { type: 'test' as any, name: 'fast', config: {} },
      ]);
      const result = results.get('fast');
      expect(result?.durationMs).toBeTypeOf('number');
      expect(result?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('catches fetcher errors and returns structured error', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      resolver.registerFetcher('failing', async () => {
        throw new Error('connection refused');
      });
      const results = await resolver.resolve([
        { type: 'failing' as any, name: 'broken', config: {} },
      ]);
      const result = results.get('broken');
      expect(result?.error).toContain('connection refused');
      expect(result?.data).toBeNull();
    });

    it('respects concurrency limit', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      let concurrent = 0;
      let maxConcurrent = 0;

      resolver.registerFetcher('slow', async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 50));
        concurrent--;
        return { ok: true };
      });

      const sources = Array.from({ length: 10 }, (_, i) => ({
        type: 'slow' as any,
        name: `source-${i}`,
        config: {},
      }));

      await resolver.resolve(sources);
      // MAX_CONCURRENCY is 5
      expect(maxConcurrent).toBeLessThanOrEqual(5);
    });
  });

  describe('solana_rpc fetcher', () => {
    it('returns error when rpcUrl has missing env vars', async () => {
      vi.stubEnv('HELIUS_API_KEY', '');
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'solana_rpc',
          name: 'test_balance',
          config: {
            rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}',
            method: 'getBalance',
            params: ['9dBhoRxJVzCv4rTGLaNm1EXaeNM3z3hCEnNbEvy2aaZH'],
          },
        },
      ]);
      const result = results.get('test_balance');
      expect(result?.error).toContain('Missing env vars');
      expect(result?.data).toBeNull();
    });

    it('returns error when method requires address but params empty', async () => {
      vi.stubEnv('HELIUS_API_KEY', 'test-key');
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'solana_rpc',
          name: 'empty_params',
          config: {
            rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}',
            method: 'getBalance',
            params: [],
          },
        },
      ]);
      const result = results.get('empty_params');
      expect(result?.error).toContain('requires an address parameter');
      expect(result?.data).toBeNull();
    });

    it('returns error when method is not specified', async () => {
      vi.stubEnv('HELIUS_API_KEY', 'test-key');
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'solana_rpc',
          name: 'no_method',
          config: {
            rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}',
            params: ['someAddress'],
          },
        },
      ]);
      const result = results.get('no_method');
      expect(result?.error).toContain('method not specified');
      expect(result?.data).toBeNull();
    });

    it('makes correct RPC call and returns result', async () => {
      vi.stubEnv('HELIUS_API_KEY', 'test-key-123');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { value: 1500000000 },
        }),
      });

      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'solana_rpc',
          name: 'balance',
          config: {
            rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}',
            method: 'getBalance',
            params: ['9dBhoRxJVzCv4rTGLaNm1EXaeNM3z3hCEnNbEvy2aaZH'],
          },
        },
      ]);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://mainnet.helius-rpc.com/?api-key=test-key-123');
      expect(JSON.parse(opts.body)).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: ['9dBhoRxJVzCv4rTGLaNm1EXaeNM3z3hCEnNbEvy2aaZH'],
      });

      const result = results.get('balance');
      expect(result?.error).toBeUndefined();
      expect(result?.data).toEqual({ value: 1500000000 });
    });

    it('handles Solana RPC error responses', async () => {
      vi.stubEnv('HELIUS_API_KEY', 'test-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32600, message: 'Invalid request' },
        }),
      });

      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'solana_rpc',
          name: 'rpc_error',
          config: {
            rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}',
            method: 'getBalance',
            params: ['someAddress'],
          },
        },
      ]);

      const result = results.get('rpc_error');
      expect(result?.error).toContain('Invalid request');
      expect(result?.data).toBeNull();
    });
  });

  describe('api fetcher', () => {
    it('returns error when URL has missing env vars', async () => {
      vi.stubEnv('ALCHEMY_API_KEY', '');
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'api',
          name: 'eth_balance',
          config: {
            url: 'https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
            method: 'POST',
            body: '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x123","latest"]}',
          },
        },
      ]);
      const result = results.get('eth_balance');
      expect(result?.error).toContain('Missing env vars');
      expect(result?.data).toBeNull();
    });

    it('returns error when URL is not configured', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        { type: 'api', name: 'no_url', config: {} },
      ]);
      const result = results.get('no_url');
      expect(result?.error).toContain('API URL not configured');
      expect(result?.data).toBeNull();
    });

    it('makes correct API call with POST body', async () => {
      vi.stubEnv('ALCHEMY_API_KEY', 'alchemy-test');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x1234' }),
      });

      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'api',
          name: 'eth_call',
          config: {
            url: 'https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xabc","latest"]}',
          },
        },
      ]);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://eth-mainnet.g.alchemy.com/v2/alchemy-test');

      const result = results.get('eth_call');
      expect(result?.error).toBeUndefined();
      expect(result?.data).toEqual({ jsonrpc: '2.0', result: '0x1234' });
    });

    it('handles HTTP error responses', async () => {
      vi.stubEnv('ALCHEMY_API_KEY', 'test');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'api',
          name: 'rate_limited',
          config: {
            url: 'https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
          },
        },
      ]);

      const result = results.get('rate_limited');
      expect(result?.error).toContain('429');
      expect(result?.data).toBeNull();
    });

    it('interpolates env vars in header values', async () => {
      vi.stubEnv('LITELLM_API_KEY', 'sk-test-key');
      vi.stubEnv('LITELLM_PROXY_URL', 'https://litellm.example.com');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total_spend: 12.34 }),
      });

      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      await resolver.resolve([
        {
          type: 'api',
          name: 'litellm_spend',
          config: {
            url: '${LITELLM_PROXY_URL}/global/spend/report',
            method: 'GET',
            headers: { Authorization: 'Bearer ${LITELLM_API_KEY}' },
          },
        },
      ]);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe('https://litellm.example.com/global/spend/report');
      expect(opts.headers['Authorization']).toBe('Bearer sk-test-key');
    });

    it('returns error when header references a missing env var', async () => {
      vi.stubEnv('LITELLM_PROXY_URL', 'https://litellm.example.com');
      delete process.env.LITELLM_API_KEY;

      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'api',
          name: 'spend_missing_key',
          config: {
            url: '${LITELLM_PROXY_URL}/global/spend/report',
            method: 'GET',
            headers: { Authorization: 'Bearer ${LITELLM_API_KEY}' },
          },
        },
      ]);

      const result = results.get('spend_missing_key');
      expect(result?.error).toContain('LITELLM_API_KEY');
      expect(result?.data).toBeNull();
    });
  });

  describe('SSRF protection', () => {
    it('blocks localhost URLs', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'api',
          name: 'localhost',
          config: { url: 'http://localhost:8080/secret' },
        },
      ]);
      const result = results.get('localhost');
      expect(result?.error).toContain('SSRF blocked');
      expect(result?.data).toBeNull();
    });

    it('blocks cloud metadata endpoints', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'api',
          name: 'metadata',
          config: { url: 'http://169.254.169.254/latest/meta-data/' },
        },
      ]);
      const result = results.get('metadata');
      expect(result?.error).toContain('SSRF blocked');
      expect(result?.data).toBeNull();
    });

    it('blocks RFC1918 private IPs', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        {
          type: 'api',
          name: 'private',
          config: { url: 'http://10.0.0.1/internal' },
        },
      ]);
      const result = results.get('private');
      expect(result?.error).toContain('SSRF blocked');
      expect(result?.data).toBeNull();
    });
  });

  describe('mcp fetcher', () => {
    it('returns error when endpoint not configured', async () => {
      // Ensure env var is not set
      delete process.env.YCLAW_MCP_ENDPOINT;
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      const results = await resolver.resolve([
        { type: 'mcp', name: 'mcp_test', config: {} },
      ]);
      const result = results.get('mcp_test');
      expect(result?.error).toContain('MCP endpoint not configured');
      expect(result?.data).toBeNull();
    });
  });

  describe('registerFetcher()', () => {
    it('allows registering custom fetchers', async () => {
      const { DataResolver } = await loadResolver();
      const resolver = new DataResolver();
      resolver.registerFetcher('custom', async (config) => {
        return { custom: true, key: config.key };
      });

      const results = await resolver.resolve([
        { type: 'custom' as any, name: 'my_custom', config: { key: 'value' } },
      ]);
      const result = results.get('my_custom');
      expect(result?.error).toBeUndefined();
      expect(result?.data).toEqual({ custom: true, key: 'value' });
    });
  });
});
