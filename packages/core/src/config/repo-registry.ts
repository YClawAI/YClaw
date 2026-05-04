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
type RepoConfigSource = 'static' | 'dynamic';

export interface UnregisterRepoResult {
  removed: boolean;
  persisted: boolean;
  name?: string;
  github?: string;
  reason?: string;
}

export class RepoRegistry {
  /** name → RepoConfig (merged from YAML + MongoDB) */
  private configs = new Map<string, RepoConfig>();

  /** normalized full_name → RepoConfig (lookup by "owner/repo") */
  private byFullName = new Map<string, RepoConfig>();

  /** name → source. Static YAML entries cannot be removed by runtime cleanup. */
  private sources = new Map<string, RepoConfigSource>();

  private db: Db | null = null;

  /**
   * Initialize the registry from both YAML and MongoDB sources.
   * YAML configs take precedence over MongoDB (human override).
   */
  async initialize(db?: Db | null): Promise<void> {
    this.configs.clear();
    this.byFullName.clear();
    this.sources.clear();
    this.db = db ?? null;

    // Load dynamic configs from MongoDB first (lower priority)
    if (db) {
      try {
        const docs = await db.collection(COLLECTION).find().toArray();
        for (const doc of docs) {
          try {
            const config = RepoConfigSchema.parse(doc);
            if (isRepoExcluded(config.github.repo)) {
              logger.warn('Skipping excluded repo from DB', { repo: config.github.repo });
              continue;
            }
            this.setConfig(config, 'dynamic');
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
      this.setConfig(config, 'static');
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

    const existingByName = this.configs.get(config.name);
    if (existingByName && this.sources.get(config.name) === 'static') {
      throw new Error(
        `Cannot override static repo config: ${config.name}`,
      );
    }

    const fullNameKey = this.fullNameKey(config);
    const existingByFullName = this.byFullName.get(fullNameKey);
    let duplicateDynamicName: string | null = null;
    if (existingByFullName && existingByFullName.name !== config.name) {
      const source = this.sources.get(existingByFullName.name);
      if (source === 'static') {
        throw new Error(
          `Cannot override static repo config for ${this.fullName(existingByFullName)}`,
        );
      }
      duplicateDynamicName = existingByFullName.name;
    }

    // Persist to MongoDB
    if (this.db) {
      if (duplicateDynamicName) {
        await this.db.collection(COLLECTION).deleteOne({ name: duplicateDynamicName });
      }
      await this.db.collection(COLLECTION).updateOne(
        { name: config.name },
        { $set: { ...config, registeredAt: new Date().toISOString() } },
        { upsert: true },
      );
    }

    // Update in-memory
    if (duplicateDynamicName) {
      const duplicate = this.configs.get(duplicateDynamicName);
      if (duplicate) this.removeConfig(duplicate);
    }
    this.setConfig(config, 'dynamic');

    logger.info('Repo registered', {
      name: config.name,
      github: `${config.github.owner}/${config.github.repo}`,
      persisted: !!this.db,
    });

    return config;
  }

  /**
   * Unregister a dynamic repo config by registry name or GitHub full name.
   * Static YAML configs are human-owned and cannot be removed at runtime.
   */
  async unregister(nameOrFullName: string): Promise<UnregisterRepoResult> {
    const config = this.resolveConfig(nameOrFullName);

    if (!config) {
      return {
        removed: false,
        persisted: false,
        reason: `Repo not found: ${nameOrFullName}`,
      };
    }

    if (this.sources.get(config.name) === 'static') {
      throw new Error(
        `Cannot unregister static repo config: ${config.name}`,
      );
    }

    if (this.db) {
      await this.db.collection(COLLECTION).deleteOne({ name: config.name });
    }

    this.removeConfig(config);

    const github = this.fullName(config);
    logger.info('Repo unregistered', {
      name: config.name,
      github,
      persisted: !!this.db,
    });

    return {
      removed: true,
      persisted: !!this.db,
      name: config.name,
      github,
    };
  }

  /** Get a repo config by registry name or GitHub full name. */
  get(name: string): RepoConfig | undefined {
    return this.resolveConfig(name);
  }

  /** Get a repo config by GitHub full name (e.g., "YClawAI/my-app"). */
  getByFullName(fullName: string): RepoConfig | undefined {
    return this.byFullName.get(normalizeFullName(fullName));
  }

  /** Get all registered repo configs. */
  getAll(): Map<string, RepoConfig> {
    return new Map(this.configs);
  }

  /** Check if a repo is registered (by name or full name). */
  has(nameOrFullName: string): boolean {
    return this.resolveConfig(nameOrFullName) !== undefined;
  }

  /** Number of registered repos. */
  get size(): number {
    return this.configs.size;
  }

  private setConfig(config: RepoConfig, source: RepoConfigSource): void {
    const existingByName = this.configs.get(config.name);
    if (existingByName) {
      this.byFullName.delete(this.fullNameKey(existingByName));
    }

    const existingByFullName = this.byFullName.get(this.fullNameKey(config));
    if (existingByFullName && existingByFullName.name !== config.name) {
      this.configs.delete(existingByFullName.name);
      this.sources.delete(existingByFullName.name);
    }

    this.configs.set(config.name, config);
    this.sources.set(config.name, source);
    this.byFullName.set(this.fullNameKey(config), config);
  }

  private removeConfig(config: RepoConfig): void {
    this.configs.delete(config.name);
    this.sources.delete(config.name);
    this.byFullName.delete(this.fullNameKey(config));
  }

  private resolveConfig(nameOrFullName: string): RepoConfig | undefined {
    return this.configs.get(nameOrFullName)
      ?? this.byFullName.get(normalizeFullName(nameOrFullName));
  }

  private fullName(config: RepoConfig): string {
    return `${config.github.owner}/${config.github.repo}`;
  }

  private fullNameKey(config: RepoConfig): string {
    return normalizeFullName(this.fullName(config));
  }
}

function normalizeFullName(fullName: string): string {
  return fullName.trim().toLowerCase();
}
