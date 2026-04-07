/**
 * Provenance tracking for ingested assets.
 *
 * Every ingested piece tracks source, timestamp, content hash (SHA-256),
 * and import job ID for full audit trail.
 */

import { createHash, randomUUID } from 'node:crypto';

export interface Provenance {
  contentHash: string;
  sourceType: string;
  sourceUri: string;
  importedAt: Date;
  importJobId: string;
  sizeBytes: number;
}

/** Generate a SHA-256 content hash from a Buffer or string. */
export function hashContent(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Create a full provenance record for an ingested asset. */
export function createProvenance(
  sourceType: string,
  sourceUri: string,
  content: Buffer | string,
  jobId?: string,
): Provenance {
  const sizeBytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.length;
  return {
    contentHash: hashContent(content),
    sourceType,
    sourceUri,
    importedAt: new Date(),
    importJobId: jobId ?? randomUUID(),
    sizeBytes,
  };
}
