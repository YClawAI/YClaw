import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock app-auth to avoid module-level _authMethod caching across tests.
// Without this, earlier tests that fire session.failed (without GITHUB_TOKEN)
// poison the cached auth method to 'none', breaking later tests that set it.
const mockIsGitHubAuthAvailable = vi.fn(() => false);
const mockGetGitHubToken = vi.fn(async () => 'ghp-test');
vi.mock('../src/actions/github/app-auth.js', () => ({
  isGitHubAuthAvailable: (...args: unknown[]) => mockIsGitHubAuthAvailable(...args),
  getGitHubToken: (...args: unknown[]) => mockGetGitHubToken(...args),
  initGitHubAuth: vi.fn(),
}));

const { createAoCallbackMiddleware } = await import('../src/ao/callback.js');

function makeEventBus() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAuditLog() {
  const insertOne = vi.fn().mockResolvedValue({});
  return {
    getDb: vi.fn().mockReturnValue({
      collection: () => ({ insertOne }),
    }),
    _insertOne: insertOne,
  };
}

function makeMockRes() {
  const res: any = {
    _status: 200,
    _body: null,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._body = body; return res; },
  };
  return res;
}

function makeMockReq(body: unknown, headers: Record<string, string> = {}) {
  return { body, headers } as any;
}

