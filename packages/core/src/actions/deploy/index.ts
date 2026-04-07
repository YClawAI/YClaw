import type { ActionResult, ActionExecutor } from '../types.js';
import type { ToolDefinition } from '../../config/schema.js';
import type { RepoConfig } from '../../config/repo-schema.js';
import type { RepoRegistry } from '../../config/repo-registry.js';
import type { AuditLog } from '../../logging/audit.js';
import type { DeploymentRecord } from '../../logging/audit.js';
import type { EventBus } from '../../triggers/event.js';
import type { Redis } from 'ioredis';
import { HardGateRunner } from '../../safety/hard-gate-runner.js';
import { createLogger } from '../../logging/logger.js';
import {
  VALID_ENVIRONMENTS,
  ASSESS_DEDUP_TTL,
  CRITICAL_ASSESS_DEDUP_TTL,
  DEPLOY_LOCK_TTL,
  STALE_DEPLOYMENT_THRESHOLD_MS,
  DEFAULT_SKIP_CHECKS,
  isDocsOnlyFile,
  type DeployAssessParams,
  type DeployExecuteParams,
  type DodCheckResult,
} from './types.js';
import { deployEcs, deployEcsCanary } from './ecs.js';
import { deployVercel } from './vercel.js';
import { deployGitHubPages } from './github-pages.js';

const logger = createLogger('deploy-executor');

// ─── Deploy Action Executor ─────────────────────────────────────────────────
//
// Actions:
//   deploy:assess  — Run deployment risk assessment (hard gates + architect review for CRITICAL)
//   deploy:execute — Trigger actual deployment (Vercel, ECS, GitHub Pages)
//                    CRITICAL-tier ECS: canary deploy with 10-min health check + auto-rollback
//
// Deploy Governance v2 pipeline (CRITICAL-tier source changes):
//   1. HardGateRunner — deterministic pattern scan, <30s, no LLM. Blocks on secrets,
//      infra destruction, CI/CD tampering, security regressions.
//   2. Architect review — deploy:review event published; Architect responds with
//      architect:deploy_review (APPROVE or REQUEST_CHANGES).
//   3. Canary deploy — ECS rolling update monitored for 10 min, auto-rollback if unhealthy.
//
// Required env vars (per deployment type):
//   Vercel:       VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
//   ECS:          AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
//   GitHub Pages: GITHUB_TOKEN (already available)
//

export class DeployExecutor implements ActionExecutor {
  readonly name = 'deploy';
  private auditLog: AuditLog;
  private registry: RepoRegistry;
  private eventBus: EventBus | null;
  private redis: Redis | null;
  private slackAlerter: ((message: string, channel?: string) => Promise<void>) | null = null;
  private readonly hardGateRunner = new HardGateRunner();

  constructor(
    auditLog: AuditLog,
    registry: RepoRegistry,
    _outboundSafety?: unknown,
    eventBus?: EventBus,
    redis?: Redis,
  ) {
    this.auditLog = auditLog;
    this.registry = registry;
    this.eventBus = eventBus || null;
    this.redis = redis || null;
  }

  /** Wire Slack notifications for deployment events. */
  setSlackAlerter(alerter: (message: string, channel?: string) => Promise<void>): void {
    this.slackAlerter = alerter;
  }

  /**
   * Clear stale pending deployments at startup.
   *
   * Uses STALE_DEPLOYMENT_THRESHOLD_MS (2 hours) so that CRITICAL-tier deployments
   * legitimately awaiting architect review are not prematurely cancelled.
   * Only deployments older than the threshold are marked as rejected.
   *
   * Returns the count of deployments cleared.
   */
  async clearStalePendingDeployments(): Promise<number> {
    const reason = 'Cancelled: stale pending deployment (exceeded STALE_DEPLOYMENT_THRESHOLD_MS) — resubmit through deploy:assess';
    const cleared = await this.auditLog.clearPendingDeployments(reason, STALE_DEPLOYMENT_THRESHOLD_MS);
    if (cleared > 0) {
      logger.info('Cleared stale pending deployments at startup', {
        count: cleared,
        thresholdMs: STALE_DEPLOYMENT_THRESHOLD_MS,
      });
    }
    return cleared;
  }

