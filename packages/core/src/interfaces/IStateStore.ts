/**
 * IStateStore — Abstract interface for the primary state/document store.
 *
 * Replaces direct MongoDB usage throughout the codebase. The default
 * implementation (MongoStateStore) wraps existing MongoDB logic.
 *
 * Design: provider-agnostic collection interface with typed CRUD operations.
 * MongoDB-specific operators ($set, $lt, etc.) are mapped to a minimal
 * query language that any backend can implement.
 */

// ─── Filter Types (provider-agnostic query predicates) ──────────────────────

/** Comparison operators for filter predicates. */
export interface ComparisonOperators<T> {
  $lt?: T;
  $lte?: T;
  $gt?: T;
  $gte?: T;
  $ne?: T;
  $in?: T[];
  $nin?: T[];
  $exists?: boolean;
}

/**
 * Filter query type. Each key maps to either:
 * - An exact value match
 * - A ComparisonOperators object for range/set queries
 * - A nested dot-notation path (string keys with unknown values)
 */
export type FilterQuery<T> = {
  [K in keyof T]?: T[K] | ComparisonOperators<T[K]>;
} & Record<string, unknown>;

// ─── Update Types ───────────────────────────────────────────────────────────

/** Update query — provider-agnostic mutation operators. */
export interface UpdateQuery<T> {
  /** Set specific fields to new values. */
  $set?: Partial<T> & Record<string, unknown>;
  /** Increment numeric fields. */
  $inc?: Partial<Record<keyof T & string, number>>;
  /** Remove fields from the document. */
  $unset?: Partial<Record<keyof T & string, 1 | true>>;
  /** Push values into array fields. */
  $push?: Partial<Record<keyof T & string, unknown>>;
}

// ─── Query Options ──────────────────────────────────────────────────────────

/** Sort specification — field name to direction (1 = ascending, -1 = descending). */
export type SortSpec = Record<string, 1 | -1>;

/** Options for find queries. */
export interface FindOptions {
  sort?: SortSpec;
  limit?: number;
  skip?: number;
}

// ─── Result Types ───────────────────────────────────────────────────────────

export interface UpdateResult {
  matchedCount: number;
  modifiedCount: number;
}

export interface DeleteResult {
  deletedCount: number;
}

export interface IndexSpec {
  fields: Record<string, 1 | -1>;
  unique?: boolean;
}

// ─── ICollection ────────────────────────────────────────────────────────────

/**
 * Generic collection interface — abstracts a document store table/collection.
 *
 * This is the core building block. Each domain module receives typed collection
 * handles from the state store (e.g., `stateStore.collection<ExecutionRecord>('executions')`).
 */
export interface ICollection<T> {
  /** Insert a single document. */
  insertOne(doc: T): Promise<void>;

  /** Find a single document matching the filter. */
  findOne(filter: FilterQuery<T>): Promise<T | null>;

  /** Find all documents matching the filter with optional sort/limit/skip. */
  find(filter: FilterQuery<T>, options?: FindOptions): Promise<T[]>;

  /** Update a single document matching the filter. */
  updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>): Promise<UpdateResult>;

  /** Update all documents matching the filter. */
  updateMany(filter: FilterQuery<T>, update: UpdateQuery<T>): Promise<UpdateResult>;

  /** Delete a single document matching the filter. */
  deleteOne(filter: FilterQuery<T>): Promise<DeleteResult>;

  /** Delete all documents matching the filter. */
  deleteMany(filter: FilterQuery<T>): Promise<DeleteResult>;

  /** Count documents matching the filter. */
  countDocuments(filter?: FilterQuery<T>): Promise<number>;

  /** Create an index for query optimization. */
  createIndex(spec: IndexSpec): Promise<void>;
}

// ─── IStateStore ────────────────────────────────────────────────────────────

/**
 * Primary state store interface. All persistent document storage goes
 * through this interface. The default adapter (MongoStateStore) wraps
 * existing MongoDB logic.
 *
 * Usage:
 * ```typescript
 * const executions = stateStore.collection<ExecutionRecord>('executions');
 * await executions.insertOne(record);
 * const history = await executions.find({ agent: 'builder' }, { sort: { startedAt: -1 }, limit: 50 });
 * ```
 */
export interface IStateStore {
  /** Connect to the backing store. */
  connect(): Promise<void>;

  /** Disconnect gracefully. */
  disconnect(): Promise<void>;

  /** Returns true if the store is connected and operational. */
  healthy(): Promise<boolean>;

  /** Get a typed collection handle by name. */
  collection<T extends Record<string, unknown>>(name: string): ICollection<T>;

  /**
   * Get the raw underlying database handle for subsystems that need
   * direct access (e.g., operators/, which we cannot modify).
   *
   * Returns null if the store is not connected or if the adapter
   * does not support raw access.
   *
   * @deprecated Prefer collection<T>() for new code. This exists
   * for backward compatibility with modules that accept a raw Db handle.
   */
  getRawDb(): unknown | null;
}
