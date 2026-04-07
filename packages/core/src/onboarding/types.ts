/**
 * Onboarding module types.
 *
 * Covers the full onboarding lifecycle: sessions, questions,
 * artifacts, ingested assets, ingestion jobs, and department presets.
 */

// ─── Onboarding Stages ──────────────────────────────────────────────────────

export type OnboardingStage =
  | 'org_framing'
  | 'ingestion'
  | 'departments'
  | 'operators'
  | 'validation'
  | 'completed';

/** Ordered list of stages for progression logic. */
export const STAGE_ORDER: readonly OnboardingStage[] = [
  'org_framing',
  'ingestion',
  'departments',
  'operators',
  'validation',
  'completed',
] as const;

// ─── Artifact Types ─────────────────────────────────────────────────────────

export type ArtifactType =
  | 'org_profile'
  | 'priorities'
  | 'brand_voice'
  | 'departments'
  | 'tools'
  | 'knowledge_index'
  | 'operators';

export type ArtifactStatus = 'draft' | 'approved' | 'rejected';

export interface ArtifactDraft {
  id: string;
  type: ArtifactType;
  filename: string;
  content: string;
  status: ArtifactStatus;
  generatedAt: Date;
  approvedAt?: Date;
  rejectionFeedback?: string;
}

// ─── Asset Classification ───────────────────────────────────────────────────

export type AssetClassification =
  | 'strategy_doc'
  | 'technical_spec'
  | 'brand_asset'
  | 'process_doc'
  | 'financial_doc'
  | 'support_doc'
  | 'general';

export type AssetSource = 'file' | 'url' | 'github' | 'text';

export interface OnboardingAsset {
  assetId: string;
  source: AssetSource;
  sourceUri: string;
  filename: string;
  contentHash: string;
  summary: string;
  classification: AssetClassification;
  department?: string;
  extractedText: string;
  importJobId: string;
  importedAt: Date;
  sizeBytes: number;
  objectKey: string;
}

// ─── Ingestion Jobs ─────────────────────────────────────────────────────────

export type IngestionJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface IngestionJob {
  jobId: string;
  sessionId: string;
  source: AssetSource;
  sourceUri: string;
  status: IngestionJobStatus;
  progress?: number;
  error?: string;
  result?: { assetId: string; summary: string };
  createdAt: Date;
  updatedAt: Date;
}

// ─── Session ────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'completed' | 'cancelled' | 'abandoned';

export interface OnboardingSession {
  sessionId: string;
  operatorId: string;
  orgId: string;

  // State machine
  stage: OnboardingStage;
  currentQuestion: number;

  // Accumulated answers
  answers: Record<string, string>;

  // Generated artifacts
  artifacts: ArtifactDraft[];

  // Ingested assets (metadata only — raw files in IObjectStore)
  assets: OnboardingAsset[];

  // Lifecycle
  status: SessionStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ─── Question Definitions ───────────────────────────────────────────────────

export interface QuestionDefinition {
  id: string;
  stage: OnboardingStage;
  prompt: string;
  helpText: string;
  defaultAnswer?: string;
  followUp?: string;
  /** Artifact this question contributes to. */
  artifactType?: ArtifactType;
}

// ─── Department Presets ─────────────────────────────────────────────────────

export interface DepartmentPreset {
  name: string;
  description: string;
  charter: string;
  agents: string[];
  recurringTasks: string[];
  escalationRules: string[];
}

// ─── Error Types ────────────────────────────────────────────────────────────

export class OnboardingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingConflictError';
  }
}

export class OnboardingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingNotFoundError';
  }
}
