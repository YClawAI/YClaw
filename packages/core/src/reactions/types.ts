/**
 * ReactionsManager — Type definitions for the declarative reaction system.
 *
 * Reactions watch for GitHub webhook events (via the internal event bus) and
 * automatically trigger actions: merge PRs, close issues, trigger agents, etc.
 */

// ─── Reaction Rule ──────────────────────────────────────────────────────────

export interface ReactionRule {
  /** Unique rule identifier (e.g., 'auto-merge', 'ci-failed-on-pr'). */
  id: string;
  /** Whether this rule is active. */
  enabled: boolean;
  /** Event trigger — which event bus event activates this rule. */
  trigger: {
    /** Event type, e.g., 'github:ci_fail', 'github:pr_review_submitted'. */
    event: string;
    /** Optional filter: key-value pairs matched against event payload. */
    filter?: Record<string, unknown>;
  };
  /** Conditions that must ALL be true (evaluated via GitHub API queries). */
  conditions?: ReactionCondition[];
  /** Safety gates — hard requirements checked before destructive actions. */
  safetyGates?: SafetyGate[];
  /** Actions to execute (in order) when rule matches. */
  actions: ReactionAction[];
  /** Retry config for the primary agent:trigger action. */
  retry?: { max: number; delayMs: number };
  /** Escalation: fire a fallback action if no resolution within afterMs. */
  escalation?: { afterMs: number; action: ReactionAction };
}

// ─── Conditions ─────────────────────────────────────────────────────────────

export interface ReactionCondition {
  type:
    | 'pr_approved'
    | 'ci_green'
    | 'has_linked_issue'
    | 'task_exists'
    | 'label_present'
    | 'label_absent';
  params?: Record<string, unknown>;
}

// ─── Safety Gates ───────────────────────────────────────────────────────────

export interface SafetyGate {
  type:
    | 'all_checks_passed'
    | 'min_approvals'
    | 'no_merge_conflicts'
    | 'no_label'
    | 'dod_gate_passed'
    | 'required_reviewer'
    | 'comment_approved'
    | 'branch_up_to_date';
  params?: Record<string, unknown>;
}

// ─── Actions ────────────────────────────────────────────────────────────────

export interface ReactionAction {
  type:
    | 'github:merge_pr'
    | 'github:close_issue'
    | 'github:pr_comment'
    | 'agent:trigger'
    | 'task:update'
    | 'task:create'
    | 'event:publish'
    | 'discord:message'
    | 'github:update_branch';
  params: Record<string, unknown>;
}

// ─── Evaluation Context ─────────────────────────────────────────────────────

/** Context passed through the evaluation pipeline for a single event. */
export interface ReactionContext {
  /** The event type that triggered evaluation. */
  eventType: string;
  /** Full event payload from the bus. */
  payload: Record<string, unknown>;
  /** Extracted PR number (if applicable). */
  prNumber?: number;
  /** Extracted issue number (if applicable). */
  issueNumber?: number;
  /** Repository owner. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Correlation ID for tracing. */
  correlationId?: string;
}

// ─── Audit Log Entry ────────────────────────────────────────────────────────

export interface ReactionAuditEntry {
  timestamp: number;
  ruleId: string;
  eventType: string;
  resource: string; // e.g., 'pr:42' or 'issue:17'
  conditionsPassed: boolean;
  gatesPassed: boolean;
  actionsExecuted: string[];
  actionsFailed: string[];
  error?: string;
}
