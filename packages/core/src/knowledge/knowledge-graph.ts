/**
 * KnowledgeGraphService — orchestrates graphify integration for the Librarian.
 *
 * Provides:
 * - ensureKnowledgeGraph(): run graphify incremental update
 * - getGraphSummary(): extract summary for standup reports
 * - queryGraph(): structural graph queries
 * - enhanceDedupe(): graph-enhanced deduplication
 *
 * All methods are resilient — graph failures never crash the curation pipeline.
 */

import { join } from 'node:path';
import { createLogger } from '../logging/logger.js';
import { runGraphify, isGraphifyAvailable } from './graphify-runner.js';
import { loadGraphData, extractGraphSummary, parseGraphReport } from './graph-report-parser.js';
import { queryGraph } from './graph-query.js';
import { enhanceDedupeWithGraph } from './graph-dedupe.js';
import type {
  GraphifyConfig,
  GraphData,
  GraphSummary,
  GraphQueryInput,
  GraphQueryResult,
  DedupeCandidate,
} from './graphify-types.js';
import type { DedupeInput } from './graph-dedupe.js';

const logger = createLogger('knowledge-graph');

export class KnowledgeGraphService {
  private cachedGraph: GraphData | null = null;
  private lastLoadTime = 0;
  private readonly cacheMaxAge = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly config: GraphifyConfig) {}

  /**
   * Run graphify incremental update against the vault.
   * Called after filing completes in daily cron, and after hygiene in weekly cron.
   *
   * Returns a status object suitable for inclusion in the curation report.
   * Never throws.
   */
  async ensureKnowledgeGraph(): Promise<{
    status: 'success' | 'degraded' | 'failed' | 'skipped';
    summary?: GraphSummary;
    duration?: number;
    error?: string;
  }> {
    if (!this.config.enabled) {
      return { status: 'skipped' };
    }

    // Check if graphify CLI is available
    const available = await isGraphifyAvailable();
    if (!available) {
      logger.warn('graphify CLI not found — skipping graph update');
      return { status: 'failed', error: 'graphify CLI not available' };
    }

    try {
      const result = await runGraphify(this.config);

      // Invalidate cache so next query loads fresh data
      this.cachedGraph = null;
      this.lastLoadTime = 0;

      if (result.status === 'failed') {
        logger.warn('graphify run failed', { error: result.error });
        return { status: 'failed', duration: result.duration, error: result.error };
      }

      // Load the updated graph and extract summary
      const summary = await this.getGraphSummary();

      return {
        status: result.degraded ? 'degraded' : 'success',
        summary: summary ?? undefined,
        duration: result.duration,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('ensureKnowledgeGraph failed unexpectedly', { error: msg });
      return { status: 'failed', error: msg };
    }
  }

  /**
   * Get a structured summary of the current graph state.
   * Used for standup report enrichment.
   */
  async getGraphSummary(): Promise<GraphSummary | null> {
    const graph = await this.loadGraph();
    if (!graph) return null;
    return extractGraphSummary(graph);
  }

  /**
   * Query the knowledge graph.
   * Used by vault:graph_query action.
   */
  async query(input: GraphQueryInput): Promise<GraphQueryResult | { status: 'unavailable' }> {
    const graph = await this.loadGraph();
    if (!graph) return { status: 'unavailable' };
    return queryGraph(graph, input);
  }

  /**
   * Enhance deduplication candidates with graph signals.
   */
  async enhanceDedupe(
    candidates: DedupeInput[],
    existingClusterEntities: string[],
  ): Promise<DedupeCandidate[]> {
    const graph = await this.loadGraph();
    if (!graph) {
      // No graph available — return candidates with unchanged confidence
      return candidates.map(c => ({
        filePath: c.filePath,
        confidence: c.baseConfidence,
        reasons: c.baseReasons,
      }));
    }
    return enhanceDedupeWithGraph(candidates, graph, existingClusterEntities);
  }

  /**
   * Load graph data with in-memory caching.
   */
  private async loadGraph(): Promise<GraphData | null> {
    const now = Date.now();
    if (this.cachedGraph && (now - this.lastLoadTime) < this.cacheMaxAge) {
      return this.cachedGraph;
    }

    const graphPath = join(this.config.output_dir, 'graph.json');
    const data = await loadGraphData(graphPath);
    if (data) {
      this.cachedGraph = data;
      this.lastLoadTime = now;
    }
    return data;
  }
}
