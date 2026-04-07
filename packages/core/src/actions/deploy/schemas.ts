import type { ToolParameter } from '../../config/schema.js';

export const DEPLOY_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'deploy:assess': {
    description: 'Run deployment risk assessment. For CRITICAL-tier source changes: runs deterministic hard gates (secrets, infra-destruction, CI/CD tampering, security-regression), then publishes a deploy:review event to Architect. Returns approved:true (auto/guarded or docs-only) or requires_architect_review:true (CRITICAL with source changes — wait for architect:deploy_review before calling deploy:execute).',
    parameters: {
      repo: { type: 'string', description: 'Repository name from the repo registry', required: true },
      environment: { type: 'string', description: 'Target environment: dev, staging, or production', required: true },
      pr_url: { type: 'string', description: 'Pull request URL for context' },
      commit_sha: { type: 'string', description: 'Git commit SHA to deploy' },
      diff_summary: { type: 'string', description: 'Summary of changes in the deployment', required: true },
      test_results: { type: 'string', description: 'Test results summary', required: true },
      files_changed: { type: 'array', description: 'List of files changed in the deployment', required: true, items: { type: 'string', description: 'File path' } },
    },
  },
  'deploy:architect_approve': {
    description: 'Process Architect deploy review decision. Updates deployment record status to approved/rejected. Call this in handle_deploy_review task BEFORE calling deploy:execute. The decision parameter must be exactly "APPROVE" or "REQUEST_CHANGES".',
    parameters: {
      deployment_id: { type: 'string', description: 'Deployment ID from the architect:deploy_review event payload', required: true },
      decision: { type: 'string', description: 'Must be "APPROVE" or "REQUEST_CHANGES" (case-sensitive uppercase)', required: true },
      reason: { type: 'string', description: 'Architect reasoning for the decision' },
    },
  },
  'deploy:execute': {
    description: 'Trigger actual deployment (Vercel, ECS, or GitHub Pages). Requires prior deploy:architect_approve with decision APPROVE for CRITICAL-tier repos. CRITICAL-tier ECS: runs a canary deploy (10-min health window, auto-rollback if unhealthy).',
    parameters: {
      repo: { type: 'string', description: 'Repository name from the repo registry', required: true },
      environment: { type: 'string', description: 'Target environment: dev, staging, or production', required: true },
      deployment_id: { type: 'string', description: 'Deployment ID from the assess step', required: true },
      commit_sha: { type: 'string', description: 'Git commit SHA to deploy' },
    },
  },
};
