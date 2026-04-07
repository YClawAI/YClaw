/**
 * YCLAW Agent Safety Guard
 *
 * Validates agent PRs against security policy before allowing merge.
 * Any PR touching protected paths gets auto-labeled and blocked for human review.
 */

import { minimatch } from 'minimatch';

export const PROTECTED_PATHS = [
  '.github/workflows/**',
  '.github/actions/**',
  'Dockerfile*',
  'docker-compose*.yml',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  '.npmrc',
  '.pnpmrc',
  'renovate.json',
  'socket.yml',
  'SECURITY.md',
  'CODEOWNERS',
  'packages/core/src/security/**',
  'config/security/**',
  'prompts/**',
];

// Files that agents can NEVER modify, even with human approval
export const FORBIDDEN_PATHS = [
  'CODEOWNERS',
  'packages/core/src/security/agent-safety-guard.ts',
  '.github/workflows/workflow-change-guard.yml',
];

export const SELF_MODIFICATION_PATTERNS = [
  /remove.*safety/i,
  /disable.*security/i,
  /bypass.*guard/i,
  /skip.*review/i,
  /auto.?merge.*security/i,
  /increase.*limit/i,
  /remove.*circuit.?breaker/i,
];

export interface AgentPRValidation {
  allowed: boolean;
  requiresHumanApproval: boolean;
  blockedFiles: string[];
  warnings: string[];
  label: string;
}

export function validateAgentPR(
  changedFiles: string[],
  prTitle: string,
  prBody: string,
  _agentId: string,
): AgentPRValidation {
  const result: AgentPRValidation = {
    allowed: true,
    requiresHumanApproval: false,
    blockedFiles: [],
    warnings: [],
    label: 'agent-pr',
  };

  // Check forbidden paths (hard block)
  for (const file of changedFiles) {
    if (FORBIDDEN_PATHS.some(p => minimatch(file, p))) {
      result.allowed = false;
      result.blockedFiles.push(file);
      result.label = 'security-blocked';
    }
  }

  // Check protected paths (require human approval)
  for (const file of changedFiles) {
    if (PROTECTED_PATHS.some(p => minimatch(file, p))) {
      result.requiresHumanApproval = true;
      result.label = 'needs-human';
      result.warnings.push(`Protected file modified: ${file}`);
    }
  }

  // Check for self-modification language
  const fullText = `${prTitle} ${prBody}`;
  for (const pattern of SELF_MODIFICATION_PATTERNS) {
    if (pattern.test(fullText)) {
      result.requiresHumanApproval = true;
      result.label = 'security-review-required';
      result.warnings.push(`Self-modification pattern detected: ${pattern.source}`);
    }
  }

  return result;
}
