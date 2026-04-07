import { createLogger } from '../logging/logger.js';

const logger = createLogger('risk-classifier');

// ─── File-Path Risk Classifier for Deploy Governance ────────────────────────
//
// Classifies deployment risk based on the file paths changed in a commit.
// Each file is matched against pattern tiers (LOW → CRITICAL). The overall
// deployment risk is the HIGHEST tier among all changed files.
//
// Used by deploy:assess to determine assessment behavior:
//   LOW      → skip assessment, auto-approve (docs-only fast-track)
//   MEDIUM   → skip assessment, auto-approve with notification
//   HIGH     → full assessment vote
//   CRITICAL → hard gates + Architect review + canary deploy
//

//

/**
 * Risk tiers ordered from lowest to highest.
 * Numeric values enable comparison: higher number = higher risk.
 */
export enum RiskTier {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/** Human-readable labels for each tier. */
export const RISK_TIER_LABELS: Record<RiskTier, string> = {
  [RiskTier.LOW]: 'low',
  [RiskTier.MEDIUM]: 'medium',
  [RiskTier.HIGH]: 'high',
  [RiskTier.CRITICAL]: 'critical',
};

// ─── Pattern Definitions ────────────────────────────────────────────────────
//
// Patterns are checked in order: CRITICAL first, then LOW, then MEDIUM.
// If a file matches none of these, it defaults to HIGH.
//
// CRITICAL is checked first because security-sensitive files must never
// be accidentally downgraded by a broader LOW or MEDIUM pattern.

/**
 * CRITICAL: Security-sensitive files that trigger hard gates + Architect review + canary deploy.
 *
 * Includes certificates, private keys, real environment files (all variants),
 * anything with "secret" or "credential" in the path, and infrastructure config.
 *
 * .env variants (.env, .env.local, .env.production, .env.staging, etc.)
 * are all CRITICAL because they may contain real secrets. Only .env.example
 * is safe (handled by MEDIUM tier). The negative lookahead (?!example$)
 * ensures .env.example is excluded from CRITICAL matching.
 *
 * KNOWN GOTCHA: The /secret/i and /credential/i patterns are intentionally
 * broad — they match ANY path containing "secret" or "credential" (case-
 * insensitive). This means paths like "docs/secret-management.md" or
 * "src/credential-validator.ts" will be classified as CRITICAL even though
 * they are not actual secrets. This is by design: false positives (extra
 * review) are safer than false negatives (missed secrets). If a file is
 * incorrectly flagged, the assessment can still approve it — but the file
 * will always require assessment + human review.
 */
const CRITICAL_PATTERNS: RegExp[] = [
  /\.pem$/i,                         // Certificates
  /\.key$/i,                         // Private keys
  /^\.env$/,                         // Root .env (exact match)
  /^\.env\.(?!example$)/,            // .env.* variants except .env.example
  /secret/i,                         // Anything with "secret" in the path
  /credential/i,                     // Anything with "credential" in the path
  /^infrastructure\//,               // Infrastructure configuration
];

/**
 * LOW: Documentation and non-runtime files that can auto-deploy.
 *
 * These files do not affect runtime behavior. Changes to them are safe
 * to deploy without assessment review.
 */
const LOW_PATTERNS: RegExp[] = [
  /\.md$/i,                          // All markdown files
  /^docs\//,                         // docs/ directory
  /^prompts\//,                      // prompts/ directory
  /^skills\//,                       // skills/ directory
  /^LICENSE$/,                       // License file
  /^CODEOWNERS$/,                    // Code owners
  /^\.gitignore$/,                   // Git ignore
  /^CLAUDE\.md$/,                    // Claude config doc
  /^\.claude\//,                     // Claude config directory
];

/**
 * MEDIUM: Configuration files that affect behavior but are low-risk.
 *
 * These files change runtime configuration (agent settings, linter rules,
 * env examples) but don't execute code directly. Auto-deploy with
 * notification to the assessment.
 */
const MEDIUM_PATTERNS: RegExp[] = [
  /^\.env\.example$/,                // Env example (no secrets)
  /^departments\/.*\.yaml$/,         // Agent config YAML
  /^\.prettierrc/,                   // Formatter config
  /^\.eslintrc/,                     // Linter config
];

// Everything else → HIGH (source code, Dockerfiles, CI workflows, etc.)

// ─── Classification Logic ───────────────────────────────────────────────────

/**
 * Classify a single file path into a risk tier.
 *
 * Check order matters:
 * 1. CRITICAL patterns first (security files must never be downgraded)
 * 2. LOW patterns (docs/non-runtime)
 * 3. MEDIUM patterns (config)
 * 4. Default: HIGH (source code, build config, CI, etc.)
 *
 * Note: CRITICAL patterns include broad /secret/i and /credential/i
 * matchers. See CRITICAL_PATTERNS JSDoc for known gotcha details.
 */
export function classifyFile(filepath: string): RiskTier {
  // 1. Check CRITICAL first — security-sensitive files
  if (CRITICAL_PATTERNS.some((p) => p.test(filepath))) {
    return RiskTier.CRITICAL;
  }

  // 2. Check LOW — documentation and non-runtime files
  if (LOW_PATTERNS.some((p) => p.test(filepath))) {
    return RiskTier.LOW;
  }

  // 3. Check MEDIUM — configuration files
  if (MEDIUM_PATTERNS.some((p) => p.test(filepath))) {
    return RiskTier.MEDIUM;
  }

  // 4. Default: HIGH — source code, build config, CI, etc.
  return RiskTier.HIGH;
}

/**
 * Classify the overall deployment risk from a list of changed files.
 *
 * The deployment risk is the HIGHEST tier among all changed files.
 * An empty file list returns HIGH (be safe — unknown changes are risky).
 *
 * @param files - Array of file paths changed in the deployment
 * @returns The highest RiskTier among all files
 */
export function classifyDeploymentRisk(files: string[]): RiskTier {
  if (files.length === 0) {
    logger.warn(
      'classifyDeploymentRisk: empty files list — defaulting to HIGH',
    );
    return RiskTier.HIGH;
  }

  let highest = RiskTier.LOW;
  const classifications: Array<{ file: string; tier: string }> = [];
  let shortCircuited = false;

  for (const file of files) {
    const tier = classifyFile(file);
    classifications.push({ file, tier: RISK_TIER_LABELS[tier] });

    if (tier > highest) {
      highest = tier;
    }

    // Short-circuit: if we hit CRITICAL, no need to check more files
    if (highest === RiskTier.CRITICAL) {
      shortCircuited = true;
      break;
    }
  }

  const classifiedCount = classifications.length;
  const totalCount = files.length;
  const suffix = shortCircuited
    ? ` (short-circuited at CRITICAL after ${classifiedCount}/${totalCount} files)`
    : '';

  logger.info(
    `classifyDeploymentRisk: ${totalCount} files → ${RISK_TIER_LABELS[highest]}${suffix}`,
    {
      classifications,
      classifiedCount,
      totalCount,
      shortCircuited,
      overall: RISK_TIER_LABELS[highest],
    },
  );

  return highest;
}
