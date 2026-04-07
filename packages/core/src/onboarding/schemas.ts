/**
 * Zod schemas for onboarding data validation.
 */

import { z } from 'zod';

// ─── Request Schemas ────────────────────────────────────────────────────────

export const StartSessionSchema = z.object({
  orgId: z.string().min(1).max(100).optional(),
});

export const AnswerQuestionSchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().min(1),
  answer: z.string().min(1).max(10_000),
});

export const ApproveArtifactSchema = z.object({
  sessionId: z.string().uuid(),
  artifactId: z.string().min(1),
});

export const RejectArtifactSchema = z.object({
  sessionId: z.string().uuid(),
  artifactId: z.string().min(1),
  feedback: z.string().max(5_000).optional(),
});

export const IngestUrlSchema = z.object({
  sessionId: z.string().uuid(),
  url: z.string().url().max(2_000),
});

export const IngestGitHubSchema = z.object({
  sessionId: z.string().uuid(),
  repoUrl: z.string().url().max(500),
  branch: z.string().max(200).optional(),
});

export const IngestTextSchema = z.object({
  sessionId: z.string().uuid(),
  content: z.string().min(1).max(100_000),
  title: z.string().min(1).max(200),
});

export const CompleteOnboardingSchema = z.object({
  sessionId: z.string().uuid(),
});

// ─── Artifact Content Schema ────────────────────────────────────────────────

export const ArtifactTypeSchema = z.enum([
  'org_profile',
  'priorities',
  'brand_voice',
  'departments',
  'tools',
  'knowledge_index',
  'operators',
]);

export const AssetClassificationSchema = z.enum([
  'strategy_doc',
  'technical_spec',
  'brand_asset',
  'process_doc',
  'financial_doc',
  'support_doc',
  'general',
]);

// ─── Job Status Schema ──────────────────────────────────────────────────────

export const IngestionJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
