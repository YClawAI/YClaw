import type { Db, Collection } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('operator-audit');

export interface OperatorAuditEntry {
  timestamp: Date;
  operatorId: string;
  action: string;
  departmentId?: string;
  resource: {
    type: string;
    id: string;
  };
  request: {
    method: string;
    path: string;
    ip: string;
  };
  decision: 'allowed' | 'denied';
  reason?: string;
}

export class OperatorAuditLogger {
  private readonly collection: Collection<OperatorAuditEntry>;

  constructor(db: Db) {
    this.collection = db.collection<OperatorAuditEntry>('operator_audit_logs');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ operatorId: 1 });
    await this.collection.createIndex({ action: 1 });
    await this.collection.createIndex({ 'resource.type': 1, 'resource.id': 1 });
    // TTL: auto-delete after 90 days. This also serves as the timestamp index
    // for sort queries — no separate { timestamp: 1 } index needed, and defining
    // both would conflict (MongoDB rejects two indexes on the same key with
    // different names/options).
    await this.collection.createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'ttl_90d' },
    );
    logger.info('Operator audit log indexes ensured');
  }

  /** Log an operator action. Fire-and-forget safe. */
  log(entry: OperatorAuditEntry): void {
    this.collection.insertOne(entry as any).catch((err) => {
      logger.error('Failed to write audit log', {
        error: err instanceof Error ? err.message : String(err),
        operatorId: entry.operatorId,
        action: entry.action,
      });
    });
  }

  /** Query audit logs for a specific operator. */
  async getByOperator(operatorId: string, limit = 100): Promise<OperatorAuditEntry[]> {
    return this.collection
      .find({ operatorId } as any)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray() as Promise<OperatorAuditEntry[]>;
  }

  /** Query recent audit logs across all operators. */
  async getRecent(limit = 100): Promise<OperatorAuditEntry[]> {
    return this.collection
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray() as Promise<OperatorAuditEntry[]>;
  }

  /** Filtered query with all supported parameters. */
  async queryFiltered(params: {
    operatorId?: string;
    action?: string;
    department?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<OperatorAuditEntry[]> {
    const query: Record<string, unknown> = {};
    if (params.operatorId) query.operatorId = params.operatorId;
    if (params.action) query.action = params.action;
    if (params.department) query.departmentId = params.department;
    if (params.from || params.to) {
      query.timestamp = {};
      if (params.from) (query.timestamp as Record<string, unknown>).$gte = params.from;
      if (params.to) (query.timestamp as Record<string, unknown>).$lte = params.to;
    }

    return this.collection
      .find(query as any)
      .sort({ timestamp: -1 })
      .limit(params.limit ?? 100)
      .toArray() as Promise<OperatorAuditEntry[]>;
  }
}
