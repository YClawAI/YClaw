import type { Db } from 'mongodb';
import { RepoConfigSchema, type RepoConfig } from './repo-schema.js';
import { loadAllRepoConfigs, isRepoExcluded } from './repo-loader.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('repo-registry');

// ─── Repo Registry ──────────────────────────────────────────────────────────
//
// Dual-source repo config registry:
//   1. Static: repos/*.yaml files (committed to yclaw, human-managed)
//   2. Dynamic: MongoDB repo_configs collection (agent-registered at runtime)
//
// Dynamic configs let agents register new repos without modifying yclaw,
// solving the self-modification exclusion chicken-and-egg problem.
//
// MongoDB configs are validated with the same Zod schema as YAML configs.
// Exclusion enforcement applies to both sources.
//

const COLLECTION = 'repo_configs';

export class RepoRegistry {
  /** name → RepoConfig (merged from YAML + MongoDB) */
  private configs = new Map<string, RepoConfig>();

  /** full_name → RepoConfig (lookup by "owner/repo") */
  private byFullName = new Map<string, RepoConfig>();

  private db: Db | null = null;

  /**
   * Initialize the registry from both YAML and MongoDB sources.
   * YAML configs take precedence over MongoDB (human override).
   */
  async initialize(db?: Db | null): Promise<void> {
    // Load dynamic configs from MongoDB first (lower priority)
    if (db) {
      this.db = db;
      try {
        const docs = await db.collection(COLLECTION).find().toArray();
        for (const doc of docs) {
          try {
            const config = RepoConfigSchema.parse(doc);
            if (isRepoExcluded(config.github.repo)) {
              logger.warn('Skipping excluded repo from DB', { repo: config.github.repo });
              continue;
            }
            this.setConfig(config);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Invalid repo config in DB', { name: doc.name, error: msg });
          }
        }
        logger.info('Loaded repo configs from MongoDB', { count: docs.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to load repo configs from MongoDB', { error: msg });
      }
    }

    // Load static configs from YAML (higher priority — overwrites DB)
    const yamlConfigs = loadAllRepoConfigs();
    for (const [, config] of yamlConfigs) {
      this.setConfig(config);
    }

    logger.info('Repo registry initialized', { total: this.configs.size });
  }

  /**
   * Register a new repo config (persists to MongoDB).
   * Validates against schema and exclusion list.
   */
  async register(raw: Record<string, unknown>): Promise<RepoConfig> {
    const config = RepoConfigSchema.parse(raw);

    if (isRepoExcluded(config.github.repo)) {
      throw new Error(
        `Cannot register excluded repo: ${config.github.repo} (self-modification protection)`,
      );
    }

    // Persist to MongoDB
    if (this.db) {
      await this.db.collection(COLLECTION).updateOne(
        { name: config.name },
        { $set: { ...config, registeredAt: new Date().toISOString() } },
        { upsert: true },
      );
    }

    // Update in-memory
    this.setConfig(config);

    logger.info('Repo registered', {
      name: config.name,
      github: `${config.github.owner}/${config.github.repo}`,
      persisted: !!this.db,
    });

    return config;
  }

  /** Get a repo config by registry name (e.g., "my-app"). */
  get(name: string): RepoConfig | undefined {
    return this.configs.get(name);
  }

  /** Get a repo config by GitHub full name (e.g., "YClawAI/my-app"). */
  getByFullName(fullName: string): RepoConfig | undefined {
    return this.byFullName.get(fullName);
  }

  /** Get all registered repo configs. */
  getAll(): Map<string, RepoConfig> {
    return new Map(this.configs);
  }

  /** Check if a repo is registered (by name or full name). */
  has(nameOrFullName: string): boolean {
    return this.configs.has(nameOrFullName) || this.byFullName.has(nameOrFullName);
  }

  /** Number of registered repos. */
  get size(): number {
    return this.configs.size;
  }

  private setConfig(config: RepoConfig): void {
    this.configs.set(config.name, config);
    const fullName = `${config.github.owner}/${config.github.repo}`;
    this.byFullName.set(fullName, config);
  }
}
