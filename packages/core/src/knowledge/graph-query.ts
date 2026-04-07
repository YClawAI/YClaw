/**
 * Graph query engine.
 *
 * Queries the persistent graph.json for structural relationships.
 * Supports node name matching, neighbor traversal, community lookup,
 * and confidence filtering.
 */

import { createLogger } from '../logging/logger.js';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  GraphCommunity,
  GraphQueryInput,
  GraphQueryResult,
} from './graphify-types.js';

const logger = createLogger('graph-query');

const DEFAULT_LIMIT = 20;

/**
 * Query the knowledge graph.
 *
 * Strategy:
 * 1. Find nodes matching the query string (case-insensitive substring)
 * 2. Expand to neighbors (1-hop)
 * 3. Include edges between matched nodes
 * 4. Include communities containing matched nodes
 * 5. Apply confidence filter if specified
 * 6. Apply limit
 */
export function queryGraph(
  data: GraphData,
  input: GraphQueryInput,
): GraphQueryResult {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const queryLower = input.query.toLowerCase();

  // Step 1: Find matching nodes
  let matchedNodes = data.nodes.filter(
    n => n.name.toLowerCase().includes(queryLower) ||
         n.type.toLowerCase().includes(queryLower),
  );

  // Apply confidence filter
  if (input.confidence) {
    const confidenceOrder: Record<string, number> = { EXTRACTED: 2, INFERRED: 1, AMBIGUOUS: 0 };
    const minConfidence = confidenceOrder[input.confidence] ?? 0;
    matchedNodes = matchedNodes.filter(
      n => (confidenceOrder[n.confidence] ?? 0) >= minConfidence,
    );
  }

  // Step 2: Expand to 1-hop neighbors
  const matchedIds = new Set(matchedNodes.map(n => n.id));
  const neighborIds = new Set<string>();

  for (const edge of data.edges) {
    if (matchedIds.has(edge.source)) neighborIds.add(edge.target);
    if (matchedIds.has(edge.target)) neighborIds.add(edge.source);
  }

  // Add neighbor nodes (not already in matched set), applying confidence filter
  let neighborNodes = data.nodes.filter(
    n => neighborIds.has(n.id) && !matchedIds.has(n.id),
  );

  if (input.confidence) {
    const confidenceOrder: Record<string, number> = { EXTRACTED: 2, INFERRED: 1, AMBIGUOUS: 0 };
    const minConfidence = confidenceOrder[input.confidence] ?? 0;
    neighborNodes = neighborNodes.filter(
      n => (confidenceOrder[n.confidence] ?? 0) >= minConfidence,
    );
  }

  const resultNodes = [...matchedNodes, ...neighborNodes].slice(0, limit);
  const resultNodeIds = new Set(resultNodes.map(n => n.id));

  // Step 3: Find edges between result nodes
  let resultEdges = data.edges.filter(
    e => resultNodeIds.has(e.source) && resultNodeIds.has(e.target),
  );

  // Apply confidence filter to edges
  if (input.confidence) {
    const confidenceOrder: Record<string, number> = { EXTRACTED: 2, INFERRED: 1, AMBIGUOUS: 0 };
    const minConfidence = confidenceOrder[input.confidence] ?? 0;
    resultEdges = resultEdges.filter(
      e => (confidenceOrder[e.confidence] ?? 0) >= minConfidence,
    );
  }

  // Step 4: Find communities containing matched nodes
  const resultCommunities = data.communities.filter(
    c => c.nodes.some(nId => matchedIds.has(nId)),
  );

  // Step 5: Build summary
  const summary = buildQuerySummary(matchedNodes, resultEdges, resultCommunities, input.query);

  logger.debug('Graph query completed', {
    query: input.query,
    matchedNodes: matchedNodes.length,
    totalNodes: resultNodes.length,
    edges: resultEdges.length,
    communities: resultCommunities.length,
  });

  return {
    nodes: resultNodes,
    edges: resultEdges,
    communities: resultCommunities,
    summary,
  };
}

function buildQuerySummary(
  matchedNodes: GraphNode[],
  edges: GraphEdge[],
  communities: GraphCommunity[],
  query: string,
): string {
  if (matchedNodes.length === 0) {
    return `No nodes found matching "${query}".`;
  }

  const parts: string[] = [];
  parts.push(`Found ${matchedNodes.length} node(s) matching "${query}".`);

  if (edges.length > 0) {
    parts.push(`${edges.length} relationship(s) between matched nodes.`);
  }

  if (communities.length > 0) {
    const labels = communities
      .map(c => c.label ?? `Community #${c.id}`)
      .join(', ');
    parts.push(`Nodes belong to: ${labels}.`);
  }

  // Highlight any god nodes (high degree)
  const godNodes = matchedNodes.filter(n => (n.degree ?? 0) >= 5);
  if (godNodes.length > 0) {
    const names = godNodes.map(n => n.name).join(', ');
    parts.push(`Hub nodes: ${names}.`);
  }

  return parts.join(' ');
}
