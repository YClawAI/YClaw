/**
 * Event publish ACL — maps event keys (source:type) to authorized publisher names.
 *
 * Fail-closed: events not in the ACL are denied with a warning log.
 * The source parameter in EventBus.publish() is checked against this map.
 */

import { createLogger } from '../logging/logger.js';

const log = createLogger('event-acl');

// ─── Types ───────────────────────────────────────────────────────────────────

export type AclMap = Record<string, string[]>;

// ─── Default ACL ─────────────────────────────────────────────────────────────

export const DEFAULT_ACL: AclMap = {
  // Architect
  'architect:build_directive': ['architect'],
  'architect:mechanic_task': ['architect'],
  'architect:pr_review': ['architect'],
  'architect:design_directive': ['architect'],
  'architect:task_complete': ['architect'],
  'architect:deploy_review': ['architect'],
  'architect:deploy_complete': ['architect'],
  'architect:rebase_needed': ['architect'],
  'architect:task_blocked': ['architect'],

  // Mechanic
  'mechanic:task_completed': ['mechanic'],
  'mechanic:task_failed': ['mechanic'],

  // AO (via callback handler)
  'ao:task_completed': ['ao-callback'],
  'ao:task_failed': ['ao-callback'],
  'ao:pr_ready': ['ao-callback'],
  'ao:pr_merged': ['ao-callback'],
  'ao:task_blocked': ['ao-callback'],
  'ao:spawn_failed': ['ao-callback'],

  // Builder compat aliases (legacy — kept for backward compatibility)
  'builder:pr_ready': ['ao-callback'],
  'builder:task_complete': ['ao-callback'],
  'builder:task_blocked': ['ao-callback'],
  'builder:task_failed': ['ao-callback'],
  'builder:spawn_failed': ['ao-callback'],

  // Strategist
  'strategist:midweek_adjustment': ['strategist'],
  'strategist:architect_directive': ['strategist'],
  'strategist:ember_directive': ['strategist'],
  'strategist:designer_directive': ['strategist'],
  'strategist:design_generate': ['strategist'],
  'strategist:standup_synthesis': ['strategist'],
  'strategist:sentinel_directive': ['strategist'],
  'strategist:keeper_directive': ['strategist'],
  'strategist:forge_directive': ['strategist'],
  'strategist:scout_directive': ['strategist'],
  'strategist:treasurer_directive': ['strategist'],
  'strategist:guide_directive': ['strategist'],
  'strategist:reviewer_directive': ['strategist'],
  'strategist:weekly_directive': ['strategist'],

  // Ember
  'ember:content_ready': ['ember'],
  'ember:needs_asset': ['ember'],
  'review:pending': ['ember', 'scout'],

  // Reviewer
  'reviewer:approved': ['reviewer'],
  'reviewer:flagged': ['reviewer'],

  // Designer
  'designer:design_review': ['designer'],
  'designer:design_generated': ['designer'],

  // Forge
  'forge:asset_ready': ['forge'],

  // Keeper
  'keeper:support_case': ['keeper'],

  // Treasurer
  'treasurer:low_balance': ['treasurer'],
  'treasurer:spend_report': ['treasurer'],

  // Deploy system
  'deploy:execute': ['deploy-system'],
  'deploy:review': ['deploy-system'],
  'deploy:approved': ['deploy-system'],
  'deployer:deploy_complete': ['deployer'],

  // GitHub webhooks
  'github:pr_opened': ['github-webhook'],
  'github:pr_updated': ['github-webhook'],
  'github:issue_assigned': ['github-webhook'],
  'github:issue_opened': ['github-webhook'],
  'github:issue_labeled': ['github-webhook'],
  'github:pr_review_submitted': ['github-webhook'],
  'github:pr_review_comment': ['github-webhook'],
  'github:ci_pass': ['github-webhook'],
  'github:ci_fail': ['github-webhook'],
  'github:repository_created': ['github-webhook'],

  // Coordination events
  'standup:report': [
    'architect', 'ember', 'scout', 'sentinel', 'strategist', 'reviewer',
    'designer', 'forge', 'keeper', 'guide', 'treasurer', 'mechanic',
  ],
  'claudeception:reflect': ['system'],

  // System events (budget enforcer publishes as 'system')
  'system:agent:budget_exceeded': ['system'],
  'system:agent:budget_warning': ['system'],

  // Objective events
  'objective:budget_exceeded': ['objective'],

  // Sentinel alerts
  'sentinel:alert': ['sentinel'],
  'sentinel:infra_alert': ['sentinel'],
  'sentinel:status_report': ['sentinel'],
  'sentinel:quality_report': ['sentinel'],

  // Discord (adapter publishes as 'discord', webhook as 'discord-webhook')
  'discord:message': ['discord', 'discord-webhook'],
  'discord:mention': ['discord', 'discord-webhook'],
  'discord:thread_reply': ['discord', 'discord-webhook'],
  'discord:react': ['discord', 'discord-webhook'],
};

// ─── ACL Check ───────────────────────────────────────────────────────────────

/**
 * Check whether a source agent is authorized to publish a given event.
 *
 * @returns `true` if the publish is allowed, `false` if denied.
 *
 * Fail-closed: events not in the ACL are denied.
 */
export function checkEventAcl(
  eventKey: string,
  sourceAgent: string,
  acl: AclMap = DEFAULT_ACL,
): boolean {
  const allowed = acl[eventKey];

  if (!allowed) {
    log.warn('ACL DENY — event not in ACL (fail-closed)', { eventKey, sourceAgent });
    return false;
  }

  if (!allowed.includes(sourceAgent)) {
    log.warn('ACL DENY — source not authorized for event', {
      eventKey,
      sourceAgent,
      allowedSources: allowed,
    });
    return false;
  }

  return true;
}
