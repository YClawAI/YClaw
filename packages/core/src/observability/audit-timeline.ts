/**
 * AuditTimeline — unified query layer across both audit stores.
 *
 * Fans out to OperatorAuditLogger and AuditLog, merges results by timestamp,
 * and provides cursor-based pagination.
 *
 * Council requirement: timestamp-based cursor pagination (?before=<ISO timestamp>).
 */

import type { OperatorAuditLogger } from '../operators/audit-logger.js';
import type { AuditLog } from '../logging/audit.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('audit-timeline');

/** Unified timeline event — normalized from both audit stores. */
export interface TimelineEvent {
  id: string;
  timestamp: string;
  source: 'operator' | 'execution';
  operatorId?: string;
  agentId?: string;
  action: string;
  correlationId?: string;
  resource?: { type: string; id: string };
  decision?: 'allowed' | 'denied';
  status?: string;
  errorCode?: string;
  message?: string;
}

export interface TimelineQuery {
  operatorId?: string;
  agentId?: string;
  correlationId?: string;
  action?: string;
  before?: string;
  limit?: number;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  cursor: string | null;
  hasMore: boolean;
}

export class AuditTimeline {
  constructor(
    private readonly operatorAudit: OperatorAuditLogger,
    private readonly auditLog: AuditLog,
  ) {}

  /**
   * Query the unified audit timeline with cursor-based pagination.
   * Fans out to both stores, merges by timestamp (descending), truncates to limit.
   */
  async query(params: TimelineQuery): Promise<TimelineResponse> {
    const limit = Math.min(params.limit ?? 50, 200);
    // Fetch limit+1 from each store individually.
    // After merge+sort+truncate, hasMore = merged had more items than limit.
    const fetchLimit = limit + 1;

    const before = params.before ? new Date(params.before) : undefined;

    const [operatorEvents, executionEvents] = await Promise.all([
      this.queryOperatorAudit(params, before, fetchLimit),
      this.queryExecutionAudit(params, before, fetchLimit),
    ]);

    // Merge and sort by timestamp descending with stable tiebreaker
    const sorted = [...operatorEvents, ...executionEvents]
      .sort((a, b) => {
        const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (timeDiff !== 0) return timeDiff;
        // Stable tiebreaker: source then id
        if (a.source !== b.source) return a.source < b.source ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });

    // hasMore reflects whether the merged stream had more items than the requested limit
    const hasMore = sorted.length > limit;
    const events = sorted.slice(0, limit);
    const cursor = events.length > 0 ? events[events.length - 1]!.timestamp : null;

    return { events, cursor, hasMore };
  }

  private async queryOperatorAudit(
    params: TimelineQuery,
    before: Date | undefined,
    limit: number,
  ): Promise<TimelineEvent[]> {
    // Skip if filtering by agentId (operator audit doesn't have agent)
    if (params.agentId) return [];

    try {
      // queryFiltered uses $lte for 'to' — subtract 1ms to make cursor exclusive
      // so events at the cursor boundary are not duplicated on the next page.
      const exclusiveBefore = before ? new Date(before.getTime() - 1) : undefined;
      const entries = await this.operatorAudit.queryFiltered({
        operatorId: params.operatorId,
        action: params.action,
        to: exclusiveBefore,
        limit,
      });

      return entries.map((e, i) => ({
        id: `op_${e.timestamp.getTime()}_${i}`,
        timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp),
        source: 'operator' as const,
        operatorId: e.operatorId,
        action: e.action,
        resource: e.resource,
        decision: e.decision,
        message: e.reason,
      }));
    } catch (err) {
      logger.warn('Operator audit query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async queryExecutionAudit(
    params: TimelineQuery,
    before: Date | undefined,
    limit: number,
  ): Promise<TimelineEvent[]> {
    // Skip if filtering by operatorId (execution audit doesn't have operator)
    if (params.operatorId) return [];

    try {
      const db = this.auditLog.getDb();
      if (!db) return [];

      const query: Record<string, unknown> = {};
      if (params.agentId) query.agent = params.agentId;
      if (params.correlationId) query.correlationId = params.correlationId;
      if (before) query.createdAt = { $lt: before };

      const executions = await db
        .collection('executions')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      return executions.map((e) => ({
        id: String(e._id),
        timestamp: String(e.createdAt ?? e.storedAt ?? new Date().toISOString()),
        source: 'execution' as const,
        agentId: String(e.agent ?? ''),
        action: String(e.flag ?? e.taskName ?? 'execution'),
        correlationId: e.correlationId ? String(e.correlationId) : undefined,
        status: String(e.status ?? ''),
        errorCode: e.errorCode ? String(e.errorCode) : undefined,
        message: e.error ? String(e.error) : undefined,
      }));
    } catch (err) {
      logger.warn('Execution audit query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
