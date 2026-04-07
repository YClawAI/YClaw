import type { AuditLog } from '../../logging/audit.js';
import type { RepoRegistry } from '../../config/repo-registry.js';
import type { EventBus } from '../../triggers/event.js';
import type { Redis } from 'ioredis';

// ─── Constants ──────────────────────────────────────────────────────────────

export const VALID_ENVIRONMENTS = new Set(['dev', 'staging', 'production']);

/** Dedup TTL — same repo+env+commit won't be assessed again within this window. */
export const ASSESS_DEDUP_TTL = 30 * 60; // 30 minutes

/**
 * Extended dedup TTL for CRITICAL-tier deployments pending architect review.
 * Architect review is human-in-the-loop and can legitimately take longer than
 * the default 30-minute window. Using the shorter TTL caused the dedup key to
 * expire mid-review, allowing re-assessment that treated the deployment as
 * 'stale' and rejected it.
 */
export const CRITICAL_ASSESS_DEDUP_TTL = 2 * 60 * 60; // 2 hours

/** Production deploy lock TTL — max 1 concurrent deploy per repo+env. */
export const DEPLOY_LOCK_TTL = 15 * 60; // 15 minutes (covers canary 10-min window)

/**
 * Stale deployment threshold for startup cleanup.
 * Pending deployments older than this are considered abandoned and may be cleared.
 * CRITICAL-tier deployments legitimately stay 'pending' while awaiting architect review,
 * so only deployments older than this threshold are cleared at startup.
 */
export const STALE_DEPLOYMENT_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Exact root-level filenames that are always docs-only. */
const DOCS_ONLY_EXACT = new Set(['LICENSE', 'CODEOWNERS', '.gitignore']);

/** Directory prefixes that are always docs-only (any file under them). */
const DOCS_ONLY_DIRS = ['docs/', 'prompts/', 'skills/'];

/**
 * Returns true if the changed file is documentation/config that carries no runtime risk.
 * Docs-only changes in a critical-tier repo skip hard gates and go straight to auto-approve.
 */
export function isDocsOnlyFile(filename: string): boolean {
  if (filename.endsWith('.md')) return true;
  if (DOCS_ONLY_EXACT.has(filename)) return true;
  return DOCS_ONLY_DIRS.some(dir => filename.startsWith(dir));
}

/**
 * DoD checks that are skipped by default because they are not yet implemented
 * or require external integration.
 */
export const DEFAULT_SKIP_CHECKS = new Set(['review_comments']);

// ─── Canary Timing ───────────────────────────────────────────────────────────

export const CANARY_HEALTH_CHECK_INTERVAL_MS = 60_000;    // poll every 60s
export const CANARY_HEALTH_CHECK_WINDOW_MS = 10 * 60_000; // 10-minute window

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface DodCheckResult {
  passed: boolean;
  failures: string[];
  skipped: string[];
}

export interface DeployAssessParams {
  repo: string;
  environment: string;
  pr_url?: string;
  commit_sha?: string;
  diff_summary: string;
  /** Full unified diff patches (concatenated from GitHub Compare API patch fields).
   *  Used by HardGateRunner for deterministic security scanning on CRITICAL-tier deploys. */
  diff_patches?: string;
  test_results: string;
  files_changed: string[];
  correlationId?: string;
}

export interface DeployExecuteParams {
  repo: string;
  environment: string;
  deployment_id: string;
  commit_sha?: string;
  correlationId?: string;
  /** DoD gate checks to skip. 'review_comments' is skipped by default. */
  skipDodChecks?: string[];
}

/** Shared dependencies injected into deploy sub-modules. */
export interface DeployDeps {
  auditLog: AuditLog;
  registry: RepoRegistry;
  eventBus: EventBus | null;
  redis: Redis | null;
  slackAlerter: ((message: string, channel?: string) => Promise<void>) | null;
}
