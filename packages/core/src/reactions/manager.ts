/**
 * ReactionsManager — Declarative lifecycle automation for GitHub events.
 *
 * Watches the internal event bus for GitHub webhook events and evaluates
 * reaction rules. When rules match, executes actions (merge PR, close issue,
 * trigger agent, etc.) with deduplication, safety gates, and escalation.
 *
 * Design principles (from Architecture review):
 *   1. Single merge evaluator — both ci_pass and review_approved funnel into
 *      the same merge logic. Redis lock prevents duplicate merges.
 *   2. Idempotency — dedup key per rule+resource prevents double execution.
 *   3. Pre-check state — always verify current PR/issue state before acting.
 *   4. Event loop breaker — processed delivery IDs cached to prevent cascades.
 *   5. Structured audit log — every evaluation logged with pass/fail details.
 */

import type { Redis } from 'ioredis';
import type { ReactionRule, ReactionAction, ReactionContext, ReactionAuditEntry } from './types.js';
import { ReactionEvaluator } from './evaluator.js';
import { EscalationManager } from './escalation.js';
import { DEFAULT_REACTION_RULES } from './rules.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('reactions-manager');

/** Dedup lock TTL — prevents the same rule from firing twice on the same resource. */
const DEDUP_LOCK_TTL = 300; // 5 minutes

/** Event loop breaker — ignore events we recently processed. */
const EVENT_DEDUP_TTL = 600; // 10 minutes

/** Audit log TTL in Redis. */
const AUDIT_TTL = 72 * 60 * 60; // 72 hours

/** Max audit entries to keep per resource. */
const MAX_AUDIT_ENTRIES = 50;

// ─── Template Interpolation ───────────────────────────────────────────────

/**
 * Replace {{field}} placeholders in a string with values from the payload.
 * Unknown fields resolve to empty string (safe fallback).
 */
function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = payload[key];
    if (val === undefined || val === null) return '';
    return String(val);
  });
}

/**
 * Deep-interpolate all string values in a params object.
 */
