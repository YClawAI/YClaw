import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, LLMResponse } from '../src/llm/types.js';
import type { IObjectStore } from '../src/interfaces/IObjectStore.js';
import { IngestionService } from '../src/onboarding/ingestion-service.js';
import type { OnboardingSession, IngestionJob, IngestionJobStatus } from '../src/onboarding/types.js';
import type { OnboardingStore } from '../src/onboarding/onboarding-store.js';
import { isPrivateIP } from '../src/onboarding/sources/ssrf-guard.js';
import { parseGitHubUrl } from '../src/onboarding/sources/github-source.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        classification: 'technical_spec',
        summary: 'A technical document.',
        department: 'development',
      }),
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'end_turn',
    } satisfies LLMResponse),
  };
}

function createMockObjectStore(): IObjectStore {
  const stored = new Map<string, Buffer>();
  return {
    put: vi.fn(async (key: string, data: Buffer) => { stored.set(key, data); }),
    get: vi.fn(async (key: string) => stored.get(key) ?? null),
    head: vi.fn(async () => null),
    delete: vi.fn(async (key: string) => { stored.delete(key); }),
    list: vi.fn(async () => ({ keys: [...stored.keys()], truncated: false })),
    getSignedUrl: vi.fn(async () => null),
  };
}

function createMockStore(): OnboardingStore {
  const session: OnboardingSession = {
    sessionId: 'test-session',
    operatorId: 'op_root',
    orgId: 'yclaw',
    stage: 'ingestion',
    currentQuestion: 0,
    answers: {},
    artifacts: [],
    assets: [],
    status: 'active',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const jobs: IngestionJob[] = [];

  return {
    ensureIndexes: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(async () => ({ ...session, assets: [...session.assets] })),
    getActiveSession: vi.fn(async () => ({ ...session })),
    updateSession: vi.fn(async (_id: string, _v: number, updates: any) => {
      Object.assign(session, updates);
      session.version++;
      return { ...session };
    }),
    cancelSession: vi.fn(),
    abandonStaleSessions: vi.fn(async () => 0),
    createJob: vi.fn(async (sessionId: string, source: any, sourceUri: string) => {
      const job: IngestionJob = {
        jobId: `job-${jobs.length}`,
        sessionId,
        source,
        sourceUri,
        status: 'queued' as IngestionJobStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      jobs.push(job);
      return job;
    }),
    getJob: vi.fn(async (id: string) => jobs.find(j => j.jobId === id) ?? null),
    listJobs: vi.fn(async () => [...jobs]),
    updateJob: vi.fn(async (jobId: string, updates: any) => {
      const job = jobs.find(j => j.jobId === jobId);
      if (job) Object.assign(job, updates);
      return job ?? null;
    }),
    cancelSessionJobs: vi.fn(async () => 0),
  } as unknown as OnboardingStore;
}

describe('IngestionService', () => {
  let provider: LLMProvider;
  let objectStore: IObjectStore;
  let store: OnboardingStore;
  let service: IngestionService;

  beforeEach(() => {
    provider = createMockProvider();
    objectStore = createMockObjectStore();
    store = createMockStore();
    service = new IngestionService(store, provider, objectStore);
  });

  describe('ingestText', () => {
    it('stores text and creates asset with classification', async () => {
      const asset = await service.ingestText('test-session', 'Hello world content', 'notes.txt');

      expect(asset.source).toBe('text');
      expect(asset.filename).toBe('notes.txt');
      expect(asset.extractedText).toBe('Hello world content');
      expect(asset.classification).toBe('technical_spec'); // from mock LLM
      expect(asset.summary).toBe('A technical document.');
      expect(asset.contentHash).toBeTruthy();
      expect(objectStore.put).toHaveBeenCalled();
    });

    it('creates a job and marks it succeeded', async () => {
      await service.ingestText('test-session', 'content', 'title');

      expect(store.createJob).toHaveBeenCalledWith('test-session', 'text', 'title');
      const updateCalls = vi.mocked(store.updateJob).mock.calls;
      const lastCall = updateCalls[updateCalls.length - 1]!;
      expect(lastCall[1]).toMatchObject({ status: 'succeeded', progress: 100 });
    });
  });

  describe('ingestFile', () => {
    it('processes a text file upload', async () => {
      const file = {
        originalname: 'readme.md',
        mimetype: 'text/markdown',
        buffer: Buffer.from('# My Project\n\nDescription here'),
        size: 30,
      };

      const asset = await service.ingestFile('test-session', file);
      expect(asset.source).toBe('file');
      expect(asset.filename).toBe('readme.md');
      expect(asset.extractedText).toContain('My Project');
      expect(objectStore.put).toHaveBeenCalled();
    });

    it('rejects oversized files', async () => {
      const file = {
        originalname: 'huge.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(11 * 1024 * 1024), // 11MB
        size: 11 * 1024 * 1024,
      };

      await expect(service.ingestFile('test-session', file))
        .rejects.toThrow('exceeds maximum');
    });

    it('rejects unsupported MIME types', async () => {
      const file = {
        originalname: 'virus.exe',
        mimetype: 'application/x-executable',
        buffer: Buffer.from('bad'),
        size: 3,
      };

      await expect(service.ingestFile('test-session', file))
        .rejects.toThrow('Unsupported file type');
    });
  });
});

describe('SSRF guard', () => {
  it('identifies private IPv4 ranges', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('169.254.169.254')).toBe(true); // AWS metadata
  });

  it('identifies public IPs as non-private', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('93.184.216.34')).toBe(false);
  });

  it('identifies IPv6 private addresses', () => {
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12::1')).toBe(true);
  });
});

describe('GitHub URL parsing', () => {
  it('parses standard repo URL', () => {
    const info = parseGitHubUrl('https://github.com/owner/repo');
    expect(info.owner).toBe('owner');
    expect(info.repo).toBe('repo');
  });

  it('strips .git suffix', () => {
    const info = parseGitHubUrl('https://github.com/owner/repo.git');
    expect(info.repo).toBe('repo');
  });

  it('extracts branch from tree URL', () => {
    const info = parseGitHubUrl('https://github.com/owner/repo/tree/develop');
    expect(info.branch).toBe('develop');
  });

  it('rejects non-GitHub URLs', () => {
    expect(() => parseGitHubUrl('https://gitlab.com/owner/repo'))
      .toThrow('Only github.com');
  });

  it('rejects invalid paths', () => {
    expect(() => parseGitHubUrl('https://github.com/only-owner'))
      .toThrow('Invalid GitHub URL');
  });
});
