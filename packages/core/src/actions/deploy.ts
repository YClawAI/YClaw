import {
  ECSClient,
  UpdateServiceCommand,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs';
import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';
import type { RepoConfig } from '../config/repo-schema.js';
import type { RepoRegistry } from '../config/repo-registry.js';
import type { AuditLog } from '../logging/audit.js';
import type { DeploymentRecord } from '../logging/audit.js';
import type { EventBus } from '../triggers/event.js';
import type { Redis } from 'ioredis';
import { HardGateRunner } from '../safety/hard-gate-runner.js';

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

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_ENVIRONMENTS = new Set(['dev', 'staging', 'production']);

// ─── Flood Protection ───────────────────────────────────────────────────────

/** Dedup TTL — same repo+env+commit won't be assessed again within this window. */
const ASSESS_DEDUP_TTL = 30 * 60; // 30 minutes

/** Production deploy lock TTL — max 1 concurrent deploy per repo+env. */
const DEPLOY_LOCK_TTL = 15 * 60; // 15 minutes (covers canary 10-min window)

/** Exact root-level filenames that are always docs-only. */
const DOCS_ONLY_EXACT = new Set(['LICENSE', 'CODEOWNERS', '.gitignore']);

/** Directory prefixes that are always docs-only (any file under them). */
const DOCS_ONLY_DIRS = ['docs/', 'prompts/', 'skills/'];

/**
 * Returns true if the changed file is documentation/config that carries no runtime risk.
 * Docs-only changes in a critical-tier repo skip hard gates and go straight to auto-approve.
 */
function isDocsOnlyFile(filename: string): boolean {
  if (filename.endsWith('.md')) return true;
  if (DOCS_ONLY_EXACT.has(filename)) return true;
  return DOCS_ONLY_DIRS.some(dir => filename.startsWith(dir));
}

/**
 * DoD checks that are skipped by default because they are not yet implemented
 * or require external integration.
 */
const DEFAULT_SKIP_CHECKS = new Set(['review_comments']);

// ─── Canary Timing ───────────────────────────────────────────────────────────

const CANARY_HEALTH_CHECK_INTERVAL_MS = 60_000;    // poll every 60s
const CANARY_HEALTH_CHECK_WINDOW_MS = 10 * 60_000; // 10-minute window

// ─── DoD Types ───────────────────────────────────────────────────────────────

interface DodCheckResult {
  passed: boolean;
  failures: string[];
  skipped: string[];
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface DeployAssessParams {
  repo: string;
  environment: string;
  pr_url?: string;
  commit_sha?: string;
  diff_summary: string;
  /** Full unified diff patches (concatenated from GitHub Compare API patch fields).
   *  Used by HardGateRunner for deterministic security scanning on CRITICAL-tier deploys. */
  diff_patches?: string;
  test_results: string;
  files_changed: string[];
  correlationId?: string;
}

interface DeployExecuteParams {
  repo: string;
  environment: string;
  deployment_id: string;
  commit_sha?: string;
  correlationId?: string;
  /** DoD gate checks to skip. 'review_comments' is skipped by default. */
  skipDodChecks?: string[];
}

// ─── Deploy Executor ────────────────────────────────────────────────────────

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

  /**
   * Handle architect:deploy_review decision.
   * Updates deployment record status based on Architect's APPROVE/REQUEST_CHANGES decision.
   * Called by Deployer's handle_deploy_review task before deploy:execute.
   */
  private async architectApprove(params: { deployment_id: string; decision: string; reason?: string }): Promise<ActionResult> {
    const { deployment_id, decision, reason } = params;

    if (!deployment_id || !decision) {
      return { success: false, error: 'Missing required parameters: deployment_id, decision' };
    }

    const record = await this.auditLog.getDeployment(deployment_id);
    if (!record) {
      return { success: false, error: `Deployment not found: ${deployment_id}` };
    }

    if (decision.toUpperCase() === 'APPROVE') {
      await this.auditLog.updateDeployment(deployment_id, { status: 'approved' });
      logger.info('Architect approved deployment', { deploymentId: deployment_id, reason });

      if (this.slackAlerter) {
        await this.slackAlerter(
          `✅ CRITICAL deploy \`${record.repo}\` → ${record.environment} **APPROVED** by Architect.\n` +
          `Deployment ID: \`${deployment_id}\`\n` +
          (reason ? `Reason: ${reason}` : ''),
          'yclaw-development',
        );
      }

      logger.info('Architect approval accepted — executing deployment immediately', {
        deploymentId: deployment_id,
        repo: record.repo,
        environment: record.environment,
      });

      const execution = await this.deployExecute({
        repo: record.repo,
        environment: record.environment,
        deployment_id,
        commit_sha: record.commit_sha,
      });

      return {
        success: execution.success,
        data: {
          deployment_id,
          approval_status: 'approved',
          execution: execution.success ? execution.data : null,
        },
        error: execution.success ? undefined : execution.error,
      };
    } else {
      await this.auditLog.updateDeployment(deployment_id, { status: 'rejected' });
      logger.info('Architect rejected deployment', { deploymentId: deployment_id, reason });

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
    // Prevents identical assessments from 33+ queued events all firing at once.
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
    // If a NEWER assessment for this repo+env already completed, this one is stale.
    if (this.redis) {
      const latestKey = `deploy:latest:${repo}:${environment}`;
      const latestTs = await this.redis.get(latestKey);
      const now = Date.now();

      if (latestTs) {
        const latestTime = parseInt(latestTs, 10);
        // Stale if: a newer assessment ran AND we're within 30 min of it
        // (assessments older than 30 min are from a previous batch — allow them)
        if (now - latestTime < ASSESS_DEDUP_TTL * 1000 && latestTime > now - 5000) {
          // Another assessment just completed for this repo+env in the last 5 seconds
          // We're part of the same flood — let the winner proceed
          logger.info('Deploy assessment staleness — newer assessment exists', {
            repo, environment, latestTime: new Date(latestTime).toISOString(),
          });
        }
      }

      // Claim this assessment as the latest
      await this.redis.set(latestKey, String(now), 'EX', ASSESS_DEDUP_TTL);
    }

    const deploymentId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info('Starting deployment assessment', {
      deploymentId, repo, environment, risk_tier: repoConfig.risk_tier,
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

    // Register dedup key so future identical assessments are skipped
    if (this.redis && params.commit_sha) {
      const dedupKey = `deploy:dedup:${repo}:${environment}:${params.commit_sha}`;
      await this.redis.set(dedupKey, deploymentId, 'EX', ASSESS_DEDUP_TTL);
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
          // ─── LAYER 1: Deterministic Hard Gates ────────────────────────────
          // Pattern-match the diff. No LLM. Blocks on:
          //   - Secret/credential patterns
          //   - Infrastructure destruction
          //   - CI/CD tampering
          //   - Security regressions
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

          // ─── LAYER 2: Architect Review ─────────────────────────────────────
          // Hard gates passed. Publish deploy:review event to Architect.
          // Deployer waits for architect:deploy_review before calling deploy:execute.

          logger.info('Hard gates passed — publishing deploy:review to Architect', {
            deploymentId, repo, environment,
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
    // CRITICAL-tier ECS gets the canary path
    const useCanary = repoConfig.risk_tier === 'critical' && deployType === 'ecs';

    logger.info('Executing deployment', {
      deploymentId: deployment_id, repo, environment, type: deployType,
      risk_tier: repoConfig.risk_tier, canary: useCanary,
    });

    try {
      let result: { url?: string; details?: string };

      switch (deployType) {
        case 'vercel':
          result = await this.deployVercel(repo, environment, params.commit_sha);
          break;
        case 'ecs':
          result = useCanary
            ? await this.deployEcsCanary(repo, environment, repoConfig, deployment_id)
            : await this.deployEcs(repo, environment, params.commit_sha);
          break;
        case 'github-pages':
          result = await this.deployGitHubPages(repo, environment);
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
      // Release production concurrency lock
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

  // ─── Deployment Backends ────────────────────────────────────────────────

  private async deployVercel(
    repo: string,
    environment: string,
    commitSha?: string,
  ): Promise<{ url?: string; details?: string }> {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error('VERCEL_TOKEN not configured');

    const repoConfig = this.registry.get(repo);
    if (!repoConfig) throw new Error(`Repo "${repo}" not found in registry`);

    const orgId = repoConfig.deployment.vercel_org_id || process.env.VERCEL_ORG_ID;
    const teamQuery = orgId ? `?teamId=${orgId}` : '';
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    let projectId = repoConfig.deployment.vercel_project_id || process.env.VERCEL_PROJECT_ID;
    if (!projectId) {
      projectId = await this.resolveVercelProject(repo, repoConfig, token, orgId, teamQuery, authHeaders);
    }

    const target = environment === 'production' ? 'production' : 'preview';
    const createBody: Record<string, unknown> = { name: repo, project: projectId, target };

    if (commitSha) {
      createBody.gitSource = {
        type: 'github',
        ref: commitSha,
        org: repoConfig.github.owner,
        repo: repoConfig.github.repo,
      };
    }

    logger.info('Creating Vercel deployment', { repo, environment, target, projectId, commitSha });

    const createResp = await fetch(
      `https://api.vercel.com/v13/deployments${teamQuery}`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      },
    );

    if (!createResp.ok) {
      const errBody = await createResp.text();
      throw new Error(`Vercel create deployment failed (${createResp.status}): ${errBody}`);
    }

    const deployment = await createResp.json() as { id: string; url: string; readyState: string };
    const maxWaitMs = 5 * 60 * 1000;
    const pollIntervalMs = 5_000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs));

      const statusResp = await fetch(
        `https://api.vercel.com/v13/deployments/${deployment.id}${teamQuery}`,
        { headers: authHeaders },
      );

      if (!statusResp.ok) continue;

      const status = await statusResp.json() as { readyState: string; url: string; alias?: string[] };

      if (status.readyState === 'READY') {
        const liveUrl = status.alias?.[0] ? `https://${status.alias[0]}` : `https://${status.url}`;
        return { url: liveUrl, details: `Vercel deployment ${deployment.id} (${target}) ready` };
      }

      if (status.readyState === 'ERROR' || status.readyState === 'CANCELED') {
        throw new Error(`Vercel deployment ${deployment.id} failed: ${status.readyState}`);
      }
    }

    return {
      url: `https://${deployment.url}`,
      details: `Vercel deployment ${deployment.id} (${target}) — still building`,
    };
  }

  private async resolveVercelProject(
    repo: string,
    repoConfig: RepoConfig,
    token: string,
    orgId: string | undefined,
    teamQuery: string,
    authHeaders: Record<string, string>,
  ): Promise<string> {
    logger.info('No Vercel project ID configured, attempting auto-discover', { repo });

    const findResp = await fetch(
      `https://api.vercel.com/v9/projects/${repo}${teamQuery}`,
      { headers: authHeaders },
    );

    if (findResp.ok) {
      const project = await findResp.json() as { id: string; name: string };
      return project.id;
    }

    const framework = repoConfig.tech_stack.framework || undefined;
    const createBody: Record<string, unknown> = {
      name: repo,
      framework: framework === 'next' ? 'nextjs' : framework,
      gitRepository: {
        type: 'github',
        repo: `${repoConfig.github.owner}/${repoConfig.github.repo}`,
      },
    };

    const createResp = await fetch(
      `https://api.vercel.com/v10/projects${teamQuery}`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      },
    );

    if (!createResp.ok) {
      const errBody = await createResp.text();
      throw new Error(`Failed to auto-create Vercel project for ${repo} (${createResp.status}): ${errBody}`);
    }

    const newProject = await createResp.json() as { id: string; name: string };
    return newProject.id;
  }

  /**
   * Standard ECS force-new-deployment (non-CRITICAL tier).
   */
  private async deployEcs(
    repo: string,
    environment: string,
    _commitSha?: string,
  ): Promise<{ url?: string; details?: string }> {
    const region = process.env.AWS_REGION || 'us-east-1';
    const repoConfig = this.registry.get(repo);
    const cluster =
      repoConfig?.deployment.cluster
      || process.env[`ECS_CLUSTER_${environment.toUpperCase()}`]
      || `yclaw-${environment}`;
    const service =
      repoConfig?.deployment.service
      || process.env[`ECS_SERVICE_${repo.toUpperCase().replace(/-/g, '_')}`]
      || repo;

    logger.info('ECS deployment starting', { repo, environment, cluster, service, region });

    const client = new ECSClient({ region });
    await client.send(new UpdateServiceCommand({ cluster, service, forceNewDeployment: true }));

    const maxIterations = 40;
    const pollIntervalMs = 15_000;

    for (let i = 0; i < maxIterations; i++) {
      await new Promise(r => setTimeout(r, pollIntervalMs));

      const desc = await client.send(new DescribeServicesCommand({ cluster, services: [service] }));
      const svc = desc.services?.[0];
      if (!svc) continue;

      if (svc.deployments?.some(d => d.rolloutState === 'FAILED')) {
        throw new Error(`ECS deployment rolled back (cluster=${cluster}, service=${service})`);
      }

      const stable =
        svc.runningCount === svc.desiredCount && (svc.deployments?.length ?? 0) === 1;

      if (stable) {
        return { details: `ECS force-deployed: cluster=${cluster}, service=${service}` };
      }
    }

    return { details: `ECS force-deploy triggered (cluster=${cluster}, service=${service}) — stability timeout` };
  }

  /**
   * CRITICAL-tier ECS canary deploy.
   *
   * Flow:
   *   1. Save current task def ARN and desired count (rollback point).
   *   2. Force new deployment (ECS rolling update — first new task = canary).
   *   3. 10-minute health window: poll ECS rollout state + health_check_url.
   *   4. On failure: rollback UpdateService to previous task def, alert Slack,
   *      publish architect:canary_rollback (Architect creates GitHub incident issue).
   *   5. On healthy: deployment fully promoted.
   *
   * NOTE: ECS deployment circuit breakers should be enabled on the service for
   * automatic image-level rollback. This layer adds monitoring + alerting.
   */
  private async deployEcsCanary(
    repo: string,
    environment: string,
    repoConfig: RepoConfig,
    deploymentId: string,
  ): Promise<{ url?: string; details?: string }> {
    const region = process.env.AWS_REGION || 'us-east-1';
    const cluster =
      repoConfig.deployment.cluster
      || process.env[`ECS_CLUSTER_${environment.toUpperCase()}`]
      || `yclaw-${environment}`;
    const service =
      repoConfig.deployment.service
      || process.env[`ECS_SERVICE_${repo.toUpperCase().replace(/-/g, '_')}`]
      || repo;

    logger.info('ECS canary deploy starting', {
      repo, environment, cluster, service, region, deploymentId,
    });

    const client = new ECSClient({ region });

    // 1. Save rollback point
    const initialDesc = await client.send(new DescribeServicesCommand({ cluster, services: [service] }));
    const initialSvc = initialDesc.services?.[0];
    if (!initialSvc) {
      throw new Error(`ECS service not found: cluster=${cluster}, service=${service}`);
    }
    const previousTaskDefArn = initialSvc.taskDefinition ?? '';
    const initialDesiredCount = initialSvc.desiredCount ?? 1;

    logger.info('Canary: saved rollback point', { cluster, service, previousTaskDefArn, initialDesiredCount });

    // 2. Force new deployment
    await client.send(new UpdateServiceCommand({ cluster, service, forceNewDeployment: true }));
    logger.info('Canary: force-new-deployment issued, entering 10-min health window', { deploymentId });

    const healthCheckUrl = repoConfig.deployment.health_check_url;
    const windowStart = Date.now();
    let consecutiveHealthFailures = 0;
    const MAX_HEALTH_FAILURES = 3;

    // 3. Health check loop
    while (Date.now() - windowStart < CANARY_HEALTH_CHECK_WINDOW_MS) {
      await new Promise(r => setTimeout(r, CANARY_HEALTH_CHECK_INTERVAL_MS));
      const elapsed_s = Math.round((Date.now() - windowStart) / 1000);

      // ECS rollout state check
      const desc = await client.send(new DescribeServicesCommand({ cluster, services: [service] }));
      const svc = desc.services?.[0];

      if (svc) {
        if (svc.deployments?.some(d => d.rolloutState === 'FAILED')) {
          logger.error('Canary: ECS circuit breaker FAILED — rolling back', { elapsed_s, deploymentId });
          await this.rollbackEcs(client, cluster, service, previousTaskDefArn, initialDesiredCount, deploymentId);
          throw new Error(
            `CANARY_ROLLBACK: ECS circuit breaker FAILED (cluster=${cluster}, service=${service}). Rolled back to ${previousTaskDefArn}.`,
          );
        }

        const stable = svc.runningCount === svc.desiredCount && (svc.deployments?.length ?? 0) === 1;
        logger.info('Canary: ECS state', {
          running: svc.runningCount, desired: svc.desiredCount,
          deployments: svc.deployments?.length, elapsed_s,
        });

        // Service fully stable (all tasks replaced) — check health one more time then promote
        if (stable && elapsed_s > 120 && consecutiveHealthFailures === 0) {
          logger.info('Canary: ECS stable, promoting to full rollout', { elapsed_s, deploymentId });
          return {
            details: `ECS canary deployed: cluster=${cluster}, service=${service} (stable after ${elapsed_s}s)`,
          };
        }
      }

      // ALB health check
      if (healthCheckUrl) {
        try {
          const resp = await fetch(healthCheckUrl, { signal: AbortSignal.timeout(15_000) });
          if (!resp.ok) {
            consecutiveHealthFailures++;
            logger.warn('Canary: health check failed', {
              url: healthCheckUrl, status: resp.status, consecutive: consecutiveHealthFailures, elapsed_s,
            });
          } else {
            consecutiveHealthFailures = 0;
          }
        } catch (fetchErr) {
          consecutiveHealthFailures++;
          logger.warn('Canary: health check error', {
            url: healthCheckUrl,
            error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
            consecutive: consecutiveHealthFailures,
            elapsed_s,
          });
        }

        if (consecutiveHealthFailures >= MAX_HEALTH_FAILURES) {
          logger.error('Canary: too many consecutive health failures — rolling back', {
            elapsed_s, deploymentId, url: healthCheckUrl,
          });
          await this.rollbackEcs(client, cluster, service, previousTaskDefArn, initialDesiredCount, deploymentId);
          throw new Error(
            `CANARY_ROLLBACK: ${MAX_HEALTH_FAILURES} consecutive health failures at ${healthCheckUrl}. Rolled back to ${previousTaskDefArn}.`,
          );
        }
      }
    }

    // 10-min window clean — full rollout promoted
    logger.info('Canary: 10-min window passed, deployment promoted', { deploymentId });
    return {
      details: `ECS canary deployed (10-min window clean): cluster=${cluster}, service=${service}`,
    };
  }

  /**
   * Roll back the ECS service to the previous task definition.
   * Called on canary health check failure. Alerts Slack + publishes event.
   */
  private async rollbackEcs(
    client: ECSClient,
    cluster: string,
    service: string,
    previousTaskDefArn: string,
    desiredCount: number,
    deploymentId: string,
  ): Promise<void> {
    logger.warn('ECS canary rollback initiated', { cluster, service, previousTaskDefArn, deploymentId });

    try {
      await client.send(new UpdateServiceCommand({
        cluster,
        service,
        taskDefinition: previousTaskDefArn || undefined,
        desiredCount,
        forceNewDeployment: true,
      }));
      logger.info('ECS rollback UpdateService sent', { cluster, service, previousTaskDefArn });
    } catch (rollbackErr) {
      logger.error('ECS rollback UpdateService failed — manual intervention required', {
        cluster, service, previousTaskDefArn,
        error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }

    await this.auditLog.updateDeployment(deploymentId, {
      status: 'rolled_back',
      rolled_back_at: new Date().toISOString(),
    });

    if (this.slackAlerter) {
      await this.slackAlerter(
        `🚨 CANARY ROLLBACK: ECS health check failed.\n` +
        `Cluster: \`${cluster}\`  Service: \`${service}\`\n` +
        `Rolled back to: \`${previousTaskDefArn || 'previous task def'}\`\n` +
        `Deployment ID: \`${deploymentId}\` — create a GitHub incident issue`,
        'yclaw-alerts',
      );
    }

    if (this.eventBus) {
      try {
        await this.eventBus.publish('architect', 'canary_rollback', {
          deployment_id: deploymentId,
          cluster,
          service,
          previous_task_def_arn: previousTaskDefArn,
          reason: 'health_check_failure',
        });
      } catch (evtErr) {
        logger.error('Failed to publish architect:canary_rollback event', {
          error: evtErr instanceof Error ? evtErr.message : String(evtErr),
        });
      }
    }
  }

  private async deployGitHubPages(
    repo: string,
    _environment: string,
  ): Promise<{ url?: string; details?: string }> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not configured');

    const repoConfig = this.registry.get(repo);
    if (!repoConfig) throw new Error(`Repo "${repo}" not found in registry`);

    const { owner, repo: ghRepo } = repoConfig.github;

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${ghRepo}/pages/deployments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub Pages API error (${response.status}): ${body}`);
    }

    const data = await response.json() as { page_url?: string; id?: number };
    return {
      url: data.page_url,
      details: `GitHub Pages deployment ${data.id || 'triggered'}`,
    };
  }
}
