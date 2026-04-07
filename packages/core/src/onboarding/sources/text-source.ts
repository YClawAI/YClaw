/**
 * Text source — handles direct text paste input.
 */

import type { IObjectStore } from '../../interfaces/IObjectStore.js';
import { createProvenance } from '../provenance.js';
import { ASSET_KEY_PREFIX } from '../constants.js';
import type { OnboardingAsset, AssetClassification } from '../types.js';

export async function processText(
  content: string,
  title: string,
  sessionId: string,
  jobId: string,
  objectStore: IObjectStore,
): Promise<OnboardingAsset> {
  const buf = Buffer.from(content, 'utf8');
  const prov = createProvenance('text', title, buf, jobId);

  const objectKey = `${ASSET_KEY_PREFIX}${sessionId}/${prov.contentHash}/${title}`;
  await objectStore.put(objectKey, buf, { contentType: 'text/plain' });

  return {
    assetId: prov.importJobId,
    source: 'text',
    sourceUri: title,
    filename: title,
    contentHash: prov.contentHash,
    summary: '',
    classification: 'general' as AssetClassification,
    extractedText: content,
    importJobId: jobId,
    importedAt: prov.importedAt,
    sizeBytes: buf.length,
    objectKey,
  };
}
