import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ZodError } from 'zod';
import {
  AgentConfigSchema,
  OrgChartSchema,
  type AgentConfig,
  type OrgChart,
} from './schema.js';

const ROOT_DIR = resolve(import.meta.dirname, '..', '..', '..', '..');
const DEPARTMENTS_DIR = join(ROOT_DIR, 'departments');
const PROMPTS_DIR = join(ROOT_DIR, 'prompts');
const MEMORY_DIR = join(ROOT_DIR, 'memory');

// ── In-memory prompt cache ──────────────────────────────────────────

interface PromptCacheEntry {
  content: string;
  /** File modification time (ms since epoch) for invalidation */
  mtimeMs: number;
  /** Rough token estimate (~4 chars per token) */
  tokens: number;
  /** Resolved file path */
  path: string;
}

/** Cache keyed by resolved file path */
const promptCache = new Map<string, PromptCacheEntry>();

let cacheHits = 0;
let cacheMisses = 0;

/**
 * Get prompt cache statistics for monitoring.
 * Useful for verifying caching is working and measuring hit rates.
 */
export function getPromptCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
} {
  const total = cacheHits + cacheMisses;
  return {
    size: promptCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? Math.round((cacheHits / total) * 1000) / 1000 : 0,
  };
}

/**
 * Clear the prompt cache. Use for testing or after prompt file updates.
 * Also resets hit/miss counters.
 */
export function clearPromptCache(): void {
  promptCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

// ── Directory accessors ─────────────────────────────────────────────

export function getRootDir(): string {
  return ROOT_DIR;
}

export function getDepartmentsDir(): string {
  return DEPARTMENTS_DIR;
}

export function getPromptsDir(): string {
  return PROMPTS_DIR;
}

export function getMemoryDir(): string {
  return MEMORY_DIR;
}

// ── Agent config loading ────────────────────────────────────────────

export function loadAgentConfig(name: string): AgentConfig {
  const departments = readdirSync(DEPARTMENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dept of departments) {
    const configPath = join(DEPARTMENTS_DIR, dept, `${name}.yaml`);
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = parseYaml(raw);
      return AgentConfigSchema.parse(parsed);
    }
  }

  throw new Error(`Agent config not found: ${name}`);
}

// ── Config validation ───────────────────────────────────────────────

export interface ConfigValidationError {
  /** Relative path from repo root, e.g. departments/development/designer.yaml */
  file: string;
  error: ZodError;
}

export interface ConfigValidationResult {
  valid: AgentConfig[];
  errors: ConfigValidationError[];
}

/**
 * Validate all YAML files in the departments/ directory against the Zod schema.
 *
 * Returns every successfully parsed config alongside a structured list of
 * failures — each failure includes the relative file path and the full ZodError
 * so callers can emit actionable messages (file, field path, expected/received).
 *
 * Used by:
 * - loadAllAgentConfigs()  — runtime graceful degradation
 * - config-validation.test.ts — CI gate that fails the build on bad configs
 * - validate-configs.ts    — standalone local validation script
 */
export function validateAllConfigs(): ConfigValidationResult {
  const valid: AgentConfig[] = [];
  const errors: ConfigValidationError[] = [];

  const departments = readdirSync(DEPARTMENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dept of departments) {
    const deptDir = join(DEPARTMENTS_DIR, dept);
    const files = readdirSync(deptDir).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      const relPath = join('departments', dept, file);
      const raw = readFileSync(join(deptDir, file), 'utf-8');
      const parsed = parseYaml(raw) as unknown;
      const result = AgentConfigSchema.safeParse(parsed);
      if (result.success) {
        valid.push(result.data);
      } else {
        errors.push({ file: relPath, error: result.error });
      }
    }
  }

  return { valid, errors };
}

