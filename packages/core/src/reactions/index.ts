/**
 * Reactions module — declarative lifecycle automation for GitHub events.
 */

export { ReactionsManager } from './manager.js';
export type { ReactionsManagerDeps } from './manager.js';
export { ReactionEvaluator } from './evaluator.js';
export { EscalationManager } from './escalation.js';
export { DEFAULT_REACTION_RULES } from './rules.js';
export {
  evaluateDoDGate,
  findImmutableViolations,
  hasTestCoverage,
} from './dod-gate.js';
export type {
  DoDCheckResult,
  DoDCheck,
  DoDGateContext,
} from './dod-gate.js';
export {
  evaluateRequiredReviewerGate,
} from './required-reviewer-gate.js';
export type {
  RequiredReviewerParams,
  RequiredReviewerResult,
} from './required-reviewer-gate.js';
export type {
  ReactionRule,
  ReactionAction,
  ReactionCondition,
  SafetyGate,
  ReactionContext,
  ReactionAuditEntry,
} from './types.js';
