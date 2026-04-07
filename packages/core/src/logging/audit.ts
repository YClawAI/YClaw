import { MongoClient, type Db, type Collection } from 'mongodb';
import type {
  ExecutionRecord,
  SelfModification,
  ReviewRequest,
  ReviewResult,
} from '../config/schema.js';
// ─── Codegen Session Result (inlined — codegen/ directory removed) ──────────

export interface CodegenSessionResult {
  session_id: string;
  repo: string;
  branch: string;
  status: 'success' | 'partial' | 'failed';
  files_changed: string[];
  tests_passed: boolean;
  commit_sha?: string;
  backend_used: string;
  duration_seconds: number;
  error?: string;
  stdout_redacted?: string;
  stderr_redacted?: string;
  browser_evidence_urls?: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DB_NAME = 'yclaw_agents';

// ─── Stored Review Document ─────────────────────────────────────────────────

interface StoredReview {
  request: ReviewRequest;
  result: ReviewResult;
  storedAt: string;
}

// ─── Codegen Session Document ────────────────────────────────────────────────

export interface StoredCodegenSession extends CodegenSessionResult {
  agent: string;
  task: string;
  storedAt: string;
  correlationId?: string;
}

// ─── Deployment Record ───────────────────────────────────────────────────────

export interface DeploymentRecord {
  id: string;
  repo: string;
  environment: string;
  risk_tier: string;
  pr_url?: string;
  commit_sha?: string;
  status: 'pending' | 'approved' | 'rejected' | 'deployed' | 'failed' | 'rolled_back';
  council_votes: Array<{
    voter: string;
    approved: boolean;
    reason: string;
  }>;
  layer2_safe?: boolean;
  layer2_reason?: string;
  layer2_votes?: Array<{
    member: string;
    safe: boolean;
    reason: string;
  }>;
  human_approval?: {
    approver: string;
    approved_at: string;
  };
  deployed_at?: string;
  rolled_back_at?: string;
  error?: string;
  correlationId?: string;
  storedAt: string;
}

// ─── Cache Stats ────────────────────────────────────────────────────────────

/**
 * Aggregate cache performance across an agent's executions.
 * Only includes executions where cache metrics were recorded.
 */
export interface CacheStats {
  /** Number of executions with cache data */
  executionsWithCache: number;
  /** Average cache hit rate across cached executions (0.0 to 1.0) */
  averageCacheHitRate: number;
  /** Average estimated cost savings rate (0.0 to 1.0) */
  averageSavingsRate: number;
  /** Total tokens read from cache across all executions */
  totalCacheReadTokens: number;
  /** Total tokens written to cache across all executions */
  totalCacheCreationTokens: number;
}

// ─── Agent Stats ────────────────────────────────────────────────────────────

export interface AgentStats {
  totalExecutions: number;
  successRate: number;
  failureRate: number;
  averageDurationMs: number | null;
  mostCommonFlag: string | undefined;
  bestPerformingContentType: string | undefined;
  worstPerformingContentType: string | undefined;
  totalSelfModifications: number;
  totalReviews: number;
  reviewApprovalRate: number;
  cache: CacheStats;
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

export class AuditLog {
  private client: MongoClient | null;
  private db: Db | null = null;
  private dbName: string;
  /** True when this AuditLog was created from an external Db handle. */
  private external: boolean;

  private executions!: Collection<ExecutionRecord>;
  private selfModifications!: Collection<SelfModification>;
  private reviews!: Collection<StoredReview>;
  private codegenSessions!: Collection<StoredCodegenSession>;
  private deployments!: Collection<DeploymentRecord>;

  constructor(mongoUri: string, dbName?: string) {
    this.client = new MongoClient(mongoUri);
    this.dbName = dbName || process.env.YCLAW_DB_NAME || DEFAULT_DB_NAME;
    this.external = false;
  }

