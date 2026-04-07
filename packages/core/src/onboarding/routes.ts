/**
 * Onboarding API routes.
 *
 * All routes live under /v1/onboarding/* and require authenticated root operator.
 * Session ownership is verified — operators can only access sessions they started.
 */

import type { Express, Request, Response } from 'express';
import { createLogger } from '../logging/logger.js';
import type { OnboardingService } from './service.js';
import type { IngestionService } from './ingestion-service.js';
import type { OperatorAuditLogger } from '../operators/audit-logger.js';
import type { ValidationRunner } from './validation.js';
import type { Operator } from '../operators/types.js';
import { OnboardingConflictError, OnboardingNotFoundError } from './types.js';
import {
  StartSessionSchema,
  AnswerQuestionSchema,
  ApproveArtifactSchema,
  RejectArtifactSchema,
  CompleteOnboardingSchema,
  IngestUrlSchema,
  IngestGitHubSchema,
  IngestTextSchema,
} from './schemas.js';

const logger = createLogger('onboarding-routes');

function getOperator(req: Request): Operator | undefined {
  return (req as Request & { operator?: Operator }).operator;
}

function requireRoot(req: Request, res: Response): Operator | null {
  const operator = getOperator(req);
  if (!operator) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  if (operator.tier !== 'root') {
    res.status(403).json({ error: 'Root operator required for onboarding' });
    return null;
  }
  return operator;
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof OnboardingConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof OnboardingNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  logger.error('Onboarding route error', { error: msg });
  res.status(500).json({ error: 'Internal server error' });
}

/** Register core onboarding routes (session, questions, artifacts). */
function registerSessionRoutes(app: Express, service: OnboardingService, ingestionService?: IngestionService | null): void {
  app.post('/v1/onboarding/start', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = StartSessionSchema.parse(req.body);
      const orgId = body.orgId ?? 'default';
      const result = await service.startSession(operator.operatorId, orgId);
      res.status(201).json({
        sessionId: result.session.sessionId,
        question: result.question,
      });
    } catch (err) { handleError(err, res); }
  });

  app.post('/v1/onboarding/answer', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = AnswerQuestionSchema.parse(req.body);
      await service.verifySessionOwnership(body.sessionId, operator.operatorId);
      const result = await service.answerQuestion(
        body.sessionId, body.questionId, body.answer, operator.operatorId,
      );
      res.json({ question: result.question, artifactsGenerated: result.artifactsGenerated });
    } catch (err) { handleError(err, res); }
  });

  // #12: Session resume — returns current question for existing active session
  app.get('/v1/onboarding/status', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const sessionId = req.query['sessionId'] as string | undefined;
      if (!sessionId) {
        const orgId = (req.query['orgId'] as string | undefined) ?? 'default';
        const session = await service.getActiveSession(orgId);
        if (!session) { res.json({ active: false }); return; }
        await service.verifySessionOwnership(session.sessionId, operator.operatorId);
        const status = await service.getStatus(session.sessionId);
        const question = service.getCurrentQuestionForSession(session);
        res.json({ active: true, ...status, currentQuestionData: question });
        return;
      }
      await service.verifySessionOwnership(sessionId, operator.operatorId);
      const status = await service.getStatus(sessionId);
      res.json({ active: true, ...status });
    } catch (err) { handleError(err, res); }
  });

  app.get('/v1/onboarding/artifacts', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const sessionId = req.query['sessionId'] as string;
      if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
      await service.verifySessionOwnership(sessionId, operator.operatorId);
      const artifacts = await service.getArtifacts(sessionId);
      res.json({ artifacts });
    } catch (err) { handleError(err, res); }
  });

  app.post('/v1/onboarding/artifacts/:id/approve', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = ApproveArtifactSchema.parse({
        sessionId: req.body?.sessionId,
        artifactId: req.params['id'],
      });
      await service.verifySessionOwnership(body.sessionId, operator.operatorId);
      const artifact = await service.approveArtifact(
        body.sessionId, body.artifactId, operator.operatorId,
      );
      res.json({ artifact });
    } catch (err) { handleError(err, res); }
  });

  app.post('/v1/onboarding/artifacts/:id/reject', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = RejectArtifactSchema.parse({
        sessionId: req.body?.sessionId,
        artifactId: req.params['id'],
        feedback: req.body?.feedback,
      });
      await service.verifySessionOwnership(body.sessionId, operator.operatorId);
      const artifact = await service.rejectArtifact(
        body.sessionId, body.artifactId, operator.operatorId, body.feedback,
      );
      res.json({ artifact });
    } catch (err) { handleError(err, res); }
  });

  app.post('/v1/onboarding/complete', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = CompleteOnboardingSchema.parse(req.body);
      await service.verifySessionOwnership(body.sessionId, operator.operatorId);
      const session = await service.completeOnboarding(body.sessionId, operator.operatorId);
      res.json({ sessionId: session.sessionId, status: session.status });
    } catch (err) { handleError(err, res); }
  });

  app.delete('/v1/onboarding/session', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const sessionId = req.query['sessionId'] as string | undefined;
      if (!sessionId) {
        const orgId = (req.query['orgId'] as string | undefined) ?? 'default';
        const session = await service.getActiveSession(orgId);
        if (!session) { res.status(404).json({ error: 'No active session found' }); return; }
        await service.verifySessionOwnership(session.sessionId, operator.operatorId);
        const cleanupFn = ingestionService ? (sid: string) => ingestionService.cleanupSessionAssets(sid) : undefined;
        await service.resetSession(session.sessionId, operator.operatorId, cleanupFn);
        res.json({ cancelled: true, sessionId: session.sessionId });
        return;
      }
      await service.verifySessionOwnership(sessionId, operator.operatorId);
      const cleanupFn = ingestionService ? (sid: string) => ingestionService.cleanupSessionAssets(sid) : undefined;
      await service.resetSession(sessionId, operator.operatorId, cleanupFn);
      res.json({ cancelled: true, sessionId });
    } catch (err) { handleError(err, res); }
  });
}

