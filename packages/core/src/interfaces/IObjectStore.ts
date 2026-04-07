/**
 * IObjectStore — Abstract interface for file/asset/blob storage.
 *
 * Used for storing agent-generated assets (images, documents, media),
 * vault files, and any binary content that doesn't belong in the
 * state store.
 *
 * Adapters:
 * - LocalFileStore — local filesystem (default for Docker Compose)
 * - S3ObjectStore — AWS S3
 * - Future: GcsObjectStore, AzureBlobStore
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ObjectMetadata {
  /** Content type (MIME). */
  contentType?: string;
  /** Content length in bytes. */
  contentLength?: number;
  /** ISO-8601 timestamp of last modification. */
  lastModified?: string;
  /** Arbitrary key-value metadata. */
  custom?: Record<string, string>;
}

export interface PutOptions {
  /** MIME content type (e.g., 'image/png', 'application/json'). */
  contentType?: string;
  /** Arbitrary metadata to store alongside the object. */
  metadata?: Record<string, string>;
}

export interface ListResult {
  /** Object keys matching the prefix. */
  keys: string[];
  /** True if there are more results (pagination). */
  truncated: boolean;
}

// ─── IObjectStore ───────────────────────────────────────────────────────────

export interface IObjectStore {
  /**
   * Store an object.
   * @param key - Object key (path-like, e.g., 'assets/logo.png')
   * @param data - Object content
   * @param options - Content type and metadata
   */
  put(key: string, data: Buffer, options?: PutOptions): Promise<void>;

  /**
   * Retrieve an object by key.
   * Returns null if the key does not exist.
   */
  get(key: string): Promise<Buffer | null>;

  /**
   * Get object metadata without downloading the content.
   * Returns null if the key does not exist.
   */
  head(key: string): Promise<ObjectMetadata | null>;

  /**
   * Delete an object by key.
   * No-op if the key does not exist.
   */
  delete(key: string): Promise<void>;

  /**
   * List objects matching a key prefix.
   * @param prefix - Key prefix to filter by (e.g., 'assets/')
   * @param maxKeys - Maximum number of keys to return (default: 1000)
   */
  list(prefix?: string, maxKeys?: number): Promise<ListResult>;

  /**
   * Generate a pre-signed URL for direct access (if supported).
   * Returns null if the adapter does not support signed URLs.
   * @param key - Object key
   * @param expiresInSeconds - URL validity duration (default: 3600)
   */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}