  /**
   * Create an AuditLog from an existing Db handle (from the infrastructure layer).
   * Avoids opening a duplicate MongoClient connection.
   */
  static async fromDb(db: Db): Promise<AuditLog> {
    const instance = new AuditLog('mongodb://unused', db.databaseName);
    instance.client = null; // No owned client — lifecycle managed by infrastructure
    instance.external = true;
    instance.db = db;
    instance.executions = db.collection<ExecutionRecord>('executions');
    instance.selfModifications = db.collection<SelfModification>('self_modifications');
    instance.reviews = db.collection<StoredReview>('reviews');
    instance.codegenSessions = db.collection<StoredCodegenSession>('codegen_sessions');
    instance.deployments = db.collection<DeploymentRecord>('deployments');
    await instance.ensureIndexes();
    return instance;
  }

  /** Connect to MongoDB and initialise collection handles + indexes. */
  async connect(): Promise<void> {
    if (this.db) return;

    await this.client!.connect();
    this.db = this.client!.db(this.dbName);

    this.executions = this.db.collection<ExecutionRecord>('executions');
    this.selfModifications = this.db.collection<SelfModification>('self_modifications');
    this.reviews = this.db.collection<StoredReview>('reviews');
    this.codegenSessions = this.db.collection<StoredCodegenSession>('codegen_sessions');
    this.deployments = this.db.collection<DeploymentRecord>('deployments');

    await this.ensureIndexes();
  }

  /** Disconnect from MongoDB gracefully. */
  async disconnect(): Promise<void> {
    // Don't close externally-provided connections — lifecycle managed by infrastructure
    if (this.client && !this.external) {
      await this.client.close();
    }
    this.db = null;
  }

  // ─── Write Operations ───────────────────────────────────────────────────

  /** Record a completed (or in-progress) agent execution. */
  async recordExecution(record: ExecutionRecord): Promise<void> {
    await this.requireConnection();
    await this.executions.insertOne({ ...record });
  }

  /** Record a self-modification event (config change, prompt edit, etc.). */
  async recordSelfModification(mod: SelfModification): Promise<void> {
    await this.requireConnection();
    await this.selfModifications.insertOne({ ...mod });
  }

  /** Record a review request together with its result. */
  async recordReview(request: ReviewRequest, result: ReviewResult): Promise<void> {
    await this.requireConnection();
    await this.reviews.insertOne({
      request,
      result,
      storedAt: new Date().toISOString(),
    });
  }

  /** Record a codegen session result. */
  async recordCodegenSession(
    session: CodegenSessionResult,
    agent: string,
    task: string,
    correlationId?: string,
  ): Promise<void> {
    await this.requireConnection();
    await this.codegenSessions.insertOne({
      ...session,
      agent,
      task,
      correlationId,
      storedAt: new Date().toISOString(),
    });
  }

  /** Record a deployment event. */
  async recordDeployment(record: DeploymentRecord): Promise<void> {
    await this.requireConnection();
    await this.deployments.insertOne({ ...record });
  }

  /** Update a deployment record (e.g., status change after assessment). */
  async updateDeployment(id: string, update: Partial<DeploymentRecord>): Promise<void> {
    await this.requireConnection();
    await this.deployments.updateOne({ id }, { $set: update });
  }

  /**
   * Clear stale pending deployments (status='pending') by marking them rejected.
   * Used at startup by deploy-governance-v2 migration to drain abandoned approval queues.
   *
   * Only clears deployments whose `storedAt` timestamp is older than `stalenessThresholdMs`
   * (default: 2 hours). Recent pending deployments — e.g. CRITICAL-tier deployments
   * legitimately waiting for architect review — are preserved so they can complete
   * the assess → review → approve → execute flow without being cancelled.
   *
   * Returns the count of deployments cleared.
   */
  async clearPendingDeployments(
    reason: string,
    stalenessThresholdMs: number = 2 * 60 * 60 * 1000,
  ): Promise<number> {
    await this.requireConnection();
    const cutoffDate = new Date(Date.now() - stalenessThresholdMs);
    const cutoffIso = cutoffDate.toISOString();
    const result = await this.deployments.updateMany(
      { status: 'pending', storedAt: { $lt: cutoffIso } },
      { $set: { status: 'rejected', error: reason } },
    );
    return result.modifiedCount;
  }