/** Register ingestion routes (file, URL, GitHub, text). */
function registerIngestionRoutes(app: Express, service: OnboardingService, ingestionService: IngestionService): void {
  // File upload via base64 JSON (MC proxies multipart → base64)
  app.post('/v1/onboarding/ingest', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const { sessionId, filename, mimetype, content, size } = req.body as {
        sessionId?: string; filename?: string; mimetype?: string; content?: string; size?: number;
      };
      if (!sessionId || !filename || !content) {
        res.status(400).json({ error: 'sessionId, filename, and content (base64) required' });
        return;
      }
      await service.verifySessionOwnership(sessionId, operator.operatorId);
      const buffer = Buffer.from(content, 'base64');
      const asset = await ingestionService.ingestFile(sessionId, {
        originalname: filename,
        mimetype: mimetype ?? 'application/octet-stream',
        buffer,
        size: size ?? buffer.length,
      });
      res.json({ asset });
    } catch (err) { handleError(err, res); }
  });

  app.post('/v1/onboarding/ingest/url', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = IngestUrlSchema.parse(req.body);
      await service.verifySessionOwnership(body.sessionId, operator.operatorId);
      const asset = await ingestionService.ingestUrl(body.sessionId, body.url);
      res.json({ asset });
    } catch (err) { handleError(err, res); }
  });

  app.post('/v1/onboarding/ingest/github', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = IngestGitHubSchema.parse(req.body);
      await service.verifySessionOwnership(body.sessionId, operator.operatorId);
      const asset = await ingestionService.ingestGitHub(body.sessionId, body.repoUrl, body.branch);
      res.json({ asset });
    } catch (err) { handleError(err, res); }
  });

  app.post('/v1/onboarding/ingest/text', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const body = IngestTextSchema.parse(req.body);
      await service.verifySessionOwnership(body.sessionId, operator.operatorId);
      const asset = await ingestionService.ingestText(body.sessionId, body.content, body.title);
      res.json({ asset });
    } catch (err) { handleError(err, res); }
  });

  // Job status polling
  app.get('/v1/onboarding/jobs', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const sessionId = req.query['sessionId'] as string;
      if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
      await service.verifySessionOwnership(sessionId, operator.operatorId);
      const jobs = await service.listJobs(sessionId);
      res.json({ jobs });
    } catch (err) { handleError(err, res); }
  });

  app.get('/v1/onboarding/jobs/:id', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const jobId = req.params['id']!;
      const job = await service.getJob(jobId);
      if (!job) { res.status(404).json({ error: `Job ${jobId} not found` }); return; }
      await service.verifySessionOwnership(job.sessionId, operator.operatorId);
      res.json({ job });
    } catch (err) { handleError(err, res); }
  });
}

/** Register validation routes. */
function registerValidationRoutes(app: Express, service: OnboardingService, validationRunner: ValidationRunner): void {
  app.post('/v1/onboarding/validate', async (req: Request, res: Response) => {
    const operator = requireRoot(req, res);
    if (!operator) return;
    try {
      const sessionId = req.body?.sessionId as string;
      if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
      await service.verifySessionOwnership(sessionId, operator.operatorId);
      const report = await validationRunner.runValidation(sessionId);
      res.json(report);
    } catch (err) { handleError(err, res); }
  });
}

export function registerOnboardingRoutes(
  app: Express,
  service: OnboardingService,
  _auditLogger: OperatorAuditLogger,
  validationRunner?: ValidationRunner | null,
  ingestionService?: IngestionService | null,
): void {
  registerSessionRoutes(app, service, ingestionService);

  if (ingestionService) {
    registerIngestionRoutes(app, service, ingestionService);
  }

  if (validationRunner) {
    registerValidationRoutes(app, service, validationRunner);
  }

  logger.info('Onboarding routes registered at /v1/onboarding/*');
}
