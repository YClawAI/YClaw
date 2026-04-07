import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamic import after mocks so constructor picks up the stub.
const { GitHubExecutor } = await import('../src/actions/github/index.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeExecutor(): InstanceType<typeof GitHubExecutor> {
  process.env.GITHUB_TOKEN = 'test-token';
  return new GitHubExecutor();
}

/** Return a minimal ok fetch response with a JSON body. */
function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Return a minimal error fetch response. */
function errResponse(status = 500, body = 'Internal Server Error') {
  return {
    ok: false,
    status,
    json: async () => ({ message: body }),
    text: async () => body,
  };
}

/**
 * Queue the 7 sequential fetch responses required for a successful commit_batch
 * with a single file.
 *
 * Order mirrors the implementation:
 *   1. GET  git/ref/heads/<baseBranch>   → { object: { sha } }
 *   2. POST git/refs                     → 201 created branch
 *   3. GET  git/commits/<sha>            → { tree: { sha } }
 *   4. POST git/blobs (one per file)     → { sha }
 *   5. POST git/trees                   → { sha }
 *   6. POST git/commits                 → { sha }
 *   7. PATCH git/refs/heads/<branch>    → ok
 */
function queueHappyPathFetches(fileCount = 1) {
  mockFetch.mockResolvedValueOnce(okJson({ object: { sha: 'base-sha-abc' } })); // 1 GET ref
  mockFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}), text: async () => '' }); // 2 POST refs
  mockFetch.mockResolvedValueOnce(okJson({ tree: { sha: 'base-tree-sha' } })); // 3 GET commit
  for (let i = 0; i < fileCount; i++) {
    mockFetch.mockResolvedValueOnce(okJson({ sha: `blob-sha-${i}` })); // 4 POST blobs
  }
  mockFetch.mockResolvedValueOnce(okJson({ sha: 'new-tree-sha' })); // 5 POST trees
  mockFetch.mockResolvedValueOnce(okJson({ sha: 'commit-sha-xyz' })); // 6 POST commits
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => '' }); // 7 PATCH ref
}

// ─── commit_batch ─────────────────────────────────────────────────────────────

