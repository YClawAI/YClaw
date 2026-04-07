// ─── Approval Manager ────────────────────────────────────────────────────────
//
// Manages the approval workflow lifecycle: create requests, notify via Slack,
// process decisions, handle expiry, and publish EventBus events on resolution.

import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { createLogger } from '../logging/logger.js';
import { APPROVAL_GATES, COST_APPROVAL_THRESHOLD_CENTS } from './gates.js';
import { redactPayload } from './types.js';
import type {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalGateConfig,
} from './types.js';
import type { EventBus } from '../triggers/event.js';
import type { ActionRegistry } from '../actions/types.js';
import type { AuditLog } from '../logging/audit.js';
import type { BudgetEnforcer } from '../costs/budget-enforcer.js';

const logger = createLogger('approval-manager');

const EXPIRY_HOURS = 24;

/**
 * Known agent identities. Callers with these IDs are treated as agents
 * and cannot approve requests that requiresHuman: true.
 */
const KNOWN_AGENT_IDS = new Set([
  'strategist', 'reviewer', 'ember', 'scout', 'forge', 'architect',
  'deployer', 'sentinel', 'signal', 'keeper', 'treasurer', 'guide',
  'designer', 'builder',
]);

function isAgentIdentity(decidedBy: string): boolean {
  return KNOWN_AGENT_IDS.has(decidedBy.toLowerCase());
}

export class ApprovalManager {
  private collection: Collection<ApprovalRequest> | null = null;
  private activityLog: Collection | null = null;
  private budgetEnforcer: BudgetEnforcer | null = null;

  constructor(
    private db: Db | null,
    private eventBus: EventBus,
    private actionRegistry: ActionRegistry | null = null,
    private auditLog: AuditLog | null = null,
  ) {}

  /** Wire in the budget enforcer so cost gates respect budget mode (tracking/off). */
  setBudgetEnforcer(enforcer: BudgetEnforcer): void {
    this.budgetEnforcer = enforcer;
  }

  /** Whether the manager has a backing store. Without MongoDB, approval gates are skipped. */
  get hasPersistence(): boolean {
    return this.collection !== null;
  }

  async initialize(): Promise<void> {
    if (!this.db) {
      logger.warn('No MongoDB — approval gates will be skipped (fail-open)');
      return;
    }

    this.collection = this.db.collection<ApprovalRequest>('approval_requests');
    this.activityLog = this.db.collection('activity_log');
    await this.collection.createIndex({ id: 1 }, { unique: true });
    await this.collection.createIndex({ status: 1 });
    await this.collection.createIndex({ 'requestedBy.agentId': 1, requestedAt: -1 });
    await this.collection.createIndex({ expiresAt: 1 });

    logger.info('Approval manager initialized');
  }

  /**
   * Check if an action type requires approval. Returns the gate config if so,
   * or undefined if the action can proceed without approval.
   */
  getGate(actionType: string): ApprovalGateConfig | undefined {
    return APPROVAL_GATES[actionType];
  }

  /**
   * Check if an action requires approval based on its type or estimated cost.
   *
   * Cost-based gates respect the budget enforcer's mode:
   * - 'enforcing': cost gates are active (require human approval above threshold)
   * - 'tracking': cost gates are SKIPPED (costs are tracked but don't block)
   * - 'off': cost gates are SKIPPED
   *
   * Action-type gates (deploy:execute, safety:modify, etc.) are ALWAYS enforced
   * regardless of budget mode — they are safety gates, not financial gates.
   */
  requiresApproval(
    actionType: string,
    estimatedCostCents?: number,
  ): ApprovalGateConfig | undefined {
    // If no persistence, skip all approval gates (fail-open)
    if (!this.hasPersistence) return undefined;

    // Action-type gates are always enforced (safety, not financial)
    const gate = this.getGate(actionType);
    if (gate) return gate;

    // Cost-based gate — only enforce when budget mode is 'enforcing'.
    // If budgetEnforcer is null (disabled via BUDGET_ENFORCEMENT_ENABLED=false),
    // cost gates are also skipped — no enforcement means no cost blocking.
    const budgetMode = this.budgetEnforcer?.getMode() ?? 'off';
    if (budgetMode !== 'enforcing') {
      // In tracking/off/disabled mode, skip cost-based approval gates
      return undefined;
    }

    if (
      estimatedCostCents !== undefined &&
      estimatedCostCents > COST_APPROVAL_THRESHOLD_CENTS
    ) {
      return APPROVAL_GATES['cost:above_threshold'];
    }

    return undefined;
  }

