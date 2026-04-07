import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { glob } from 'glob';
import type { Pool } from 'pg';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('vault-reader');

const DEFAULT_LITELLM_URL = 'http://localhost:4000';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export interface VaultSearchResult {
  filePath: string;
  heading: string;
  excerpt: string;
  score: number;
}

export interface VaultReaderConfig {
  vaultBasePath: string;
  pgPool?: Pool;
  liteLlmUrl?: string;
  embeddingModel?: string;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface VaultEmbeddingRow {
  file_path: string;
  heading: string | null;
  content: string;
  score: number;
}

export class VaultReader {
  constructor(private cfg: VaultReaderConfig) {}

  async readFile(relativePath: string): Promise<string> {
    if (relativePath.includes('.obsidian/')) {
      throw new Error(`Access denied: .obsidian/ paths are not readable via VaultReader`);
    }
    const vaultRoot = resolve(this.cfg.vaultBasePath);
    const fullPath = resolve(this.cfg.vaultBasePath, relativePath);
    if (!fullPath.startsWith(vaultRoot + '/') && fullPath !== vaultRoot) {
      throw new Error(`Access denied: path escapes vault root`);
    }
    return readFile(fullPath, 'utf8');
  }

  async listFiles(pattern?: string): Promise<string[]> {
    const globPattern = pattern ?? '**/*.md';
    const files = await glob(globPattern, {
      cwd: this.cfg.vaultBasePath,
      ignore: ['.obsidian/**'],
    });
    return files.sort();
  }

  async search(query: string, limit = 10): Promise<VaultSearchResult[]> {
    if (!this.cfg.pgPool) {
      throw new Error('pgvector not configured: provide pgPool in VaultReaderConfig');
    }

    const embedding = await this.embedQuery(query);
    const embeddingLiteral = `[${embedding.join(',')}]`;

    const result = await this.cfg.pgPool.query(
      `SELECT file_path, heading, content, 1 - (embedding <=> $1) AS score
       FROM vault_embeddings
       ORDER BY embedding <=> $1
       LIMIT $2`,
      [embeddingLiteral, limit],
    );

    const rows = result.rows as VaultEmbeddingRow[];
    return rows.map((row) => ({
      filePath: row.file_path,
      heading: row.heading ?? '',
      excerpt: row.content.slice(0, 200),
      score: Number(row.score),
    }));
  }

  private async embedQuery(query: string): Promise<number[]> {
    const url = `${this.cfg.liteLlmUrl ?? DEFAULT_LITELLM_URL}/v1/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
        input: query,
      }),
    });

    if (!response.ok) {
      throw new Error(`LiteLLM embed failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as EmbeddingResponse;
    const embedding = data.data[0]?.embedding;
    if (!embedding) {
      throw new Error('LiteLLM returned empty embedding');
    }
    return embedding;
  }
}
