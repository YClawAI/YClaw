// ─── Deploy Governance Module ───────────────────────────────────────────────
//
// File-path risk classification and deploy risk assessment.

//

export {
  RiskTier,
  RISK_TIER_LABELS,
  classifyFile,
  classifyDeploymentRisk,
} from './risk-classifier.js';

export {
  assessDeploymentRisk,
} from './risk-integration.js';

export type {
  RiskAssessmentResult,
} from './risk-integration.js';
