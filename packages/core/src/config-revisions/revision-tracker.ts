// ─── Config Revision Tracker ─────────────────────────────────────────────────
//
// Tracks agent configuration changes by computing snapshots from YAML configs
// and storing versioned revisions with diffs in MongoDB.
//
// Capture points:
// 1. On deploy (startup) — compare current configs against latest stored revision
// 2. On PR merge — webhook handler stores PR context for next deploy capture
// 3. On API update — caller records a revision directly
//
// Revisions are append-only with unique (agentId, version) index.

import { createHash, randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { createLogger } from '../logging/logger.js';
import type { AgentConfig } from '../config/schema.js';
import { loadPrompt } from '../config/loader.js';
import { computeDiff, isDiffEmpty, summarizeDiff } from './diff-engine.js';
import type {
  ConfigSnapshot,
  ConfigRevision,
  CreateRevisionInput,
  ConfigDiff,
} from './types.js';

const logger = createLogger('revision-tracker');

const COLLECTION_NAME = 'agent_config_revisions';
const MAX_VERSION_RETRIES = 3;

export class RevisionTracker {
  private collection: Collection<ConfigRevision> | null = null;

  /**
   * Pending PR context — set by webhook handler on PR merge,
   * consumed by the next deploy capture.
   */
  private pendingPrContext: {
    commitSha: string;
    prNumber: number;
    changedAgents: string[];
  } | null = null;

  constructor(private db: Db | null) {}

  get hasPersistence(): boolean {
    return this.collection !== null;
  }

  async initialize(): Promise<void> {
    if (!this.db) {
      logger.warn('No MongoDB — config revision tracking disabled');
      return;
    }

    this.collection = this.db.collection<ConfigRevision>(COLLECTION_NAME);

    await this.collection.createIndex({ id: 1 }, { unique: true });
    // Unique compound index prevents version collisions (Fix #4)
    await this.collection.createIndex(
      { agentId: 1, version: 1 },
      { unique: true },
    );
    await this.collection.createIndex({ timestamp: -1 });
    await this.collection.createIndex({ agentId: 1, timestamp: -1 });

    logger.info('Config revision tracker initialized');
  }

  // ─── PR Merge Context (Fix #2) ────────────────────────────────────────────

  /**
   * Store PR merge context for the next deploy capture.
   * Called by the GitHub webhook handler when a PR merges that touches
   * agent YAML files in departments/ or prompts/.
   */
  setPrMergeContext(ctx: {
    commitSha: string;
    prNumber: number;
    changedAgents: string[];
  }): void {
    this.pendingPrContext = ctx;
    logger.info('PR merge context stored for next deploy capture', {
      prNumber: ctx.prNumber,
      changedAgents: ctx.changedAgents,
    });
  }

  // ─── Snapshot Computation ──────────────────────────────────────────────────

  /**
   * Build a ConfigSnapshot from a loaded AgentConfig.
   * Captures all behavior-relevant fields including model provider,
   * triggers, data sources, executor config, task routing, etc.
   */
  computeSnapshot(config: AgentConfig): ConfigSnapshot {
    // Hash all system prompts concatenated
    const promptHasher = createHash('sha256');
    let totalPromptLength = 0;

    for (const promptName of config.system_prompts) {
      try {
        const content = loadPrompt(promptName);
        promptHasher.update(content);
        totalPromptLength += content.length;
      } catch {
        // Prompt file missing — include the name so hash changes if list changes
        promptHasher.update(`__missing__:${promptName}`);
      }
    }

    // Serialize triggers with full detail
    const triggers: string[] = [];
    const cronSchedules: string[] = [];
    for (const trigger of config.triggers) {
      switch (trigger.type) {
        case 'cron':
          cronSchedules.push(`${trigger.task}@${trigger.schedule}`);
          triggers.push(`cron:${trigger.task}@${trigger.schedule}`);
          break;
        case 'event':
          triggers.push(`event:${trigger.task}@${trigger.event}`);
          break;
        case 'webhook':
          triggers.push(`webhook:${trigger.task}@${trigger.method}:${trigger.path}`);
          break;
        case 'manual':
          triggers.push(`manual:${trigger.task}`);
          break;
        case 'batch_event':
          triggers.push(`batch_event:${trigger.task}@${trigger.events.join(',')}:min=${trigger.min_count}:timeout=${trigger.timeout_ms}`);
          break;
      }
      // Include per-trigger model override if present
      if (trigger.model) {
        triggers.push(`trigger_model:${trigger.task}@${trigger.model.provider}/${trigger.model.model}`);
      }
    }

    // Serialize data sources
    const dataSources: string[] = config.data_sources.map(
      ds => `${ds.type}:${ds.name}`,
    );

    // Hash complex objects that change infrequently
    const executorHash = config.executor
      ? hashJson(config.executor)
      : null;

    const taskRoutingHash = config.taskRouting
      ? hashJson(config.taskRouting)
      : null;

    const contentWeightsHash = config.content_weights
      ? hashJson(config.content_weights)
      : null;

    const metadataHash = config.metadata
      ? hashJson(config.metadata)
      : null;

    return {
      modelProvider: config.model.provider,
      model: config.model.model,
      maxTokens: config.model.maxTokens,
      temperature: config.model.temperature,
      systemPromptHash: promptHasher.digest('hex'),
      systemPromptLength: totalPromptLength,
      systemPromptNames: [...config.system_prompts].sort(),
      availableActions: [...config.actions].sort(),
      triggers: triggers.sort(),
      cronSchedules: cronSchedules.sort(),
      eventSubscriptions: [...config.event_subscriptions].sort(),
      eventPublications: [...config.event_publications].sort(),
      dataSources: dataSources.sort(),
      reviewBypass: [...config.review_bypass].sort(),
      humanize: config.humanize ?? false,
      executorHash,
      taskRoutingHash,
      contentWeightsHash,
      metadataHash,
      yamlPath: `departments/${config.department}/${config.name}.yaml`,
    };
  }

  // ─── Deploy Capture ────────────────────────────────────────────────────────

  /**
   * Check all loaded configs against stored revisions.
   * Creates new revisions for any that changed.
   * Call this at startup after loading all agent configs.
   */
  async captureOnDeploy(
    configs: Map<string, AgentConfig>,
    opts?: { commitSha?: string; changedBy?: string },
  ): Promise<{ created: number; unchanged: number }> {
    if (!this.collection) {
      return { created: 0, unchanged: configs.size };
    }

    // Consume pending PR context if available (Fix #2)
    const prCtx = this.pendingPrContext;
    this.pendingPrContext = null;

    let created = 0;
    let unchanged = 0;

    for (const [agentId, config] of configs) {
      const snapshot = this.computeSnapshot(config);
      const latest = await this.getLatestRevision(agentId);

      // Determine source and PR metadata
      const isPrAgent = prCtx?.changedAgents.includes(agentId) ?? false;
      const source = isPrAgent ? 'pr_merge' as const : 'deploy' as const;
      const commitSha = isPrAgent
        ? prCtx?.commitSha
        : (opts?.commitSha ?? undefined);
      const prNumber = isPrAgent ? prCtx?.prNumber : undefined;

      if (latest) {
        const diff = computeDiff(latest.snapshot, snapshot);
        if (isDiffEmpty(diff)) {
          unchanged++;
          continue;
        }
        // Config changed — create new revision
        await this.createRevision({
          agentId,
          snapshot,
          changedBy: opts?.changedBy ?? 'ci',
          changeReason: `Deploy detected config change: ${summarizeDiff(diff)}`,
          source,
          commitSha,
          prNumber,
        });
        created++;
      } else {
        // First revision — create initial with empty diff
        await this.createRevision({
          agentId,
          snapshot,
          changedBy: opts?.changedBy ?? 'ci',
          changeReason: 'Initial config revision',
          source,
          commitSha,
          prNumber,
        });
        created++;
      }
    }

    logger.info(`Deploy capture complete: ${created} new revisions, ${unchanged} unchanged`);
    return { created, unchanged };
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Create a new revision. Auto-increments version per agent.
   * Uses retry with unique index to prevent version collision (Fix #4).
   */
  async createRevision(input: CreateRevisionInput): Promise<ConfigRevision> {
    if (!this.collection) {
      throw new Error('Revision tracker has no persistence');
    }

    for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt++) {
      const latest = await this.getLatestRevision(input.agentId);
      const version = latest ? latest.version + 1 : 1;

      const diff: ConfigDiff = latest
        ? computeDiff(latest.snapshot, input.snapshot)
        : { added: [], removed: [], changed: [] };

      const revision: ConfigRevision = {
        id: randomUUID(),
        agentId: input.agentId,
        version,
        snapshot: input.snapshot,
        diff,
        changedBy: input.changedBy,
        changeReason: input.changeReason,
        source: input.source,
        commitSha: input.commitSha ?? null,
        prNumber: input.prNumber ?? null,
        timestamp: new Date().toISOString(),
      };

      try {
        await this.collection.insertOne({ ...revision });

        logger.info(`Config revision v${version} created for ${input.agentId}: ${summarizeDiff(diff)}`, {
          agentId: input.agentId,
          version,
          source: input.source,
        });

        return revision;
      } catch (err: unknown) {
        // Duplicate key on (agentId, version) — retry with next version
        const code = (err as { code?: number }).code;
        if (code === 11000 && attempt < MAX_VERSION_RETRIES - 1) {
          logger.warn(`Version collision for ${input.agentId} v${version}, retrying`, { attempt });
          continue;
        }
        throw err;
      }
    }

    // Unreachable — loop always returns or throws
    throw new Error(`Failed to allocate version for ${input.agentId} after ${MAX_VERSION_RETRIES} retries`);
  }

  /**
   * Get the latest revision for an agent.
   */
  async getLatestRevision(agentId: string): Promise<ConfigRevision | null> {
    if (!this.collection) return null;
    return this.collection.findOne(
      { agentId },
      { sort: { version: -1 } },
    );
  }

  /**
   * Get a specific revision by agent and version.
   */
  async getRevision(agentId: string, version: number): Promise<ConfigRevision | null> {
    if (!this.collection) return null;
    return this.collection.findOne({ agentId, version });
  }

  /**
   * List revisions for an agent, newest first.
   */
  async listRevisions(
    agentId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ revisions: ConfigRevision[]; total: number }> {
    if (!this.collection) return { revisions: [], total: 0 };

    const limit = Math.max(1, Math.min(opts?.limit ?? 20, 100));
    const offset = Math.max(0, opts?.offset ?? 0);

    const [revisions, total] = await Promise.all([
      this.collection
        .find({ agentId })
        .sort({ version: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.collection.countDocuments({ agentId }),
    ]);

    return { revisions, total };
  }

  /**
   * Compare two versions for an agent.
   */
  async compareVersions(
    agentId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<{ from: ConfigRevision; to: ConfigRevision; diff: ConfigDiff } | null> {
    if (!this.collection) return null;

    const [from, to] = await Promise.all([
      this.getRevision(agentId, fromVersion),
      this.getRevision(agentId, toVersion),
    ]);

    if (!from || !to) return null;

    return {
      from,
      to,
      diff: computeDiff(from.snapshot, to.snapshot),
    };
  }

  // ─── Incident Correlation ──────────────────────────────────────────────────

  /**
   * Get all config changes across all agents since a given timestamp.
   * Used for incident correlation: "what changed in the last 24h?"
   */
  async getRecentChanges(since: Date): Promise<ConfigRevision[]> {
    if (!this.collection) return [];

    return this.collection
      .find({ timestamp: { $gte: since.toISOString() } })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
  }

  // ─── Rollback ──────────────────────────────────────────────────────────────

  /**
   * Get the snapshot from a previous revision for rollback reference.
   * Note: YAML configs live in departments/ (immutable path) — actual file
   * restoration must be done via git revert / manual edit + redeploy.
   * This records the rollback intent and provides the target snapshot.
   */
  async getRollbackSnapshot(
    agentId: string,
    version: number,
  ): Promise<ConfigSnapshot | null> {
    const revision = await this.getRevision(agentId, version);
    return revision?.snapshot ?? null;
  }

  /**
   * Record a rollback as a new revision pointing back to the source version.
   */
  async recordRollback(
    agentId: string,
    toVersion: number,
    snapshot: ConfigSnapshot,
    changedBy: string,
  ): Promise<ConfigRevision> {
    return this.createRevision({
      agentId,
      snapshot,
      changedBy,
      changeReason: `Rolled back to version ${toVersion}`,
      source: 'manual',
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Hash a JSON-serializable value for change detection.
 * Uses deterministic key ordering via sorted JSON.
 */
function hashJson(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}