  // ─── Read Operations ────────────────────────────────────────────────────

  /** Retrieve recent execution records for a given agent, newest first. */
  async getAgentHistory(agentName: string, limit: number = 50): Promise<ExecutionRecord[]> {
    await this.requireConnection();
    return this.executions
      .find({ agent: agentName })
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray() as unknown as ExecutionRecord[];
  }

  /** Compute aggregate statistics for an agent across all stored executions. */
  async getAgentStats(agentName: string): Promise<AgentStats> {
    await this.requireConnection();

    const allExecutions = await this.executions.find({ agent: agentName }).toArray();
    const totalExecutions = allExecutions.length;

    if (totalExecutions === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        failureRate: 0,
        averageDurationMs: null,
        mostCommonFlag: undefined,
        bestPerformingContentType: undefined,
        worstPerformingContentType: undefined,
        totalSelfModifications: 0,
        totalReviews: 0,
        reviewApprovalRate: 0,
        cache: {
          executionsWithCache: 0,
          averageCacheHitRate: 0,
          averageSavingsRate: 0,
          totalCacheReadTokens: 0,
          totalCacheCreationTokens: 0,
        },
      };
    }

    // Success / failure rates
    const completed = allExecutions.filter(e => e.status === 'completed').length;
    const failed = allExecutions.filter(e => e.status === 'failed').length;
    const successRate = completed / totalExecutions;
    const failureRate = failed / totalExecutions;

    // Average duration for executions that have a completedAt timestamp
    const durations = allExecutions
      .filter(e => e.completedAt)
      .map(e => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime());
    const averageDurationMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

    // Most common review flag across all executions
    const flagCounts = new Map<string, number>();
    for (const exec of allExecutions) {
      if (exec.reviewResult?.flags) {
        for (const flag of exec.reviewResult.flags) {
          flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
        }
      }
    }
    let mostCommonFlag: string | undefined;
    let maxCount = 0;
    for (const [flag, count] of flagCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonFlag = flag;
      }
    }

    // Self-modification count
    const totalSelfModifications = await this.selfModifications.countDocuments({ agent: agentName });

    // Review stats
    const agentReviews = await this.reviews.find({ 'request.agent': agentName }).toArray();
    const totalReviews = agentReviews.length;
    const approvedReviews = agentReviews.filter(r => r.result.approved).length;
    const reviewApprovalRate = totalReviews > 0 ? approvedReviews / totalReviews : 0;

    // Cache stats — aggregate from executions that have cache data
    const cacheStats = this.computeCacheStats(allExecutions);

    return {
      totalExecutions,
      successRate,
      failureRate,
      averageDurationMs,
      mostCommonFlag,
      bestPerformingContentType: undefined,
      worstPerformingContentType: undefined,
      totalSelfModifications,
      totalReviews,
      reviewApprovalRate,
      cache: cacheStats,
    };
  }

  /** Get codegen sessions for a repo. */
  async getCodegenSessions(repo: string, limit: number = 20): Promise<StoredCodegenSession[]> {
    await this.requireConnection();
    return this.codegenSessions
      .find({ repo })
      .sort({ storedAt: -1 })
      .limit(limit)
      .toArray();
  }

  /** Get deployment history for a repo. */
  async getDeploymentHistory(repo: string, limit: number = 20): Promise<DeploymentRecord[]> {
    await this.requireConnection();
    return this.deployments
      .find({ repo })
      .sort({ storedAt: -1 })
      .limit(limit)
      .toArray();
  }

  /** Get a specific deployment by ID. */
  async getDeployment(id: string): Promise<DeploymentRecord | null> {
    await this.requireConnection();
    return this.deployments.findOne({ id });
  }

  // ─── Accessors ─────────────────────────────────────────────────────────

