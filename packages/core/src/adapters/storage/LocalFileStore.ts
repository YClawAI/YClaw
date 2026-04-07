/**
 * LocalFileStore — Local filesystem adapter for IObjectStore.
 *
 * Default for Docker Compose and local development. Stores objects
 * as files in a configurable base directory.
 */

import { readFile, writeFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import type {
  IObjectStore,
  ObjectMetadata,
  PutOptions,
  ListResult,
} from '../../interfaces/IObjectStore.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('local-file-store');

export class LocalFileStore implements IObjectStore {
  private readonly basePath: string;

  /**
   * @param basePath - Root directory for stored objects (default: ./data/objects)
   */
  constructor(basePath?: string) {
    this.basePath = basePath || process.env.YCLAW_OBJECT_STORE_PATH || join(process.cwd(), 'data', 'objects');
  }

  private resolvePath(key: string): string {
    // Prevent path traversal (#11) — resolve and verify path stays under basePath
    const normalized = key.replace(/^\/+/, '');
    const resolved = resolve(this.basePath, normalized);
    const resolvedBase = resolve(this.basePath);
    if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) {
      throw new Error(`Path traversal detected: "${key}" resolves outside base directory`);
    }
    return resolved;
  }

  async put(key: string, data: Buffer, options?: PutOptions): Promise<void> {
    const filePath = this.resolvePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);

    // Store metadata as a sidecar file if provided
    if (options?.contentType || options?.metadata) {
      const metaPath = `${filePath}.meta.json`;
      await writeFile(metaPath, JSON.stringify({
        contentType: options.contentType,
        metadata: options.metadata,
        storedAt: new Date().toISOString(),
      }));
    }

    logger.info('Object stored', { key, size: data.length });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolvePath(key));
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const filePath = this.resolvePath(key);
      const stats = await stat(filePath);

      let contentType: string | undefined;
      let custom: Record<string, string> | undefined;

      // Try to read sidecar metadata
      try {
        const metaRaw = await readFile(`${filePath}.meta.json`, 'utf-8');
        const meta = JSON.parse(metaRaw);
        contentType = meta.contentType;
        custom = meta.metadata;
      } catch { /* no metadata file */ }

      return {
        contentType,
        contentLength: stats.size,
        lastModified: stats.mtime.toISOString(),
        custom,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = this.resolvePath(key);
      await unlink(filePath);
      // Clean up metadata sidecar
      try { await unlink(`${filePath}.meta.json`); } catch { /* no metadata */ }
      logger.info('Object deleted', { key });
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async list(prefix?: string, maxKeys?: number): Promise<ListResult> {
    const max = maxKeys || 1000;
    const keys: string[] = [];
    const searchDir = prefix ? this.resolvePath(prefix) : this.basePath;

    try {
      // Collect max+1 to detect truncation (#10)
      await this.listRecursive(searchDir, this.basePath, keys, max + 1);
    } catch (err: any) {
      if (err.code === 'ENOENT') return { keys: [], truncated: false };
      throw err;
    }

    const truncated = keys.length > max;
    return { keys: keys.slice(0, max), truncated };
  }

  async getSignedUrl(_key: string, _expiresInSeconds?: number): Promise<string | null> {
    // Local filesystem doesn't support signed URLs
    return null;
  }

  private async listRecursive(
    dir: string,
    basePath: string,
    keys: string[],
    max: number,
  ): Promise<void> {
    if (keys.length >= max) return;

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (keys.length >= max) break;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.listRecursive(fullPath, basePath, keys, max);
      } else if (!entry.name.endsWith('.meta.json')) {
        // Convert absolute path back to key
        const key = fullPath.slice(basePath.length + 1);
        keys.push(key);
      }
    }
  }
}