describe('GitHubExecutor — commit_batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  // ── Input validation (no fetch needed) ────────────────────────────────────

  describe('input validation', () => {
    it('returns { success: false } when owner is missing', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        repo: 'my-repo',
        branch: 'agent/test',
        message: 'test commit',
        files: [{ path: 'src/foo.ts', content: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { success: false } when repo is missing', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        branch: 'agent/test',
        message: 'test commit',
        files: [{ path: 'src/foo.ts', content: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { success: false } when message is missing', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/test',
        files: [{ path: 'src/foo.ts', content: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { success: false } when files is missing', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/test',
        message: 'test commit',
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { success: false } for an empty files array', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/test',
        message: 'test commit',
        files: [],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Branch validation ──────────────────────────────────────────────────────

  describe('branch validation', () => {
    it('blocks the protected branch "master"', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'master',
        message: 'test',
        files: [{ path: 'src/foo.ts', content: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/protected/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('blocks the protected branch "main"', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'main',
        message: 'test',
        files: [{ path: 'src/foo.ts', content: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/protected/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('blocks a branch that does not match any allowed pattern', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'my-feature', // no prefix — should be rejected
        message: 'test',
        files: [{ path: 'src/foo.ts', content: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/allowed patterns/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('accepts an "agent/" prefixed branch', async () => {
      const executor = makeExecutor();
      queueHappyPathFetches(1);
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/my-fix',
        message: 'test',
        files: [{ path: 'src/foo.ts', content: 'hello' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a "feature/" prefixed branch', async () => {
      const executor = makeExecutor();
      queueHappyPathFetches(1);
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'feature/new-widget',
        message: 'test',
        files: [{ path: 'src/widget.ts', content: 'hello' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a "fix/" prefixed branch', async () => {
      const executor = makeExecutor();
      queueHappyPathFetches(1);
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'fix/null-ptr',
        message: 'test',
        files: [{ path: 'src/foo.ts', content: 'x' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a "docs/" prefixed branch', async () => {
      const executor = makeExecutor();
      queueHappyPathFetches(1);
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'docs/update-readme',
        message: 'test',
        files: [{ path: 'README.md', content: '# hello' }],
      });
      expect(result.success).toBe(true);
    });
  });

  // ── Path validation (runs inside the batch loop) ───────────────────────────

  describe('file path validation', () => {
    it('returns { success: false } for a path traversal attempt', async () => {
      const executor = makeExecutor();
      // First 3 fetch calls succeed (ref, create branch, commit) before blobs
      mockFetch.mockResolvedValueOnce(okJson({ object: { sha: 'base-sha' } }));
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}), text: async () => '' });
      mockFetch.mockResolvedValueOnce(okJson({ tree: { sha: 'tree-sha' } }));

      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/test',
        message: 'test',
        files: [{ path: '../../etc/passwd', content: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns { success: false } for a .env file path', async () => {
      const executor = makeExecutor();
      mockFetch.mockResolvedValueOnce(okJson({ object: { sha: 'base-sha' } }));
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}), text: async () => '' });
      mockFetch.mockResolvedValueOnce(okJson({ tree: { sha: 'tree-sha' } }));

      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/test',
        message: 'test',
        files: [{ path: '.env', content: 'SECRET=hunter2' }],
      });
      expect(result.success).toBe(false);
    });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('returns { success: true } with sha, branch, and files_committed count', async () => {
      const executor = makeExecutor();
      queueHappyPathFetches(2);
      const result = await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/batch-test',
        message: 'batch commit two files',
        files: [
          { path: 'src/a.ts', content: 'export const a = 1;' },
          { path: 'src/b.ts', content: 'export const b = 2;' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        sha: 'commit-sha-xyz',
        branch: 'agent/batch-test',
        files_committed: 2,
      });
    });

    it('makes exactly 7 fetch calls for a single-file batch', async () => {
      const executor = makeExecutor();
      queueHappyPathFetches(1);
      await executor.execute('commit_batch', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        branch: 'agent/single-file',
        message: 'single file commit',
        files: [{ path: 'src/foo.ts', content: 'export {}' }],
      });
      // 1 GET ref + 1 POST branch + 1 GET commit + 1 POST blob + 1 POST tree + 1 POST commit + 1 PATCH ref
      expect(mockFetch).toHaveBeenCalledTimes(7);
    });
  });
});

// ─── get_multiple_files ───────────────────────────────────────────────────────

describe('GitHubExecutor — get_multiple_files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe('input validation', () => {
    it('returns { success: false } when owner is missing', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('get_multiple_files', {
        repo: 'my-repo',
        paths: ['src/foo.ts'],
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { success: false } when repo is missing', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        paths: ['src/foo.ts'],
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { success: false } when paths is missing', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { success: false } for an empty paths array', async () => {
      const executor = makeExecutor();
      const result = await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        paths: [],
      });
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Partial failure ────────────────────────────────────────────────────────

  describe('partial failure', () => {
    it('returns top-level success:true even when some paths fail', async () => {
      const executor = makeExecutor();
      const fileContent = Buffer.from('export const x = 1;', 'utf-8').toString('base64');

      // src/good.ts — succeeds
      mockFetch.mockResolvedValueOnce(okJson({
        type: 'file',
        path: 'src/good.ts',
        sha: 'abc',
        size: 20,
        content: fileContent,
      }));
      // src/missing.ts — 404
      mockFetch.mockResolvedValueOnce(errResponse(404, 'Not Found'));

      const result = await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        paths: ['src/good.ts', 'src/missing.ts'],
      });

      expect(result.success).toBe(true);
      const files = result.data?.files as Record<string, unknown>;
      expect(files['src/good.ts']).toBeDefined();
      expect((files['src/good.ts'] as any).error).toBeUndefined();
      expect((files['src/missing.ts'] as any).error).toBeTruthy();
    });

    it('stores an error entry for the failing path', async () => {
      const executor = makeExecutor();
      mockFetch.mockResolvedValueOnce(errResponse(404, 'Not Found'));

      const result = await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        paths: ['src/does-not-exist.ts'],
      });

      expect(result.success).toBe(true);
      const files = result.data?.files as Record<string, unknown>;
      const entry = files['src/does-not-exist.ts'] as { error: string };
      expect(typeof entry.error).toBe('string');
      expect(entry.error.length).toBeGreaterThan(0);
    });
  });

  // ── All succeed ────────────────────────────────────────────────────────────

  describe('all succeed', () => {
    it('returns all files with decoded content when every fetch succeeds', async () => {
      const executor = makeExecutor();
      const makeFileResponse = (path: string, source: string) =>
        okJson({
          type: 'file',
          path,
          sha: `sha-${path}`,
          size: source.length,
          content: Buffer.from(source, 'utf-8').toString('base64'),
        });

      mockFetch.mockResolvedValueOnce(makeFileResponse('src/a.ts', 'export const a = 1;'));
      mockFetch.mockResolvedValueOnce(makeFileResponse('src/b.ts', 'export const b = 2;'));

      const result = await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        paths: ['src/a.ts', 'src/b.ts'],
      });

      expect(result.success).toBe(true);
      const files = result.data?.files as Record<string, unknown>;
      expect(Object.keys(files)).toHaveLength(2);
      expect((files['src/a.ts'] as any).content).toBe('export const a = 1;');
      expect((files['src/b.ts'] as any).content).toBe('export const b = 2;');
    });

    it('omits the ref query parameter when ref is not provided', async () => {
      const executor = makeExecutor();
      mockFetch.mockResolvedValueOnce(okJson({
        type: 'file',
        path: 'src/foo.ts',
        sha: 'sha-foo',
        size: 5,
        content: Buffer.from('hello', 'utf-8').toString('base64'),
      }));

      await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        paths: ['src/foo.ts'],
      });

      // When ref is absent the Contents API is called without a ?ref= query string;
      // the API then resolves against the repo's default branch.
      const calledUrl: string = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('ref=');
    });

    it('passes a custom ref through to the API URL', async () => {
      const executor = makeExecutor();
      mockFetch.mockResolvedValueOnce(okJson({
        type: 'file',
        path: 'src/foo.ts',
        sha: 'sha-foo',
        size: 5,
        content: Buffer.from('hello', 'utf-8').toString('base64'),
      }));

      await executor.execute('get_multiple_files', {
        owner: 'yclaw-ai',
        repo: 'my-repo',
        paths: ['src/foo.ts'],
        ref: 'agent/my-branch',
      });

      const calledUrl: string = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('ref=agent');
    });
  });
});