  // ─── Definition of Done Gate ──────────────────────────────────────────────

  private checkDefinitionOfDone(record: DeploymentRecord, skipChecks: string[]): DodCheckResult {
    const skip = new Set([...DEFAULT_SKIP_CHECKS, ...skipChecks]);
    const failures: string[] = [];
    const skipped: string[] = [...skip];

    if (!skip.has('ci_check')) {
      if (record.layer2_safe === false) {
        failures.push('ci_check: deployment was previously flagged as unsafe');
      }
    }

    if (!skip.has('pr_required')) {
      if (record.environment === 'production' && !record.pr_url) {
        failures.push('pr_required: Production deployments must have an associated PR URL');
      }
    }

    return { passed: failures.length === 0, failures, skipped };
  }

  // ─── Tool Definitions ─────────────────────────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'deploy:assess',
        description: [
          'Run deployment risk assessment.',
          'For CRITICAL-tier source changes: runs deterministic hard gates (secrets, infra-destruction,',
          'CI/CD tampering, security-regression), then publishes a deploy:review event to Architect.',
          'Returns approved:true (auto/guarded or docs-only) or requires_architect_review:true',
          '(CRITICAL with source changes — wait for architect:deploy_review before calling deploy:execute).',
        ].join(' '),
        parameters: {
          repo: { type: 'string', description: 'Repository name from the repo registry', required: true },
          environment: { type: 'string', description: 'Target environment: dev, staging, or production', required: true },
          pr_url: { type: 'string', description: 'Pull request URL for context' },
          commit_sha: { type: 'string', description: 'Git commit SHA to deploy' },
          diff_summary: { type: 'string', description: 'Summary of changes in the deployment', required: true },
          diff_patches: {
            type: 'string',
            description: 'Full unified diff patches (concatenated from GitHub Compare API patch fields). Pass this for CRITICAL-tier hard gate scanning.',
          },
          test_results: { type: 'string', description: 'Test results summary', required: true },
          files_changed: {
            type: 'array',
            description: 'List of files changed in the deployment',
            required: true,
            items: { type: 'string', description: 'File path' },
          },
        },
      },
      {
        name: 'deploy:architect_approve',
        description: 'Process Architect deploy review decision. Updates deployment record status to approved/rejected. Call this in handle_deploy_review task BEFORE calling deploy:execute.',
        parameters: {
          deployment_id: { type: 'string', description: 'Deployment ID from the architect:deploy_review event payload', required: true },
          decision: { type: 'string', description: 'APPROVE or REQUEST_CHANGES', required: true },
          reason: { type: 'string', description: 'Architect reasoning for the decision' },
        },
      },
      {
        name: 'deploy:status',
        description: [
          'Get deployment pipeline status.',
          'Returns recent deployments for a repo (or all repos), their status, and pipeline health.',
          'Use this for deployment health checks and monitoring.',
        ].join(' '),
        parameters: {
          repo: { type: 'string', description: 'Repository name (optional — omit for all repos)' },
          deployment_id: { type: 'string', description: 'Specific deployment ID to check (optional)' },
          limit: { type: 'number', description: 'Number of recent deployments to return (default: 5, max: 20)' },
        },
      },
      {
        name: 'deploy:execute',
        description: [
          'Trigger actual deployment (Vercel, ECS, or GitHub Pages).',
          'Requires prior deploy:assess with status=approved.',
          'CRITICAL-tier ECS: runs a canary deploy (10-min health window, auto-rollback if unhealthy).',
          'Runs Definition of Done gate before deploying.',
        ].join(' '),
        parameters: {
          repo: { type: 'string', description: 'Repository name from the repo registry', required: true },
          environment: { type: 'string', description: 'Target environment: dev, staging, or production', required: true },
          deployment_id: { type: 'string', description: 'Deployment ID from the assess step', required: true },
          commit_sha: { type: 'string', description: 'Git commit SHA to deploy' },
          skipDodChecks: {
            type: 'array',
            description: 'DoD gate checks to skip (e.g., ["pr_required"] for hotfix deploys without a PR)',
            items: { type: 'string', description: 'Check name to skip' },
          },
        },
      },
    ];
  }

  async execute(
    action: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult> {
    switch (action) {
      case 'assess':
        return this.assess(params as unknown as DeployAssessParams);
      case 'execute':
        return this.deployExecute(params as unknown as DeployExecuteParams);
      case 'architect_approve':
        return this.architectApprove(params as unknown as { deployment_id: string; decision: string; reason?: string });
      case 'status':
        return this.deployStatus(params as unknown as { repo?: string; deployment_id?: string; limit?: number });
      default:
        return { success: false, error: `Unknown deploy action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * POST-deploy health check against the repo's configured health_check_url.
   * Non-blocking: logs a Slack warning on failure but never throws.
   */
  private async runHealthCheck(repoConfig: RepoConfig): Promise<void> {
    const url = repoConfig.deployment.health_check_url;
    if (!url) return;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (resp.ok) {
        logger.info('Post-deploy health check passed', { url, status: resp.status });
      } else {
        const msg = `Health check returned ${resp.status} for ${url}`;
        logger.error('Post-deploy health check failed', { url, status: resp.status });
        if (this.slackAlerter) {
          await this.slackAlerter(`⚠️ Post-deploy health check failed: ${msg}`, 'yclaw-alerts');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Post-deploy health check error', { url, error: msg });
      if (this.slackAlerter) {
        await this.slackAlerter(
          `⚠️ Post-deploy health check error for ${url}: ${msg}`,
          'yclaw-alerts',
        );
      }
    }
  }

  // ─── deploy:architect_approve ───────────────────────────────────────────

  private async architectApprove(params: { deployment_id: string; decision: string; reason?: string }): Promise<ActionResult> {
    const { deployment_id, decision, reason } = params;

    if (!deployment_id || !decision) {
      return { success: false, error: 'Missing required parameters: deployment_id, decision' };
    }

    const record = await this.auditLog.getDeployment(deployment_id);
    if (!record) {
      return { success: false, error: `Deployment not found: ${deployment_id}` };
    }

    if (record.status !== 'pending') {
      logger.warn('Architect approve/reject on non-pending deployment', {
        deploymentId: deployment_id, currentStatus: record.status, decision,
      });
      return {
        success: false,
        error: `Deployment ${deployment_id} is not pending (status: ${record.status}). Cannot ${decision.toLowerCase()} a ${record.status} deployment.`,
      };
    }

    if (decision.toUpperCase() === 'APPROVE') {
      await this.auditLog.updateDeployment(deployment_id, { status: 'approved' });
      logger.info('Architect approved deployment', {
        deploymentId: deployment_id, reason,
        state_transition: 'pending → approved',
        repo: record.repo, environment: record.environment,
      });

      if (this.slackAlerter) {
        await this.slackAlerter(
          `✅ CRITICAL deploy \`${record.repo}\` → ${record.environment} **APPROVED** by Architect.\n` +
          `Deployment ID: \`${deployment_id}\`\n` +
          (reason ? `Reason: ${reason}` : ''),
          'yclaw-development',
        );
      }

      // Enqueue deploy:execute — publish deploy:approved so the Strategist
      // triggers execution instead of relying on the Architect (who doesn't
      // have deploy:execute in its tool set) to chain the call manually.
      // Event-based: avoids blocking Architect's serial queue during 10-min canary deploys.
      if (this.eventBus) {
        try {
          await this.eventBus.publish('deploy', 'approved', {
            deployment_id,
            repo: record.repo,
            environment: record.environment,
            commit_sha: record.commit_sha ?? null,
          }, record.correlationId);
          logger.info('Published deploy:approved event', { deploymentId: deployment_id });
        } catch (evtErr) {
          logger.error('Failed to publish deploy:approved event', {
            error: evtErr instanceof Error ? evtErr.message : String(evtErr),
          });
        }
      }

      return {
        success: true,
        data: {
          deployment_id,
          status: 'approved',
          message: 'Deployment approved by Architect. deploy:approved event published for execution.',
        },
      };
    } else {
      await this.auditLog.updateDeployment(deployment_id, { status: 'rejected' });
      logger.info('Architect rejected deployment', {
        deploymentId: deployment_id, reason,
        state_transition: 'pending → rejected',
        repo: record.repo, environment: record.environment,
      });

      if (this.slackAlerter) {
        await this.slackAlerter(
          `❌ CRITICAL deploy \`${record.repo}\` → ${record.environment} **REJECTED** by Architect.\n` +
          `Deployment ID: \`${deployment_id}\`\n` +
          (reason ? `Reason: ${reason}` : ''),
          'yclaw-alerts',
        );
      }

      return {
        success: true,
        data: {
          deployment_id,
          status: 'rejected',
          message: `Deployment rejected by Architect: ${reason || 'no reason given'}`,
        },
      };
    }
  }

  // ─── deploy:status ─────────────────────────────────────────────────────

  /**
   * Get deployment pipeline status. Returns recent deployments, their status,
   * and overall pipeline health. Used by Sentinel's deployment_health cron.
   */
  private async deployStatus(params: { repo?: string; deployment_id?: string; limit?: number }): Promise<ActionResult> {
    const { repo, deployment_id, limit: rawLimit } = params;
    const limit = Math.min(Math.max(rawLimit ?? 5, 1), 20);

    try {
      // Single deployment lookup
      if (deployment_id) {
        const record = await this.auditLog.getDeployment(deployment_id);
        if (!record) {
          return { success: false, error: `Deployment ${deployment_id} not found` };
        }
        return {
          success: true,
          data: {
            deployment: {
              id: record.id,
              repo: record.repo,
              environment: record.environment,
              status: record.status,
              commit_sha: record.commit_sha,
              pr_url: record.pr_url,
              risk_tier: record.risk_tier,
              created_at: record.storedAt,
              approved_by: record.human_approval?.approver ?? null,
              error: record.error,
            },
          },
        };
      }

      // Recent deployments for a specific repo or all repos
      if (repo) {
        const history = await this.auditLog.getDeploymentHistory(repo, limit);
        const deployments = history.map(r => ({
          id: r.id,
          repo: r.repo,
          environment: r.environment,
          status: r.status,
          commit_sha: r.commit_sha,
          risk_tier: r.risk_tier,
          created_at: r.storedAt,
          error: r.error,
        }));

        // Pipeline health summary
        const recent = history.slice(0, 10);
        const succeeded = recent.filter(r => r.status === 'deployed').length;
        const failed = recent.filter(r => r.status === 'failed' || r.status === 'rejected' || r.status === 'rolled_back').length;
        const pending = recent.filter(r => r.status === 'pending' || r.status === 'approved').length;

        return {
          success: true,
          data: {
            repo,
            deployments,
            pipeline_health: {
              recent_total: recent.length,
              succeeded,
              failed,
              pending,
              success_rate: recent.length > 0 ? `${Math.round((succeeded / recent.length) * 100)}%` : 'N/A',
              status: failed > succeeded ? 'unhealthy' : pending > 3 ? 'degraded' : 'healthy',
            },
          },
        };
      }

      // All repos — get registered repos and check each
      const repoMap = this.registry.getAll();
      const summary: Array<{ repo: string; latest_status: string; latest_at: string; environment: string }> = [];

      for (const [repoName] of repoMap) {
        const history = await this.auditLog.getDeploymentHistory(repoName, 1);
        if (history.length > 0) {
          const latest = history[0]!;
          summary.push({
            repo: repoName,
            latest_status: latest.status,
            latest_at: latest.storedAt ?? 'unknown',
            environment: latest.environment,
          });
        }
      }

      return {
        success: true,
        data: {
          repos: summary,
          total_repos: repoMap.size,
          repos_with_deployments: summary.length,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('deploy:status failed', { error: msg, repo, deployment_id });
      return { success: false, error: `deploy:status failed: ${msg}` };
    }
  }

  // ─── deploy:assess ──────────────────────────────────────────────────────

  private async assess(params: DeployAssessParams): Promise<ActionResult> {
    const { repo, environment, correlationId } = params;

    if (!repo || !environment) {
      return { success: false, error: 'Missing required parameters: repo, environment' };
    }

    if (!VALID_ENVIRONMENTS.has(environment)) {
      return {
        success: false,
        error: `Invalid environment: ${environment}. Must be one of: ${[...VALID_ENVIRONMENTS].join(', ')}`,
      };
    }

    const repoConfig = this.registry.get(repo);
    if (!repoConfig) {
      return { success: false, error: `Repo "${repo}" not found in registry` };
    }

    // ─── Flood Protection: Dedup by repo+env+commit_sha ─────────────────
    if (this.redis && params.commit_sha) {
      const dedupKey = `deploy:dedup:${repo}:${environment}:${params.commit_sha}`;
      const existing = await this.redis.get(dedupKey);
      if (existing) {
        logger.info('Deploy assessment dedup — already assessed', {
          repo, environment, commit_sha: params.commit_sha, existingDeploymentId: existing,
        });
        return {
          success: true,
          data: {
            deployment_id: existing,
            deduplicated: true,
            status: 'already_assessed',
            message: `Duplicate skipped — already assessed as ${existing}`,
          },
        };
      }
    }

    // ─── Flood Protection: Staleness check ──────────────────────────────
    // CRITICAL-tier deployments use an extended TTL because architect review
    // can legitimately take longer than 30 minutes. Using the short TTL caused
    // the deploy:latest key to expire mid-review, allowing re-assessment that
    // treated the deployment as stale and rejected it. (Issue #885)
    if (this.redis) {
      const latestKey = `deploy:latest:${repo}:${environment}`;
      const latestTs = await this.redis.get(latestKey);
      const now = Date.now();
      const dedupTtl = repoConfig.risk_tier === 'critical' ? CRITICAL_ASSESS_DEDUP_TTL : ASSESS_DEDUP_TTL;

      if (latestTs) {
        const latestTime = parseInt(latestTs, 10);
        if (now - latestTime < dedupTtl * 1000 && latestTime > now - 5000) {
          logger.info('Deploy assessment staleness — newer assessment exists', {
            repo, environment, latestTime: new Date(latestTime).toISOString(),
            risk_tier: repoConfig.risk_tier, dedupTtl,
          });
        }
      }

      await this.redis.set(latestKey, String(now), 'EX', dedupTtl);
    }

    const deploymentId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info('Starting deployment assessment', {
      deploymentId, repo, environment, risk_tier: repoConfig.risk_tier,
      dedup_ttl_seconds: repoConfig.risk_tier === 'critical' ? CRITICAL_ASSESS_DEDUP_TTL : ASSESS_DEDUP_TTL,
      commit_sha: params.commit_sha,
    });

    const record: DeploymentRecord = {
      id: deploymentId,
      repo,
      environment,
      risk_tier: repoConfig.risk_tier,
      pr_url: params.pr_url,
      commit_sha: params.commit_sha,
      status: 'pending',
      council_votes: [],
      correlationId,
      storedAt: new Date().toISOString(),
    };

    await this.auditLog.recordDeployment(record);

    // CRITICAL-tier: use extended TTL so architect review (up to 2h) doesn't
    // cause the dedup key to expire and trigger a false 'stale assessment' re-run.
    const initialDedupTtl = repoConfig.risk_tier === 'critical' ? CRITICAL_ASSESS_DEDUP_TTL : ASSESS_DEDUP_TTL;
    if (this.redis && params.commit_sha) {
      const dedupKey = `deploy:dedup:${repo}:${environment}:${params.commit_sha}`;
      await this.redis.set(dedupKey, deploymentId, 'EX', initialDedupTtl);
      logger.info('Deployment dedup key set', {
        deploymentId, repo, environment, risk_tier: repoConfig.risk_tier,
        ttl_seconds: initialDedupTtl, commit_sha: params.commit_sha,
      });
    }

    const filesChanged = (params.files_changed as string[] | undefined) ?? [];
    const docsOnly = filesChanged.length > 0 && filesChanged.every(isDocsOnlyFile);
    const alertChannel = 'yclaw-alerts';

    switch (repoConfig.risk_tier) {
      case 'auto':
        break;

      case 'guarded':
        if (this.slackAlerter) {
          await this.slackAlerter(
            `⚠️ Guarded-tier deploy: \`${repo}\` → ${environment} (deployment \`${deploymentId}\`)`,
            alertChannel,
          );
        }
        break;

      case 'critical':
        if (!docsOnly) {
          const diffContent = params.diff_patches || params.diff_summary;
          const hardGateResult = this.hardGateRunner.run(diffContent);

          if (!hardGateResult.passed) {
            const failedGates = hardGateResult.gates
              .filter(g => !g.passed)
              .map(g => `${g.name} (${g.violations.length} violation${g.violations.length !== 1 ? 's' : ''})`)
              .join(', ');

            logger.warn('Hard gates blocked CRITICAL-tier deployment', {
              deploymentId, repo, environment, failedGates,
            });

            await this.auditLog.updateDeployment(deploymentId, { status: 'rejected' });

            if (this.slackAlerter) {
              await this.slackAlerter(
                `🚫 CRITICAL-tier deploy BLOCKED by hard gates.\n` +
                `Repo: \`${repo}\`  Environment: \`${environment}\`\n` +
                `Failed gates: ${failedGates}\n` +
                `Fix violations and resubmit. Deployment ID: \`${deploymentId}\``,
                alertChannel,
              );
            }

            return {
              success: false,
              error: `Hard gates blocked deployment: ${failedGates}`,
              data: {
                deployment_id: deploymentId,
                approved: false,
                status: 'rejected',
                hard_gate_result: hardGateResult,
                message: 'Fix hard gate violations and resubmit.',
              },
            };
          }

          logger.info('Hard gates passed — publishing deploy:review to Architect', {
            deploymentId, repo, environment,
            state_transition: 'pending → pending_review',
            review_timeout_seconds: CRITICAL_ASSESS_DEDUP_TTL,
          });

          await this.auditLog.updateDeployment(deploymentId, { status: 'pending' });

          const rubric = [
            '1. Change intent matches diff (no unrelated edits in critical areas)',
            '2. Rollback strategy exists',
            '3. Least privilege enforced (IAM/policies tight, no unnecessary wildcards)',
            '4. No new public exposure unless justified',
            '5. Secrets use SSM/Secrets Manager, not literals',
          ];

          if (this.eventBus) {
            try {
              await this.eventBus.publish('deploy', 'review', {
                deployment_id: deploymentId,
                repo,
                environment,
                pr_url: params.pr_url ?? null,
                commit_sha: params.commit_sha ?? null,
                diff_summary: params.diff_summary,
                files_changed: filesChanged,
                hard_gate_passed: true,
                hard_gate_results: hardGateResult,
                rubric,
              }, correlationId);
              logger.info('deploy:review event published — awaiting architect:deploy_review', {
                deploymentId, repo, environment,
                next_expected_event: 'architect:deploy_review',
                next_expected_action: 'deploy:architect_approve',
              });
            } catch (evtErr) {
              logger.error('Failed to publish deploy:review event', {
                error: evtErr instanceof Error ? evtErr.message : String(evtErr),
              });
            }
          }

          if (this.slackAlerter) {
            await this.slackAlerter(
              `🔍 CRITICAL-tier deploy pending Architect review.\n` +
              `Repo: \`${repo}\`  Environment: \`${environment}\`\n` +
              `Hard gates: ✅ passed\n` +
              `Deployment ID: \`${deploymentId}\` — waiting for architect:deploy_review`,
              alertChannel,
            );
          }

          return {
            success: true,
            data: {
              deployment_id: deploymentId,
              approved: false,
              requires_architect_review: true,
              status: 'pending_review',
              message: 'Hard gates passed. deploy:review event published. Await architect:deploy_review before calling deploy:execute.',
              risk_tier: 'critical',
              hard_gate_result: hardGateResult,
            },
          };
        }
        // docs-only critical → fall through to auto-approve
        break;
    }

    // Auto-approve path (auto/guarded tier, or critical+docs-only)
    logger.info('Deploy assessment: auto-approved', {
      deploymentId, repo, environment, risk_tier: repoConfig.risk_tier, docsOnly,
    });
    await this.auditLog.updateDeployment(deploymentId, {
      status: 'approved',
      council_votes: [],
    });

    return {
      success: true,
      data: {
        deployment_id: deploymentId,
        approved: true,
        requires_architect_review: false,
        status: 'approved',
        message: 'Assessment approved. CI pipeline is the deployment gate.',
        risk_tier: repoConfig.risk_tier,
      },
    };
  }

  // ─── deploy:execute ─────────────────────────────────────────────────────

  private async deployExecute(params: DeployExecuteParams): Promise<ActionResult> {
    const { repo, environment, deployment_id } = params;

    if (!repo || !environment || !deployment_id) {
      return {
        success: false,
        error: 'Missing required parameters: repo, environment, deployment_id',
      };
    }

    if (!VALID_ENVIRONMENTS.has(environment)) {
      return {
        success: false,
        error: `Invalid environment: ${environment}. Must be one of: ${[...VALID_ENVIRONMENTS].join(', ')}`,
      };
    }

    const record = await this.auditLog.getDeployment(deployment_id);
    if (!record) {
      return { success: false, error: `Deployment not found: ${deployment_id}` };
    }

    if (record.status !== 'approved') {
      return {
        success: false,
        error: `Deployment ${deployment_id} is not approved (status: ${record.status})`,
      };
    }

    // Prevent replay attacks
    if (record.repo !== repo || record.environment !== environment) {
      logger.error('Deploy replay attack blocked', {
        deploymentId: deployment_id,
        record_repo: record.repo,
        request_repo: repo,
        record_env: record.environment,
        request_env: environment,
      });
      return {
        success: false,
        error: `Deployment ${deployment_id} was approved for ${record.repo}/${record.environment}, not ${repo}/${environment}`,
      };
    }

    // ─── Concurrency Lock: max 1 production deploy per repo ─────────────
    let deployLockKey: string | null = null;
    if (this.redis && environment === 'production') {
      deployLockKey = `deploy:exec-lock:${repo}:${environment}`;
      const lockAcquired = await this.redis.set(deployLockKey, deployment_id, 'EX', DEPLOY_LOCK_TTL, 'NX');
      if (!lockAcquired) {
        const holder = await this.redis.get(deployLockKey);
        logger.warn('Deploy concurrency lock blocked — another deploy in progress', {
          deploymentId: deployment_id, repo, environment, holder,
        });
        return {
          success: false,
          error: `Another production deploy is in progress for ${repo} (${holder}). Wait for it to complete.`,
        };
      }
      logger.info('Deploy concurrency lock acquired', { deploymentId: deployment_id, repo, environment });
    }

    const repoConfig = this.registry.get(repo);
    if (!repoConfig) {
      if (deployLockKey && this.redis) await this.redis.del(deployLockKey);
      return { success: false, error: `Repo "${repo}" not found in registry` };
    }

    // ─── Definition of Done Gate ────────────────────────────────────────────

    const skipDodChecks = params.skipDodChecks ?? [];
    const dod = this.checkDefinitionOfDone(record, skipDodChecks);

    if (!dod.passed) {
      const failureMsg = `DoD not met: ${dod.failures.join('; ')}`;
      logger.warn('Deployment blocked by Definition of Done gate', {
        deploymentId: deployment_id,
        failures: dod.failures,
        skipped: dod.skipped,
      });

      if (this.eventBus) {
        try {
          await this.eventBus.publish('deploy', 'blocked', {
            deployment_id,
            repo,
            environment,
            failures: dod.failures,
            skipped: dod.skipped,
          }, params.correlationId);
        } catch (evtErr) {
          logger.error('Failed to publish deploy:blocked event', {
            error: evtErr instanceof Error ? evtErr.message : String(evtErr),
          });
        }
      }

      await this.auditLog.updateDeployment(deployment_id, {
        status: 'rejected',
        error: failureMsg,
      });

      if (deployLockKey && this.redis) await this.redis.del(deployLockKey);
      return { success: false, error: failureMsg };
    }

    const deployType = repoConfig.deployment.type;
    const useCanary = repoConfig.risk_tier === 'critical' && deployType === 'ecs';

    logger.info('Executing deployment', {
      deploymentId: deployment_id, repo, environment, type: deployType,
      risk_tier: repoConfig.risk_tier, canary: useCanary,
      state_transition: 'approved → deploying',
    });

    try {
      let result: { url?: string; details?: string };

      switch (deployType) {
        case 'vercel':
          result = await deployVercel(repo, environment, this.registry, params.commit_sha);
          break;
        case 'ecs':
          result = useCanary
            ? await deployEcsCanary(repo, environment, repoConfig, deployment_id, {
                auditLog: this.auditLog,
                eventBus: this.eventBus,
                slackAlerter: this.slackAlerter,
              })
            : await deployEcs(repo, environment, repoConfig);
          break;
        case 'github-pages':
          result = await deployGitHubPages(repo, this.registry);
          break;
        case 'none':
          return { success: false, error: `Repo ${repo} has deployment.type = none` };
        default:
          return { success: false, error: `Unknown deployment type: ${deployType}` };
      }

      await this.auditLog.updateDeployment(deployment_id, {
        status: 'deployed',
        deployed_at: new Date().toISOString(),
      });

      logger.info('Deployment succeeded', {
        deploymentId: deployment_id, repo, environment, url: result.url, canary: useCanary,
      });

      await this.runHealthCheck(repoConfig);

      return {
        success: true,
        data: {
          deployment_id,
          status: 'deployed',
          url: result.url,
          details: result.details,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Deployment failed', { deploymentId: deployment_id, error: msg });

      const isCanaryRollback = msg.startsWith('CANARY_ROLLBACK:');
      await this.auditLog.updateDeployment(deployment_id, {
        status: isCanaryRollback ? 'rolled_back' : 'failed',
        error: msg,
      });

      return { success: false, error: `Deployment failed: ${msg}` };
    } finally {
      if (deployLockKey && this.redis) {
        try {
          await this.redis.del(deployLockKey);
          logger.info('Deploy concurrency lock released', { deploymentId: deployment_id, repo, environment });
        } catch (lockErr) {
          logger.error('Failed to release deploy lock (will expire via TTL)', {
            deploymentId: deployment_id, error: lockErr instanceof Error ? lockErr.message : String(lockErr),
          });
        }
      }
    }
  }
}
