import { createLogger } from '../logging/logger.js';
import { ApprovalManager } from '../approvals/approval-manager.js';
import { ObjectiveManager } from '../objectives/objective-manager.js';
import { StaleLoopDetector } from '../objectives/stale-loop-detector.js';
import { RevisionTracker } from '../config-revisions/revision-tracker.js';
import { AgentExecutor } from '../agent/executor.js';
import { AgentRouter } from '../agent/router.js';
import { SLACK_CHANNELS } from '../actions/slack.js';
import type { SlackExecutor } from '../actions/slack.js';
import type { GitHubExecutor } from '../actions/github/index.js';
import { GitHubRateLimitError } from '../actions/github/client.js';
import type { DeployExecutor } from '../actions/deploy/index.js';
import type { TaskExecutor } from '../actions/task.js';
import { Redis as IORedis } from 'ioredis';
import { CronManager } from '../triggers/cron.js';
import { BatchCollector } from '../triggers/batch-collector.js';
import { validateEventPayload } from '../triggers/event-schemas.js';
import { createEvent, COORD_DELIVERABLE_SUBMITTED, COORD_REVIEW_COMPLETED } from '../types/events.js';
import type { CoordDeliverablePayload, CoordReviewPayload } from '../types/events.js';
import { shouldRunHeartbeat, recordHeartbeatRun } from '../services/heartbeat-precheck.js';
import { Journaler } from '../modules/journaler.js';
import { SlackNotifier } from '../modules/slack-notifier.js';
import { ChannelNotifier } from '../modules/channel-notifier.js';
import { registerExplorationModule } from '../exploration/index.js';
import { registerGrowthEngine } from '../growth-engine/index.js';
import type { ExplorationDispatcher } from '../exploration/index.js';
import type { ExperimentEngine } from '../growth-engine/index.js';
import type { SettingsOverlay } from '../config/settings-overlay.js';
import type { ServiceContext } from './services.js';
import type { ActionContext } from './actions.js';
import { AoBridge } from '../ao/bridge.js';
import type { AgentEvent } from '../config/schema.js';
import type { YClawEvent } from '../types/events.js';
import {
  AO_CIRCUIT_OPEN_COOLDOWN_TTL_SEC,
  AO_DIRECTIVE_CLAIM_TTL_SEC,
  AO_FAILURE_SUMMARY_TTL_SEC,
  BRANCH_REFRESH_CLAIM_TTL_SEC,
  CI_REPAIR_CLAIM_TTL_SEC,
  EVENT_DISPATCH_DEDUP_TTL_SEC,
  ISSUE_CLAIM_TTL_SEC,
  PR_HYGIENE_CYCLE_LOCK_TTL_SEC,
  PR_HYGIENE_PR_COOLDOWN_TTL_SEC,
  PR_HYGIENE_NEEDS_HUMAN_TTL_SEC,
  PR_HYGIENE_RATE_LIMIT_TTL_SEC,
  buildAoCircuitOpenCooldownKey,
  buildAoDegradedHoldKey,
  buildAoDirectiveClaimKey,
  buildAoFailureSummaryKey,
  buildBranchRefreshClaimKey,
  buildCiRepairClaimKey,
  buildEventDispatchDedupKey,
  buildIssueClaimKey,
  buildPrHygieneCooldownKey,
  buildPrHygieneCycleLockKey,
  buildPrHygieneNeedsHumanKey,
  buildPrHygieneRateLimitKey,
  claimDedupKey,
} from './event-claims.js';
import {
  buildCiRepairDirective,
  handleCiRepairCapGate,
  isAutomatedPrAuthor,
  selectCiRepairTarget,
} from './ci-repair.js';
import { listPrHygieneCandidatesByBase, shouldLabelNeedsHuman } from './pr-hygiene.js';

const logger = createLogger('bootstrap:agents');
const AO_DEGRADED_HOLD_TTL_SEC = 180;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AgentContext {
  executor: AgentExecutor;
  router: AgentRouter;
  cronManager: CronManager;
  approvalManager: ApprovalManager;
  objectiveManager: ObjectiveManager;
  revisionTracker: RevisionTracker;
  explorationDispatcher: ExplorationDispatcher | null;
  explorationStop: (() => void) | null;
  growthEngine: ExperimentEngine | null;
  growthEngineStop: (() => void) | null;
  aoBridge: AoBridge | null;
}

