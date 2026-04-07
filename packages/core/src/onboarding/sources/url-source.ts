/**
 * URL source — single-page fetch + text extraction.
 *
 * Uses safeFetch for SSRF protection (validates pre-fetch, post-redirect,
 * and final response URL). No crawling — single page only.
 */

import { createLogger } from '../../logging/logger.js';
import type { IObjectStore } from '../../interfaces/IObjectStore.js';
import { createProvenance } from '../provenance.js';
import { safeFetch } from './ssrf-guard.js';
import { ASSET_KEY_PREFIX } from '../constants.js';
import type { OnboardingAsset, AssetClassification } from '../types.js';

const logger = createLogger('onboarding:url-source');

/** Strip HTML tags and extract text content. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function processUrl(
  url: string,
  sessionId: string,
  jobId: string,
  objectStore: IObjectStore,
): Promise<OnboardingAsset> {
  // safeFetch handles SSRF validation (scheme, redirects, final IP)
  const response = await safeFetch(url, { 'Accept': 'text/html, text/plain, application/json' });

  if (!response.ok) {
    throw new Error(`URL fetch failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? 'text/html';
  const raw = await response.text();

  const extractedText = contentType.includes('text/html')
    ? stripHtml(raw)
    : raw;

  const content = Buffer.from(raw, 'utf8');
  const prov = createProvenance('url', url, content, jobId);

  const hostname = new URL(url).hostname;
  const objectKey = `${ASSET_KEY_PREFIX}${sessionId}/${prov.contentHash}/${hostname}`;
  await objectStore.put(objectKey, content, { contentType });

  logger.info('URL processed', { url, size: content.length });

  return {
    assetId: prov.importJobId,
    source: 'url',
    sourceUri: url,
    filename: hostname,
    contentHash: prov.contentHash,
    summary: '',
    classification: 'general' as AssetClassification,
    extractedText: extractedText.slice(0, 50_000),
    importJobId: jobId,
    importedAt: prov.importedAt,
    sizeBytes: content.length,
    objectKey,
  };
}
