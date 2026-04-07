import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ActionExecutor, ActionResult } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import type { VaultReader } from '../knowledge/vault-reader.js';
import type { KnowledgeGraphService } from '../knowledge/knowledge-graph.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('vault-executor');

/**
 * Vault action executor.
 * Exposes vault read, semantic search, and write to agents.
 *
 * Actions:
 *   vault:read        — Read a file from the vault by relative path
 *   vault:search      — Semantic search over vault notes via pgvector
 *   vault:write       — Write a note to the vault via WriteGateway
 *   vault:graph_query — Query the structural knowledge graph
 */
export class VaultExecutor implements ActionExecutor {
  readonly name = 'vault';

  private readonly vaultBasePath: string;
  private graphService: KnowledgeGraphService | null = null;

  constructor(
    private reader: VaultReader,
    vaultBasePath?: string,
  ) {
    // vaultBasePath must be provided for vault:write to work
    this.vaultBasePath = vaultBasePath ?? '';
  }

  setGraphService(service: KnowledgeGraphService): void {
    this.graphService = service;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'vault:read',
        description: 'Read a note from the Obsidian vault by its relative path (e.g. "00-org/architecture.md")',
        parameters: {
          path: {
            type: 'string',
            description: 'Relative path from vault root to the note file',
            required: true,
          },
        },
      },
      {
        name: 'vault:search',
        description: 'Semantic search over vault notes using pgvector. Returns the most relevant excerpts.',
        parameters: {
          query: {
            type: 'string',
            description: 'Natural language search query',
            required: true,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
            required: false,
          },
        },
      },
      {
        name: 'vault:write',
        description: 'Write a note to the Obsidian vault. Content goes through the WriteGateway security scanner.',
        parameters: {
          path: {
            type: 'string',
            description: 'Target vault path (e.g. "02-areas/development/decisions/adr-001.md")',
            required: true,
          },
          content: {
            type: 'string',
            description: 'Markdown content to write',
            required: true,
          },
          message: {
            type: 'string',
            description: 'Commit message for the vault write',
            required: false,
          },
        },
      },
      {
        name: 'vault:graph_query',
        description: 'Query the structural knowledge graph for relationships between vault concepts. Returns nodes, edges, communities, and a summary.',
        parameters: {
          query: {
            type: 'string',
            description: 'Search term — matches node names and types',
            required: true,
          },
          confidence: {
            type: 'string',
            description: 'Minimum confidence filter: EXTRACTED, INFERRED, or AMBIGUOUS (default: all)',
            required: false,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of nodes to return (default: 20)',
            required: false,
          },
        },
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case 'read':
        return this.read(params);
      case 'search':
        return this.search(params);
      case 'write':
        return this.write(params);
      case 'graph_query':
        return this.graphQuery(params);
      default:
        return { success: false, error: `Unknown vault action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.reader.listFiles('**/*.md');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('VaultExecutor health check failed', { error: msg });
      return false;
    }
  }

  private async read(params: Record<string, unknown>): Promise<ActionResult> {
    const path = params['path'] as string | undefined;
    if (!path) {
      return { success: false, error: 'Missing required parameter: path' };
    }

    try {
      const content = await this.reader.readFile(path);
      return { success: true, data: { path, content } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('vault:read failed', { path, error: msg });
      return { success: false, error: `vault:read failed: ${msg}` };
    }
  }

  private async write(params: Record<string, unknown>): Promise<ActionResult> {
    const path = params['path'] as string | undefined;
    const content = params['content'] as string | undefined;
    const message = params['message'] as string | undefined;

    if (!path || !content) {
      return { success: false, error: 'Missing required parameters: path, content' };
    }

    try {
      if (!this.vaultBasePath) {
        return { success: false, error: 'vault:write is not available — vaultBasePath not configured' };
      }

      // Write directly to the requested vault path
      const vaultRoot = resolve(this.vaultBasePath);
      const fullPath = resolve(this.vaultBasePath, path);

      // Path traversal guard
      if (!fullPath.startsWith(vaultRoot + '/') && fullPath !== vaultRoot) {
        return { success: false, error: 'vault:write denied — path escapes vault root' };
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');

      logger.info('vault:write completed', { path, message: message ?? 'vault write' });
      return { success: true, data: { path, message: message ?? 'vault write' } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('vault:write failed', { path, error: msg });
      return { success: false, error: `vault:write failed: ${msg}` };
    }
  }

  private async search(params: Record<string, unknown>): Promise<ActionResult> {
    const query = params['query'] as string | undefined;
    const limit = typeof params['limit'] === 'number' ? params['limit'] : undefined;

    if (!query) {
      return { success: false, error: 'Missing required parameter: query' };
    }

    try {
      const results = await this.reader.search(query, limit);
      return { success: true, data: { results } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('vault:search failed', { query, error: msg });
      return { success: false, error: `vault:search failed: ${msg}` };
    }
  }

  private async graphQuery(params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.graphService) {
      return { success: false, error: 'vault:graph_query is not available — graph service not initialized (librarian.graph.enabled not set)' };
    }

    const query = params['query'] as string | undefined;
    if (!query) {
      return { success: false, error: 'Missing required parameter: query' };
    }

    const confidence = params['confidence'] as 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' | undefined;
    const limit = typeof params['limit'] === 'number' ? params['limit'] : undefined;

    try {
      const result = await this.graphService.query({ query, confidence, limit });
      // Cast to Record<string, unknown> since ActionResult.data requires it
      return { success: true, data: result as unknown as Record<string, unknown> };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('vault:graph_query failed', { query, error: msg });
      return { success: false, error: `vault:graph_query failed: ${msg}` };
    }
  }
}
