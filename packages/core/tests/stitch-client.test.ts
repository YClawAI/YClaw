/**
 * Tests for StitchClient — Google Stitch JSON-RPC wrapper.
 *
 * Covers:
 *   1. listProjects — correct RPC payload, optional filter
 *   2. createProject — correct payload, optional title
 *   3. generateScreen — required + optional args
 *   4. editScreens — all args forwarded
 *   5. generateVariants — variantOptions forwarded
 *   6. getScreen — name path constructed correctly
 *   7. listScreens — projectId forwarded
 *   8. HTTP error → StitchError with recoverable flag
 *   9. JSON-RPC error in body → StitchError
 *  10. Missing STITCH_API_KEY → throws on construction
 *  11. Request IDs are unique across calls
 *  12. Missing result (no error, no result) → StitchError
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock Logger ─────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

const { StitchClient, StitchError } = await import('../src/services/stitch-client.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetchOk(result: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 'test-id', result }),
    }),
  );
}

function mockFetchHttpError(status: number, statusText: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
      json: async () => ({}),
    }),
  );
}

function mockFetchRpcError(code: number, message: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 'test-id', error: { code, message } }),
    }),
  );
}

function mockFetchNoResult(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 'test-id' }),
    }),
  );
}

function getRequestBody(): unknown {
  const fetchMock = vi.mocked(fetch);
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  const [, init] = call;
  return JSON.parse(init?.body as string);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StitchClient construction', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('throws if STITCH_API_KEY is missing', () => {
    vi.stubEnv('STITCH_API_KEY', '');
    expect(() => new StitchClient()).toThrow('STITCH_API_KEY');
  });

  it('constructs successfully when STITCH_API_KEY is set', () => {
    vi.stubEnv('STITCH_API_KEY', 'test-key');
    expect(() => new StitchClient()).not.toThrow();
  });
});

describe('StitchClient methods', () => {
  let client: InstanceType<typeof StitchClient>;

  beforeEach(() => {
    vi.stubEnv('STITCH_API_KEY', 'test-api-key');
    client = new StitchClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ─── listProjects ──────────────────────────────────────────────────────────

  it('listProjects sends correct tool name and empty args', async () => {
    mockFetchOk({ projects: [] });
    await client.listProjects();
    const body = getRequestBody() as { method: string; params: { name: string; arguments: Record<string, unknown> } };
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('list_projects');
    expect(body.params.arguments).toEqual({});
  });

  it('listProjects forwards optional filter', async () => {
    mockFetchOk({ projects: [] });
    await client.listProjects('my-filter');
    const body = getRequestBody() as { params: { arguments: Record<string, unknown> } };
    expect(body.params.arguments['filter']).toBe('my-filter');
  });

  // ─── createProject ─────────────────────────────────────────────────────────

  it('createProject sends correct tool name without title', async () => {
    mockFetchOk({ name: 'projects/123', title: 'Untitled' });
    await client.createProject();
    const body = getRequestBody() as { params: { name: string; arguments: Record<string, unknown> } };
    expect(body.params.name).toBe('create_project');
    expect(body.params.arguments).toEqual({});
  });

  it('createProject forwards title when provided', async () => {
    mockFetchOk({ name: 'projects/123', title: 'My Project' });
    await client.createProject('My Project');
    const body = getRequestBody() as { params: { arguments: Record<string, unknown> } };
    expect(body.params.arguments['title']).toBe('My Project');
  });

  // ─── generateScreen ────────────────────────────────────────────────────────

  it('generateScreen sends correct tool name and required args', async () => {
    mockFetchOk({ screens: [] });
    await client.generateScreen('proj-1', 'Design a login page');
    const body = getRequestBody() as { params: { name: string; arguments: Record<string, unknown> } };
    expect(body.params.name).toBe('generate_screen_from_text');
    expect(body.params.arguments['projectId']).toBe('proj-1');
    expect(body.params.arguments['prompt']).toBe('Design a login page');
    expect(body.params.arguments['deviceType']).toBeUndefined();
    expect(body.params.arguments['modelId']).toBeUndefined();
  });

  it('generateScreen forwards optional deviceType and modelId', async () => {
    mockFetchOk({ screens: [] });
    await client.generateScreen('proj-1', 'prompt', 'DESKTOP', 'GEMINI_3_PRO');
    const body = getRequestBody() as { params: { arguments: Record<string, unknown> } };
    expect(body.params.arguments['deviceType']).toBe('DESKTOP');
    expect(body.params.arguments['modelId']).toBe('GEMINI_3_PRO');
  });

  // ─── editScreens ───────────────────────────────────────────────────────────

  it('editScreens sends correct payload', async () => {
    mockFetchOk({ screens: [] });
    await client.editScreens('proj-1', ['screen-a', 'screen-b'], 'Fix spacing');
    const body = getRequestBody() as { params: { name: string; arguments: Record<string, unknown> } };
    expect(body.params.name).toBe('edit_screens');
    expect(body.params.arguments['projectId']).toBe('proj-1');
    expect(body.params.arguments['selectedScreenIds']).toEqual(['screen-a', 'screen-b']);
    expect(body.params.arguments['prompt']).toBe('Fix spacing');
  });

  // ─── generateVariants ──────────────────────────────────────────────────────

  it('generateVariants forwards variantOptions', async () => {
    mockFetchOk({ screens: [] });
    await client.generateVariants('proj-1', ['screen-a'], 'Explore variations', {
      variantCount: 3,
      creativeRange: 'EXPLORE',
    });
    const body = getRequestBody() as { params: { name: string; arguments: Record<string, unknown> } };
    expect(body.params.name).toBe('generate_variants');
    expect(body.params.arguments['variantOptions']).toEqual({ variantCount: 3, creativeRange: 'EXPLORE' });
  });

  // ─── getScreen ─────────────────────────────────────────────────────────────

  it('getScreen constructs resource name path correctly', async () => {
    mockFetchOk({ name: 'projects/proj-1/screens/scr-1', title: 'Hero' });
    await client.getScreen('proj-1', 'scr-1');
    const body = getRequestBody() as { params: { name: string; arguments: Record<string, unknown> } };
    expect(body.params.name).toBe('get_screen');
    expect(body.params.arguments['name']).toBe('projects/proj-1/screens/scr-1');
    expect(body.params.arguments['projectId']).toBe('proj-1');
    expect(body.params.arguments['screenId']).toBe('scr-1');
  });

  // ─── listScreens ───────────────────────────────────────────────────────────

  it('listScreens forwards projectId', async () => {
    mockFetchOk({ screens: [] });
    await client.listScreens('proj-42');
    const body = getRequestBody() as { params: { name: string; arguments: Record<string, unknown> } };
    expect(body.params.name).toBe('list_screens');
    expect(body.params.arguments['projectId']).toBe('proj-42');
  });

  // ─── JSON-RPC structure ────────────────────────────────────────────────────

  it('sends jsonrpc 2.0 envelope with unique request IDs', async () => {
    mockFetchOk({ projects: [] });
    await client.listProjects();
    const body1 = getRequestBody() as { jsonrpc: string; id: string };
    expect(body1.jsonrpc).toBe('2.0');
    const id1 = body1.id;

    mockFetchOk({ projects: [] });
    await client.listProjects();
    const body2 = getRequestBody() as { id: string };
    expect(body2.id).not.toBe(id1);
  });

  it('sends X-Goog-Api-Key header', async () => {
    mockFetchOk({ projects: [] });
    await client.listProjects();
    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-api-key');
  });

  // ─── Error handling ────────────────────────────────────────────────────────

  it('throws StitchError on HTTP 4xx (not recoverable)', async () => {
    mockFetchHttpError(400, 'Bad Request');
    await expect(client.listProjects()).rejects.toMatchObject({
      name: 'StitchError',
      code: 400,
      recoverable: false,
    });
  });

  it('throws StitchError on HTTP 500 (recoverable)', async () => {
    mockFetchHttpError(500, 'Internal Server Error');
    await expect(client.listProjects()).rejects.toMatchObject({
      name: 'StitchError',
      code: 500,
      recoverable: true,
    });
  });

  it('throws StitchError when JSON-RPC body contains error', async () => {
    mockFetchRpcError(-32601, 'Method not found');
    await expect(client.listProjects()).rejects.toMatchObject({
      name: 'StitchError',
      code: -32601,
    });
  });

  it('throws StitchError when result is absent with no error', async () => {
    mockFetchNoResult();
    await expect(client.listProjects()).rejects.toMatchObject({
      name: 'StitchError',
      code: -1,
    });
  });
});