function interpolateParams(params: Record<string, unknown>, payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = interpolate(value, payload);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = interpolateParams(value as Record<string, unknown>, payload);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── ReactionsManager ─────────────────────────────────────────────────────

export interface ReactionsManagerDeps {
  redis: Redis;
  githubToken: string;
  /** Callback to trigger an agent via the internal event bus. */
  triggerAgent: (agent: string, task: string, correlationId?: string, actionParams?: Record<string, unknown>) => Promise<void>;
  /** Callback to publish an event on the bus. */
  publishEvent: (source: string, type: string, data: Record<string, unknown>, correlationId?: string) => Promise<void>;
  /** Callback to execute a GitHub action (merge_pr, close_issue, etc.). */
  executeGitHubAction: (action: string, params: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  /** Callback to execute a Discord notification action. */
  executeDiscordAction?: (channel: string, text: string) => Promise<void>;
  /** Callback to create/update a task in the Task Registry. */
  executeTaskAction: (action: string, params: Record<string, unknown>) => Promise<void>;
  /** Optional: custom rules (overrides defaults). */
  rules?: ReactionRule[];
}

export class ReactionsManager {
  private rules: ReactionRule[];
  private evaluator: ReactionEvaluator;
  private escalation: EscalationManager;
  private redis: Redis;
  private deps: ReactionsManagerDeps;

  constructor(deps: ReactionsManagerDeps) {
    this.deps = deps;
    this.redis = deps.redis;
    this.rules = (deps.rules || DEFAULT_REACTION_RULES).filter(r => r.enabled);
    this.evaluator = new ReactionEvaluator(deps.redis, deps.githubToken);
    this.escalation = new EscalationManager(deps.redis);

    // Wire escalation action executor
    this.escalation.onEscalation((action, ctx) => this.executeAction(action, ctx));

    logger.info('ReactionsManager initialized', {
      ruleCount: this.rules.length,
      ruleIds: this.rules.map(r => r.id),
    });
  }

  /**
   * Start the escalation poller.
   */
  start(): void {
    this.escalation.start();
    logger.info('ReactionsManager started');
  }

  /**
   * Stop the escalation poller.
   */
  stop(): void {
    this.escalation.stop();
    logger.info('ReactionsManager stopped');
  }

  /**
   * Handle an incoming event from the event bus.
   * This is the main entry point — called by the event subscriber.
   */
  async handleEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    // ─── Event Loop Breaker ───────────────────────────────────────────
    const deliveryId = (payload.delivery_id as string) || (payload.correlationId as string);
    if (deliveryId) {
      const dedupKey = `reaction:event:${deliveryId}`;
      const alreadyProcessed = await this.redis.set(dedupKey, '1', 'EX', EVENT_DEDUP_TTL, 'NX');
      if (!alreadyProcessed) {
        logger.debug('Event already processed, skipping', { eventType, deliveryId });
        return;
      }
    }

    // ─── Journaler Loop Prevention ─────────────────────────────────────
    // Skip events originating from Journaler-generated comments
    const commentBody = (payload.comment_body as string) || (payload.body as string) || '';
    if (commentBody.includes('<!-- yclaw-journaler -->')) {
      logger.debug('Ignoring journaler-generated comment', { eventType });
      return;
    }

    // ─── Build Context ────────────────────────────────────────────────
    const ctx = this.buildContext(eventType, payload);
    if (!ctx) {
      logger.debug('Could not build context from event', { eventType });
      return;
    }

    // ─── Evaluate All Matching Rules ──────────────────────────────────
    const matchingRules = this.rules.filter(rule => this.triggerMatches(rule, eventType, payload));

    if (matchingRules.length === 0) {
      logger.debug('No matching rules for event', { eventType });
      return;
    }

    logger.info('Evaluating reaction rules', {
      eventType,
      matchingRules: matchingRules.map(r => r.id),
      pr: ctx.prNumber,
      issue: ctx.issueNumber,
    });

    for (const rule of matchingRules) {
      await this.evaluateAndExecute(rule, ctx);
    }
  }

  // ─── Private: Context Builder ───────────────────────────────────────────

  private buildContext(eventType: string, payload: Record<string, unknown>): ReactionContext | null {
    const owner = (payload.owner as string) || 'yclaw-ai';
    const repo = (payload.repo as string) || 'yclaw';

    if (!owner || !repo) return null;

    return {
      eventType,
      payload,
      prNumber: (payload.pr_number as number) || undefined,
      issueNumber: (payload.issue_number as number) || undefined,
      owner,
      repo,
      correlationId: payload.correlationId as string,
    };
  }

  // ─── Private: Trigger Matching ──────────────────────────────────────────

  private triggerMatches(rule: ReactionRule, eventType: string, payload: Record<string, unknown>): boolean {
    if (rule.trigger.event !== eventType) return false;

    // Check filter
    if (rule.trigger.filter) {
      for (const [key, value] of Object.entries(rule.trigger.filter)) {
        if (payload[key] !== value) return false;
      }
    }

    return true;
  }

  // ─── Private: Evaluate & Execute ────────────────────────────────────────

  private async evaluateAndExecute(rule: ReactionRule, ctx: ReactionContext): Promise<void> {
    const resource = ctx.prNumber ? `pr:${ctx.prNumber}` : `issue:${ctx.issueNumber || 'unknown'}`;
    const audit: ReactionAuditEntry = {
      timestamp: Date.now(),
      ruleId: rule.id,
      eventType: ctx.eventType,
      resource,
      conditionsPassed: true,
      gatesPassed: true,
      actionsExecuted: [],
      actionsFailed: [],
    };

    try {
      // ─── Dedup Lock ───────────────────────────────────────────────
      const lockKey = `reaction:lock:${rule.id}:${resource}`;
      const acquired = await this.redis.set(lockKey, '1', 'EX', DEDUP_LOCK_TTL, 'NX');
      if (!acquired) {
        logger.info('Dedup lock active, skipping rule', { ruleId: rule.id, resource });
        return;
      }

      // ─── Evaluate Conditions ──────────────────────────────────────
      if (rule.conditions && rule.conditions.length > 0) {
        const condResult = await this.evaluator.evaluateConditions(rule.conditions, ctx);
        audit.conditionsPassed = condResult.passed;

        if (!condResult.passed) {
          logger.info('Conditions not met', { ruleId: rule.id, resource, details: condResult.details });
          // Release lock since we're not acting
          await this.redis.del(lockKey);
          await this.recordAudit(resource, audit);
          return;
        }
      }

      // ─── Evaluate Safety Gates ────────────────────────────────────
      if (rule.safetyGates && rule.safetyGates.length > 0) {
        const gateResult = await this.evaluator.evaluateSafetyGates(rule.safetyGates, ctx);
        audit.gatesPassed = gateResult.passed;

        if (!gateResult.passed) {
          logger.warn('Safety gates blocked action', { ruleId: rule.id, resource, details: gateResult.details });
          await this.redis.del(lockKey);
          await this.recordAudit(resource, audit);
          return;
        }
      }

      // ─── Pre-check: Is PR already merged/closed? ──────────────────
      if (this.isMergeRule(rule) && ctx.prNumber) {
        const alreadyDone = await this.evaluator.isPRAlreadyMerged(ctx);
        if (alreadyDone) {
          logger.info('PR already merged/closed, skipping', { ruleId: rule.id, pr: ctx.prNumber });
          await this.recordAudit(resource, audit);
          return;
        }
      }

      // ─── Execute Actions ──────────────────────────────────────────
      logger.info('Executing reaction actions', {
        ruleId: rule.id,
        resource,
        actionCount: rule.actions.length,
      });

      for (const action of rule.actions) {
        try {
          await this.executeAction(action, ctx);
          audit.actionsExecuted.push(action.type);
        } catch (err) {
          audit.actionsFailed.push(action.type);
          audit.error = String(err);
          logger.error('Action failed', { ruleId: rule.id, actionType: action.type, error: String(err) });

          // For merge failures, don't continue with post-merge actions
          if (action.type === 'github:merge_pr') break;
        }
      }

      // ─── Schedule Escalation (if configured and not fully succeeded) ─
      if (rule.escalation && audit.actionsFailed.length > 0) {
        await this.escalation.schedule(rule.id, rule.escalation.afterMs, rule.escalation.action, ctx);
      } else if (rule.escalation && audit.actionsFailed.length === 0) {
        // Success — cancel any pending escalation
        await this.escalation.cancel(rule.id, ctx);
      }

    } catch (err) {
      audit.error = String(err);
      logger.error('Rule evaluation failed', { ruleId: rule.id, resource, error: String(err) });
    }

    await this.recordAudit(resource, audit);
  }

  // ─── Private: Action Execution ──────────────────────────────────────────

  async executeAction(action: ReactionAction, ctx: ReactionContext): Promise<void> {
    const params = interpolateParams(action.params, ctx.payload);

    switch (action.type) {
      case 'github:merge_pr': {
        const prNum = ctx.prNumber;
        if (!prNum) throw new Error('No PR number for merge_pr action');
        const result = await this.deps.executeGitHubAction('merge_pr', {
          owner: ctx.owner,
          repo: ctx.repo,
          pullNumber: prNum,
          merge_method: (params.merge_method as string) || 'squash',
        });
        if (!result.success) {
          throw new Error(`merge_pr failed: ${result.error}`);
        }
        logger.info('PR merged via reaction', { pr: prNum, repo: `${ctx.owner}/${ctx.repo}` });
        break;
      }

      case 'github:close_issue': {
        const issues = ctx.prNumber
          ? this.evaluator.extractLinkedIssues((ctx.payload.pr_body as string) || '')
          : ctx.issueNumber ? [ctx.issueNumber] : [];

        for (const issueNum of issues) {
          const comment = (params.comment as string) || '';
          const result = await this.deps.executeGitHubAction('close_issue', {
            owner: ctx.owner,
            repo: ctx.repo,
            issue_number: issueNum,
            comment,
          });
          if (!result.success) {
            logger.error('Failed to close issue', { issue: issueNum, error: result.error });
          } else {
            logger.info('Issue closed via reaction', { issue: issueNum });
          }
        }
        break;
      }

      case 'github:pr_comment': {
        const prNum = ctx.prNumber;
        if (!prNum) throw new Error('No PR number for pr_comment action');
        await this.deps.executeGitHubAction('pr_comment', {
          owner: ctx.owner,
          repo: ctx.repo,
          pullNumber: prNum,
          body: (params.body as string) || '',
        });
        break;
      }

      case 'agent:trigger': {
        const agent = params.agent as string;
        const task = params.task as string;
        if (!agent || !task) throw new Error('agent:trigger requires agent and task params');
        await this.deps.triggerAgent(agent, task, ctx.correlationId, params);
        logger.info('Agent triggered via reaction', { agent, taskPreview: task.slice(0, 100) });
        break;
      }

      case 'task:update': {
        await this.deps.executeTaskAction('update', {
          ...params,
          prNumber: ctx.prNumber,
          issueNumber: ctx.issueNumber,
        });
        break;
      }

      case 'task:create': {
        await this.deps.executeTaskAction('create', {
          ...params,
          prNumber: ctx.prNumber,
          issueNumber: ctx.issueNumber,
          agent: (params.agent as string) || 'builder',
        });
        break;
      }

      case 'event:publish': {
        const eventType = params.type as string;
        const data = (params.data as Record<string, unknown>) || {};
        await this.deps.publishEvent('reactions', eventType, { ...data, ...ctx.payload }, ctx.correlationId);
        break;
      }

      case 'github:update_branch': {
        if (!ctx.prNumber) break;

        // Prevent update loops — max 3 updates per PR per hour
        const updateCountKey = `reaction:branch-update:${ctx.owner}:${ctx.repo}:${ctx.prNumber}`;
        const count = await this.redis.incr(updateCountKey);
        if (count === 1) await this.redis.expire(updateCountKey, 3600);
        if (count > 3) {
          logger.warn('Branch update loop detected, skipping', { pr: ctx.prNumber, count });
          break;
        }

        // Get head SHA for expected_head_sha (optimistic concurrency)
        const prUrl = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}`;
        const prResp = await fetch(prUrl, {
          headers: {
            Authorization: `Bearer ${this.deps.githubToken}`,
            Accept: 'application/vnd.github+json',
          },
        });
        const prData = await prResp.json() as { head?: { sha?: string } };
        const headSha = prData?.head?.sha;
        if (!headSha) {
          logger.warn('Could not get head SHA for branch update', { pr: ctx.prNumber });
          break;
        }

        const updateUrl = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}/update-branch`;
        const resp = await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${this.deps.githubToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expected_head_sha: headSha }),
        });

        if (resp.ok) {
          logger.info('Auto-updated PR branch', { pr: ctx.prNumber });
        } else {
          const err = await resp.text();
          logger.warn('Failed to update PR branch', { pr: ctx.prNumber, status: resp.status, error: err });
        }
        break;
      }

      case 'discord:message': {
        const channel = params.channel as string;
        const text = params.text as string;
        if (!channel || !text) throw new Error('discord:message requires channel and text');
        if (!this.deps.executeDiscordAction) {
          logger.warn('discord:message action skipped — executeDiscordAction not wired', {
            channel,
          });
          break;
        }
        await this.deps.executeDiscordAction(channel, text);
        break;
      }

      default:
        logger.warn('Unknown action type', { type: action.type });
    }
  }

  // ─── Private: Helpers ───────────────────────────────────────────────────

  private isMergeRule(rule: ReactionRule): boolean {
    return rule.actions.some(a => a.type === 'github:merge_pr');
  }

  private async recordAudit(resource: string, entry: ReactionAuditEntry): Promise<void> {
    const key = `reaction:audit:${resource}`;
    try {
      await this.redis.lpush(key, JSON.stringify(entry));
      await this.redis.ltrim(key, 0, MAX_AUDIT_ENTRIES - 1);
      await this.redis.expire(key, AUDIT_TTL);
    } catch (err) {
      logger.error('Failed to record audit', { resource, error: String(err) });
    }
  }
}
