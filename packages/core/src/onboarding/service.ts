/**
 * OnboardingService — orchestrates the conversational onboarding flow.
 *
 * Model-agnostic: receives an LLMProvider via constructor.
 * Never references a specific model or provider name.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import type { LLMProvider } from '../llm/types.js';
import type { OperatorAuditLogger } from '../operators/audit-logger.js';
import type { OnboardingStore } from './onboarding-store.js';
import type {
  OnboardingSession,
  ArtifactDraft,
  ArtifactType,
  OnboardingStage,
  IngestionJob,
} from './types.js';
import { OnboardingConflictError, OnboardingNotFoundError, STAGE_ORDER } from './types.js';
import { getQuestionsForStage, getQuestionById } from './questions.js';
import { getTemplate } from './templates/index.js';

const logger = createLogger('onboarding-service');

export interface QuestionResponse {
  questionId: string;
  prompt: string;
  helpText: string;
  defaultAnswer?: string;
  followUp?: string;
  stageComplete: boolean;
  nextStage?: OnboardingStage;
}

export interface OnboardingStatus {
  sessionId: string;
  stage: OnboardingStage;
  currentQuestion: number;
  totalQuestionsInStage: number;
  artifactCount: number;
  approvedArtifactCount: number;
  assetCount: number;
  status: string;
}

export class OnboardingService {
  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly store: OnboardingStore,
    private readonly auditLogger: OperatorAuditLogger | null,
  ) {}

  /** Start a new onboarding session. Returns first question. */
  async startSession(operatorId: string, orgId: string): Promise<{
    session: OnboardingSession;
    question: QuestionResponse;
  }> {
    const session = await this.store.createSession(operatorId, orgId);
    const question = this.getCurrentQuestion(session);

    this.logAudit(operatorId, 'onboarding.start', 'session', session.sessionId);
    logger.info('Onboarding started', { sessionId: session.sessionId, orgId });

    return { session, question };
  }

  /** Submit an answer to the current question. Returns next question or stage transition. */
  async answerQuestion(
    sessionId: string,
    questionId: string,
    answer: string,
    operatorId: string,
  ): Promise<{
    question: QuestionResponse | null;
    artifactsGenerated: ArtifactDraft[];
  }> {
    // Validate question exists (stage check happens inside retry loop with fresh session)
    const questionDef = getQuestionById(questionId);
    if (!questionDef) {
      throw new OnboardingConflictError(`Unknown question "${questionId}"`);
    }

    // Generate artifacts OUTSIDE retry loop — LLM calls are expensive
    let artifactsGenerated: ArtifactDraft[] = [];
    if (questionDef.artifactType) {
      const session = await this.requireSession(sessionId);
      const updatedAnswers = { ...session.answers, [questionId]: answer };
      const artifact = await this.generateArtifact(
        questionDef.artifactType, updatedAnswers, session.assets,
      );
      artifactsGenerated = [artifact];
    }

    // Retry loop for session update — concurrent ingestion may bump version
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const session = await this.requireSession(sessionId);

      if (questionDef.stage !== session.stage) {
        throw new OnboardingConflictError(
          `Question "${questionId}" does not belong to current stage "${session.stage}"`,
        );
      }

      const updatedAnswers = { ...session.answers, [questionId]: answer };
      const stageQuestions = getQuestionsForStage(session.stage);
      const nextQuestionIndex = session.currentQuestion + 1;
      const stageComplete = nextQuestionIndex >= stageQuestions.length;

      // Merge artifacts: replace by type to avoid duplicates
      const newTypes = new Set(artifactsGenerated.map(a => a.type));
      const mergedArtifacts = [
        ...session.artifacts.filter(a => !newTypes.has(a.type)),
        ...artifactsGenerated,
      ];

      try {
        if (stageComplete) {
          const nextStage = this.getNextStage(session.stage);
          await this.store.updateSession(sessionId, session.version, {
            answers: updatedAnswers,
            artifacts: mergedArtifacts,
            stage: nextStage,
            currentQuestion: 0,
          });
          const nextQuestion = this.getQuestionForStage(nextStage, 0);
          this.logAudit(operatorId, 'onboarding.stage_complete', 'session', sessionId);
          return { question: nextQuestion, artifactsGenerated };
        }

        await this.store.updateSession(sessionId, session.version, {
          answers: updatedAnswers,
          artifacts: mergedArtifacts,
          currentQuestion: nextQuestionIndex,
        });
        const nextQ = this.getQuestionForStage(session.stage, nextQuestionIndex);
        return { question: nextQ, artifactsGenerated };
      } catch (err) {
        if (err instanceof OnboardingConflictError && attempt < maxRetries - 1) {
          logger.warn('Version conflict on answerQuestion, retrying', { sessionId, attempt });
          continue;
        }
        throw err;
      }
    }

    throw new OnboardingConflictError('Failed to save answer after retries — please try again');
  }

  /** Regenerate a specific artifact with updated context. */
  async regenerateArtifact(
    sessionId: string,
    artifactType: ArtifactType,
    operatorId: string,
  ): Promise<ArtifactDraft> {
    const session = await this.requireSession(sessionId);

    const artifact = await this.generateArtifact(artifactType, session.answers, session.assets);

    // Replace existing artifact of the same type, or add new
    const updatedArtifacts = session.artifacts.filter(a => a.type !== artifactType);
    updatedArtifacts.push(artifact);

    await this.store.updateSession(sessionId, session.version, {
      artifacts: updatedArtifacts,
    });

    this.logAudit(operatorId, 'onboarding.artifact_regenerated', 'artifact', artifact.id);
    return artifact;
  }

  /** Approve a draft artifact. */
  async approveArtifact(
    sessionId: string,
    artifactId: string,
    operatorId: string,
  ): Promise<ArtifactDraft> {
    const session = await this.requireSession(sessionId);

    const artifactIndex = session.artifacts.findIndex(a => a.id === artifactId);
    if (artifactIndex === -1) {
      throw new OnboardingNotFoundError(`Artifact ${artifactId} not found`);
    }

    const artifact = session.artifacts[artifactIndex]!;
    if (artifact.status !== 'draft') {
      throw new OnboardingConflictError(`Artifact is ${artifact.status}, not draft`);
    }

    const updated: ArtifactDraft = { ...artifact, status: 'approved', approvedAt: new Date() };
    const updatedArtifacts = [...session.artifacts];
    updatedArtifacts[artifactIndex] = updated;

    await this.store.updateSession(sessionId, session.version, {
      artifacts: updatedArtifacts,
    });

    this.logAudit(operatorId, 'onboarding.artifact_approved', 'artifact', artifactId);
    return updated;
  }

  /** Reject a draft artifact with optional feedback for regeneration. */
  async rejectArtifact(
    sessionId: string,
    artifactId: string,
    operatorId: string,
    feedback?: string,
  ): Promise<ArtifactDraft> {
    const session = await this.requireSession(sessionId);

    const artifactIndex = session.artifacts.findIndex(a => a.id === artifactId);
    if (artifactIndex === -1) {
      throw new OnboardingNotFoundError(`Artifact ${artifactId} not found`);
    }

    const artifact = session.artifacts[artifactIndex]!;
    if (artifact.status !== 'draft') {
      throw new OnboardingConflictError(`Artifact is ${artifact.status}, not draft`);
    }

    const updated: ArtifactDraft = {
      ...artifact,
      status: 'rejected',
      rejectionFeedback: feedback,
    };
    const updatedArtifacts = [...session.artifacts];
    updatedArtifacts[artifactIndex] = updated;

    await this.store.updateSession(sessionId, session.version, {
      artifacts: updatedArtifacts,
    });

    this.logAudit(operatorId, 'onboarding.artifact_rejected', 'artifact', artifactId);
    return updated;
  }

  /** Get current onboarding status. */
  async getStatus(sessionId: string): Promise<OnboardingStatus> {
    const session = await this.requireSession(sessionId);
    const stageQuestions = getQuestionsForStage(session.stage);

    return {
      sessionId: session.sessionId,
      stage: session.stage,
      currentQuestion: session.currentQuestion,
      totalQuestionsInStage: stageQuestions.length,
      artifactCount: session.artifacts.length,
      approvedArtifactCount: session.artifacts.filter(a => a.status === 'approved').length,
      assetCount: session.assets.length,
      status: session.status,
    };
  }

  /** Get all artifacts for a session. */
  async getArtifacts(sessionId: string): Promise<ArtifactDraft[]> {
    const session = await this.requireSession(sessionId);
    return session.artifacts;
  }

  /** Complete onboarding. All artifacts must be approved (not draft or rejected). */
  async completeOnboarding(sessionId: string, operatorId: string): Promise<OnboardingSession> {
    const session = await this.requireSession(sessionId);

    // #10: Check that all artifacts are approved — reject draft AND rejected
    const unapproved = session.artifacts.filter(a => a.status !== 'approved');
    if (unapproved.length > 0) {
      const drafts = unapproved.filter(a => a.status === 'draft').length;
      const rejected = unapproved.filter(a => a.status === 'rejected').length;
      throw new OnboardingConflictError(
        `Cannot complete: ${drafts} draft and ${rejected} rejected artifact(s). All artifacts must be approved.`,
      );
    }

    const completed = await this.store.updateSession(sessionId, session.version, {
      status: 'completed',
      stage: 'completed',
      completedAt: new Date(),
    });

    this.logAudit(operatorId, 'onboarding.complete', 'session', sessionId);
    logger.info('Onboarding completed', { sessionId });

    return completed;
  }

  /**
   * Cancel and reset the active session.
   * If a cleanup function is provided, also cleans up object store assets (#9).
   */
  async resetSession(
    sessionId: string,
    operatorId: string,
    cleanupFn?: (sessionId: string) => Promise<number>,
  ): Promise<void> {
    await this.store.cancelSession(sessionId);
    await this.store.cancelSessionJobs(sessionId);
    if (cleanupFn) {
      await cleanupFn(sessionId);
    }
    this.logAudit(operatorId, 'onboarding.reset', 'session', sessionId);
    logger.info('Onboarding session reset', { sessionId });
  }

  /** Get active session for an org, if any. */
  async getActiveSession(orgId: string): Promise<OnboardingSession | null> {
    return this.store.getActiveSession(orgId);
  }

  /** List ingestion jobs for a session. */
  async listJobs(sessionId: string): Promise<IngestionJob[]> {
    return this.store.listJobs(sessionId);
  }

  /** Get a specific ingestion job. */
  async getJob(jobId: string): Promise<IngestionJob | null> {
    return this.store.getJob(jobId);
  }

  /** Verify that the operator owns the session (#13). */
  async verifySessionOwnership(sessionId: string, operatorId: string): Promise<void> {
    const session = await this.store.getSession(sessionId);
    if (!session) throw new OnboardingNotFoundError(`Session ${sessionId} not found`);
    if (session.operatorId !== operatorId) {
      throw new OnboardingConflictError('Session belongs to a different operator');
    }
  }

  /** Get current question for an existing session (#12 resume). */
  getCurrentQuestionForSession(session: OnboardingSession): QuestionResponse | null {
    return this.getQuestionForStage(session.stage, session.currentQuestion);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async requireSession(sessionId: string): Promise<OnboardingSession> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new OnboardingNotFoundError(`Session ${sessionId} not found`);
    }
    if (session.status !== 'active') {
      throw new OnboardingConflictError(`Session is ${session.status}, not active`);
    }
    return session;
  }

  private async generateArtifact(
    type: ArtifactType,
    answers: Record<string, string>,
    assets: OnboardingSession['assets'],
  ): Promise<ArtifactDraft> {
    const template = getTemplate(type);
    if (!template) {
      throw new Error(`No template registered for artifact type: ${type}`);
    }

    const messages = template.buildMessages(answers, assets);
    const response = await this.llmProvider.chat(messages, {
      temperature: 0.3,
      maxTokens: 4096,
    });

    return {
      id: randomUUID(),
      type,
      filename: template.filename,
      content: response.content,
      status: 'draft',
      generatedAt: new Date(),
    };
  }

  private getCurrentQuestion(session: OnboardingSession): QuestionResponse {
    const q = this.getQuestionForStage(session.stage, session.currentQuestion);
    if (!q) {
      throw new Error(`No question at index ${session.currentQuestion} for stage ${session.stage}`);
    }
    return q;
  }

  private getQuestionForStage(stage: OnboardingStage, index: number): QuestionResponse | null {
    const questions = getQuestionsForStage(stage);
    const q = questions[index];
    if (!q) return null;

    return {
      questionId: q.id,
      prompt: q.prompt,
      helpText: q.helpText,
      defaultAnswer: q.defaultAnswer,
      followUp: q.followUp,
      stageComplete: index >= questions.length - 1,
      nextStage: index >= questions.length - 1 ? this.getNextStage(stage) : undefined,
    };
  }

  private getNextStage(current: OnboardingStage): OnboardingStage {
    const idx = STAGE_ORDER.indexOf(current);
    if (idx === -1 || idx >= STAGE_ORDER.length - 1) return 'completed';
    return STAGE_ORDER[idx + 1]!;
  }

  private logAudit(operatorId: string, action: string, resourceType: string, resourceId: string): void {
    if (!this.auditLogger) return;
    this.auditLogger.log({
      timestamp: new Date(),
      operatorId,
      action,
      resource: { type: resourceType, id: resourceId },
      request: { method: 'POST', path: '/v1/onboarding', ip: 'internal' },
      decision: 'allowed',
    });
  }
}
