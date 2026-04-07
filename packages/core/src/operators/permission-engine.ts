import type { Operator } from './types.js';
import type { Role, Grant } from './roles.js';

// ─── Permission Check Types ────────────────────────────────────────────────────

export interface PermissionCheck {
  operatorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
}

export interface PermissionResult {
  allowed: boolean;
  reason: 'root_access' | 'role_grant' | 'department_match' | 'denied_no_grant' | 'denied_observer';
  effectiveGrants: Grant[];
}

// ─── Agent-to-Department Mapping ───────────────────────────────────────────────

/** Build a lookup map of agent name → department slug from loaded agent configs. */
export function buildAgentDepartmentMap(
  configs: Map<string, { department: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, config] of configs) {
    map.set(name, config.department);
  }
  return map;
}

// ─── Permission Evaluation ─────────────────────────────────────────────────────

/** Actions observers are always denied. */
const WRITE_ACTIONS = new Set(['trigger', 'cancel', 'approve', 'create', 'update', 'delete']);

/** Standard actions allowed via department membership alone (no explicit grant needed). */
const STANDARD_DEPARTMENT_ACTIONS = new Set(['read', 'trigger', 'cancel_own']);

/**
 * Evaluate whether an operator has permission to perform an action.
 * Accepts multiple roles for multi-role aggregation.
 *
 * Priority:
 * 1. Root operator → always allowed
 * 2. Observer trying to write → always denied
 * 3. Aggregated role grants (explicit resource/action match across ALL roles)
 * 4. Department-based access (operator.departments includes target) — standard actions only
 * 5. Deny by default
 */
export function evaluatePermission(
  operator: Operator,
  roles: Role[],
  check: PermissionCheck,
  agentDepartmentMap?: Map<string, string>,
): PermissionResult {
  // 1. Root always allowed
  if (operator.tier === 'root') {
    return { allowed: true, reason: 'root_access', effectiveGrants: [] };
  }

  // 2. Observer can't perform write actions
  if (operator.tier === 'observer' && WRITE_ACTIONS.has(check.action)) {
    return { allowed: false, reason: 'denied_observer', effectiveGrants: [] };
  }

  // 3. Check explicit role grants across ALL assigned roles
  const allGrants = roles.flatMap((r) => r.grants);
  if (allGrants.length > 0) {
    const matchingGrants = allGrants.filter((grant) => {
      // Resource type match (exact or wildcard within the grant's actions)
      if (grant.resourceType !== check.resourceType) return false;
      // Resource ID match
      if (grant.resourceId !== check.resourceId && grant.resourceId !== '*') return false;
      // Action match
      if (!grant.actions.includes(check.action) && !grant.actions.includes('*')) return false;
      return true;
    });

    if (matchingGrants.length > 0) {
      return { allowed: true, reason: 'role_grant', effectiveGrants: matchingGrants };
    }
  }

  // 4. Department-based access (standard actions only)
  if (operator.departments.includes('*')) {
    if (STANDARD_DEPARTMENT_ACTIONS.has(check.action)) {
      return { allowed: true, reason: 'department_match', effectiveGrants: [] };
    }
    // Wildcard departments but non-standard action → need explicit grant
    return { allowed: false, reason: 'denied_no_grant', effectiveGrants: [] };
  }

  // Resolve the target department
  let targetDepartment: string | undefined;

  if (check.resourceType === 'department') {
    targetDepartment = check.resourceId;
  } else if (check.resourceType === 'agent' && agentDepartmentMap) {
    targetDepartment = agentDepartmentMap.get(check.resourceId);
  }

  if (targetDepartment && operator.departments.includes(targetDepartment)) {
    // Only standard actions are allowed via department membership
    if (STANDARD_DEPARTMENT_ACTIONS.has(check.action)) {
      return { allowed: true, reason: 'department_match', effectiveGrants: [] };
    }
    // Non-standard action in own department → need explicit grant
    return { allowed: false, reason: 'denied_no_grant', effectiveGrants: [] };
  }

  // 5. Deny by default
  return { allowed: false, reason: 'denied_no_grant', effectiveGrants: [] };
}
