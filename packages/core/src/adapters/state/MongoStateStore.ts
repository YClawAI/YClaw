/**
 * MongoStateStore — MongoDB adapter for IStateStore.
 *
 * Wraps existing MongoDB logic. This is the default state store adapter.
 * Existing modules that accept a `Db` handle continue to work via getRawDb().
 * New code should use collection<T>() for typed, provider-agnostic access.
 */

import { MongoClient, type Db, type Collection } from 'mongodb';
import type {
  IStateStore,
  ICollection,
  FilterQuery,
  UpdateQuery,
  FindOptions,
  UpdateResult,
  DeleteResult,
  IndexSpec,
} from '../../interfaces/IStateStore.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('mongo-state-store');

// ─── MongoCollection Adapter ────────────────────────────────────────────────

/**
 * Wraps a MongoDB Collection to implement ICollection<T>.
 * Translates provider-agnostic filter/update types to MongoDB operators.
 */
class MongoCollection<T extends Record<string, unknown>> implements ICollection<T> {
  constructor(private readonly col: Collection<any>) {}

  async insertOne(doc: T): Promise<void> {
    await this.col.insertOne({ ...doc } as any);
  }

  async findOne(filter: FilterQuery<T>): Promise<T | null> {
    return this.col.findOne(filter as any) as Promise<T | null>;
  }

  async find(filter: FilterQuery<T>, options?: FindOptions): Promise<T[]> {
    let cursor = this.col.find(filter as any);
    if (options?.sort) {
      cursor = cursor.sort(options.sort);
    }
    if (options?.skip) {
      cursor = cursor.skip(options.skip);
    }
    if (options?.limit) {
      cursor = cursor.limit(options.limit);
    }
    return cursor.toArray() as unknown as T[];
  }

  async updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>): Promise<UpdateResult> {
    const mongoUpdate: Record<string, unknown> = {};
    if (update.$set) mongoUpdate.$set = update.$set;
    if (update.$inc) mongoUpdate.$inc = update.$inc;
    if (update.$unset) mongoUpdate.$unset = update.$unset;
    if (update.$push) mongoUpdate.$push = update.$push;

    const result = await this.col.updateOne(filter as any, mongoUpdate);
    return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async updateMany(filter: FilterQuery<T>, update: UpdateQuery<T>): Promise<UpdateResult> {
    const mongoUpdate: Record<string, unknown> = {};
    if (update.$set) mongoUpdate.$set = update.$set;
    if (update.$inc) mongoUpdate.$inc = update.$inc;
    if (update.$unset) mongoUpdate.$unset = update.$unset;
    if (update.$push) mongoUpdate.$push = update.$push;

    const result = await this.col.updateMany(filter as any, mongoUpdate);
    return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async deleteOne(filter: FilterQuery<T>): Promise<DeleteResult> {
    const result = await this.col.deleteOne(filter as any);
    return { deletedCount: result.deletedCount };
  }

  async deleteMany(filter: FilterQuery<T>): Promise<DeleteResult> {
    const result = await this.col.deleteMany(filter as any);
    return { deletedCount: result.deletedCount };
  }

  async countDocuments(filter?: FilterQuery<T>): Promise<number> {
    return this.col.countDocuments((filter ?? {}) as any);
  }

  async createIndex(spec: IndexSpec): Promise<void> {
    await this.col.createIndex(spec.fields, {
      ...(spec.unique ? { unique: true } : {}),
    });
  }
}

// ─── MongoStateStore ────────────────────────────────────────────────────────

export class MongoStateStore implements IStateStore {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private readonly uri: string;
  private readonly dbName: string;

  constructor(uri: string, dbName?: string) {
    this.uri = uri;
    this.dbName = dbName || process.env.MONGODB_DB || 'yclaw_agents';
  }

  async connect(): Promise<void> {
    if (this.db) return;

    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    logger.info('MongoStateStore connected', { dbName: this.dbName });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      logger.info('MongoStateStore disconnected');
    }
  }

  async healthy(): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  collection<T extends Record<string, unknown>>(name: string): ICollection<T> {
    if (!this.db) {
      throw new Error('MongoStateStore not connected. Call connect() first.');
    }
    return new MongoCollection<T>(this.db.collection(name));
  }

  /**
   * Returns the raw MongoDB Db handle for backward compatibility.
   * Existing modules (operators, audit log, etc.) that need direct
   * Collection access use this during the migration period.
   */
  getRawDb(): Db | null {
    return this.db;
  }
}

// ─── NullStateStore ─────────────────────────────────────────────────────────

/**
 * No-op state store for graceful degradation when no database is available.
 * All writes are silently discarded; all reads return empty results.
 */
export class NullStateStore implements IStateStore {
  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
  async healthy(): Promise<boolean> { return false; }

  collection<T extends Record<string, unknown>>(_name: string): ICollection<T> {
    return new NullCollection<T>();
  }

  getRawDb(): null { return null; }
}

class NullCollection<T extends Record<string, unknown>> implements ICollection<T> {
  async insertOne(): Promise<void> { /* no-op */ }
  async findOne(): Promise<T | null> { return null; }
  async find(): Promise<T[]> { return []; }
  async updateOne(): Promise<UpdateResult> { return { matchedCount: 0, modifiedCount: 0 }; }
  async updateMany(): Promise<UpdateResult> { return { matchedCount: 0, modifiedCount: 0 }; }
  async deleteOne(): Promise<DeleteResult> { return { deletedCount: 0 }; }
  async deleteMany(): Promise<DeleteResult> { return { deletedCount: 0 }; }
  async countDocuments(): Promise<number> { return 0; }
  async createIndex(): Promise<void> { /* no-op */ }
}
