import type { Db, Collection } from 'mongodb';
import { loadAgentConfig, loadAllAgentConfigs } from '../config/loader.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('memory-index');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  source: string;       // collection name: agent_memory | executions | reviews
  agent: string;
  snippet: string;
  score: number;
  timestamp: string;
}

export interface SearchOptions {
  limit?: number;            // default 10
  collections?: string[];    // default: all 3
  timeWindowHours?: number;  // optional recency filter
}

// ─── MemoryIndex ────────────────────────────────────────────────────────────

export class MemoryIndex {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    // Text indexes — safe fields only (one compound text index per collection)
    // EXCLUDE value/details/content fields that may contain secrets or PII

    const agentMemory = this.db.collection('agent_memory');
    const executions = this.db.collection('executions');
    const reviews = this.db.collection('reviews');

    await Promise.all([
      // agent_memory: only index the key, NOT the value
      agentMemory.createIndex(
        { key: 'text' },
        { name: 'memory_text_search', weights: { key: 1 } },
      ),
      // executions: task metadata only, NOT action details or tool args
      executions.createIndex(
        { task: 'text', agent: 'text', status: 'text' },
        { name: 'executions_text_search', weights: { task: 3, agent: 1, status: 1 } },
      ),
      // reviews: content type and agent only, NOT request.content (may contain PII)
      reviews.createIndex(
        { 'request.contentType': 'text', 'request.agent': 'text' },
        { name: 'reviews_text_search', weights: { 'request.contentType': 2, 'request.agent': 1 } },
      ),
      // Timestamp index for reviews (executions + agent_memory already have them)
      reviews.createIndex({ storedAt: -1 }),
    ]);

    logger.info('Memory search indexes initialized');
  }

  async search(
    query: string,
    agentName: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const { limit = 10, collections, timeWindowHours } = options;

    // Resolve agent's department for scope enforcement
    const agentFilter = await this.buildAgentFilter(agentName);

    const targetCollections = collections || ['agent_memory', 'executions', 'reviews'];
    const results: SearchResult[] = [];

    const searchPromises = targetCollections.map(async (collName) => {
      try {
        const coll = this.db.collection(collName);
        const filter: Record<string, unknown> = { $text: { $search: query } };

        // Scope enforcement: limit to permitted agents
        if (agentFilter) {
          const agentField = collName === 'reviews' ? 'request.agent' : 'agent';
          filter[agentField] = { $in: agentFilter };
        }

        // Time window filter
        if (timeWindowHours) {
          const cutoff = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000).toISOString();
          const timeField = collName === 'agent_memory' ? 'updatedAt'
            : collName === 'executions' ? 'startedAt'
            : 'storedAt';
          filter[timeField] = { $gte: cutoff };
        }

        const docs = await coll
          .find(filter, { projection: { score: { $meta: 'textScore' } } })
          .sort({ score: { $meta: 'textScore' } })
          .limit(Math.ceil(limit / targetCollections.length))
          .toArray();

        for (const doc of docs) {
          results.push({
            source: collName,
            agent: this.extractAgent(collName, doc),
            snippet: this.redactSnippet(this.extractSnippet(collName, doc)),
            score: (doc as Record<string, unknown>).score as number,
            timestamp: this.extractTimestamp(collName, doc),
          });
        }
      } catch (err) {
        logger.warn(`Search failed on collection ${collName}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await Promise.all(searchPromises);

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // ─── Scope Enforcement ────────────────────────────────────────────────────

  /**
   * Build an agent filter array based on the requesting agent's department.
   * Executive department → null (no filter, search all).
   * Other departments → [self + department peers].
   */
  private async buildAgentFilter(agentName: string): Promise<string[] | null> {
    try {
      const config = loadAgentConfig(agentName);
      if (config.department === 'executive') {
        return null; // executives search everything
      }

      // Find all agents in the same department
      const allConfigs = loadAllAgentConfigs();
      const peers: string[] = [];
      for (const [name, cfg] of allConfigs) {
        if (cfg.department === config.department) {
          peers.push(name);
        }
      }
      // Ensure self is included
      if (!peers.includes(agentName)) {
        peers.push(agentName);
      }
      return peers;
    } catch {
      // If config loading fails, restrict to self only
      return [agentName];
    }
  }

  // ─── Redaction ────────────────────────────────────────────────────────────

  /** Strip patterns that look like secrets before returning snippets to agents. */
  private redactSnippet(text: string): string {
    return text
      .replace(/\b(sk-|xoxb-|ghp_|AKIA)[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
      .replace(/mongodb(\+srv)?:\/\/[^\s]+/g, '[REDACTED_URI]');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private extractAgent(collection: string, doc: Record<string, unknown>): string {
    if (collection === 'reviews') {
      const request = doc.request as Record<string, unknown> | undefined;
      return (request?.agent as string) || 'unknown';
    }
    return (doc.agent as string) || 'unknown';
  }

  private extractSnippet(collection: string, doc: Record<string, unknown>): string {
    switch (collection) {
      case 'agent_memory':
        return `${doc.key as string}`;
      case 'executions':
        return `${doc.task as string} — ${doc.status as string}`;
      case 'reviews': {
        const request = doc.request as Record<string, unknown> | undefined;
        return `${request?.contentType as string || 'review'} by ${request?.agent as string || 'unknown'}`;
      }
      default:
        return 'unknown';
    }
  }

  private extractTimestamp(collection: string, doc: Record<string, unknown>): string {
    switch (collection) {
      case 'agent_memory':
        return doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : String(doc.updatedAt || '');
      case 'executions':
        return (doc.startedAt as string) || '';
      case 'reviews':
        return (doc.storedAt as string) || '';
      default:
        return '';
    }
  }
}

// ─── Null Implementation ────────────────────────────────────────────────────

/**
 * Drop-in replacement for MemoryIndex when MongoDB is unavailable.
 * Returns empty results, never throws, never blocks startup.
 */
export class NullMemoryIndex {
  async initialize(): Promise<void> { /* no-op */ }
  async search(_query?: string, _agentName?: string, _options?: SearchOptions): Promise<SearchResult[]> { return []; }
}

export type MemoryIndexLike = MemoryIndex | NullMemoryIndex;
