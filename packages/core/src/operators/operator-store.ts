import type { Db, Collection, Filter } from 'mongodb';
import { createLogger } from '../logging/logger.js';
import type { Operator, Invitation, OperatorStatus } from './types.js';

const logger = createLogger('operator-store');

export class OperatorStore {
  private readonly operators: Collection<Operator>;
  private readonly invitations: Collection<Invitation>;

  constructor(private readonly db: Db) {
    this.operators = db.collection<Operator>('operators');
    this.invitations = db.collection<Invitation>('invitations');
  }

  /** Create indexes for efficient queries. Call once at startup. */
  async ensureIndexes(): Promise<void> {
    await this.operators.createIndex({ operatorId: 1 }, { unique: true });
    await this.operators.createIndex({ apiKeyPrefix: 1 });
    await this.operators.createIndex({ email: 1 });
    await this.operators.createIndex({ status: 1 });
    await this.operators.createIndex({ tailscaleIPs: 1 });

    await this.invitations.createIndex({ invitationId: 1 }, { unique: true });
    await this.invitations.createIndex({ tokenHash: 1 });
    await this.invitations.createIndex({ status: 1, expiresAt: 1 });

    logger.info('Operator store indexes ensured');
  }

  // ─── Operator CRUD ─────────────────────────────────────────────────────────

  async createOperator(data: Operator): Promise<Operator> {
    await this.operators.insertOne(data as any);
    logger.info('Operator created', { operatorId: data.operatorId, tier: data.tier });
    return data;
  }

  async getByOperatorId(operatorId: string): Promise<Operator | null> {
    return this.operators.findOne({ operatorId } as Filter<Operator>) as Promise<Operator | null>;
  }

  async getByApiKeyPrefix(prefix: string): Promise<Operator | null> {
    return this.operators.findOne({ apiKeyPrefix: prefix } as Filter<Operator>) as Promise<Operator | null>;
  }

  async getByEmail(email: string): Promise<Operator | null> {
    return this.operators.findOne({ email } as Filter<Operator>) as Promise<Operator | null>;
  }

  async updateStatus(operatorId: string, status: OperatorStatus, reason?: string): Promise<void> {
    const update: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (status === 'revoked') {
      update.revokedAt = new Date();
      if (reason) update.revokedReason = reason;
    }
    await this.operators.updateOne(
      { operatorId } as Filter<Operator>,
      { $set: update },
    );
    logger.info('Operator status updated', { operatorId, status, reason });
  }

  async updateApiKey(operatorId: string, apiKeyHash: string, apiKeyPrefix: string): Promise<void> {
    await this.operators.updateOne(
      { operatorId } as Filter<Operator>,
      { $set: { apiKeyHash, apiKeyPrefix, updatedAt: new Date() } },
    );
    logger.info('Operator API key rotated', { operatorId, prefix: apiKeyPrefix });
  }

  /** Fire-and-forget lastActiveAt update. */
  updateLastActive(operatorId: string): void {
    this.operators.updateOne(
      { operatorId } as Filter<Operator>,
      { $set: { lastActiveAt: new Date() } },
    ).catch((err) => {
      logger.warn('Failed to update lastActiveAt', {
        operatorId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async listOperators(filter?: Partial<Pick<Operator, 'status' | 'tier'>>): Promise<Operator[]> {
    const query: Record<string, unknown> = {};
    if (filter?.status) query.status = filter.status;
    if (filter?.tier) query.tier = filter.tier;
    return this.operators.find(query as Filter<Operator>).sort({ createdAt: -1 }).toArray() as Promise<Operator[]>;
  }

  async countByStatus(status: OperatorStatus): Promise<number> {
    return this.operators.countDocuments({ status } as Filter<Operator>);
  }

  /** Count total operators (all statuses). Used by bootstrap to check if any exist. */
  async countOperators(): Promise<number> {
    return this.operators.countDocuments({});
  }

  // ─── Invitation CRUD ───────────────────────────────────────────────────────

  async createInvitation(data: Invitation): Promise<Invitation> {
    await this.invitations.insertOne(data as any);
    logger.info('Invitation created', { invitationId: data.invitationId, email: data.email });
    return data;
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<Invitation | null> {
    return this.invitations.findOne({ tokenHash } as Filter<Invitation>) as Promise<Invitation | null>;
  }

  async acceptInvitation(invitationId: string, operatorId: string): Promise<void> {
    await this.invitations.updateOne(
      { invitationId } as Filter<Invitation>,
      { $set: { status: 'accepted', acceptedAt: new Date(), acceptedByOperatorId: operatorId } },
    );
    logger.info('Invitation accepted', { invitationId, operatorId });
  }

  /** Expire pending invitations past their expiresAt date. Returns count expired. */
  async expireInvitations(): Promise<number> {
    const result = await this.invitations.updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } } as Filter<Invitation>,
      { $set: { status: 'expired' } },
    );
    if (result.modifiedCount > 0) {
      logger.info(`Expired ${result.modifiedCount} invitation(s)`);
    }
    return result.modifiedCount;
  }
}
