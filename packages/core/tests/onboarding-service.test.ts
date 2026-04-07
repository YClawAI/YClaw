import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LLMProvider, LLMResponse } from '../src/llm/types.js';
import { OnboardingService } from '../src/onboarding/service.js';
import { OnboardingConflictError, OnboardingNotFoundError } from '../src/onboarding/types.js';
import type { OnboardingSession, IngestionJob, IngestionJobStatus } from '../src/onboarding/types.js';
import type { OnboardingStore } from '../src/onboarding/onboarding-store.js';

// ─── Mock LLM Provider ──────────────────────────────────────────────────────

function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: '# Generated Artifact\n\nMock content for testing.',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 200 },
      stopReason: 'end_turn',
    } satisfies LLMResponse),
  };
}

// ─── Mock Store ─────────────────────────────────────────────────────────────

function createMockStore(): OnboardingStore {
  let session: OnboardingSession | null = null;
  const jobs: IngestionJob[] = [];

  return {
    ensureIndexes: vi.fn(),
    createSession: vi.fn(async (operatorId: string, orgId: string) => {
      if (session && session.status === 'active') {
        throw new OnboardingConflictError('Active session already exists');
      }
      session = {
        sessionId: 'test-session-id',
        operatorId,
        orgId,
        stage: 'org_framing',
        currentQuestion: 0,
        answers: {},
        artifacts: [],
        assets: [],
        status: 'active',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return session;
    }),
    getSession: vi.fn(async (id: string) => {
      if (session && session.sessionId === id) return { ...session };
      return null;
    }),
    getActiveSession: vi.fn(async () => session ? { ...session } : null),
    updateSession: vi.fn(async (id: string, expectedVersion: number, updates: any) => {
      if (!session || session.sessionId !== id) {
        throw new OnboardingNotFoundError('Session not found');
      }
      if (session.version !== expectedVersion) {
        throw new OnboardingConflictError('Version mismatch');
      }
      session = { ...session, ...updates, version: session.version + 1, updatedAt: new Date() };
      return session;
    }),
    cancelSession: vi.fn(async (id: string) => {
      if (!session || session.sessionId !== id) {
        throw new OnboardingNotFoundError('Session not found');
      }
      if (session.status !== 'active') {
        throw new OnboardingConflictError('Session not active');
      }
      session = { ...session, status: 'cancelled', version: session.version + 1 };
      return session;
    }),
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
    updateJob: vi.fn(async () => null),
    cancelSessionJobs: vi.fn(async () => 0),
  } as unknown as OnboardingStore;
}

describe('OnboardingService', () => {
  let provider: LLMProvider;
  let store: ReturnType<typeof createMockStore>;
  let service: OnboardingService;

  beforeEach(() => {
    provider = createMockProvider();
    store = createMockStore();
    service = new OnboardingService(provider, store as any, null);
  });

  describe('startSession', () => {
    it('creates session and returns first question', async () => {
      const result = await service.startSession('op_root', 'yclaw');
      expect(result.session.sessionId).toBe('test-session-id');
      expect(result.session.stage).toBe('org_framing');
      expect(result.question.questionId).toBe('org_mission');
      expect(result.question.prompt).toContain('organization');
    });

    it('rejects duplicate active session', async () => {
      await service.startSession('op_root', 'yclaw');
      await expect(service.startSession('op_root', 'yclaw'))
        .rejects.toThrow(OnboardingConflictError);
    });
  });

  describe('answerQuestion', () => {
    it('advances to next question in stage', async () => {
      await service.startSession('op_root', 'yclaw');

      const result = await service.answerQuestion(
        'test-session-id', 'org_mission', 'We build AI tools', 'op_root',
      );

      expect(result.question).not.toBeNull();
      expect(result.question!.questionId).toBe('org_priorities');
    });

    it('generates artifact for questions with artifactType', async () => {
      await service.startSession('op_root', 'yclaw');

      const result = await service.answerQuestion(
        'test-session-id', 'org_mission', 'We build AI tools', 'op_root',
      );

      expect(result.artifactsGenerated.length).toBe(1);
      expect(result.artifactsGenerated[0]!.type).toBe('org_profile');
      expect(result.artifactsGenerated[0]!.status).toBe('draft');
      expect(provider.chat).toHaveBeenCalled();
    });

    it('rejects answer for wrong stage', async () => {
      await service.startSession('op_root', 'yclaw');

      await expect(service.answerQuestion(
        'test-session-id', 'department_review', 'looks good', 'op_root',
      )).rejects.toThrow(OnboardingConflictError);
    });

    it('transitions to next stage when all questions answered', async () => {
      const { session } = await service.startSession('op_root', 'yclaw');

      // Answer all 5 org_framing questions
      const questions = ['org_mission', 'org_priorities', 'org_voice', 'org_departments', 'org_tools'];
      for (const qId of questions) {
        await service.answerQuestion(session.sessionId, qId, 'test answer', 'op_root');
      }

      // The store.updateSession should have been called with stage: 'ingestion'
      const updateCalls = vi.mocked(store.updateSession).mock.calls;
      const lastCall = updateCalls[updateCalls.length - 1]!;
      expect(lastCall[2]).toMatchObject({ stage: 'ingestion' });
    });
  });

  describe('approveArtifact', () => {
    it('approves a draft artifact', async () => {
      await service.startSession('op_root', 'yclaw');
      const { artifactsGenerated } = await service.answerQuestion(
        'test-session-id', 'org_mission', 'We build AI tools', 'op_root',
      );

      const artifact = artifactsGenerated[0]!;
      const approved = await service.approveArtifact(
        'test-session-id', artifact.id, 'op_root',
      );

      expect(approved.status).toBe('approved');
      expect(approved.approvedAt).toBeDefined();
    });

    it('rejects approval of non-existent artifact', async () => {
      await service.startSession('op_root', 'yclaw');

      await expect(service.approveArtifact(
        'test-session-id', 'nonexistent', 'op_root',
      )).rejects.toThrow(OnboardingNotFoundError);
    });
  });

  describe('rejectArtifact', () => {
    it('rejects a draft artifact', async () => {
      await service.startSession('op_root', 'yclaw');
      const { artifactsGenerated } = await service.answerQuestion(
        'test-session-id', 'org_mission', 'We build AI tools', 'op_root',
      );

      const artifact = artifactsGenerated[0]!;
      const rejected = await service.rejectArtifact(
        'test-session-id', artifact.id, 'op_root', 'Not detailed enough',
      );

      expect(rejected.status).toBe('rejected');
    });
  });

  describe('completeOnboarding', () => {
    it('rejects completion with pending drafts', async () => {
      await service.startSession('op_root', 'yclaw');
      // Generate an artifact but don't approve it
      await service.answerQuestion(
        'test-session-id', 'org_mission', 'We build AI tools', 'op_root',
      );

      await expect(service.completeOnboarding('test-session-id', 'op_root'))
        .rejects.toThrow(OnboardingConflictError);
    });
  });

  describe('getStatus', () => {
    it('returns current progress', async () => {
      await service.startSession('op_root', 'yclaw');
      const status = await service.getStatus('test-session-id');

      expect(status.stage).toBe('org_framing');
      expect(status.currentQuestion).toBe(0);
      expect(status.totalQuestionsInStage).toBe(5);
      expect(status.status).toBe('active');
    });
  });

  describe('resetSession', () => {
    it('cancels session and jobs', async () => {
      await service.startSession('op_root', 'yclaw');
      await service.resetSession('test-session-id', 'op_root');

      expect(store.cancelSession).toHaveBeenCalledWith('test-session-id');
      expect(store.cancelSessionJobs).toHaveBeenCalledWith('test-session-id');
    });
  });

  describe('session not found', () => {
    it('throws for missing session', async () => {
      await expect(service.getStatus('nonexistent'))
        .rejects.toThrow(OnboardingNotFoundError);
    });
  });
});
