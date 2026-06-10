import { createHash } from 'node:crypto';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('content-dedup');

// ─── Constants ────────────────────────────────────────────────────────────────

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SIMILARITY_THRESHOLD = 0.85;   // 85% Jaccard bigram similarity

// ─── Types ───────────────────────────────────────────────────────────────────

interface DedupRecord {
  hash: string;
  bigrams: Set<string>;
  timestamp: number;
}

export interface DedupCheckResult {
  isDuplicate: boolean;
  reason?: 'exact' | 'fuzzy';
  similarity?: number;
}

// ─── ContentDedupGate ─────────────────────────────────────────────────────────
//
// Prevents duplicate/near-duplicate content from being posted to a platform.
// Records are scoped per-platform so the same content can appear on different
// platforms (e.g., Twitter + Telegram).
//
// Matching strategy:
//   1. SHA-256 exact hash — instant O(1) check
//   2. Jaccard bigram fuzzy — catches minor rewrites (>85% overlap)
//
// TTL: records expire after 12 hours (in-memory Map, no Redis dependency).
// Fail-open: any unexpected error logs a warning and allows the post.

export class ContentDedupGate {
  // platform → list of recent dedup records within the 12h window
  private readonly records: Map<string, DedupRecord[]> = new Map();

  /**
   * Check whether `content` is a duplicate of a recently recorded post
   * on the same `platform`. Fail-open on errors.
   */
  check(content: string, platform: string): DedupCheckResult {
    try {
      this.pruneExpired(platform);

      const hash = this.sha256(content);
      const bigrams = this.getBigrams(content);
      const platformRecords = this.records.get(platform) ?? [];

      // 1. Exact match
      for (const record of platformRecords) {
        if (record.hash === hash) {
          return { isDuplicate: true, reason: 'exact' };
        }
      }

      // 2. Fuzzy match (Jaccard bigram)
      for (const record of platformRecords) {
        const similarity = this.jaccardSimilarity(bigrams, record.bigrams);
        if (similarity > SIMILARITY_THRESHOLD) {
          return { isDuplicate: true, reason: 'fuzzy', similarity };
        }
      }

      return { isDuplicate: false };
    } catch (err) {
      logger.warn('ContentDedupGate.check error (fail-open)', { error: err instanceof Error ? err.message : String(err) });
      return { isDuplicate: false };
    }
  }

  /**
   * Record successfully posted content so future calls to `check` can detect
   * duplicates. Call this AFTER a successful outbound action.
   */
  recordOutboundContent(content: string, platform: string): void {
    try {
      const hash = this.sha256(content);
      const bigrams = this.getBigrams(content);
      const record: DedupRecord = { hash, bigrams, timestamp: Date.now() };

      if (!this.records.has(platform)) {
        this.records.set(platform, []);
      }
      this.records.get(platform)!.push(record);
    } catch (err) {
      logger.warn('ContentDedupGate.recordOutboundContent error (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Build a set of character bigrams from normalised text.
   * Normalisation: lowercase + collapse whitespace.
   */
  private getBigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const bigrams = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i++) {
      bigrams.add(normalized.slice(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Jaccard similarity between two bigram sets: |A ∩ B| / |A ∪ B|.
   * Returns 1.0 for two empty sets (both empty → identical).
   */
  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1.0;
    if (a.size === 0 || b.size === 0) return 0.0;

    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) intersection++;
    }

    const union = a.size + b.size - intersection;
    return intersection / union;
  }

  /** Remove expired records for a platform (older than TTL_MS). */
  private pruneExpired(platform: string): void {
    const records = this.records.get(platform);
    if (!records) return;

    const cutoff = Date.now() - TTL_MS;
    const filtered = records.filter(r => r.timestamp > cutoff);
    this.records.set(platform, filtered);
  }
}