export function loadAllAgentConfigs(): Map<string, AgentConfig> {
  const { valid, errors } = validateAllConfigs();

  for (const { file, error } of errors) {
    const issues = error.issues
      .map(i => `  ${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('\n');
    // Use stderr directly — logger is not yet initialised at config-load time
    process.stderr.write(
      `[CRITICAL] Config validation failed — skipping agent: ${file}\n${issues}\n`,
    );
  }

  const configs = new Map<string, AgentConfig>();
  for (const config of valid) {
    configs.set(config.name, config);
  }

  // ── Trigger→task validation (2026-03-27) ───────────────────────────
  // Warn when a trigger references a task name not defined in the agent's
  // workflow markdown. Catches "ghost tasks" that block the serial queue.
  for (const [name, config] of configs) {
    const workflowPrompt = config.system_prompts?.find(p => p.includes('workflow'));
    if (!workflowPrompt) continue;

    try {
      const workflowContent = loadPrompt(workflowPrompt);
      // Extract task names from ## Task: <name> headers (case-insensitive)
      const taskPattern = /^##\s+Task:\s+(\S+)/gim;
      const definedTasks = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = taskPattern.exec(workflowContent)) !== null) {
        definedTasks.add(match[1].toLowerCase());
      }

      // Also match ## <task_name> (some workflows use this format)
      const altPattern = /^##\s+(?:Task:\s+)?(\w+)\s/gm;
      while ((match = altPattern.exec(workflowContent)) !== null) {
        const candidate = match[1].toLowerCase();
        // Skip common non-task headers
        if (!['core', 'rules', 'event', 'design', 'vault', 'ao', 'mandatory', 'queue', 'emergency', 'cross'].includes(candidate)) {
          definedTasks.add(candidate);
        }
      }

      if (definedTasks.size === 0) continue; // Can't validate if no tasks found

      for (const trigger of config.triggers ?? []) {
        const taskName = (trigger as { task?: string }).task;
        if (taskName && !definedTasks.has(taskName.toLowerCase())) {
          process.stderr.write(
            `[WARN] Agent "${name}": trigger (${(trigger as { type: string }).type}:${(trigger as { event?: string; schedule?: string }).event || (trigger as { schedule?: string }).schedule || '?'}) ` +
            `references task "${taskName}" which is NOT defined in ${workflowPrompt}. ` +
            `This task will run with no workflow instructions and may block the serial queue.\n`,
          );
        }
      }
    } catch {
      // Prompt loading failed — skip validation for this agent
    }
  }

  // ── Communication style validation ─────────────────────────────────
  // Warn if an agent's communication style file does not exist
  for (const [name, config] of configs) {
    if (config.communication?.style) {
      const stylePath = join(PROMPTS_DIR, 'styles', `${config.communication.style}.md`);
      if (!existsSync(stylePath)) {
        process.stderr.write(
          `[WARN] Agent "${name}": communication.style "${config.communication.style}" ` +
          `has no corresponding file at prompts/styles/${config.communication.style}.md\n`,
        );
      }
    }
  }

  // ── Subscription→trigger validation (#872) ─────────────────────────
  // Warn when an agent subscribes to an event but has no matching
  // type:event trigger to handle it — prevents silent discard at runtime.
  for (const [name, config] of configs) {
    for (const subscription of config.event_subscriptions) {
      const hasMatchingTrigger = (config.triggers ?? []).some(
        t => t.type === 'event' && t.event === subscription,
      );
      if (!hasMatchingTrigger) {
        process.stderr.write(
          `[WARN] Agent "${name}" subscribes to "${subscription}" but has no trigger for it\n`,
        );
      }
    }
  }

  return configs;
}

export function getAgentConfigPath(
  name: string,
  department: string,
): string {
  return join(DEPARTMENTS_DIR, department, `${name}.yaml`);
}

// ── Prompt loading (with in-memory cache) ───────────────────────────

/**
 * Load a prompt file by name. Uses an in-memory cache with mtime-based
 * invalidation to avoid redundant readFileSync calls.
 *
 * Cache behavior:
 * - First call: reads file, caches content + mtime
 * - Subsequent calls: stat() to check mtime (cheap), return cached
 *   content if unchanged, re-read if file was modified
 * - stat() is ~10x cheaper than readFileSync for large files
 */
export function loadPrompt(name: string): string {
  const resolved = resolve(PROMPTS_DIR, name);

  // Path traversal guard
  if (
    !resolved.startsWith(resolve(PROMPTS_DIR) + '/') &&
    resolved !== resolve(PROMPTS_DIR)
  ) {
    throw new Error(`Path traversal detected in prompt name: ${name}`);
  }

  if (!existsSync(resolved)) {
    throw new Error(`Prompt not found: ${name}`);
  }

  // Check cache
  const cached = promptCache.get(resolved);
  if (cached) {
    // Validate mtime — stat() is cheaper than readFileSync
    try {
      const stat = statSync(resolved);
      if (stat.mtimeMs === cached.mtimeMs) {
        cacheHits++;
        return cached.content;
      }
    } catch {
      // stat failed — fall through to re-read
    }
  }

  // Cache miss or stale — read file and update cache
  cacheMisses++;
  const content = readFileSync(resolved, 'utf-8');
  const stat = statSync(resolved);
  const tokens = Math.ceil(content.length / 4);

  promptCache.set(resolved, {
    content,
    mtimeMs: stat.mtimeMs,
    tokens,
    path: resolved,
  });

  return content;
}

/**
 * Load a prompt with metadata (content, path, token estimate).
 * Uses the same in-memory cache as loadPrompt().
 */
export function loadPromptWithMetadata(
  name: string,
): { content: string; path: string; tokens: number } {
  const resolved = resolve(PROMPTS_DIR, name);

  // loadPrompt handles caching, path traversal, and existence checks
  const content = loadPrompt(name);

  // After loadPrompt, the entry is guaranteed to be in cache
  const cached = promptCache.get(resolved);
  if (cached) {
    return {
      content: cached.content,
      path: cached.path,
      tokens: cached.tokens,
    };
  }

  // Fallback (should not happen, but defensive)
  const tokens = Math.ceil(content.length / 4);
  return { content, path: resolved, tokens };
}

// ── Org chart and event catalog ─────────────────────────────────────

export function buildOrgChart(
  configs: Map<string, AgentConfig>,
): OrgChart {
  const departments: Record<
    string,
    { agents: string[]; role: string }
  > = {};

  const DEPT_ROLES: Record<string, string> = {
    executive: 'Sets direction, gates quality',
    marketing: 'External narrative and growth',
    operations: 'Community, analytics, infrastructure',
    development: 'Code quality and deployment',
    finance: 'Treasury and spend tracking',
    support: 'User help and troubleshooting',
  };

  for (const [, config] of configs) {
    if (!departments[config.department]) {
      departments[config.department] = {
        agents: [],
        role: DEPT_ROLES[config.department] || config.department,
      };
    }
    departments[config.department].agents.push(config.name);
  }

  return OrgChartSchema.parse({ departments });
}

export function buildEventCatalog(
  configs: Map<string, AgentConfig>,
): string[] {
  const events = new Set<string>();
  for (const [, config] of configs) {
    for (const sub of config.event_subscriptions) events.add(sub);
    for (const pub of config.event_publications) events.add(pub);
  }
  return Array.from(events).sort();
}
