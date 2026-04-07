import { createLogger } from '../logging/logger.js';
import {
  RiskTier,
  RISK_TIER_LABELS,
  classifyDeploymentRisk,
} from './risk-classifier.js';
import type { RiskTierType } from '../config/repo-schema.js';

const logger = createLogger('risk-integration');

// ─── Risk-Based Deploy Governance Integration ───────────────────────────────
//
// Bridges the file-path risk classifier with the deployment assessment.
// Called by deploy:assess after receiving files_changed to determine
// whether to skip, notify, or invoke the full assessment.
//
//

/**
 * Result of risk-based assessment.
 *
 * - `skipAssessment: true` means the assessment should NOT be invoked.
 * - `requireHuman: false` always. CRITICAL tier now uses hard gates + Architect review instead.
 * - `notify: true` means the assessment should be notified post-deploy.
 * - `riskTier` is the file-path risk tier label.
 * - `repoRiskTier` is the mapped repo-level risk tier for the assessment.
 */
export interface RiskAssessmentResult {
  skipAssessment: boolean;
  requireHuman: boolean;
  notify: boolean;
  approved: boolean;
  riskTier: string;
  repoRiskTier: RiskTierType;
  reason: string;
}

/**
 * Map file-path RiskTier to repo-level RiskTierType for the assessment.
 *
 * The deployment assessment uses 'auto' | 'guarded' | 'critical'.
 * The file-path classifier uses LOW | MEDIUM | HIGH | CRITICAL.
 *
 * Mapping:
 *   LOW      → 'auto'     (assessment skipped entirely)
 *   MEDIUM   → 'auto'     (assessment skipped, notification sent)
 *   HIGH     → 'guarded'  (full assessment vote, majority required)
 *   CRITICAL → 'critical' (hard gates + Architect review + canary deploy)
 */
function mapToRepoRiskTier(tier: RiskTier): RiskTierType {
  switch (tier) {
    case RiskTier.LOW:
      return 'auto';
    case RiskTier.MEDIUM:
      return 'auto';
    case RiskTier.HIGH:
      return 'guarded';
    case RiskTier.CRITICAL:
      return 'critical';
    default: {
      const _exhaustive: never = tier;
      throw new Error(`Unknown risk tier: ${_exhaustive}`);
    }
  }
}

/**
 * Assess deployment risk based on changed files and determine assessment behavior.
 *
 * Decision matrix (from docs/dev-dept-option-c-plan.md):
 *
 * | Risk Tier | Assessment     | Human | Action                              |
 * |-----------|-------------|-------|-------------------------------------|
 * | LOW       | Skip        | No    | Auto-approve, docs-only fast-track  |
 * | MEDIUM    | Skip+Notify | No    | Auto-approve, notify assessment        |
 * | HIGH      | Full vote   | No    | Assessment must approve (2/3 votes)    |
 * | CRITICAL  | Hard+Arch   | No    | Hard gates + Architect review + canary deploy |
 *
 * @param filesChanged - Array of file paths changed in the deployment
 * @returns Assessment result with assessment behavior flags
 */
export function assessDeploymentRisk(
  filesChanged: string[],
): RiskAssessmentResult {
  const tier = classifyDeploymentRisk(filesChanged);
  const tierLabel = RISK_TIER_LABELS[tier];
  const repoRiskTier = mapToRepoRiskTier(tier);

  logger.info(`Risk assessment: ${tierLabel} (${filesChanged.length} files)`, {
    tier: tierLabel,
    repoRiskTier,
    fileCount: filesChanged.length,
  });

  switch (tier) {
    case RiskTier.LOW:
      return {
        skipAssessment: true,
        requireHuman: false,
        notify: false,
        approved: true,
        riskTier: tierLabel,
        repoRiskTier,
        reason: `Docs-only fast-track: all ${filesChanged.length} files are documentation/non-runtime`,
      };

    case RiskTier.MEDIUM:
      return {
        skipAssessment: true,
        requireHuman: false,
        notify: true,
        approved: true,
        riskTier: tierLabel,
        repoRiskTier,
        reason: `Config-only auto-approve: ${filesChanged.length} files are configuration (assessment notified)`,
      };

    case RiskTier.HIGH:
      return {
        skipAssessment: false,
        requireHuman: false,
        notify: false,
        approved: false,
        riskTier: tierLabel,
        repoRiskTier,
        reason: `Code changes detected: full assessment vote required`,
      };

    case RiskTier.CRITICAL:
      return {
        skipAssessment: false,
        requireHuman: false,
        notify: false,
        approved: false,
        riskTier: tierLabel,
        repoRiskTier,
        reason: `Critical files detected: hard gates + Architect review + canary deploy required`,
      };
  }
}
