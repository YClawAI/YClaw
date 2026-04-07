import {
  ECSClient,
  UpdateServiceCommand,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs';
import type { RepoConfig } from '../../config/repo-schema.js';
import type { AuditLog } from '../../logging/audit.js';
import type { EventBus } from '../../triggers/event.js';
import { createLogger } from '../../logging/logger.js';
import { CANARY_HEALTH_CHECK_INTERVAL_MS, CANARY_HEALTH_CHECK_WINDOW_MS } from './types.js';

const logger = createLogger('deploy-ecs');

/**
 * Standard ECS force-new-deployment (non-CRITICAL tier).
 */
export async function deployEcs(
  repo: string,
  environment: string,
  repoConfig: RepoConfig | undefined,
): Promise<{ url?: string; details?: string }> {
  const region = process.env.AWS_REGION || 'us-east-1';
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
 *      publish deployer:canary_rollback (Deployer creates GitHub incident issue).
 *   5. On healthy: deployment fully promoted.
 */
export async function deployEcsCanary(
  repo: string,
  environment: string,
  repoConfig: RepoConfig,
  deploymentId: string,
  deps: {
    auditLog: AuditLog;
    eventBus: EventBus | null;
    slackAlerter: ((message: string, channel?: string) => Promise<void>) | null;
  },
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
        await rollbackEcs(client, cluster, service, previousTaskDefArn, initialDesiredCount, deploymentId, deps);
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
        await rollbackEcs(client, cluster, service, previousTaskDefArn, initialDesiredCount, deploymentId, deps);
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
async function rollbackEcs(
  client: ECSClient,
  cluster: string,
  service: string,
  previousTaskDefArn: string,
  desiredCount: number,
  deploymentId: string,
  deps: {
    auditLog: AuditLog;
    eventBus: EventBus | null;
    slackAlerter: ((message: string, channel?: string) => Promise<void>) | null;
  },
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

  await deps.auditLog.updateDeployment(deploymentId, {
    status: 'rolled_back',
    rolled_back_at: new Date().toISOString(),
  });

  if (deps.slackAlerter) {
    await deps.slackAlerter(
      `🚨 CANARY ROLLBACK: ECS health check failed.\n` +
      `Cluster: \`${cluster}\`  Service: \`${service}\`\n` +
      `Rolled back to: \`${previousTaskDefArn || 'previous task def'}\`\n` +
      `Deployment ID: \`${deploymentId}\` — create a GitHub incident issue`,
      'yclaw-alerts',
    );
  }

  if (deps.eventBus) {
    try {
      await deps.eventBus.publish('deployer', 'canary_rollback', {
        deployment_id: deploymentId,
        cluster,
        service,
        previous_task_def_arn: previousTaskDefArn,
        reason: 'health_check_failure',
      });
    } catch (evtErr) {
      logger.error('Failed to publish deployer:canary_rollback event', {
        error: evtErr instanceof Error ? evtErr.message : String(evtErr),
      });
    }
  }
}
