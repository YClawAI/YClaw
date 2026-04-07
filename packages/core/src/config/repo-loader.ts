import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { RepoConfigSchema, type RepoConfig } from './repo-schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('repo-loader');

const ROOT_DIR = resolve(import.meta.dirname, '..', '..', '..', '..');
const REPOS_DIR = join(ROOT_DIR, 'repos');

/**
 * Repos where codegen is forbidden (self-modification protection).
 * Checked at execution time by isRepoExcluded().
 *
 * NOTE: These repos ARE loaded into the registry so that webhook handlers
 * (ReactionsManager, GitHubWebhookHandler) can process events from them.
 * Codegen exclusion is enforced at execution time, not at load time.
 */
const EXCLUDED_REPOS = new Set<string>([
  // yclaw was previously excluded here for self-modification protection.
  // Removed 2026-02-25: Builder needs codegen:execute to work effectively.
  // Safety is now enforced via CI guard workflow (.github/workflows/agent-safety.yml)
  // which blocks PRs modifying protected paths without human approval.
]);

export function getReposDir(): string {
  return REPOS_DIR;
}

export function getExcludedRepos(): ReadonlySet<string> {
  return EXCLUDED_REPOS;
}

export function isRepoExcluded(repoName: string): boolean {
  return EXCLUDED_REPOS.has(repoName);
}

export function loadRepoConfig(name: string): RepoConfig {
  const configPath = join(REPOS_DIR, `${name}.yaml`);
  if (!existsSync(configPath)) {
    throw new Error(`Repo config not found: ${name}`);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  const config = RepoConfigSchema.parse(parsed);

  if (EXCLUDED_REPOS.has(config.github.repo)) {
    throw new Error(
      `Repo "${config.github.repo}" is excluded from codegen operations (self-modification protection)`,
    );
  }

  return config;
}

export function loadAllRepoConfigs(): Map<string, RepoConfig> {
  const configs = new Map<string, RepoConfig>();

  if (!existsSync(REPOS_DIR)) {
    logger.warn(`Repos directory not found: ${REPOS_DIR}`);
    return configs;
  }

  const files = readdirSync(REPOS_DIR).filter(f => f.endsWith('.yaml'));

  for (const file of files) {
    try {
      const raw = readFileSync(join(REPOS_DIR, file), 'utf-8');
      const parsed = parseYaml(raw);
      const config = RepoConfigSchema.parse(parsed);

      if (EXCLUDED_REPOS.has(config.github.repo)) {
        logger.info(`Loading codegen-excluded repo for webhook processing: ${config.github.repo}`);
      }

      configs.set(config.name, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to load repo config ${file}: ${msg}`);
    }
  }

  logger.info(`Loaded ${configs.size} repo configs`);
  return configs;
}
