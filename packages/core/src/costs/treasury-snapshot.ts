import type { Db } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('treasury-snapshot');

const COLLECTION = 'treasury_snapshots';

/**
 * Writes treasury data snapshots to MongoDB so Mission Control
 * can read them without making live RPC/API calls.
 *
 * The Treasurer agent calls writeSnapshot() after each data fetch cycle.
 *
 * IMPORTANT: Crypto snapshots MUST include pre-computed USD values
 * (usdValue per holding, totalUsdValue per wallet). MC reads these
 * server-side for runway calculations. If USD values are missing,
 * MC falls back to live RPC + CoinGecko which is slower but correct.
 *
 * Expected snapshot shapes:
 *   banking: { accounts: Array<{ id, name, institution, type, availableBalance, ledgerBalance, currency }> }
 *   crypto:  { holdings: Array<{ chain, address, label, nativeBalance, nativeSymbol, usdValue, totalUsdValue, tokens }> }
 *   infra:   { aws: { byService: Array<{ service, costCents }> }, mongoAtlas: { monthlyCents }, redisCloud: { monthlyCents } }
 */
export class TreasurySnapshotWriter {
  constructor(private db: Db) {}

  async writeSnapshot(
    category: 'banking' | 'crypto' | 'infra',
    data: unknown,
  ): Promise<void> {
    try {
      await this.db.collection(COLLECTION).updateOne(
        { _id: category as unknown as import('mongodb').ObjectId },
        { $set: { data, updatedAt: new Date() } },
        { upsert: true },
      );
      logger.info(`Treasury snapshot written: ${category}`);
    } catch (err) {
      logger.warn(`Treasury snapshot write failed for ${category}: ${err}`);
    }
  }

  async getSnapshot(category: string): Promise<{ data: unknown; updatedAt: Date } | null> {
    try {
      const doc = await this.db.collection(COLLECTION).findOne({
        _id: category as unknown as import('mongodb').ObjectId,
      });
      if (!doc) return null;
      return {
        data: doc.data,
        updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt as string),
      };
    } catch {
      return null;
    }
  }
}
