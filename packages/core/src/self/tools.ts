import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml, stringify as yamlStringify } from 'yaml';
import {
  getRootDir,
  getPromptsDir,
  getMemoryDir,
  loadAgentConfig,
  getAgentConfigPath,
  buildOrgChart,
  buildEventCatalog,
  loadAllAgentConfigs,
} from '../config/loader.js';
import type { AuditLog } from '../logging/audit.js';
import type { AgentMemory } from './memory.js';
import type { MemoryIndexLike, SearchOptions } from './memory-index.js';
import { createLogger } from '../logging/logger.js';
import { ConfigPersister } from './git-persist.js';

const logger = createLogger('self-tools');

/** Validate that a resolved path stays within the expected base directory. */
function assertWithinDir(baseDir: string, userInput: string): string {
  const resolved = resolve(baseDir, userInput);
  if (!resolved.startsWith(resolve(baseDir) + '/') && resolved !== resolve(baseDir)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

/** Validate that a name contains only safe characters (alphanumeric, hyphens, underscores, dots). */
function assertSafeName(name: string): void {
  if (!/^[a-zA-Z0-9_\-][a-zA-Z0-9_\-./]*$/.test(name) || name.includes('..')) {
    throw new Error(`Invalid name: ${name}`);
  }
}

export class SelfModTools {
  private agentMemory: AgentMemory | null;
  private memoryIndex: MemoryIndexLike | null;
  private configPersister: ConfigPersister;

  constructor(
    private auditLog: AuditLog,
    agentMemory?: AgentMemory | null,
    memoryIndex?: MemoryIndexLike | null,
  ) {
    this.agentMemory = agentMemory ?? null;
    this.memoryIndex = memoryIndex ?? null;
    this.configPersister = new ConfigPersister();
  }

  async execute(
    agentName: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'read_config':
        return this.readConfig(agentName);
      case 'read_prompt':
        return this.readPrompt(args.name as string);
      case 'read_source':
        return this.readSource(args.path as string);
      case 'read_history':
        return this.readHistory(agentName, (args.limit as number) || 10);
      case 'read_org_chart':
        return this.readOrgChart();
      case 'update_config':
        return this.updateConfig(agentName, args.changes as Record<string, unknown>);
      case 'update_prompt':
        return this.updatePrompt(
          args.name as string,
          args.content as string,
          (args.mode as string) || 'append',
        );
      case 'update_schedule':
        return this.updateSchedule(agentName, args.task as string, args.schedule as string);
      case 'update_model':
        return this.updateModel(agentName, args.provider as string, args.model as string);
      case 'request_new_data_source':
        return this.requestNewDataSource(
          agentName,
          args.description as string,
          args.suggestedSource as string | undefined,
        );
      case 'memory_read':
        return this.memoryRead(agentName, args.key as string | undefined);
      case 'memory_write':
        return this.memoryWrite(agentName, args.key as string, args.value as string);
      case 'search_memory':
        return this.searchMemory(
          agentName,
          args.query as string,
          args.scope as string | undefined,
          args.limit as number | undefined,
        );
      case 'cross_write_memory':
        return this.crossWriteMemory(
          agentName,
          args.target_agent as string,
          args.key as string,
          args.value as string,
        );
      default:
        return { error: `Unknown self-modification method: ${method}` };
    }
  }

  // ─── Read-Only Tools ─────────────────────────────────────────────────────

  private readConfig(agentName: string): unknown {
    try {
      const config = loadAgentConfig(agentName);
      return { success: true, config };
    } catch (err) {
      return { error: `Failed to read config: ${err}` };
    }
  }

  private readPrompt(name: string): unknown {
    try {
      const promptPath = assertWithinDir(getPromptsDir(), name);
      if (!existsSync(promptPath)) {
        return { error: `Prompt not found: ${name}` };
      }
      const content = readFileSync(promptPath, 'utf-8');
      return { success: true, name, content, tokens: Math.ceil(content.length / 4) };
    } catch (err) {
      return { error: `Failed to read prompt: ${err}` };
    }
  }

  private readSource(path: string): unknown {
    // Security: prevent path traversal outside project root
    const rootDir = getRootDir();
    const fullPath = join(rootDir, path);
    if (!fullPath.startsWith(rootDir)) {
      return { error: 'Path traversal detected' };
    }

    // Prevent reading immutable safety files' internals
    const BLOCKED_PATTERNS = [
      '/self/safety.ts', // Can't read safety gate implementation
    ];
    if (BLOCKED_PATTERNS.some(p => path.includes(p))) {
      return { error: 'This file is part of the immutable safety floor and cannot be read by agents' };
    }

    try {
      if (!existsSync(fullPath)) {
        return { error: `Source file not found: ${path}` };
      }
      const content = readFileSync(fullPath, 'utf-8');
      return { success: true, path, content };
    } catch (err) {
      return { error: `Failed to read source: ${err}` };
    }
  }

  private async readHistory(agentName: string, limit: number): Promise<unknown> {
    try {
      const history = await this.auditLog.getAgentHistory(agentName, limit);
      const stats = await this.auditLog.getAgentStats(agentName);
      return { success: true, executions: history, stats };
    } catch (err) {
      return { error: `Failed to read history: ${err}` };
    }
  }

  private readOrgChart(): unknown {
    try {
      const allConfigs = loadAllAgentConfigs();
      const orgChart = buildOrgChart(allConfigs);
      const eventCatalog = buildEventCatalog(allConfigs);
      return { success: true, orgChart, eventCatalog };
    } catch (err) {
      return { error: `Failed to read org chart: ${err}` };
    }
  }

  // ─── Write Tools ─────────────────────────────────────────────────────────

  private async updateConfig(agentName: string, changes: Record<string, unknown>): Promise<unknown> {
    try {
      const config = loadAgentConfig(agentName);
      const configPath = getAgentConfigPath(agentName, config.department);
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = parseYaml(raw) as Record<string, unknown>;

      // Deep merge changes
      const merged = deepMerge(parsed, changes);
      const yamlContent = yamlStringify(merged);
      writeFileSync(configPath, yamlContent, 'utf-8');

      logger.info(`Config updated for ${agentName}`, { changes });

      // Persist to Git via PR
      const gitResult = await this.configPersister.persistConfigChange({
        agentName,
        department: config.department,
        fileContent: yamlContent,
        description: `update config: ${Object.keys(changes).join(', ')}`,
      });

      return {
        success: true,
        updatedFields: Object.keys(changes),
        ...(gitResult.prUrl ? { prUrl: gitResult.prUrl } : {}),
        ...(gitResult.error ? { gitWarning: gitResult.error } : {}),
      };
    } catch (err) {
      return { error: `Failed to update config: ${err}` };
    }
  }

  private updatePrompt(name: string, content: string, mode: string): unknown {
    try {
      const promptPath = assertWithinDir(getPromptsDir(), name);

      // Check for IMMUTABLE markers
      if (existsSync(promptPath)) {
        const existing = readFileSync(promptPath, 'utf-8');
        if (existing.includes('<!-- IMMUTABLE -->')) {
          // Only allow appending to non-immutable sections
          const sections = existing.split('<!-- IMMUTABLE -->');
          if (mode === 'replace') {
            return {
              error: 'This prompt contains IMMUTABLE sections. Only append mode is allowed, and only to non-immutable sections.',
            };
          }
        }
      }

      if (mode === 'append') {
        const existing = existsSync(promptPath) ? readFileSync(promptPath, 'utf-8') : '';
        writeFileSync(promptPath, existing + '\n\n' + content, 'utf-8');
      } else {
        writeFileSync(promptPath, content, 'utf-8');
      }

      logger.info(`Prompt updated: ${name} (mode: ${mode})`);
      return { success: true, name, mode };
    } catch (err) {
      return { error: `Failed to update prompt: ${err}` };
    }
  }

  private async updateSchedule(agentName: string, task: string, schedule: string): Promise<unknown> {
    try {
      const config = loadAgentConfig(agentName);
      const configPath = getAgentConfigPath(agentName, config.department);
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = parseYaml(raw) as Record<string, unknown>;

      const triggers = parsed.triggers as Array<Record<string, unknown>>;
      const target = triggers?.find(
        (t: Record<string, unknown>) => t.type === 'cron' && t.task === task
      );

      if (!target) {
        return { error: `No cron trigger found for task: ${task}` };
      }

      target.schedule = schedule;
      const updatedContent = yamlStringify(parsed);
      writeFileSync(configPath, updatedContent, 'utf-8');

      logger.info(`Schedule updated for ${agentName}:${task} → ${schedule}`);

      // Persist to Git via PR
      const gitResult = await this.configPersister.persistConfigChange({
        agentName,
        department: config.department,
        fileContent: updatedContent,
        description: `update ${task} schedule to "${schedule}"`,
      });

      return {
        success: true,
        task,
        newSchedule: schedule,
        ...(gitResult.prUrl ? { prUrl: gitResult.prUrl } : {}),
        ...(gitResult.error ? { gitWarning: gitResult.error } : {}),
      };
    } catch (err) {
      return { error: `Failed to update schedule: ${err}` };
    }
  }

  private async updateModel(agentName: string, provider: string, model: string): Promise<unknown> {
    try {
      const config = loadAgentConfig(agentName);
      const configPath = getAgentConfigPath(agentName, config.department);
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = parseYaml(raw) as Record<string, unknown>;

      (parsed.model as Record<string, unknown>).provider = provider;
      (parsed.model as Record<string, unknown>).model = model;
      const updatedContent = yamlStringify(parsed);
      writeFileSync(configPath, updatedContent, 'utf-8');

      logger.info(`Model updated for ${agentName}: ${provider}/${model}`);

      // Persist to Git via PR
      const gitResult = await this.configPersister.persistConfigChange({
        agentName,
        department: config.department,
        fileContent: updatedContent,
        description: `update model to ${provider}/${model}`,
      });

      return {
        success: true,
        provider,
        model,
        ...(gitResult.prUrl ? { prUrl: gitResult.prUrl } : {}),
        ...(gitResult.error ? { gitWarning: gitResult.error } : {}),
      };
    } catch (err) {
      return { error: `Failed to update model: ${err}` };
    }
  }

  private requestNewDataSource(
    agentName: string,
    description: string,
    suggestedSource?: string,
  ): unknown {
    // Create a request in the development department's queue
    const requestDir = join(getRootDir(), 'memory', 'architect');
    if (!existsSync(requestDir)) {
      mkdirSync(requestDir, { recursive: true });
    }

    const requestFile = join(requestDir, `data-request-${Date.now()}.md`);
    const content = `# Data Source Request

**Requesting Agent**: ${agentName}
**Date**: ${new Date().toISOString()}

## What's needed
${description}

${suggestedSource ? `## Suggested Source\n${suggestedSource}` : ''}
`;

    writeFileSync(requestFile, content, 'utf-8');
    logger.info(`New data source requested by ${agentName}: ${description}`);
    return {
      success: true,
      status: 'request_filed',
      message: 'Data source request filed with the Development department.',
    };
  }

  // ─── Agent Memory ────────────────────────────────────────────────────────

  private async memoryRead(agentName: string, key?: string): Promise<unknown> {
    // MongoDB-first, file fallback
    if (this.agentMemory) {
      try {
        if (key) {
          const data = await this.agentMemory.read(agentName, key);
          return { success: true, key, data };
        }
        const data = await this.agentMemory.readAll(agentName);
        return { success: true, data };
      } catch (err) {
        logger.warn(`MongoDB memory read failed, falling back to file`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // File-based fallback
    try {
      assertSafeName(agentName);
      const memDir = join(getMemoryDir(), agentName);
      if (!existsSync(memDir)) {
        return { success: true, data: {} };
      }

      if (key) {
        const filePath = assertWithinDir(memDir, `${key}.json`);
        if (!existsSync(filePath)) {
          return { success: true, key, data: null };
        }
        const content = readFileSync(filePath, 'utf-8');
        return { success: true, key, data: JSON.parse(content) };
      }

      const files = readdirSync(memDir).filter(f => f.endsWith('.json'));
      const data: Record<string, unknown> = {};
      for (const file of files) {
        const k = file.replace('.json', '');
        const content = readFileSync(join(memDir, file), 'utf-8');
        data[k] = JSON.parse(content);
      }
      return { success: true, data };
    } catch (err) {
      return { error: `Failed to read memory: ${err}` };
    }
  }

  private async memoryWrite(agentName: string, key: string, value: string): Promise<unknown> {
    // MongoDB-first, file fallback
    if (this.agentMemory) {
      try {
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { parsed = value; }
        await this.agentMemory.write(agentName, key, parsed);
        logger.info(`Memory written (MongoDB) for ${agentName}: ${key}`);
        return { success: true, key };
      } catch (err) {
        logger.warn(`MongoDB memory write failed, falling back to file`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // File-based fallback
    try {
      assertSafeName(agentName);
      const memDir = join(getMemoryDir(), agentName);
      if (!existsSync(memDir)) {
        mkdirSync(memDir, { recursive: true });
      }

      const filePath = assertWithinDir(memDir, `${key}.json`);
      let content: string;
      try { content = JSON.stringify(JSON.parse(value), null, 2); } catch { content = JSON.stringify(value); }
      writeFileSync(filePath, content, 'utf-8');
      logger.info(`Memory written (file) for ${agentName}: ${key}`);
      return { success: true, key };
    } catch (err) {
      return { error: `Failed to write memory: ${err}` };
    }
  }

  // ─── Memory Search ──────────────────────────────────────────────────────

  private async searchMemory(
    agentName: string,
    query: string,
    scope?: string,
    limit?: number,
  ): Promise<unknown> {
    if (!this.memoryIndex) {
      return { error: 'Memory search is unavailable (no MongoDB connection)' };
    }

    try {
      // Scope enforcement: non-executive agents requesting "all" get downgraded
      let effectiveScope = scope || 'department';
      try {
        const config = loadAgentConfig(agentName);
        if (config.department !== 'executive' && effectiveScope === 'all') {
          effectiveScope = 'department';
        }
      } catch {
        effectiveScope = 'self';
      }

      const options: SearchOptions = { limit: limit || 10 };

      // For "self" scope, override the agent filter by restricting collections
      // The MemoryIndex already handles department scoping internally
      const results = await this.memoryIndex.search(query, agentName, options);

      // Filter to self only if scope is "self"
      const filtered = effectiveScope === 'self'
        ? results.filter(r => r.agent === agentName)
        : results;

      // Format for LLM readability
      if (filtered.length === 0) {
        return { success: true, results: [], message: 'No matching memories found.' };
      }

      const formatted = filtered.map((r, i) => ({
        rank: i + 1,
        source: r.source,
        agent: r.agent,
        snippet: r.snippet,
        timestamp: r.timestamp,
      }));

      return { success: true, results: formatted };
    } catch (err) {
      return { error: `Memory search failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ─── Cross-Write Memory (Executive Only) ────────────────────────────────

  async crossWriteMemory(
    agentName: string,
    targetAgent: string,
    key: string,
    value: string,
  ): Promise<unknown> {
    // Department gate: only executive agents can write to other agents' memory
    try {
      const config = loadAgentConfig(agentName);
      if (config.department !== 'executive') {
        return { error: 'Only executive agents can write to other agents\' memory' };
      }
    } catch (err) {
      return { error: `Failed to verify agent department: ${err}` };
    }

    if (!this.agentMemory) {
      return { error: 'Cross-write unavailable (no MongoDB connection)' };
    }

    try {
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { parsed = value; }
      await this.agentMemory.write(targetAgent, key, parsed);
      logger.info(`Cross-write: ${agentName} wrote to ${targetAgent}/${key}`);
      return { success: true, targetAgent, key };
    } catch (err) {
      return { error: `Cross-write failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