  /** Expose the MongoDB Db handle for subsystems that need direct collection access. */
  getDb(): Db | null {
    return this.db;
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  /**
   * Compute aggregate cache stats from execution records.
   * Only considers executions where tokenUsage includes cache fields.
   */
  private computeCacheStats(executions: ExecutionRecord[]): CacheStats {
    let executionsWithCache = 0;
    let totalHitRate = 0;
    let totalSavingsRate = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;

    for (const exec of executions) {
      const usage = exec.tokenUsage;
      if (!usage) continue;

      const hasCache =
        (usage.cacheReadInputTokens !== undefined && usage.cacheReadInputTokens > 0) ||
        (usage.cacheCreationInputTokens !== undefined && usage.cacheCreationInputTokens > 0);

      if (!hasCache) continue;

      executionsWithCache++;
      totalHitRate += usage.cacheHitRate ?? 0;
      totalSavingsRate += usage.estimatedSavingsRate ?? 0;
      totalCacheReadTokens += usage.cacheReadInputTokens ?? 0;
      totalCacheCreationTokens += usage.cacheCreationInputTokens ?? 0;
    }

    return {
      executionsWithCache,
      averageCacheHitRate: executionsWithCache > 0
        ? Math.round((totalHitRate / executionsWithCache) * 1000) / 1000
        : 0,
      averageSavingsRate: executionsWithCache > 0
        ? Math.round((totalSavingsRate / executionsWithCache) * 1000) / 1000
        : 0,
      totalCacheReadTokens,
      totalCacheCreationTokens,
    };
  }

  private async requireConnection(): Promise<void> {
    if (!this.db) {
      await this.connect();
    }
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.executions.createIndex({ agent: 1, startedAt: -1 }),
      this.executions.createIndex({ status: 1 }),
      this.selfModifications.createIndex({ agent: 1, timestamp: -1 }),
      this.selfModifications.createIndex({ status: 1 }),
      this.reviews.createIndex({ 'request.agent': 1, storedAt: -1 }),
      this.codegenSessions.createIndex({ repo: 1, storedAt: -1 }),
      this.codegenSessions.createIndex({ session_id: 1 }, { unique: true }),
      this.codegenSessions.createIndex({ correlationId: 1 }),
      this.deployments.createIndex({ repo: 1, storedAt: -1 }),
      this.deployments.createIndex({ id: 1 }, { unique: true }),
      this.deployments.createIndex({ status: 1 }),
      this.deployments.createIndex({ correlationId: 1 }),
    ]);
  }
}

// ─── Null Audit Log (no-op when MongoDB is unavailable) ─────────────────────

/**
 * Drop-in replacement for AuditLog that silently discards all writes.
 * Used when MongoDB is unavailable so the rest of the system can start.
 */
export class NullAuditLog extends AuditLog {
  constructor() {
    // Pass a dummy URI — we never connect
    super('mongodb://null:27017', 'null');
  }

  override async connect(): Promise<void> { /* no-op */ }
  override async disconnect(): Promise<void> { /* no-op */ }
  override async recordExecution(): Promise<void> { /* no-op */ }
  override async recordSelfModification(): Promise<void> { /* no-op */ }
  override async recordReview(): Promise<void> { /* no-op */ }
  override async recordCodegenSession(): Promise<void> { /* no-op */ }
  override async recordDeployment(): Promise<void> { /* no-op */ }
  override async updateDeployment(): Promise<void> { /* no-op */ }
  override async clearPendingDeployments(): Promise<number> { return 0; }
  override async getAgentHistory(): Promise<ExecutionRecord[]> { return []; }
  override async getCodegenSessions(): Promise<StoredCodegenSession[]> { return []; }
  override async getDeploymentHistory(): Promise<DeploymentRecord[]> { return []; }
  override async getDeployment(): Promise<DeploymentRecord | null> { return null; }
  override async getAgentStats(agentName: string): Promise<AgentStats> {
    return {
      totalExecutions: 0, successRate: 0, failureRate: 0,
      averageDurationMs: null, mostCommonFlag: undefined,
      bestPerformingContentType: undefined, worstPerformingContentType: undefined,
      totalSelfModifications: 0, totalReviews: 0, reviewApprovalRate: 0,
      cache: {
        executionsWithCache: 0,
        averageCacheHitRate: 0,
        averageSavingsRate: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
      },
    };
  }
}
