/**
 * Event payload schemas — enforced at publish AND consume time.
 * Prevents misrouted events (e.g., Issue #92: architect:pr_review
 * being published for non-PR-review task completions).
 */

export interface EventSchema {
  required: string[];
  description: string;
}

/**
 * Registry of known event schemas. Events not in this registry
 * are allowed through without validation (backward compatible).
 */
export const EVENT_SCHEMAS: Record<string, EventSchema> = {
  'architect:pr_review': {
    required: ['pr_number', 'status'],
    description: 'Architect completed a PR review (approved or changes_requested)',
  },
  'builder:pr_ready': {
    required: ['pr_number', 'repo'],
    description: 'Builder created a PR ready for review',
  },
  'github:ci_fail': {
    required: ['repo', 'branch', 'commit_sha'],
    description: 'CI failed on a branch',
  },
  'github:ci_pass': {
    required: ['repo', 'branch', 'commit_sha'],
    description: 'CI passed on a branch',
  },
  'github:pr_review_submitted': {
    required: ['pr_number', 'review_state'],
    description: 'A formal review was submitted on a PR',
  },
  'github:pr_review_comment': {
    required: ['pr_number', 'review_state'],
    description: 'Architect (or reviewer) posted a ## Architect Review comment on a PR',
  },
  'github:issue_assigned': {
    required: ['issue_number'],
    description: 'An issue was assigned to an agent',
  },
  'github:issue_opened': {
    required: ['issue_number'],
    description: 'A new issue was created',
  },
  'github:issue_labeled': {
    required: ['issue_number', 'label_added'],
    description: 'A label was added to an issue',
  },
  'keeper:support_case': {
    required: ['user_id', 'message'],
    description: 'Keeper escalating a support case to Guide',
  },
  'architect:build_directive': {
    required: ['repo'],
    description: 'Architect publishes a build directive for AO to spawn a coding session',
  },
  'architect:deploy_complete': {
    required: ['repo', 'status'],
    description: 'Architect finished a deployment (status: deployed | failed | rolled_back)',
  },
  'ao:task_failed': {
    required: ['error'],
    description: 'AO task failed — includes issue context and failure reason',
  },
  'ao:spawn_failed': {
    required: ['eventKey', 'reason'],
    description: 'AO could not spawn a coding session — circuit open, missing repo, or unreachable',
  },
  'ao:task_completed': {
    required: [],
    description: 'AO task completed successfully',
  },
  'ao:pr_ready': {
    required: ['pr_number', 'repo'],
    description: 'AO created a PR ready for review',
  },
  'ao:task_blocked': {
    required: ['reason'],
    description: 'AO task blocked — needs human or external input',
  },
  // ─── Builder compat aliases (yclaw generic naming) ──────────────────────────
  'builder:task_complete': {
    required: [],
    description: 'Builder/AO task completed (compat alias for ao:task_completed)',
  },
  'builder:task_blocked': {
    required: ['reason'],
    description: 'Builder/AO task blocked (compat alias for ao:task_blocked)',
  },
  'builder:task_failed': {
    required: ['error'],
    description: 'Builder/AO task failed (compat alias for ao:task_failed)',
  },
  'builder:spawn_failed': {
    required: ['eventKey', 'reason'],
    description: 'Builder/AO spawn failed (compat alias for ao:spawn_failed)',
  },
  // ─── Deploy Governance v2 ──────────────────────────────────────────────────
  'deploy:review': {
    required: ['deployment_id', 'repo', 'environment'],
    description: 'CRITICAL-tier deployment requires Architect review before deploy:execute can proceed',
  },
  'architect:deploy_review': {
    required: ['deployment_id', 'decision'],
    description: 'Architect deploy review decision (APPROVE or REQUEST_CHANGES) — advisory audit trail',
  },
  'deploy:approved': {
    required: ['deployment_id', 'repo', 'environment'],
    description: 'CRITICAL-tier deployment approved by Architect — Strategist will call deploy:execute',
  },
};

/**
 * Validate an event payload against its schema.
 * Returns null if valid or unregistered (backward compatible).
 * Returns array of missing field names if invalid.
 */
export function validateEventPayload(
  eventKey: string,
  payload: Record<string, unknown>,
): string[] | null {
  const schema = EVENT_SCHEMAS[eventKey];
  if (!schema) return null; // Unknown events pass through

  const missing = schema.required.filter(f => !(f in payload));
  return missing.length > 0 ? missing : null;
}
