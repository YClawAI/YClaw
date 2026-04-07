// ─── Approval Gate Definitions ───────────────────────────────────────────────
//
// Maps action types to their approval requirements. Actions matching a gate
// require approval before execution. `requiresHuman: true` means only a human
// can approve; `requiresHuman: false` means Strategist or Architect can approve.
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

import type { ApprovalGateConfig } from './types.js';

export const APPROVAL_GATES: Record<string, ApprovalGateConfig> = {
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

/** Cost threshold in cents — actions estimated above this auto-create an approval request. */
export const COST_APPROVAL_THRESHOLD_CENTS = 500; // $5
