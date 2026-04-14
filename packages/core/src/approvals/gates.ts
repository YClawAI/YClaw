// ─── Approval Gate Definitions ───────────────────────────────────────────────
//
// Maps action types to their approval requirements. Actions matching a gate
// require approval before execution. `requiresHuman: true` means only a human
// can approve; `requiresHuman: false` means Strategist or Architect can approve.
//
// APPROVAL_MODE environment variable controls behavior:
//   'strict'  (default) — all gates active, approval required before execution
//   'lenient' — auto-approve low/medium risk actions, only require approval for high/critical
//   'disabled' — skip ALL gates (emergency only, logged loudly at startup)
//
// IMPORTANT: deploy:execute uses requiresHuman: false because the deploy
// governance pipeline (risk-classifier → risk-integration → Architect review)
// already gates CRITICAL deploys through Architect review + hard gates + canary.
// Adding a separate human approval on top creates contradictory alerts:
// Architect approves and starts the deploy, but a stale "human approval required"
// message lingers in #yclaw-alerts. See PR #456 incident (2026-03-21).
//
// For TRUE safety-critical actions (modifying safety rails, outbound guards),
// safety:modify retains requiresHuman: true — these bypass the deploy pipeline.

import { createLogger } from '../logging/logger.js';
import type { ApprovalGateConfig } from './types.js';

const logger = createLogger('approvals');

export type ApprovalMode = 'strict' | 'lenient' | 'disabled';

export const APPROVAL_MODE: ApprovalMode = (() => {
  const raw = process.env.APPROVAL_MODE?.toLowerCase();
  if (raw === 'disabled' || raw === 'lenient') return raw;
  return 'strict';
})();

// Startup warning for non-strict modes
if (APPROVAL_MODE !== 'strict') {
  const msg = APPROVAL_MODE === 'disabled'
    ? '⚠️  APPROVAL_MODE=disabled — ALL approval gates are bypassed. Use only for emergencies.'
    : '⚠️  APPROVAL_MODE=lenient — low/medium risk actions are auto-approved.';
  logger.warn(msg);
  // Also log to stderr for container logs
  console.warn(`[approvals] ${msg}`);
}

const ALL_GATES: Record<string, ApprovalGateConfig> = {
  'deploy:execute': {
    riskLevel: 'high',
    channel: '#yclaw-alerts',
    requiresHuman: false,
  },
  'safety:modify': {
    riskLevel: 'critical',
    channel: '#yclaw-alerts',
    requiresHuman: true,
  },
  'agent:config_change': {
    riskLevel: 'medium',
    channel: '#yclaw-operations',
    requiresHuman: false,
  },
  'cost:above_threshold': {
    riskLevel: 'high',
    channel: '#yclaw-alerts',
    requiresHuman: true,
  },
  'github:delete_branch': {
    riskLevel: 'medium',
    channel: '#yclaw-development',
    requiresHuman: false,
  },
  'external:new_integration': {
    riskLevel: 'medium',
    channel: '#yclaw-operations',
    requiresHuman: true,
  },
};

function filterGatesByMode(
  gates: Record<string, ApprovalGateConfig>,
  mode: ApprovalMode,
): Record<string, ApprovalGateConfig> {
  if (mode === 'disabled') return {};
  if (mode === 'strict') return gates;

  // Lenient: keep only high/critical gates
  const filtered: Record<string, ApprovalGateConfig> = {};
  for (const [action, config] of Object.entries(gates)) {
    if (config.riskLevel === 'high' || config.riskLevel === 'critical') {
      filtered[action] = config;
    }
  }
  return filtered;
}

export const APPROVAL_GATES: Record<string, ApprovalGateConfig> = filterGatesByMode(ALL_GATES, APPROVAL_MODE);

/** Cost threshold in cents — actions estimated above this auto-create an approval request. */
export const COST_APPROVAL_THRESHOLD_CENTS = APPROVAL_MODE === 'disabled'
  ? 999_999
  : parseInt(process.env.COST_APPROVAL_THRESHOLD_CENTS ?? '', 10) || 10_000; // $100 default