  /**
   * Create a new approval request and notify the appropriate Slack channel.
   * Returns the request ID. Does NOT block the calling agent.
   */
  async createRequest(opts: {
    actionType: string;
    agentId: string;
    department: string;
    payload: Record<string, unknown>;
    reasoning: string;
    estimatedCostCents: number;
    gate: ApprovalGateConfig;
  }): Promise<string> {
    if (!this.collection) {
      throw new Error('Approval manager has no persistence — cannot create request');
    }

    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 60 * 60 * 1000);

    const request: ApprovalRequest = {
      id,
      type: opts.actionType,
      requiresHuman: opts.gate.requiresHuman,
      requestedBy: {
        agentId: opts.agentId,
        department: opts.department,
      },
      payload: redactPayload(opts.payload),
      reasoning: opts.reasoning,
      estimatedCostCents: opts.estimatedCostCents,
      riskLevel: opts.gate.riskLevel,
      status: 'pending',
      decidedBy: null,
      decisionNote: null,
      slackMessageTs: null,
      slackChannel: opts.gate.channel,
      requestedAt: now.toISOString(),
      decidedAt: null,
      expiresAt: expiresAt.toISOString(),
    };

    await this.collection.insertOne({ ...request });

    logger.info('Approval request created', {
      id,
      type: opts.actionType,
      agent: opts.agentId,
      riskLevel: opts.gate.riskLevel,
      requiresHuman: opts.gate.requiresHuman,
    });

    // Audit trail
    void this.writeAuditEntry('approval_requested', {
      requestId: id,
      actionType: opts.actionType,
      agentId: opts.agentId,
      department: opts.department,
      riskLevel: opts.gate.riskLevel,
      requiresHuman: opts.gate.requiresHuman,
      estimatedCostCents: opts.estimatedCostCents,
    });

    // Post to Slack (fire-and-forget)
    void this.notifySlack(request, opts.gate);

