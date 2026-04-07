/**
 * OnboardingStore — MongoDB persistence for onboarding sessions and ingestion jobs.
 *
 * Uses optimistic concurrency via a `version` field on sessions.
 * All updates require the expected version; mismatches return 409.
 */

import type { Db, Collection } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import type {
  OnboardingSession,
  OnboardingStage,
  SessionStatus,
  ArtifactDraft,
  OnboardingAsset,
  IngestionJob,
  IngestionJobStatus,
} from './types.js';
import { OnboardingConflictError, OnboardingNotFoundError } from './types.js';

const logger = createLogger('onboarding-store');

export class OnboardingStore {
  private readonly sessions: Collection<OnboardingSession>;
  private readonly jobs: Collection<IngestionJob>;

  constructor(db: Db) {
    this.sessions = db.collection<OnboardingSession>('onboarding_sessions');
    this.jobs = db.collection<IngestionJob>('onboarding_jobs');
  }

  async ensureIndexes(): Promise<void> {
    await this.sessions.createIndex({ sessionId: 1 }, { unique: true });
    // Only one active session per org at a time
    await this.sessions.createIndex(
      { orgId: 1, status: 1 },
      { unique: true, partialFilterExpression: { status: 'active' } },
    );
    await this.sessions.createIndex({ operatorId: 1 });
    await this.sessions.createIndex({ status: 1 });

    await this.jobs.createIndex({ jobId: 1 }, { unique: true });
    await this.jobs.createIndex({ sessionId: 1 });
    await this.jobs.createIndex({ status: 1 });

    logger.info('Onboarding store indexes ensured');
  }

  // ─── Session CRUD ─────────────────────────────────────────────────────────

  async createSession(operatorId: string, orgId: string): Promise<OnboardingSession> {
    const now = new Date();
    const session: OnboardingSession = {
      sessionId: randomUUID(),
      operatorId,
      orgId,
      stage: 'org_framing',
      currentQuestion: 0,
      answers: {},
      artifacts: [],
      assets: [],
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.sessions.insertOne(session as any);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate key') || msg.includes('E11000')) {
        throw new OnboardingConflictError(
          'An active onboarding session already exists for this org. Cancel it first or wait for it to complete.',
        );
      }
      throw err;
    }

    logger.info('Onboarding session created', { sessionId: session.sessionId, orgId });
    return session;
  }

  async getSession(sessionId: string): Promise<OnboardingSession | null> {
    return this.sessions.findOne({ sessionId }) as Promise<OnboardingSession | null>;
  }

  async getActiveSession(orgId: string): Promise<OnboardingSession | null> {
    return this.sessions.findOne({ orgId, status: 'active' }) as Promise<OnboardingSession | null>;
  }

  /**
   * Update session fields with optimistic concurrency.
   * Throws OnboardingConflictError if the version doesn't match.
   */
  async updateSession(
    sessionId: string,
    expectedVersion: number,
    updates: Partial<Pick<
      OnboardingSession,
      'stage' | 'currentQuestion' | 'answers' | 'artifacts' | 'assets' | 'status' | 'completedAt'
    >>,
  ): Promise<OnboardingSession> {
    const result = await this.sessions.findOneAndUpdate(
      { sessionId, version: expectedVersion },
      {
        $set: { ...updates, updatedAt: new Date() },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );

    if (!result) {
      throw new OnboardingConflictError(
        'Session was modified by another request. Refresh and try again.',
      );
    }

    return result as OnboardingSession;
  }

  /**
   * Cancel an active session. Preserves data for audit trail.
   */
  async cancelSession(sessionId: string): Promise<OnboardingSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new OnboardingNotFoundError(`Session ${sessionId} not found`);
    }
    if (session.status !== 'active') {
      throw new OnboardingConflictError(`Session is ${session.status}, not active`);
    }

    return this.updateSession(sessionId, session.version, { status: 'cancelled' });
  }

  /**
   * Mark sessions with no activity for N days as abandoned.
   * Returns the count of sessions marked.
   */
  async abandonStaleSessions(daysThreshold: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysThreshold);

    const result = await this.sessions.updateMany(
      { status: 'active', updatedAt: { $lt: cutoff } },
      { $set: { status: 'abandoned' as SessionStatus, updatedAt: new Date() } },
    );

    if (result.modifiedCount > 0) {
      logger.info(`Abandoned ${result.modifiedCount} stale onboarding sessions`);
    }
    return result.modifiedCount;
  }

  // ─── Job CRUD ─────────────────────────────────────────────────────────────

  async createJob(sessionId: string, source: IngestionJob['source'], sourceUri: string): Promise<IngestionJob> {
    const now = new Date();
    const job: IngestionJob = {
      jobId: randomUUID(),
      sessionId,
      source,
      sourceUri,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    await this.jobs.insertOne(job as any);
    logger.info('Ingestion job created', { jobId: job.jobId, source });
    return job;
  }

  async getJob(jobId: string): Promise<IngestionJob | null> {
    return this.jobs.findOne({ jobId }) as Promise<IngestionJob | null>;
  }

  async listJobs(sessionId: string): Promise<IngestionJob[]> {
    return this.jobs
      .find({ sessionId })
      .sort({ createdAt: -1 })
      .toArray() as Promise<IngestionJob[]>;
  }

  async updateJob(
    jobId: string,
    updates: Partial<Pick<IngestionJob, 'status' | 'progress' | 'error' | 'result'>>,
  ): Promise<IngestionJob | null> {
    const result = await this.jobs.findOneAndUpdate(
      { jobId },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return result as IngestionJob | null;
  }

  /**
   * Cancel all pending/running jobs for a session.
   */
  async cancelSessionJobs(sessionId: string): Promise<number> {
    const result = await this.jobs.updateMany(
      { sessionId, status: { $in: ['queued', 'running'] as IngestionJobStatus[] } },
      { $set: { status: 'cancelled' as IngestionJobStatus, updatedAt: new Date() } },
    );
    return result.modifiedCount;
  }
}