describe('ao callback middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AO_AUTH_TOKEN = 'test-token';
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('authentication', () => {
    it('should return 401 when token is wrong', async () => {
      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq({ type: 'session.completed' }, { 'x-ao-token': 'wrong-token' }),
        res,
      );

      expect(res._status).toBe(401);
      expect(res._body).toMatchObject({ error: 'Unauthorized' });
    });

    it('should return 401 when token header is missing', async () => {
      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(makeMockReq({ type: 'session.completed' }, {}), res);

      expect(res._status).toBe(401);
    });

    it('should return 503 when AO_AUTH_TOKEN is not configured', async () => {
      delete process.env.AO_AUTH_TOKEN;
      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq({ type: 'session.completed' }, { 'x-ao-token': 'anything' }),
        res,
      );

      expect(res._status).toBe(503);
      expect(res._body).toMatchObject({ error: 'Server misconfigured' });
    });

    it('should accept requests with valid token', async () => {
      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'session.completed', sessionId: 'ao-123' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(res._status).toBe(200);
      expect(res._body).toMatchObject({ received: true, type: 'session.completed' });
    });
  });

  describe('event routing', () => {
    it('should emit ao:task_completed for session.completed', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'session.completed', sessionId: 'ao-123', issueNumber: 42 },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        'ao',
        'task_completed',
        expect.objectContaining({ type: 'session.completed', session_id: 'ao-123' }),
      );
    });

    it('should emit ao:pr_ready for pr.ready', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'pr.ready', prNumber: 55, prUrl: 'https://github.com/test/repo/pull/55' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        'ao',
        'pr_ready',
        expect.objectContaining({ type: 'pr.ready', pr_number: 55 }),
      );
    });

    it('should emit ao:pr_ready for pr.created', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'pr.created', prNumber: 56 },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        'ao',
        'pr_ready',
        expect.objectContaining({ type: 'pr.created', pr_number: 56 }),
      );
    });

    it('should emit ao:pr_merged for pr.merged (distinct from task_completed)', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'pr.merged', prNumber: 42 },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        'ao',
        'pr_merged',
        expect.objectContaining({ type: 'pr.merged', pr_number: 42 }),
      );
    });

    it('should emit ao:task_failed for session.failed', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'session.failed', error: 'CI broke' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        'ao',
        'task_failed',
        expect.objectContaining({ type: 'session.failed', error: 'CI broke' }),
      );
    });

    it('should emit ao:task_failed for ci.failed', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'ci.failed', prNumber: 99 },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        'ao',
        'task_failed',
        expect.objectContaining({ type: 'ci.failed' }),
      );
    });

    it('should pass unknown event types through on ao namespace', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'pr.review_requested', prNumber: 42 },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        'ao',
        'pr.review_requested',
        expect.objectContaining({ type: 'pr.review_requested', pr_number: 42 }),
      );
    });
  });

  describe('payload normalization (camelCase → snake_case)', () => {
    it('should publish snake_case pr_number and pr_url for ao:pr_ready', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          {
            type: 'pr.ready',
            issueNumber: 10,
            prNumber: 77,
            prUrl: 'https://github.com/your-org/yclaw/pull/77',
            repo: 'yclaw',
            sessionId: 'sid-42',
          },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      const [, , published] = eventBus.publish.mock.calls.find(
        ([ns, evt]: [string, string]) => ns === 'ao' && evt === 'pr_ready',
      )!;

      // snake_case keys must be present
      expect(published).toMatchObject({
        issue_number: 10,
        pr_number: 77,
        pr_url: 'https://github.com/your-org/yclaw/pull/77',
        session_id: 'sid-42',
        repo: 'yclaw',
      });

      // camelCase originals must be absent
      expect(published).not.toHaveProperty('issueNumber');
      expect(published).not.toHaveProperty('prNumber');
      expect(published).not.toHaveProperty('prUrl');
      expect(published).not.toHaveProperty('sessionId');
    });

    it('should not include undefined snake_case keys when camelCase fields are absent', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'session.completed', repo: 'yclaw' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      const [, , published] = eventBus.publish.mock.calls.find(
        ([ns, evt]: [string, string]) => ns === 'ao' && evt === 'task_completed',
      )!;

      expect(published).not.toHaveProperty('pr_number');
      expect(published).not.toHaveProperty('pr_url');
      expect(published).not.toHaveProperty('issue_number');
      expect(published).not.toHaveProperty('session_id');
    });
  });

  describe('validation', () => {
    it('should return 400 for malformed body', async () => {
      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(makeMockReq(null, { 'x-ao-token': 'test-token' }), res);

      expect(res._status).toBe(400);
      expect(res._body).toMatchObject({ error: expect.stringContaining('Bad request') });
    });

    it('should return 400 when type field is missing', async () => {
      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq({ sessionId: 'ao-123' }, { 'x-ao-token': 'test-token' }),
        res,
      );

      expect(res._status).toBe(400);
      expect(res._body).toMatchObject({ error: expect.stringContaining('missing type') });
    });
  });

  describe('audit logging', () => {
    it('should write to audit log on valid callback', async () => {
      const auditLog = makeAuditLog();
      const handler = createAoCallbackMiddleware(makeEventBus() as any, auditLog as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'session.completed', sessionId: 'ao-audit' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(auditLog._insertOne).toHaveBeenCalled();
      const entry = auditLog._insertOne.mock.calls[0]![0];
      expect(entry.agent).toBe('ao-callback');
      expect(entry.action).toBe('callback_received');
    });
  });

  describe('ao:task_failed payload contract (issue #927)', () => {
    // Regression guard: ao:task_failed must carry the fields published by callback.ts
    // (error, issue_number, repo, session_id) — NOT the ao:task_blocked fields
    // (blocker_type, details) that resolve_blocker expects.
    it('ao:task_failed for session.failed carries error, issue_number, repo, session_id in snake_case', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          {
            type: 'session.failed',
            issueNumber: 927,
            repo: 'your-org/yclaw',
            sessionId: 'sid-927',
            error: 'worktree missing after run',
          },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(res._status).toBe(200);

      const [, , published] = eventBus.publish.mock.calls.find(
        ([ns, evt]: [string, string]) => ns === 'ao' && evt === 'task_failed',
      )!;

      // Fields required by handle_task_failure workflow
      expect(published).toMatchObject({
        type: 'session.failed',
        error: 'worktree missing after run',
        issue_number: 927,
        repo: 'your-org/yclaw',
        session_id: 'sid-927',
      });

      // Must NOT contain resolve_blocker's ao:task_blocked fields
      expect(published).not.toHaveProperty('blocker_type');
      expect(published).not.toHaveProperty('details');

      // camelCase originals must be absent (snake_case only)
      expect(published).not.toHaveProperty('issueNumber');
      expect(published).not.toHaveProperty('sessionId');
    });

    it('ao:task_failed for ci.failed carries error, issue_number, repo in snake_case', async () => {
      const eventBus = makeEventBus();
      const handler = createAoCallbackMiddleware(eventBus as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          {
            type: 'ci.failed',
            issueNumber: 927,
            repo: 'your-org/yclaw',
            error: 'vitest suite failed: 3 tests failed',
          },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(res._status).toBe(200);

      const [, , published] = eventBus.publish.mock.calls.find(
        ([ns, evt]: [string, string]) => ns === 'ao' && evt === 'task_failed',
      )!;

      expect(published).toMatchObject({
        type: 'ci.failed',
        error: 'vitest suite failed: 3 tests failed',
        issue_number: 927,
        repo: 'your-org/yclaw',
      });

      // Must NOT contain resolve_blocker's ao:task_blocked fields
      expect(published).not.toHaveProperty('blocker_type');
      expect(published).not.toHaveProperty('details');

      expect(published).not.toHaveProperty('issueNumber');
    });
  });

  describe('false-positive alert resolution', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.GITHUB_TOKEN = 'ghp-test';
      // Enable GitHub auth for false-positive resolution + issue comments
      mockIsGitHubAuthAvailable.mockReturnValue(true);
      // Speed up polling in tests
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.GITHUB_TOKEN;
      mockIsGitHubAuthAvailable.mockReturnValue(false);
    });

    it('posts a threaded ✅ reply and adds reaction when a PR is found', async () => {
      // Slack postMessage returns ts for the failure alert
      const slackPostResponse = { ok: true, ts: '1234567890.000100' };
      // GitHub search returns a matching PR
      const githubSearchResponse = {
        total_count: 1,
        items: [{ number: 42, html_url: 'https://github.com/your-org/yclaw/pull/42', created_at: '2026-04-01T00:00:00Z', state: 'open' }],
      };
      // Slack thread reply
      const slackThreadResponse = { ok: true, ts: '1234567890.000200' };
      // Slack reaction
      const slackReactionResponse = { ok: true };

      // URL-dispatching mock: commentOnIssueFailure also calls fetch (GitHub issue
      // comment), so ordered mockResolvedValueOnce would have responses stolen.
      let slackPostCount = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url === 'https://slack.com/api/chat.postMessage') {
          slackPostCount++;
          const resp = slackPostCount === 1 ? slackPostResponse : slackThreadResponse;
          return Promise.resolve({ ok: true, json: async () => resp });
        }
        if (url === 'https://slack.com/api/reactions.add') {
          return Promise.resolve({ ok: true, json: async () => slackReactionResponse });
        }
        if (typeof url === 'string' && url.includes('api.github.com/search/issues')) {
          return Promise.resolve({ ok: true, json: async () => githubSearchResponse });
        }
        // GitHub issue comment or any other call
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      // Fire the session.failed callback
      await handler(
        makeMockReq(
          { type: 'session.failed', issueNumber: 913, repo: 'your-org/yclaw', error: 'Session worktree missing after AO run' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      // The HTTP response should always succeed immediately
      expect(res._status).toBe(200);
      expect(res._body).toMatchObject({ received: true });

      // Allow the background resolution task to run
      await vi.runAllTimersAsync();
      // Flush remaining microtasks
      await Promise.resolve();
      await Promise.resolve();

      // Verify thread reply was posted with ✅ language
      const threadReplyCall = fetchMock.mock.calls.find(([url, opts]) =>
        url === 'https://slack.com/api/chat.postMessage' &&
        JSON.parse(opts.body).thread_ts === '1234567890.000100',
      );
      expect(threadReplyCall).toBeDefined();
      const threadBody = JSON.parse(threadReplyCall![1].body);
      expect(threadBody.text).toContain('✅ Resolved');
      expect(threadBody.text).toContain('PR #42');
      expect(threadBody.text).toContain('#913');

      // Verify ✅ reaction was added to the original message
      const reactionCall = fetchMock.mock.calls.find(([url]) =>
        url === 'https://slack.com/api/reactions.add',
      );
      expect(reactionCall).toBeDefined();
      const reactionBody = JSON.parse(reactionCall![1].body);
      expect(reactionBody.name).toBe('white_check_mark');
      expect(reactionBody.timestamp).toBe('1234567890.000100');
    });

    it('does NOT post a resolution if no PR is found (real failure)', async () => {
      const slackPostResponse = { ok: true, ts: '1234567890.000100' };
      const githubEmptyResponse = { total_count: 0, items: [] };

      // URL-dispatching mock — handles Slack, GitHub search, and GitHub issue comment calls
      fetchMock.mockImplementation((url: string) => {
        if (url === 'https://slack.com/api/chat.postMessage') {
          return Promise.resolve({ ok: true, json: async () => slackPostResponse });
        }
        if (typeof url === 'string' && url.includes('api.github.com/search/issues')) {
          return Promise.resolve({ ok: true, json: async () => githubEmptyResponse });
        }
        // GitHub issue comment or any other call
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'session.failed', issueNumber: 999, error: 'Real failure: build exploded' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(res._status).toBe(200);

      // Run all timers to exhaust the polling loop
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();

      // No thread reply should be posted
      const threadReplyCall = fetchMock.mock.calls.find(([url, opts]) =>
        url === 'https://slack.com/api/chat.postMessage' &&
        opts?.body && JSON.parse(opts.body).thread_ts,
      );
      expect(threadReplyCall).toBeUndefined();

      // No reaction added
      const reactionCall = fetchMock.mock.calls.find(([url]) =>
        url === 'https://slack.com/api/reactions.add',
      );
      expect(reactionCall).toBeUndefined();
    });

    it('skips resolution when issueNumber is absent from session.failed event', async () => {
      const slackPostResponse = { ok: true, ts: '1234567890.000100' };

      fetchMock.mockResolvedValue({ ok: true, json: async () => slackPostResponse });

      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'session.failed', error: 'stdin timeout' }, // no issueNumber
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      expect(res._status).toBe(200);

      await vi.runAllTimersAsync();
      await Promise.resolve();

      // GitHub should never be queried since there is no issue number to look up
      const githubCall = fetchMock.mock.calls.find(([url]) =>
        url?.includes('api.github.com'),
      );
      expect(githubCall).toBeUndefined();
    });

    it('does not attempt PR resolution for ci.failed (only session.failed)', async () => {
      const slackPostResponse = { ok: true, ts: '1234567890.000100' };
      fetchMock.mockResolvedValue({ ok: true, json: async () => slackPostResponse });

      const handler = createAoCallbackMiddleware(makeEventBus() as any, makeAuditLog() as any);
      const res = makeMockRes();

      await handler(
        makeMockReq(
          { type: 'ci.failed', issueNumber: 100, error: 'tests failed' },
          { 'x-ao-token': 'test-token' },
        ),
        res,
      );

      await vi.runAllTimersAsync();
      await Promise.resolve();

      // PR search (false-positive resolution) should NOT run for ci.failed
      // (commentOnIssueFailure may still post an issue comment — that's expected)
      const prSearchCall = fetchMock.mock.calls.find(([url]) =>
        url?.includes('api.github.com/search/issues'),
      );
      expect(prSearchCall).toBeUndefined();
    });
  });
});