    return id;
  }

  /**
   * Process a decision on an approval request.
   * Enforces requiresHuman: if the request requires human approval and the
   * decidedBy is a known agent identity, the decision is rejected.
   */
  async decide(id: string, decision: ApprovalDecision): Promise<ApprovalRequest | { error: string }> {
    if (!this.collection) {
      logger.warn('No MongoDB — cannot process approval decision');
      return { error: 'Approval manager has no persistence' };
    }

    const request = await this.collection.findOne({ id, status: 'pending' });
    if (!request) {
      logger.warn('Approval request not found or already decided', { id });
      return { error: 'Approval request not found or already decided' };
    }

    // Enforce requiresHuman gate
    if (request.requiresHuman && isAgentIdentity(decision.decidedBy)) {
      logger.warn('Agent attempted to approve a human-only gate', {
        id,
        decidedBy: decision.decidedBy,
        actionType: request.type,
      });
      return {
        error: `This request requires human approval. Agent "${decision.decidedBy}" cannot approve it.`,
      };
    }

    const now = new Date().toISOString();
    const update: Partial<ApprovalRequest> = {
      status: decision.decision === 'approved' ? 'approved' : 'rejected',
      decidedBy: decision.decidedBy,
      decisionNote: decision.note ?? null,
      decidedAt: now,
    };

    await this.collection.updateOne({ id }, { $set: update });

    const resolved = { ...request, ...update };

    const eventType = decision.decision === 'approved' ? 'granted' : 'rejected';
    await this.eventBus.publish('approval', eventType, {
      requestId: id,
      actionType: request.type,
      agentId: request.requestedBy.agentId,
      department: request.requestedBy.department,
      payload: request.payload,
      decidedBy: decision.decidedBy,
      note: decision.note,
    });

    logger.info(`Approval ${eventType}`, {
      id,
      type: request.type,
      decidedBy: decision.decidedBy,
    });

    // Audit trail
    void this.writeAuditEntry(`approval_${eventType}`, {
      requestId: id,
      actionType: request.type,
      agentId: request.requestedBy.agentId,
      decidedBy: decision.decidedBy,
      note: decision.note,
    });

    // Update Slack message (fire-and-forget)
    void this.updateSlackMessage(resolved, eventType);

    return resolved;
  }

  /**
   * Expire pending requests older than 24h. Call this from a cron job.
   */
  async expirePending(): Promise<number> {
    if (!this.collection) return 0;

    const now = new Date().toISOString();
    const expired = await this.collection.find({
      status: 'pending',
      expiresAt: { $lte: now },
    }).toArray();

    if (expired.length === 0) return 0;

    await this.collection.updateMany(
      { status: 'pending', expiresAt: { $lte: now } },
      { $set: { status: 'expired', decidedAt: now } },
    );

    for (const request of expired) {
      await this.eventBus.publish('approval', 'expired', {
        requestId: request.id,
        actionType: request.type,
        agentId: request.requestedBy.agentId,
        payload: request.payload,
      });

      void this.writeAuditEntry('approval_expired', {
        requestId: request.id,
        actionType: request.type,
        agentId: request.requestedBy.agentId,
      });
    }

    logger.info(`Expired ${expired.length} pending approval request(s)`);
    return expired.length;
  }

  /**
   * Get a single approval request by ID.
   */
  async getRequest(id: string): Promise<ApprovalRequest | null> {
    if (!this.collection) return null;
    return this.collection.findOne({ id });
  }

  /**
   * Get pending approval requests, optionally filtered by agent.
   */
  async getPending(agentId?: string): Promise<ApprovalRequest[]> {
    if (!this.collection) return [];
    const filter: Record<string, unknown> = { status: 'pending' };
    if (agentId) filter['requestedBy.agentId'] = agentId;
    return this.collection.find(filter).sort({ requestedAt: -1 }).toArray();
  }

  /**
   * Get recent approval requests (all statuses).
   */
  async getRecent(limit: number = 50): Promise<ApprovalRequest[]> {
    if (!this.collection) return [];
    return this.collection.find({}).sort({ requestedAt: -1 }).limit(limit).toArray();
  }

  // ─── Audit Trail ────────────────────────────────────────────────────────────

  private async writeAuditEntry(
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!this.activityLog) return;
    try {
      await this.activityLog.insertOne({
        action,
        subsystem: 'approvals',
        details,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to write approval audit entry', { error: msg, action });
    }
  }

  // ─── Slack Notification ────────────────────────────────────────────────────

  private async notifySlack(request: ApprovalRequest, gate: ApprovalGateConfig): Promise<void> {
    if (!this.actionRegistry) return;

    const riskEmoji: Record<string, string> = {
      low: ':white_check_mark:',
      medium: ':warning:',
      high: ':rotating_light:',
      critical: ':no_entry:',
    };

    const costDisplay = request.estimatedCostCents > 0
      ? `$${(request.estimatedCostCents / 100).toFixed(2)}`
      : 'N/A';

    const approverInfo = gate.requiresHuman
      ? 'Human approval required'
      : 'Strategist or Architect can approve';

    const text = [
      `${riskEmoji[request.riskLevel] ?? ':question:'} *Approval Required: ${request.riskLevel.toUpperCase()}*`,
      `*Agent:* ${request.requestedBy.agentId} (${request.requestedBy.department})`,
      `*Action:* \`${request.type}\``,
      `*Reasoning:* ${request.reasoning}`,
      `*Est. Cost:* ${costDisplay}`,
      `*Approver:* ${approverInfo}`,
      '',
      `Reply with: \`/approve ${request.id}\` or \`/reject ${request.id} [reason]\``,
      `Auto-expires: ${request.expiresAt}`,
    ].join('\n');

    try {
      const result = await this.actionRegistry.execute('slack:message', {
        channel: gate.channel,
        text,
      });

      if (result.success && result.data?.ts && this.collection) {
        await this.collection.updateOne(
          { id: request.id },
          {
            $set: {
              slackMessageTs: result.data.ts as string,
              slackChannel: result.data.channel as string ?? gate.channel,
            },
          },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to post approval notification to Slack', { error: msg, requestId: request.id });
    }
  }

  private async updateSlackMessage(request: ApprovalRequest, eventType: string): Promise<void> {
    if (!this.actionRegistry || !request.slackMessageTs || !request.slackChannel) return;

    const statusEmoji = eventType === 'granted' ? ':white_check_mark:' : ':x:';
    const statusText = eventType === 'granted' ? 'APPROVED' : 'REJECTED';

    const text = [
      `${statusEmoji} *${statusText}* — \`${request.type}\``,
      `*Agent:* ${request.requestedBy.agentId}`,
      `*Decided by:* ${request.decidedBy}`,
      request.decisionNote ? `*Note:* ${request.decisionNote}` : '',
    ].filter(Boolean).join('\n');

    try {
      await this.actionRegistry.execute('slack:thread_reply', {
        channel: request.slackChannel,
        threadTs: request.slackMessageTs,
        text,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to update Slack approval message', { error: msg, requestId: request.id });
    }
  }
}