export async function initAgents(
  services: ServiceContext,
  actions: ActionContext,
): Promise<AgentContext> {
  const {
    auditLog, eventBus, eventStream, streamRedis, deployRedis, memoryIndex,
    memoryManager, costTracker, budgetEnforcer, checkpointManager, fleetGuard, repoRegistry,
    settingsOverlay,
  } = services;
  const {
    actionRegistry, selfModTools, safetyGate, reviewGate,
    humanizationGate, outboundSafety, dataResolver,
  } = actions;

  // ─── Agent Executor ──────────────────────────────────────────────────
  const executor = new AgentExecutor(
    auditLog,
    selfModTools,
    safetyGate,
    reviewGate,
    outboundSafety,
    actionRegistry,
    eventBus,
    memoryIndex,
    dataResolver,
    memoryManager,
  );
  executor.setHumanizationGate(humanizationGate);
  executor.setCostTracker(costTracker);
  executor.setCheckpointManager(checkpointManager);
  if (budgetEnforcer) {
    executor.setBudgetEnforcer(budgetEnforcer);
  }
  executor.setSettingsOverlay(settingsOverlay);
  if (services.yclawConfig) {
    executor.setYclawConfig(services.yclawConfig);
  }
  if (deployRedis) {
    executor.setRedis(deployRedis);
  }

  // ─── AO Bridge (ao orchestrator HTTP client) ────────────────────────────
  const aoBridge = new AoBridge(auditLog);
  const aoOrchestrator = (process.env.AO_DEFAULT_AGENT || 'claude-code') as 'claude-code' | 'codex' | 'aider' | 'pi-rpc' | 'claude-code-headless';
  logger.info('[Bootstrap] AoBridge initialized', { agent: aoOrchestrator });

  const getAoDegradedReason = async (repo: string): Promise<string | null> => {
    if (!deployRedis) return null;
    try {
      return await deployRedis.get(buildAoDegradedHoldKey(repo));
    } catch (err) {
      logger.warn('[AO] Failed to read degraded hold state', {
        repo,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  const markAoDegraded = async (repo: string, reason: string): Promise<void> => {
    if (!deployRedis) return;
    try {
      await deployRedis.set(buildAoDegradedHoldKey(repo), reason, 'EX', AO_DEGRADED_HOLD_TTL_SEC);
    } catch (err) {
      logger.warn('[AO] Failed to record degraded hold state', {
        repo,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const emitAoSpawnFailure = async (params: {
    repo: string;
    eventKey: string;
    reason: string;
    issueUrl?: string;
    issueNumber?: number;
    correlationId?: string;
    error?: string;
    summaryText?: string;
    degraded?: boolean;
    extra?: Record<string, unknown>;
  }): Promise<boolean> => {
    // circuit_open failures all share a repo-level cooldown key so that N concurrent
    // issues hitting the open circuit produce exactly ONE summary alert per cooldown
    // window (15 min), not N per-issue alerts.
    const isCircuitOpen = params.reason === 'circuit_open';
    const summaryKey = isCircuitOpen
      ? buildAoCircuitOpenCooldownKey(params.repo)
      : buildAoFailureSummaryKey({
          repo: params.repo,
          eventKey: params.eventKey,
          reason: params.reason,
        });
    const ttlSec = isCircuitOpen ? AO_CIRCUIT_OPEN_COOLDOWN_TTL_SEC : AO_FAILURE_SUMMARY_TTL_SEC;
    const shouldEmit = await claimDedupKey(deployRedis, summaryKey, ttlSec);
    if (!shouldEmit) {
      logger.info('[AO] Suppressed duplicate AO failure alert/event', {
        repo: params.repo,
        eventKey: params.eventKey,
        reason: params.reason,
        issueNumber: params.issueNumber,
      });
      return false;
    }

    // For circuit_open, override the summary text with a canonical batch alert message
    // regardless of which individual issue first triggered the suppression window.
    const summaryText = isCircuitOpen
      ? `🔴 AO Circuit Breaker OPEN for \`${params.repo}\` — issue delegation suppressed. Next retry: ~60s (circuit auto-reset). Further alerts suppressed for 15 min.`
      : params.summaryText;

    await eventBus.publish('ao', 'spawn_failed', {
      eventKey: params.eventKey,
      issueUrl: params.issueUrl,
      issueNumber: params.issueNumber,
      repo: params.repo,
      reason: params.reason,
      correlationId: params.correlationId,
      error: params.error,
      degraded: params.degraded === true,
      summaryText,
      ...(params.extra || {}),
    });
    return true;
  };

  // ─── Approval Manager ─────────────────────────────────────────────────
  const approvalManager = new ApprovalManager(
    services.auditLog.getDb(),
    eventBus,
    actionRegistry,
    services.auditLog,
  );
  await approvalManager.initialize();
  if (budgetEnforcer) {
    approvalManager.setBudgetEnforcer(budgetEnforcer);
  }
  executor.setApprovalManager(approvalManager);
  logger.info('Approval manager initialized and wired to executor');

  // ─── Objective Manager ──────────────────────────────────────────────
  const objectiveManager = new ObjectiveManager(
    services.auditLog.getDb(),
    eventBus,
    costTracker,
  );
  await objectiveManager.initialize();
  executor.setObjectiveManager(objectiveManager);

  const staleLoopDetector = new StaleLoopDetector(eventBus, objectiveManager);
  executor.setStaleLoopDetector(staleLoopDetector);
  logger.info('Objective manager + stale loop detector initialized');

  // ─── Config Revision Tracker ──────────────────────────────────────────
  const revisionTracker = new RevisionTracker(services.auditLog.getDb());
  await revisionTracker.initialize();
  logger.info('Config revision tracker initialized');

  // ─── Agent Router ────────────────────────────────────────────────────
  const router = new AgentRouter();
  executor.setRouter(router);

  // ─── Deploy Config Capture ──────────────────────────────────────────
  // After loading all configs, check for changes vs stored revisions
  if (revisionTracker.hasPersistence) {
    const commitSha = process.env.COMMIT_SHA || process.env.GIT_COMMIT || null;
    void revisionTracker.captureOnDeploy(router.getAllConfigs(), {
      commitSha: commitSha ?? undefined,
      changedBy: 'ci',
    }).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Deploy config capture failed (non-fatal)', { error: msg });
    });
  }

  // ─── Approval Event Consumer ────────────────────────────────────────
  // When an approval is granted, re-execute the original action on behalf
  // of the requesting agent (bypassing the approval gate on retry).
  eventBus.subscribe('approval:granted', async (event) => {
    const payload = event.payload ?? {};
    const agentId = payload.agentId as string | undefined;
    const actionType = payload.actionType as string | undefined;
    const actionPayload = payload.payload as Record<string, unknown> | undefined;
    const requestId = payload.requestId as string | undefined;

    if (!agentId || !actionType || !actionPayload) {
      logger.warn('approval:granted event missing required fields', { requestId });
      return;
    }

    const config = router.getConfig(agentId);
    if (!config) {
      logger.warn('approval:granted — unknown agent', { agentId, requestId });
      return;
    }

    logger.info(`Executing approved action: ${actionType} for ${agentId}`, { requestId });

    try {
      const result = await actionRegistry.execute(actionType, actionPayload);
      logger.info(`Approved action executed: ${actionType}`, {
        requestId,
        success: result.success,
        error: result.error,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Approved action execution failed: ${actionType}`, {
        requestId, error: msg,
      });
    }
  });

  // ─── Slack Alerting Wiring ───────────────────────────────────────────
  const slackExecutor = actionRegistry.getExecutor('slack') as SlackExecutor;
  if (slackExecutor) {
    safetyGate.setSlackAlerter(async (message, severity) => {
      const channel = severity === 'critical' ? SLACK_CHANNELS.alerts : SLACK_CHANNELS.audit;
      await slackExecutor.execute('message', {
        channel, text: message, username: 'Sentinel', icon_emoji: ':shield:',
      });
    });

    reviewGate.setSlackAlerter(async (message, channel) => {
      await slackExecutor.execute('message', {
        channel: channel || SLACK_CHANNELS.executive,
        text: message, username: 'Reviewer', icon_emoji: ':mag:',
      });
    });

    outboundSafety.setSlackAlerter(async (message, severity) => {
      const channel = severity === 'critical' ? SLACK_CHANNELS.alerts : SLACK_CHANNELS.operations;
      await slackExecutor.execute('message', {
        channel, text: message, username: 'Sentinel', icon_emoji: ':shield:',
      });
    });

    const deployExecutor = actionRegistry.getExecutor('deploy') as DeployExecutor;
    if (deployExecutor) {
      deployExecutor.setSlackAlerter(async (message, channel) => {
        await slackExecutor.execute('message', {
          channel: channel || SLACK_CHANNELS.development,
          text: message, username: 'Deployment', icon_emoji: ':vertical_traffic_light:',
        });
      });
    }
  }

  // ─── Budget Alert Wiring ─────────────────────────────────────────────
  if (slackExecutor) {
    eventBus.subscribe('system:agent:budget_warning', async (event) => {
      const msg = event.payload?.message as string;
      if (msg) {
        await slackExecutor.execute('message', {
          channel: SLACK_CHANNELS.alerts,
          text: msg,
          username: 'Budget Tracker',
          icon_emoji: ':money_with_wings:',
        });
      }
    });
    eventBus.subscribe('system:agent:budget_exceeded', async (event) => {
      const msg = event.payload?.message as string;
      if (msg) {
        await slackExecutor.execute('message', {
          channel: SLACK_CHANNELS.alerts,
          text: msg,
          username: 'Budget Tracker',
          icon_emoji: ':money_with_wings:',
        });
      }
    });

    // Objective event alerts
    eventBus.subscribe('objective:stale_loop_detected', async (event) => {
      const msg = event.payload?.message as string;
      if (msg) {
        await slackExecutor.execute('message', {
          channel: SLACK_CHANNELS.alerts,
          text: `:repeat: *Stale Loop Detected*\n${msg}`,
          username: 'Objective Tracker',
          icon_emoji: ':dart:',
        });
      }
    });
    eventBus.subscribe('objective:budget_exceeded', async (event) => {
      const p = event.payload ?? {};
      const text = `:warning: *Objective Budget Exceeded*\n*${p.title}*\nBudget: $${((p.budgetCents as number ?? 0) / 100).toFixed(2)} | Spent: $${((p.spentCents as number ?? 0) / 100).toFixed(2)}`;
      await slackExecutor.execute('message', {
        channel: SLACK_CHANNELS.alerts,
        text,
        username: 'Objective Tracker',
        icon_emoji: ':dart:',
      });
    });
  }

  // ─── Cron Triggers ───────────────────────────────────────────────────
  const cronManager = new CronManager();
  const cronTriggers = router.getAllCronTriggers();

  for (const { agent, task, schedule, model: cronModel, prompts: cronPrompts } of cronTriggers) {
    const config = router.getConfig(agent);
    if (!config) continue;

    // Elvis pre-check: skip the LLM if the agent has no pending work.
    // Controlled per-agent via YAML heartbeat.precheck.enabled (default: true).
    // Strategist is hard-excluded: it creates work from GitHub issues that haven't
    // been triaged into Redis yet, so queue-depth checks would produce a
    // chicken-and-egg false negative (see issue #447 post-mortem).
    const precheckCfg = config.heartbeat?.precheck;
    const precheckEnabled = agent !== 'strategist' && precheckCfg?.enabled !== false;
    const precheckMaxSilenceMs = ((precheckCfg?.maxSilenceHours ?? 6) * 3_600_000);

    cronManager.schedule(agent, schedule, task, async () => {
      if (fleetGuard?.isPaused()) { logger.info(`Cron skipped (fleet paused): ${agent}:${task}`); return; }
      const cronOverrides = await settingsOverlay.getAgentOverrides(config.department, agent);
      if (cronOverrides?.cronEnabled?.[task] === false) {
        logger.info(`Cron skipped (disabled via MC): ${agent}:${task}`);
        return;
      }
      if (deployRedis) {
        const locked = await deployRedis.set(`cron:lock:${agent}:${task}`, '1', 'EX', 600, 'NX');
        if (!locked) { logger.info(`Cron skipped (locked): ${agent}:${task}`); return; }
      }

      // Elvis pre-check gate — deterministic, zero-LLM
      if (precheckEnabled && deployRedis) {
        const precheck = await shouldRunHeartbeat(
          agent,
          deployRedis,
          eventStream ?? null,
          { maxSilenceMs: precheckMaxSilenceMs },
        );
        if (!precheck.shouldRun) {
          logger.info(`[${agent}] Elvis pre-check: skipping ${task} — ${precheck.skipReason}`);
          return;
        }
        logger.info(`[${agent}] Elvis pre-check: running ${task} — ${precheck.reasons.join(', ')}`);
      }

      logger.info(`Cron fired: ${agent}:${task}`);
      try {
        await executor.execute(config, task, 'cron', undefined, cronModel, undefined, cronPrompts);
        if (precheckEnabled && deployRedis) {
          await recordHeartbeatRun(agent, deployRedis);
        }
      } catch (err) {
        logger.error(`Cron execution failed: ${agent}:${task}`, { error: err });
      }
    });
  }

  logger.info(`Scheduled ${cronTriggers.length} cron triggers`);


  // ─── Event Triggers ──────────────────────────────────────────────────
  const eventSubs = router.getAllEventSubscriptions();

  for (const [eventKey, agents] of eventSubs) {
    eventBus.subscribe(eventKey, async (event) => {
      if (router.isShuttingDown) {
        logger.warn(`Shutdown in progress — dropping ${eventKey} event`, {
          correlationId: event.correlationId,
        });
        return;
      }
      if (fleetGuard?.isPaused()) {
        logger.info(`Fleet paused — dropping ${eventKey} event`, {
          correlationId: event.correlationId,
        });
        return;
      }
      const targetAgent = event.payload?.target_agent as string | undefined;

      const payload = event.payload || {};
      const missing = validateEventPayload(eventKey, payload);
      if (missing) {
        logger.warn(`Dropping malformed ${eventKey} event — missing fields: ${missing.join(', ')}`, {
          payloadKeys: Object.keys(payload),
        });
        return;
      }

      for (const agentName of agents) {
        if (targetAgent && agentName !== targetAgent) continue;

        const config = router.getConfig(agentName);
        if (!config) continue;

        const triggers = config.triggers.filter(
          t => t.type === 'event' && t.event === eventKey,
        );
        if (triggers.length === 0) continue;

        for (const trigger of triggers) {
          // Check MC settings overlay for event toggle — must run before
          // dispatcher and dedup branches so disabled events are never enqueued
          if (settingsOverlay) {
            const eventOverrides = await settingsOverlay.getAgentOverrides(config.department, agentName);
            if (eventOverrides?.eventEnabled?.[eventKey] === false) {
              logger.info(`Event skipped (disabled via MC): ${agentName} → ${eventKey}`);
              continue;
            }
          }

          if (deployRedis) {
            const dedupKey = buildEventDispatchDedupKey({
              eventId: event.id,
              correlationId: event.correlationId,
              agentName,
              task: trigger.task,
            });
            const claimed = await claimDedupKey(deployRedis, dedupKey, EVENT_DISPATCH_DEDUP_TTL_SEC);
            if (!claimed) {
              logger.info('Event dispatch dedup — skipping duplicate trigger', {
                eventKey,
                agentName,
                task: trigger.task,
                eventId: event.id,
                correlationId: event.correlationId,
              });
              continue;
            }
          }

          // ─── Mechanic: deterministic executor bypass ────────────────
          // Mechanic is NOT an LLM-driven agent. Intercept its events
          // and call the constrained task runner directly.
          if (agentName === 'mechanic') {
            logger.info(`Event routed to mechanic executor: ${trigger.task} (from ${eventKey})`, {
              correlationId: event.correlationId,
            });
            try {
              const { executeMechanicTask } = await import('../mechanic/mechanic-executor.js');
              const payload = event.payload || {};
              const mechanicTask = {
                repo: (payload.repo as string) || `${payload.owner}/${payload.repo_name || ''}`,
                branch: (payload.branch as string) || (payload.head_branch as string) || '',
                taskType: (payload.taskType as string) || '',
                reason: (payload.reason as string) || undefined,
                requestedBy: (payload.requestedBy as string) || undefined,
                prNumber: (payload.prNumber as number) || undefined,
              };
              const ghToken = process.env.GITHUB_TOKEN || '';
              const result = await executeMechanicTask(mechanicTask, ghToken);
              await eventBus.publish(
                'mechanic',
                result.success ? 'task_completed' : 'task_failed',
                { ...result, originalTask: mechanicTask },
                event.correlationId,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error(`Mechanic executor failed: ${trigger.task}`, { error: msg });
              await eventBus.publish('mechanic', 'task_failed', {
                success: false, error: msg,
              }, event.correlationId);
            }
            continue;
          }

          // Deploy assessment dedup
          if (agentName === 'architect' && trigger.task === 'deploy_assessment' && deployRedis) {
            const p = event.payload || {};
            const commitSha = (p.commit_sha as string) || (p.sha as string);
            const repoFull = (p.repo_full as string) || `${p.owner}/${p.repo}`;
            if (commitSha && repoFull) {
              const eventDedupKey = `deploy:event-dedup:${repoFull}:${commitSha}`;
              const isNew = await deployRedis.set(eventDedupKey, '1', 'EX', 1800, 'NX');
              if (!isNew) {
                logger.info('Deploy event dedup — skipping duplicate deploy_assessment trigger', {
                  repoFull, commitSha, correlationId: event.correlationId,
                });
                continue;
              }
            }
          }

          logger.info(`Event triggered: ${agentName}:${trigger.task} (from ${eventKey})`, {
            correlationId: event.correlationId,
          });

          try {
            const payloadWithCorrelation = event.correlationId
              ? { ...event.payload, correlationId: event.correlationId }
              : event.payload;
            // Fire without await so multiple triggers run in parallel
            executor.execute(config, trigger.task, 'event', payloadWithCorrelation, trigger.model)
              .catch(err => logger.error(`Event execution failed: ${agentName}:${trigger.task}`, { error: err }));
          } catch (err) {
            logger.error(`Event execution failed: ${agentName}:${trigger.task}`, { error: err });
          }
        }
      }
    });
  }

  logger.info(`Subscribed to ${eventSubs.size} event patterns`);

  // ─── Batch Event Triggers ────────────────────────────────────────────
  const batchCollector = new BatchCollector(executor);
  batchCollector.setSettingsOverlay(settingsOverlay);
  const allConfigs = router.getAllConfigs();
  const batchEventPatterns = new Set<string>();

  for (const [, config] of allConfigs) {
    for (const trigger of config.triggers) {
      if (trigger.type === 'batch_event') {
        const patterns = batchCollector.register({
          agentConfig: config,
          task: trigger.task,
          events: trigger.events,
          minCount: trigger.min_count ?? 10,
          timeoutMs: trigger.timeout_ms ?? 1800000,
          model: trigger.model,
        });
        for (const p of patterns) batchEventPatterns.add(p);
      }
    }
  }

  for (const pattern of batchEventPatterns) {
    eventBus.subscribe(`batch:${pattern}`, async (event) => {
      await batchCollector.onEvent(event);
    });
  }

  if (batchEventPatterns.size > 0) {
    eventBus.subscribe('*:*', async (event) => {
      await batchCollector.onEvent(event);
    });
    logger.info(`Batch collector registered for ${batchEventPatterns.size} event patterns`);
  }

  // ─── Bot PR Hygiene Cron: keep bot PRs refreshed + auto-merge armed ────
  {
    const githubExec = actionRegistry.getExecutor('github') as GitHubExecutor | undefined;

    const runPrHygieneCycle = async (): Promise<void> => {
      if (!githubExec) {
        logger.warn('[PRHygiene] GitHub executor unavailable — skipping cycle');
        return;
      }
      if (fleetGuard?.isPaused()) {
        logger.info('[PRHygiene] Fleet paused — skipping cycle');
        return;
      }

      // Check rate-limit suppression key before acquiring the cycle lock.
      if (deployRedis) {
        const rateLimitUntil = await deployRedis.get(buildPrHygieneRateLimitKey());
        if (rateLimitUntil) {
          logger.info('[PRHygiene] Rate-limited — suppressing cycle', { rateLimitUntil });
          return;
        }
      }

      const cycleLockKey = buildPrHygieneCycleLockKey();
      const cycleClaimed = await claimDedupKey(
        deployRedis,
        cycleLockKey,
        PR_HYGIENE_CYCLE_LOCK_TTL_SEC,
      );
      if (!cycleClaimed) {
        logger.info('[PRHygiene] Cycle already running elsewhere — skipping');
        return;
      }

      try {

      const enableAutoMergeWithRetry = async ({
        owner,
        repo,
        repoFull,
        baseBranch,
        pullNumber,
        mergeableState,
      }: {
        owner: string;
        repo: string;
        repoFull: string;
        baseBranch: string;
        pullNumber: number;
        mergeableState?: string;
      }): Promise<boolean> => {
        let lastError: string | undefined;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const enableResult = await githubExec.execute('enable_pr_auto_merge', {
            owner,
            repo,
            pullNumber,
          });
          if (enableResult.success) {
            logger.info('[PRHygiene] Auto-merge armed result', {
              repo: repoFull,
              baseBranch,
              pullNumber,
              mergeableState,
              autoMergeArmed: true,
              attempt,
            });
            return true;
          }

          lastError = enableResult.error;
          logger.warn('[PRHygiene] Failed to enable auto-merge for bot PR', {
            repo: repoFull,
            baseBranch,
            pullNumber,
            mergeableState,
            error: enableResult.error,
            attempt,
          });

          if (attempt < 2) {
            await sleepMs(3000);
          }
        }

        logger.warn('[PRHygiene] Auto-merge armed result', {
          repo: repoFull,
          baseBranch,
          pullNumber,
          mergeableState,
          autoMergeArmed: false,
          error: lastError,
        });
        return false;
      };

      for (const repoConfig of repoRegistry.getAll().values()) {
        const owner = repoConfig.github.owner;
        const repo = repoConfig.github.repo;
        const repoFull = `${owner}/${repo}`;

        const listResult = await githubExec.execute('list_prs', {
          owner,
          repo,
          state: 'open',
          fetch_all: true,
        });
        if (!listResult.success) {
          logger.warn('[PRHygiene] Failed to list PRs', {
            repo: repoFull,
            error: listResult.error,
          });
          continue;
        }

        const prs = Array.isArray((listResult.data as { prs?: unknown[] } | undefined)?.prs)
          ? ((listResult.data as { prs: Array<Record<string, unknown>> }).prs)
          : [];
        const candidatesByBase = listPrHygieneCandidatesByBase(prs);
        if (candidatesByBase.size === 0) continue;

        logger.info('[PRHygiene] Evaluating bot PR candidates', {
          repo: repoFull,
          baseBranches: [...candidatesByBase.keys()],
          candidateCount: [...candidatesByBase.values()].reduce((sum, list) => sum + list.length, 0),
        });

        for (const [baseBranch, candidates] of candidatesByBase.entries()) {
          let branchActionTaken = false;

          for (const candidate of candidates) {
            try {
              const needsHumanMarkerKey = buildPrHygieneNeedsHumanKey({
                repo: repoFull,
                pullNumber: candidate.prNumber,
              });
              if (deployRedis) {
                try {
                  const markedNeedsHuman = await deployRedis.get(needsHumanMarkerKey);
                  if (markedNeedsHuman) {
                    logger.info('[PRHygiene] Skipping bot PR already marked needs-human', {
                      repo: repoFull,
                      baseBranch,
                      pullNumber: candidate.prNumber,
                    });
                    // Skip this PR but continue processing other candidates.
                    // Previously this was `break` which blocked ALL newer PRs
                    // for the same base branch, causing pipeline deadlock when
                    // a needs-human PR sat unresolved for hours/days.
                    continue;
                  }
                } catch (err) {
                  logger.warn('[PRHygiene] Failed to read needs-human marker', {
                    repo: repoFull,
                    baseBranch,
                    pullNumber: candidate.prNumber,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              const prResult = await githubExec.execute('get_pr', {
                owner,
                repo,
                pullNumber: candidate.prNumber,
              });
              if (!prResult.success) {
                logger.warn('[PRHygiene] Failed to inspect PR', {
                  repo: repoFull,
                  baseBranch,
                  pullNumber: candidate.prNumber,
                  error: prResult.error,
                });
                continue;
              }

              const prData = (prResult.data || {}) as Record<string, unknown>;
              if (prData.state !== 'open' || prData.draft === true || prData.merged === true) {
                continue;
              }

              const mergeableState =
                typeof prData.mergeable_state === 'string' ? prData.mergeable_state : undefined;
              const autoMergeEnabled = prData.auto_merge_enabled === true;
              const expectedHeadSha =
                prData.head && typeof prData.head === 'object' && typeof (prData.head as Record<string, unknown>).sha === 'string'
                  ? (prData.head as Record<string, unknown>).sha as string
                  : undefined;

              logger.info('[PRHygiene] Inspected bot PR candidate', {
                repo: repoFull,
                baseBranch,
                pullNumber: candidate.prNumber,
                mergeableState,
                autoMergeEnabled,
                headBranch: candidate.headBranch,
              });

              if (shouldLabelNeedsHuman(mergeableState)) {
                const labelClaimed = await claimDedupKey(
                  deployRedis,
                  buildPrHygieneCooldownKey({
                    repo: repoFull,
                    pullNumber: candidate.prNumber,
                    action: 'needs_human',
                  }),
                  PR_HYGIENE_PR_COOLDOWN_TTL_SEC,
                );
                if (!labelClaimed) continue;

                const labelResult = await githubExec.execute('add_labels', {
                  owner,
                  repo,
                  issue_number: candidate.prNumber,
                  labels: ['needs-human'],
                });
                if (labelResult.success) {
                  if (deployRedis) {
                    try {
                      await deployRedis.set(
                        needsHumanMarkerKey,
                        '1',
                        'EX',
                        PR_HYGIENE_NEEDS_HUMAN_TTL_SEC,
                      );
                    } catch (err) {
                      logger.warn('[PRHygiene] Failed to persist needs-human marker', {
                        repo: repoFull,
                        baseBranch,
                        pullNumber: candidate.prNumber,
                        error: err instanceof Error ? err.message : String(err),
                      });
                    }
                  }
                  logger.info('[PRHygiene] Labeled conflicted bot PR for human intervention', {
                    repo: repoFull,
                    baseBranch,
                    pullNumber: candidate.prNumber,
                    mergeableState,
                  });
                  // Note: auto-merge may still be enabled on this PR, but
                  // BranchRefresh will skip it (needs-human label check below)
                  // and update_pr_branch would fail anyway on a conflicting PR.
                } else {
                  logger.warn('[PRHygiene] Failed to label conflicted bot PR', {
                    repo: repoFull,
                    baseBranch,
                    pullNumber: candidate.prNumber,
                    mergeableState,
                    error: labelResult.error,
                  });
                }
                // Label applied — skip this PR and continue to the next candidate.
                // Previously this was `break` which blocked ALL newer PRs,
                // causing pipeline deadlock. Dirty PRs get labeled and skipped;
                // clean/behind PRs continue to be processed.
                continue;
              }

              if (mergeableState === 'behind') {
                const updateClaimed = await claimDedupKey(
                  deployRedis,
                  buildPrHygieneCooldownKey({
                    repo: repoFull,
                    pullNumber: candidate.prNumber,
                    action: 'update_branch',
                  }),
                  PR_HYGIENE_PR_COOLDOWN_TTL_SEC,
                );
                if (updateClaimed) {
                  const updateResult = await githubExec.execute('update_pr_branch', {
                    owner,
                    repo,
                    pullNumber: candidate.prNumber,
                    expected_head_sha: expectedHeadSha,
                  });
                  if (updateResult.success) {
                    logger.info('[PRHygiene] Requested branch update for bot PR', {
                      repo: repoFull,
                      baseBranch,
                      pullNumber: candidate.prNumber,
                    });
                  } else {
                    logger.warn('[PRHygiene] Failed to request branch update for bot PR', {
                      repo: repoFull,
                      baseBranch,
                      pullNumber: candidate.prNumber,
                      error: updateResult.error,
                    });
                  }
                  branchActionTaken = true;
                }
              }

              if (!autoMergeEnabled) {
                const enableClaimed = await claimDedupKey(
                  deployRedis,
                  buildPrHygieneCooldownKey({
                    repo: repoFull,
                    pullNumber: candidate.prNumber,
                    action: 'enable_auto_merge',
                  }),
                  PR_HYGIENE_PR_COOLDOWN_TTL_SEC,
                );
                if (!enableClaimed) {
                  if (branchActionTaken) break;
                  continue;
                }

                await enableAutoMergeWithRetry({
                  owner,
                  repo,
                  repoFull,
                  baseBranch,
                  pullNumber: candidate.prNumber,
                  mergeableState,
                });
                branchActionTaken = true;
              }

              if (branchActionTaken) break;
            } catch (err) {
              if (err instanceof GitHubRateLimitError) {
                const backoffSec = Math.max(
                  Math.ceil((err.retryAfterMs - Date.now()) / 1000),
                  PR_HYGIENE_RATE_LIMIT_TTL_SEC,
                );
                if (deployRedis) {
                  await deployRedis.set(
                    buildPrHygieneRateLimitKey(),
                    new Date(Date.now() + backoffSec * 1000).toISOString(),
                    'EX',
                    backoffSec,
                  );
                }
                logger.warn('[PRHygiene] Rate limited — suppressing cycle', { backoffSec });
                return; // Exit the cycle entirely; finally will release the lock
              }
              logger.error('[PRHygiene] Candidate processing failed', {
                repo: repoFull,
                baseBranch,
                pullNumber: candidate.prNumber,
                error: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }
        }
      }

      } catch (err) {
        if (err instanceof GitHubRateLimitError) {
          const backoffSec = Math.max(
            Math.ceil((err.retryAfterMs - Date.now()) / 1000),
            PR_HYGIENE_RATE_LIMIT_TTL_SEC,
          );
          if (deployRedis) {
            await deployRedis.set(
              buildPrHygieneRateLimitKey(),
              new Date(Date.now() + backoffSec * 1000).toISOString(),
              'EX',
              backoffSec,
            );
          }
          logger.warn('[PRHygiene] Rate limited — suppressing cycle', { backoffSec });
          return; // Exit the cycle entirely; finally will release the lock
        }
        throw err;
      } finally {
        // Explicitly release the cycle lock so the next tick can start
        // immediately instead of waiting for the TTL to expire.
        await deployRedis?.del(cycleLockKey).catch((err: unknown) => {
          logger.warn('[PRHygiene] Failed to release cycle lock', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    };

    setInterval(() => {
      void runPrHygieneCycle().catch((err) => {
        logger.error('[PRHygiene] Cycle failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 5 * 60 * 1000);

    setTimeout(() => {
      void runPrHygieneCycle().catch((err) => {
        logger.error('[PRHygiene] Initial cycle failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 30_000);

    logger.info('[PRHygiene] periodic bot PR hygiene worker registered');
  }

  // ─── Branch Refresh Worker: keep auto-merge PRs current with master ─────
  {
    const githubExec = actionRegistry.getExecutor('github') as GitHubExecutor | undefined;

    eventBus.subscribe('github:pr_merged', async (event) => {
      if (!githubExec) {
        logger.warn('[BranchRefresh] GitHub executor unavailable — skipping pr_merged handling');
        return;
      }

      const payload = event.payload || {};
      const owner = typeof payload.owner === 'string' ? payload.owner : undefined;
      const repo = typeof payload.repo === 'string' ? payload.repo : undefined;
      const repoFull = typeof payload.repo_full === 'string'
        ? payload.repo_full
        : owner && repo ? `${owner}/${repo}` : undefined;
      const mergedPrNumber = typeof payload.pr_number === 'number' ? payload.pr_number : undefined;
      const baseBranch = typeof payload.base_branch === 'string' ? payload.base_branch : 'master';

      if (!owner || !repo || !repoFull) {
        logger.warn('[BranchRefresh] Missing repo information on github:pr_merged payload', {
          eventId: event.id,
          correlationId: event.correlationId,
        });
        return;
      }

      const listResult = await githubExec.execute('list_prs', {
        owner,
        repo,
        state: 'open',
        per_page: 100,
      });

      if (!listResult.success) {
        logger.warn('[BranchRefresh] Failed to list open PRs after merge', {
          repo: repoFull,
          error: listResult.error,
        });
        return;
      }

      const prs = Array.isArray((listResult.data as { prs?: unknown[] } | undefined)?.prs)
        ? ((listResult.data as { prs: Array<Record<string, unknown>> }).prs)
        : [];

      const candidates = prs.filter((pr) => {
        const prNumber = typeof pr.number === 'number' ? pr.number : undefined;
        const user = typeof pr.user === 'string' ? pr.user : '';
        const draft = pr.draft === true;
        const base = pr.base && typeof pr.base === 'object'
          ? pr.base as Record<string, unknown>
          : undefined;
        const baseRef = typeof base?.ref === 'string' ? base.ref : undefined;

        return (
          prNumber !== undefined &&
          prNumber !== mergedPrNumber &&
          !draft &&
          isAutomatedPrAuthor(user) &&
          baseRef === baseBranch
        );
      });

      if (candidates.length === 0) {
        logger.info('[BranchRefresh] No bot PRs need evaluation after merge', {
          repo: repoFull,
          mergedPrNumber,
          baseBranch,
        });
        return;
      }

      for (const pr of candidates) {
        const targetPullNumber = pr.number as number;
        const claimKey = buildBranchRefreshClaimKey({
          eventId: event.id,
          correlationId: event.correlationId,
          repo: repoFull,
          targetPullNumber,
        });
        const claimed = await claimDedupKey(deployRedis, claimKey, BRANCH_REFRESH_CLAIM_TTL_SEC);
        if (!claimed) {
          logger.info('[BranchRefresh] Duplicate branch refresh skipped', {
            repo: repoFull,
            targetPullNumber,
            eventId: event.id,
            correlationId: event.correlationId,
          });
          continue;
        }

        const prResult = await githubExec.execute('get_pr', {
          owner,
          repo,
          pullNumber: targetPullNumber,
        });

        if (!prResult.success) {
          logger.warn('[BranchRefresh] Failed to inspect PR before branch update', {
            repo: repoFull,
            targetPullNumber,
            error: prResult.error,
          });
          continue;
        }

        const prData = (prResult.data || {}) as Record<string, unknown>;
        if (prData.draft === true || prData.merged === true || prData.state !== 'open') {
          continue;
        }
        // Skip PRs marked needs-human — they require human intervention,
        // not automated branch advancement.
        const prLabels = Array.isArray(prData.labels)
          ? (prData.labels as Array<{ name?: string }>).map(l => l.name || '')
          : [];
        if (prLabels.some(l => l === 'needs-human' || l === '🙅 needs-human')) {
          logger.info('[BranchRefresh] Skipping needs-human PR', {
            repo: repoFull,
            targetPullNumber,
          });
          continue;
        }
        if (prData.auto_merge_enabled !== true) {
          logger.info('[BranchRefresh] Skipping PR without auto-merge enabled', {
            repo: repoFull,
            targetPullNumber,
          });
          continue;
        }

        const updateResult = await githubExec.execute('update_pr_branch', {
          owner,
          repo,
          pullNumber: targetPullNumber,
        });

        if (updateResult.success) {
          logger.info('[BranchRefresh] Requested branch update for auto-merge PR', {
            repo: repoFull,
            targetPullNumber,
            mergedPrNumber,
            baseBranch,
          });
        } else {
          logger.warn('[BranchRefresh] Failed to request branch update', {
            repo: repoFull,
            targetPullNumber,
            mergedPrNumber,
            error: updateResult.error,
          });
        }
      }
    });

    logger.info('[BranchRefresh] github:pr_merged branch refresh worker registered');
  }

  // ─── CI Repair Worker: route failed bot PR checks back into AO ────────
  {
    const githubExec = actionRegistry.getExecutor('github') as GitHubExecutor | undefined;

    eventBus.subscribe('github:ci_fail', async (event) => {
      if (!aoBridge) {
        logger.warn('[CIRepair] AO bridge unavailable — skipping ci_fail handling');
        return;
      }
      if (!githubExec) {
        logger.warn('[CIRepair] GitHub executor unavailable — skipping ci_fail handling');
        return;
      }

      const payload = event.payload || {};
      const owner = typeof payload.owner === 'string' ? payload.owner : undefined;
      const repo = typeof payload.repo === 'string' ? payload.repo : undefined;
      const repoFull = typeof payload.repo_full === 'string'
        ? payload.repo_full
        : owner && repo ? `${owner}/${repo}` : undefined;
      const branch = typeof payload.branch === 'string' ? payload.branch : undefined;
      const commitSha = typeof payload.commit_sha === 'string' ? payload.commit_sha : undefined;
      const workflow = typeof payload.workflow === 'string' ? payload.workflow : undefined;
      const runUrl = typeof payload.url === 'string' ? payload.url : undefined;
      const failureSummary = typeof payload.failure_summary === 'string' ? payload.failure_summary : undefined;
      const failedJob = typeof payload.failed_job === 'string' ? payload.failed_job : undefined;
      const failureLogExcerpt = typeof payload.failure_log_excerpt === 'string'
        ? payload.failure_log_excerpt
        : undefined;

      if (!owner || !repo || !repoFull || !branch || !commitSha) {
        logger.warn('[CIRepair] Missing repo, branch, or commit information on github:ci_fail payload', {
          eventId: event.id,
          correlationId: event.correlationId,
        });
        return;
      }

      const claimKey = buildCiRepairClaimKey({ repo: repoFull, branch, commitSha });
      const claimed = await claimDedupKey(deployRedis, claimKey, CI_REPAIR_CLAIM_TTL_SEC);
      if (!claimed) {
        logger.info('[CIRepair] Duplicate ci_fail repair skipped', {
          repo: repoFull,
          branch,
          commitSha,
        });
        return;
      }

      const listResult = await githubExec.execute('list_prs', {
        owner,
        repo,
        state: 'open',
        per_page: 100,
      });

      if (!listResult.success) {
        logger.warn('[CIRepair] Failed to list PRs after ci_fail', {
          repo: repoFull,
          branch,
          error: listResult.error,
        });
        return;
      }

      const prs = Array.isArray((listResult.data as { prs?: unknown[] } | undefined)?.prs)
        ? ((listResult.data as { prs: Array<Record<string, unknown>> }).prs)
        : [];

      const target = selectCiRepairTarget(prs, branch);
      if (!target) {
        logger.info('[CIRepair] No open automated PR matched failing branch', {
          repo: repoFull,
          branch,
          commitSha,
        });
        return;
      }

      if (!target.issueNumber) {
        logger.info('[CIRepair] No issue number extracted from branch — proceeding with repair without issue context', {
          repo: repoFull,
          branch,
          prNumber: target.prNumber,
        });
      }

      // ─── CI Repair Attempt Cap ───────────────────────────────────────────
      // If this PR has already been repaired MAX_CI_REPAIR_ATTEMPTS times,
      // stop creating repair tasks and escalate to a human instead.
      const capResult = await handleCiRepairCapGate({
        redis: deployRedis,
        githubExec,
        repoFull,
        owner,
        repo,
        prNumber: target.prNumber,
        issueNumber: target.issueNumber,
      });
      if (!capResult.shouldProceed) return;

      if (aoBridge.isCircuitOpen(repoFull)) {
        logger.error(`[CIRepair] Circuit OPEN for ${repoFull} — github:ci_fail will not be processed`);
        await markAoDegraded(repoFull, 'circuit_open');
        await emitAoSpawnFailure({
          eventKey: 'github:ci_fail',
          repo: repoFull,
          reason: 'circuit_open',
          correlationId: event.correlationId,
          summaryText: `AO degraded for ${repoFull} — skipping CI repair delegation while the circuit breaker is open.`,
          degraded: true,
          extra: {
            pr_number: target.prNumber,
            branch,
            commit_sha: commitSha,
          },
        });
        return;
      }

      const directive = buildCiRepairDirective({
        repoFull,
        prNumber: target.prNumber,
        issueNumber: target.issueNumber,
        branch,
        commitSha,
        workflow,
        runUrl,
        failureSummary,
        failedJob,
        failureLogExcerpt,
      });

      const result = await aoBridge.spawn({
        repo: repoFull,
        directive,
        cleanupIssueNumber: target.issueNumber,
        claimPr: target.prNumber,
        orchestrator: aoOrchestrator,
        context: JSON.stringify({
          eventKey: 'github:ci_fail',
          correlationId: event.correlationId,
          prNumber: target.prNumber,
          prUrl: target.prUrl,
          branch,
          commitSha,
          workflow,
          runUrl,
          repairMode: 'fix_ci_failure',
        }),
        priority: 'P1',
      });

      if (result?.status === 'spawned') {
        logger.info(`[CIRepair] Routed github:ci_fail to AO: ${result.id}`, {
          repo: repoFull,
          prNumber: target.prNumber,
          issueNumber: target.issueNumber,
          branch,
        });
      } else {
        logger.error('[CIRepair] Failed to spawn AO repair task for github:ci_fail', {
          status: result?.status,
          error: result?.error,
          repo: repoFull,
          prNumber: target.prNumber,
          issueNumber: target.issueNumber,
          branch,
        });
        await markAoDegraded(repoFull, 'ao_unreachable');
        await emitAoSpawnFailure({
          eventKey: 'github:ci_fail',
          repo: repoFull,
          reason: 'ao_unreachable',
          error: result?.error,
          correlationId: event.correlationId,
          summaryText: `AO degraded for ${repoFull} — CI repair delegation is temporarily paused after spawn timeouts/unreachable responses.`,
          degraded: true,
          extra: {
            pr_number: target.prNumber,
            branch,
            commit_sha: commitSha,
          },
        });
      }
    });

    logger.info('[CIRepair] github:ci_fail AO repair worker registered');
  }

  // ─── AO Bridge: Route architect:build_directive to Agent Orchestrator ────
  if (aoBridge) {
    const routeAoDirective = async (
      event: { id: string; correlationId?: string; payload?: Record<string, unknown> },
      delivery: 'pubsub' | 'stream',
    ): Promise<void> => {
      const payload = event.payload || {};
      const repo = typeof payload.repo === 'string' ? payload.repo : '';
      const owner = typeof payload.owner === 'string' ? payload.owner : '';
      const fullRepo = repo.includes('/') ? repo : (owner && repo ? `${owner}/${repo}` : '');
      const issueNumber = typeof payload.issueNumber === 'number' ? payload.issueNumber
        : typeof payload.issue_number === 'number' ? payload.issue_number : undefined;
      const issueUrl = typeof payload.issueUrl === 'string' ? payload.issueUrl
        : typeof payload.issue_url === 'string' ? payload.issue_url : undefined;

      const targetRepo = fullRepo || 'your-org/yclaw';
      const degradedReason = await getAoDegradedReason(targetRepo);
      if (degradedReason) {
        logger.warn(`[AO] Degraded hold active for ${targetRepo} — skipping architect:build_directive`, {
          issueNumber,
          degradedReason,
          delivery,
        });
        await emitAoSpawnFailure({
          eventKey: 'architect:build_directive',
          issueUrl,
          issueNumber,
          repo: targetRepo,
          reason: degradedReason,
          correlationId: event.correlationId,
          summaryText: `AO degraded for ${targetRepo} — skipping new Architect delegations for ${AO_DEGRADED_HOLD_TTL_SEC}s while AO recovers.`,
          degraded: true,
        });
        return;
      }
      const claimKey = buildAoDirectiveClaimKey({
        eventId: event.id,
        correlationId: event.correlationId,
        repo: targetRepo,
        issueNumber,
      });
      const claimed = await claimDedupKey(deployRedis, claimKey, AO_DIRECTIVE_CLAIM_TTL_SEC);
      if (!claimed) {
        logger.warn('[AO] Duplicate architect:build_directive skipped', {
          delivery,
          repo: targetRepo,
          issueNumber,
          eventId: event.id,
          correlationId: event.correlationId,
        });
        if (delivery === 'stream') {
          throw new Error(`AO directive claim already held for ${claimKey}`);
        }
        return;
      }

      // Circuit breaker: skip spawn entirely when AO is confirmed down for this repo
      if (aoBridge.isCircuitOpen(targetRepo)) {
        logger.error(`[AO] Circuit OPEN for ${targetRepo} — architect:build_directive will not be processed`);
        await markAoDegraded(targetRepo, 'circuit_open');
        await emitAoSpawnFailure({
          eventKey: 'architect:build_directive',
          issueUrl,
          issueNumber,
          repo: targetRepo,
          reason: 'circuit_open',
          correlationId: event.correlationId,
          summaryText: `AO circuit is open for ${targetRepo} — suppressing new Architect delegations until the breaker resets.`,
          degraded: true,
        });
        return;
      }

      if (!fullRepo) {
        logger.warn('[AO] No repo in architect:build_directive — defaulting to your-org/yclaw');
      }

      // F1: Issue-scoped claim — prevents duplicate delegation from concurrent
      // sweep + webhook + label events. Must be checked BEFORE spawn.
      if (issueNumber) {
        const issueClaimKey = buildIssueClaimKey(targetRepo, issueNumber);
        const issueClaimed = await claimDedupKey(deployRedis, issueClaimKey, ISSUE_CLAIM_TTL_SEC);
        if (!issueClaimed) {
          logger.info('[AO] Issue already claimed — skipping duplicate delegation', {
            repo: targetRepo, issueNumber, delivery,
          });
          return;
        }
      }

      // Build directive from Architect's structured fields (investigation_summary,
      // plan, key_files, constraints, acceptance_criteria). Falls back to description
      // or generic event name if none are present.
      const parts: string[] = [];
      if (typeof payload.investigation_summary === 'string' && payload.investigation_summary.trim()) parts.push(payload.investigation_summary.trim());
      if (typeof payload.plan === 'string' && payload.plan.trim()) parts.push(`\n\nPlan:\n${payload.plan.trim()}`);
      if (typeof payload.key_files === 'string' && payload.key_files.trim()) parts.push(`\n\nKey files:\n${payload.key_files.trim()}`);
      if (Array.isArray(payload.key_files) && payload.key_files.length > 0) parts.push(`\n\nKey files:\n${payload.key_files.join('\n')}`);
      if (typeof payload.constraints === 'string' && payload.constraints.trim()) parts.push(`\n\nConstraints:\n${payload.constraints.trim()}`);
      if (typeof payload.acceptance_criteria === 'string' && payload.acceptance_criteria.trim()) parts.push(`\n\nAcceptance criteria:\n${payload.acceptance_criteria.trim()}`);

      const directive = parts.length > 0
        ? parts.join('')
        : typeof payload.description === 'string' ? payload.description
        : 'Event: architect:build_directive';

      const result = await aoBridge.spawn({
        issueUrl,
        issueNumber,
        repo: targetRepo,
        directive,
        orchestrator: aoOrchestrator,
        context: JSON.stringify({ eventKey: 'architect:build_directive', correlationId: event.correlationId, ...payload }),
        priority: typeof payload.priority === 'string' ? payload.priority as 'P0' | 'P1' | 'P2' | 'P3' : undefined,
      });

      if (result?.status === 'spawned') {
        logger.info(`[AO] Routed architect:build_directive to AO: ${result.id}`, { repo: targetRepo, issueNumber });
        // F1: Add in-progress lifecycle label (claim already acquired above)
        if (issueNumber) {
          const ghExec = actionRegistry.getExecutor('github') as GitHubExecutor | undefined;
          if (ghExec) {
            const labelResult = await ghExec.execute('add_labels', {
              owner: targetRepo.split('/')[0],
              repo: targetRepo.split('/')[1],
              issue_number: issueNumber,
              labels: ['in-progress'],
            }).catch((err: unknown) => {
              logger.warn('[AO] Failed to add in-progress label', { issueNumber, error: err instanceof Error ? err.message : String(err) });
              return { success: false, error: String(err) };
            });
            if (labelResult && !labelResult.success) {
              logger.warn('[AO] add_labels returned failure', { issueNumber, error: labelResult.error });
            }
          }
        }
      } else {
        logger.error('[AO] Failed to spawn AO task for architect:build_directive', {
          status: result?.status, error: result?.error, repo: targetRepo, issueNumber,
        });
        await markAoDegraded(targetRepo, 'ao_unreachable');
        await emitAoSpawnFailure({
          eventKey: 'architect:build_directive',
          issueUrl,
          issueNumber,
          repo: targetRepo,
          reason: 'ao_unreachable',
          error: result?.error,
          correlationId: event.correlationId,
          summaryText: `AO degraded for ${targetRepo} — architect directives are being paused after spawn timeouts/unreachable responses.`,
          degraded: true,
        });
      }
    };

    if (eventStream) {
      eventStream.subscribeStream('architect', 'ao-bridge', async (event: YClawEvent<unknown>) => {
        if (event.type !== 'architect.build_directive') return;
        const payload = event.payload && typeof event.payload === 'object'
          ? event.payload as Record<string, unknown>
          : {};
        await routeAoDirective({
          id: event.id,
          correlationId: event.correlation_id,
          payload,
        }, 'stream');
      });
      logger.info('[AO] architect.build_directive → AO bridge stream consumer registered');
    } else {
      eventBus.subscribe('architect:build_directive', async (event: AgentEvent) => {
        await routeAoDirective({
          id: event.id,
          correlationId: event.correlationId,
          payload: event.payload,
        }, 'pubsub');
      });
      logger.info('[AO] architect:build_directive → AO bridge handler registered');
    }
  } else {
    logger.warn('[AO] AO bridge not configured — architect:build_directive events will not be processed');
  }

  // ─── Coordination Event Bridges ──────────────────────────────────────
  // Coordination bridge: ao:pr_ready → deliverable submitted (builder:pr_ready kept for compat)
  const prReadyHandler = async (event: { payload?: Record<string, unknown>; correlationId?: string; id: string }) => {
    const payload = event.payload ?? {};
    void eventBus.publishCoordEvent(createEvent<CoordDeliverablePayload>({
      type: COORD_DELIVERABLE_SUBMITTED,
      source: 'ao',
      correlation_id: event.correlationId || event.id,
      payload: {
        task_id: (payload.task_id as string) || '',
        submitter: 'ao',
        artifact_type: 'pr',
        artifact_url: (payload.url as string) || (payload.pr_url as string) || '',
      },
    }));
  };
  eventBus.subscribe('ao:pr_ready', prReadyHandler);
  eventBus.subscribe('builder:pr_ready', prReadyHandler); // compat

  eventBus.subscribe('architect:pr_review', async (event) => {
    const payload = event.payload ?? {};
    const reviewStatus = payload.status as string;
    if (reviewStatus === 'approved' || reviewStatus === 'changes_requested') {
      void eventBus.publishCoordEvent(createEvent<CoordReviewPayload>({
        type: COORD_REVIEW_COMPLETED,
        source: 'architect',
        correlation_id: event.correlationId || event.id,
        payload: {
          task_id: (payload.task_id as string) || '',
          reviewer: 'architect',
          status: reviewStatus,
          feedback: (payload.feedback as string) || undefined,
        },
      }));
    }
  });

  // ─── Journaler + ChannelNotifier ─────────────────────────────────────
  if (eventStream && streamRedis) {
    const githubExec = actionRegistry.getExecutor('github') as GitHubExecutor;
    const journaler = new Journaler(streamRedis, eventStream, githubExec);
    await journaler.start();
    logger.info('Journaler started (milestone events → GitHub issue comments)');

    // Prefer the unified ChannelNotifier when the infrastructure layer
    // provides IChannel adapters. It fans coord events out to every
    // enabled platform (Slack, Discord, …) using per-platform routing
    // and formatting.
    //
    // Fall back to the legacy SlackNotifier when no infrastructure
    // channels are wired — this is the old env-only path (SlackExecutor
    // talking directly to Slack).
    const infraChannels = services.infrastructure?.channels;
    if (infraChannels && infraChannels.size > 0) {
      const channelNotifier = new ChannelNotifier(streamRedis, eventStream, infraChannels);
      await channelNotifier.start();
      logger.info('ChannelNotifier started', {
        platforms: Array.from(infraChannels.keys()),
      });
    } else {
      const slackExec = actionRegistry.getExecutor('slack') as SlackExecutor;
      const slackNotifier = new SlackNotifier(streamRedis, eventStream, slackExec);
      await slackNotifier.start();
      logger.info('SlackNotifier started (legacy path — no infrastructure channels)');
    }
  } else {
    logger.info('Journaler & ChannelNotifier disabled — EventStream not available');
  }

  // ─── Exploration Module (AgentHub Phase 2) ───────────────────────────────
  let explorationDispatcher: ExplorationDispatcher | null = null;
  let explorationStop: (() => void) | null = null;

  const agentHubUrl = process.env.AGENTHUB_URL;
  const agentHubDispatcherKey = process.env.AGENTHUB_DISPATCHER_KEY;
  const agentHubWorkerKeysJson = process.env.AGENTHUB_WORKER_KEYS; // JSON: {"worker-1":"key1","worker-2":"key2"}
  const githubToken = process.env.GITHUB_TOKEN;

  if (agentHubUrl && agentHubDispatcherKey && agentHubWorkerKeysJson && githubToken) {
    try {
      const workerApiKeys = JSON.parse(agentHubWorkerKeysJson) as Record<string, string>;
      const result = registerExplorationModule({
        agentHubUrl,
        dispatcherApiKey: agentHubDispatcherKey,
        dispatcherAgentId: 'architect',
        workerApiKeys,
        githubToken,
        eventBus,
      });
      explorationDispatcher = result.dispatcher;
      explorationStop = result.stop;
      logger.info('Exploration module registered', {
        agentHubUrl,
        workers: Object.keys(workerApiKeys),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Exploration module failed to initialize — running without exploration (${msg})`);
    }
  } else {
    logger.info('Exploration module disabled (AGENTHUB_URL, AGENTHUB_DISPATCHER_KEY, AGENTHUB_WORKER_KEYS, or GITHUB_TOKEN not set)');
  }

  // ─── Growth Engine (AgentHub Phase 3) ──────────────────────────────────────
  let growthEngine: ExperimentEngine | null = null;
  let growthEngineStop: (() => void) | null = null;

  const growthHubUrl = process.env.AGENTHUB_URL;
  const growthApiKey = process.env.GROWTH_ENGINE_API_KEY;
  const growthConfigDir = process.env.GROWTH_ENGINE_CONFIG_DIR;

  if (growthHubUrl && growthApiKey && growthConfigDir) {
    try {
      const result = registerGrowthEngine({
        agentHubUrl: growthHubUrl,
        apiKey: growthApiKey,
        agentId: process.env.GROWTH_ENGINE_AGENT_ID ?? 'growth-engine',
        eventBus,
        configDir: growthConfigDir,
        humanApprovalCount: validApprovalCount(process.env.GROWTH_ENGINE_APPROVAL_COUNT),
      });
      growthEngine = result.engine;
      growthEngineStop = result.stop;
      logger.info('Growth engine registered', { agentHubUrl: growthHubUrl, configDir: growthConfigDir });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Growth engine failed to initialize — running without growth engine (${msg})`);
    }
  } else {
    logger.info('Growth engine disabled (AGENTHUB_URL, GROWTH_ENGINE_API_KEY, or GROWTH_ENGINE_CONFIG_DIR not set)');
  }

  // ─── AO Event Handlers (completion, failure, spawn_failed) ──────────────
  {
    const slackExec = actionRegistry.getExecutor('slack') as SlackExecutor | undefined;

    // Wire recovery alerts: when the circuit closes after being open, post a single
    // "AO recovered" message. This fires via AoBridge's internal state transition —
    // no polling needed.
    aoBridge.setCircuitChangeCallback((repo, open) => {
      if (!open && slackExec) {
        slackExec.execute('message', {
          channel: SLACK_CHANNELS.alerts,
          text: `✅ AO Circuit Breaker closed for \`${repo}\` — service recovered, delegations resuming`,
        }).catch((err: unknown) => {
          logger.warn('[AO] Recovery Slack notify failed', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    });

    eventBus.subscribe('ao:task_completed', async (event) => {
      const p = event.payload || {};
      logger.info(`[AO] Task completed: ${p.issue_url || `issue #${p.issue_number}`} → PR: ${p.pr_url || 'N/A'}`);
      if (slackExec) {
        await slackExec.execute('message', {
          channel: SLACK_CHANNELS.development,
          text: `AO completed: ${p.issue_url || `issue #${p.issue_number}`} → ${p.pr_url || 'no PR'}`,
        }).catch((err: unknown) => {
          logger.warn('[AO] Slack notify failed', { error: err instanceof Error ? err.message : String(err) });
        });
      }
      // F1: Release issue claim + remove in-progress label
      const completedIssueNumber = typeof p.issue_number === 'number' ? p.issue_number : undefined;
      const completedRepo = typeof p.repo === 'string' ? p.repo : 'your-org/yclaw';
      if (completedIssueNumber) {
        if (deployRedis) {
          const issueClaimKey = buildIssueClaimKey(completedRepo, completedIssueNumber);
          await deployRedis.del(issueClaimKey).catch((err: unknown) => {
            logger.warn('[AO] Failed to release issue claim', { issueNumber: completedIssueNumber, error: err instanceof Error ? err.message : String(err) });
          });
        }
        const ghExec = actionRegistry.getExecutor('github') as GitHubExecutor | undefined;
        if (ghExec) {
          const removeLabelResult = await ghExec.execute('remove_label', {
            owner: completedRepo.split('/')[0],
            repo: completedRepo.split('/')[1],
            issue_number: completedIssueNumber,
            label: 'in-progress',
          }).catch((err: unknown) => {
            logger.warn('[AO] Failed to remove in-progress label', { issueNumber: completedIssueNumber, error: err instanceof Error ? err.message : String(err) });
            return { success: false, error: String(err) };
          });
          if (removeLabelResult && !removeLabelResult.success) {
            logger.warn('[AO] remove_label returned failure on completion', { issueNumber: completedIssueNumber, error: removeLabelResult.error });
          }
        }
      }
    });

    eventBus.subscribe('ao:task_failed', async (event) => {
      const p = event.payload || {};
      const repo = typeof p.repo === 'string' ? p.repo : undefined;

      // F1: Release issue claim + remove in-progress label BEFORE any early returns
      const failedIssueNumber = typeof p.issue_number === 'number' ? p.issue_number : undefined;
      const failedRepo = typeof p.repo === 'string' ? p.repo : 'your-org/yclaw';
      if (failedIssueNumber) {
        if (deployRedis) {
          const issueClaimKey = buildIssueClaimKey(failedRepo, failedIssueNumber);
          await deployRedis.del(issueClaimKey).catch((err: unknown) => {
            logger.warn('[AO] Failed to release issue claim on failure', { issueNumber: failedIssueNumber, error: err instanceof Error ? err.message : String(err) });
          });
        }
        const ghExec = actionRegistry.getExecutor('github') as GitHubExecutor | undefined;
        if (ghExec) {
          const removeLabelResult = await ghExec.execute('remove_label', {
            owner: failedRepo.split('/')[0],
            repo: failedRepo.split('/')[1],
            issue_number: failedIssueNumber,
            label: 'in-progress',
          }).catch((err: unknown) => {
            logger.warn('[AO] Failed to remove in-progress label on failure', { issueNumber: failedIssueNumber, error: err instanceof Error ? err.message : String(err) });
            return { success: false, error: String(err) };
          });
          if (removeLabelResult && !removeLabelResult.success) {
            logger.warn('[AO] remove_label returned failure on task_failed', { issueNumber: failedIssueNumber, error: removeLabelResult.error });
          }
        }
      }

      // When the circuit is open, spawn_failed already posted a batch summary alert
      // covering all circuit_open failures for this repo. Suppress per-issue task_failed
      // alerts to avoid the 2–3× alert flood described in issue #723.
      if (aoBridge.isCircuitOpen(repo)) {
        logger.info('[AO] Suppressing task_failed alert — circuit open', { repo, issueNumber: p.issue_number });
        return;
      }

      logger.warn(`[AO] Task failed: ${p.issue_url || `issue #${p.issue_number}`} — ${p.error || 'unknown'}`);
      if (slackExec) {
        await slackExec.execute('message', {
          channel: SLACK_CHANNELS.alerts,
          text: `AO failed: ${p.issue_url || `issue #${p.issue_number}`} — ${p.error || 'unknown'}`,
        }).catch((err: unknown) => {
          logger.warn('[AO] Slack notify failed', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    });

    eventBus.subscribe('ao:spawn_failed', async (event) => {
      const p = event.payload || {};
      logger.error(`[AO] Spawn failed: ${p.eventKey} — ${p.reason}`, { error: p.error });
      if (slackExec) {
        await slackExec.execute('message', {
          channel: SLACK_CHANNELS.alerts,
          text: typeof p.summaryText === 'string' && p.summaryText.trim().length > 0
            ? p.summaryText
            : `AO spawn failed: ${p.eventKey} for ${p.issueUrl || p.repo || 'unknown'} — ${p.reason}`,
        }).catch((err: unknown) => {
          logger.warn('[AO] Slack notify failed', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    });

    logger.info('[AO] Completion/failure/spawn_failed handlers registered');
  }

  return {
    executor,
    router,
    cronManager,
    approvalManager,
    objectiveManager,
    revisionTracker,
    explorationDispatcher,
    explorationStop,
    growthEngine,
    growthEngineStop,
    aoBridge,
  };
}

/** F8: Parse and validate approval count — defaults to 5 if missing, NaN, or negative */
function validApprovalCount(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '5', 10);
  if (Number.isNaN(parsed) || parsed < 0) return 5;
  return parsed;
}
