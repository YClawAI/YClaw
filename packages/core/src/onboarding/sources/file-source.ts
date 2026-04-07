/**
 * File source — handles local file uploads.
 *
 * Validates MIME type and size, parses content, stores raw file
 * in IObjectStore (council change #3).
 */

import { createLogger } from '../../logging/logger.js';
import type { IObjectStore } from '../../interfaces/IObjectStore.js';
import { parseContent } from '../parsers/index.js';
import { createProvenance } from '../provenance.js';
import { MAX_FILE_SIZE_BYTES, SUPPORTED_MIME_TYPES, ASSET_KEY_PREFIX } from '../constants.js';
import type { OnboardingAsset, AssetClassification } from '../types.js';

const logger = createLogger('onboarding:file-source');

export interface FileInput {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export async function processFile(
  file: FileInput,
  sessionId: string,
  jobId: string,
  objectStore: IObjectStore,
): Promise<OnboardingAsset> {
  // Validate size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size ${file.size} exceeds maximum ${MAX_FILE_SIZE_BYTES} bytes`);
  }

  // Validate MIME type
  if (!SUPPORTED_MIME_TYPES.has(file.mimetype)) {
    throw new Error(`Unsupported file type: ${file.mimetype}`);
  }

  // Create provenance
  const prov = createProvenance('file', file.originalname, file.buffer, jobId);

  // Store raw file in object store (council change #3: all files to IObjectStore)
  const objectKey = `${ASSET_KEY_PREFIX}${sessionId}/${prov.contentHash}/${file.originalname}`;
  await objectStore.put(objectKey, file.buffer, { contentType: file.mimetype });

  // Parse content (returns null for images)
  const parseResult = await parseContent(file.mimetype, file.buffer);
  const extractedText = parseResult?.text ?? '';

  logger.info('File processed', {
    filename: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    hasText: extractedText.length > 0,
  });

  return {
    assetId: prov.importJobId,
    source: 'file',
    sourceUri: file.originalname,
    filename: file.originalname,
    contentHash: prov.contentHash,
    summary: '', // Will be filled by LLM classification
    classification: 'general' as AssetClassification,
    extractedText,
    importJobId: jobId,
    importedAt: prov.importedAt,
    sizeBytes: file.size,
    objectKey,
  };
}
