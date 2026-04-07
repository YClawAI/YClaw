import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { glob } from 'glob';
import { parse as parseYaml } from 'yaml';
import type { Pool } from 'pg';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('vault-sync');

const DEFAULT_LITELLM_URL = 'http://localhost:4000';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_BATCH_SIZE = 20;
const CURSOR_KEY = 'vault:sync:cursor';

export interface VaultSyncConfig {
  vaultBasePath: string;
  pgPool: Pool;
  liteLlmUrl?: string;
  embeddingModel?: string;
  batchSize?: number;
}

export interface SyncReport {
  filesProcessed: number;
  chunksUpserted: number;
  chunksSkipped: number;
  errors: string[];
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

interface Chunk {
  id: string;
  filePath: string;
  chunkIndex: number;
  heading: string;
  content: string;
  contentHash: string;
  frontmatter: Record<string, unknown>;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: {}, body: raw };
  }
  const rest = raw.slice(4);
  const endIdx = rest.search(/^---$/m);
  if (endIdx === -1) {
    return { frontmatter: {}, body: raw };
  }
  const yamlStr = rest.slice(0, endIdx);
  const afterFrontmatter = rest.slice(endIdx + 3).replace(/^\r?\n/, '');
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(yamlStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // malformed frontmatter — treat as empty
  }
  return { frontmatter, body: afterFrontmatter };
}

function chunkByHeadings(body: string): Array<{ heading: string; content: string }> {
  const lines = body.split('\n');
  const chunks: Array<{ heading: string; content: string }> = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentLines.length > 0) {
        const text = currentLines.join('\n').trim();
        if (text.length > 0) {
          chunks.push({ heading: currentHeading, content: text });
        }
      }
      currentHeading = line.slice(3).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const text = currentLines.join('\n').trim();
    if (text.length > 0) {
      chunks.push({ heading: currentHeading, content: text });
    }
  }

  // If no chunks found, treat the whole body as a single chunk
  if (chunks.length === 0 && body.trim().length > 0) {
    chunks.push({ heading: '', content: body.trim() });
  }

  return chunks;
}

function buildChunks(filePath: string, frontmatter: Record<string, unknown>, body: string): Chunk[] {
  const sections = chunkByHeadings(body);
  return sections.map(({ heading, content }, idx) => {
    const contentHash = sha256(content);
    const idSource = `${filePath}:${idx}:${contentHash}`;
    const id = sha256(idSource).slice(0, 32);
    return { id, filePath, chunkIndex: idx, heading, content, contentHash, frontmatter };
  });
}

export class VaultSyncEngine {
  private readonly liteLlmUrl: string;
  private readonly embeddingModel: string;
  private readonly batchSize: number;

  constructor(
    private cfg: VaultSyncConfig,
    private redis?: RedisLike,
  ) {
    this.liteLlmUrl = cfg.liteLlmUrl ?? DEFAULT_LITELLM_URL;
    this.embeddingModel = cfg.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.batchSize = cfg.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async ensureSchema(): Promise<void> {
    await this.cfg.pgPool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await this.cfg.pgPool.query(`
      CREATE TABLE IF NOT EXISTS vault_embeddings (
        id VARCHAR(64) PRIMARY KEY,
        file_path VARCHAR(512) NOT NULL,
        chunk_index INT NOT NULL,
        heading VARCHAR(256),
        content TEXT NOT NULL,
        content_hash VARCHAR(64),
        embedding vector(1536),
        frontmatter JSONB,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logger.info('vault_embeddings schema ensured');
  }

  async syncAll(): Promise<SyncReport> {
    const report: SyncReport = { filesProcessed: 0, chunksUpserted: 0, chunksSkipped: 0, errors: [] };

    const files = await glob('**/*.md', {
      cwd: this.cfg.vaultBasePath,
      ignore: ['.obsidian/**'],
    });

    for (const file of files) {
      try {
        await this.syncFile(file);
        report.filesProcessed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('vault sync file error', { file, error: msg });
        report.errors.push(`${file}: ${msg}`);
      }
    }

    return report;
  }

  async syncFile(filePath: string): Promise<void> {
    const vaultRoot = resolve(this.cfg.vaultBasePath);
    const fullPath = resolve(this.cfg.vaultBasePath, filePath);
    if (!fullPath.startsWith(vaultRoot + '/') && fullPath !== vaultRoot) {
      throw new Error(`vault-sync: path escapes vault root: ${filePath}`);
    }
    const raw = await readFile(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const chunks = buildChunks(filePath, frontmatter, body);

    if (chunks.length === 0) return;

    // Filter out chunks whose content_hash already matches DB (dedup)
    const existingHashes = await this.fetchExistingHashes(chunks.map((c) => c.id));
    const toEmbed = chunks.filter((c) => existingHashes.get(c.id) !== c.contentHash);

    if (toEmbed.length === 0) {
      logger.debug('vault sync: all chunks up-to-date', { filePath });
      return;
    }

    // Batch embed
    for (let i = 0; i < toEmbed.length; i += this.batchSize) {
      const batch = toEmbed.slice(i, i + this.batchSize);
      const embeddings = await this.embedBatch(batch.map((c) => c.content));

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = embeddings[j];
        if (!chunk || !embedding) continue;

        await this.cfg.pgPool.query(
          `INSERT INTO vault_embeddings (id, file_path, chunk_index, heading, content, content_hash, embedding, frontmatter, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (id) DO UPDATE SET
             embedding = EXCLUDED.embedding,
             content = EXCLUDED.content,
             content_hash = EXCLUDED.content_hash,
             frontmatter = EXCLUDED.frontmatter,
             synced_at = NOW()`,
          [
            chunk.id,
            chunk.filePath,
            chunk.chunkIndex,
            chunk.heading || null,
            chunk.content,
            chunk.contentHash,
            `[${embedding.join(',')}]`,
            JSON.stringify(chunk.frontmatter),
          ],
        );
      }
    }

    logger.info('vault sync: file synced', { filePath, chunks: toEmbed.length });
  }

  async getLastCursor(): Promise<string | null> {
    if (!this.redis) return null;
    return this.redis.get(CURSOR_KEY);
  }

  private async fetchExistingHashes(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.cfg.pgPool.query(
      `SELECT id, content_hash FROM vault_embeddings WHERE id IN (${placeholders})`,
      ids,
    );
    const rows = result.rows as Array<{ id: string; content_hash: string }>;
    return new Map(rows.map((r) => [r.id, r.content_hash]));
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.liteLlmUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, input: texts }),
    });

    if (!response.ok) {
      throw new Error(`LiteLLM embed batch failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as EmbeddingResponse;
    return data.data.map((d) => d.embedding);
  }
}
