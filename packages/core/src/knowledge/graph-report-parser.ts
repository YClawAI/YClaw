/**
 * Parses GRAPH_REPORT.md and graph.json into structured data.
 *
 * Extracts god nodes, communities, cross-area connections, orphaned nodes,
 * and health metrics. All parsing is defensive — returns empty/default
 * values for missing or malformed data.
 */

import { readFile } from 'node:fs/promises';
import { createLogger } from '../logging/logger.js';
import type { GraphData, GraphSummary, GraphHealthMetrics, GraphNode, GraphCommunity } from './graphify-types.js';

const logger = createLogger('graph-report-parser');

/**
 * Load and parse graph.json from the output directory.
 * Returns null if file doesn't exist or is malformed.
 */
export async function loadGraphData(graphJsonPath: string): Promise<GraphData | null> {
  try {
    const raw = await readFile(graphJsonPath, 'utf8');
    const data = JSON.parse(raw) as GraphData;

    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      logger.warn('graph.json has invalid structure', { path: graphJsonPath });
      return null;
    }

    // Ensure communities array exists
    if (!Array.isArray(data.communities)) {
      data.communities = [];
    }

    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug('graph.json not found', { path: graphJsonPath });
    } else {
      logger.warn('Failed to load graph.json', { path: graphJsonPath, error: msg });
    }
    return null;
  }
}

/**
 * Extract a structured summary from graph data.
 */
export function extractGraphSummary(data: GraphData): GraphSummary {
  const health = computeHealthMetrics(data);
  const godNodes = findGodNodes(data.nodes, 5);
  const largestCommunities = findLargestCommunities(data.communities, 5);
  const orphanedNodes = findOrphanedNodes(data);
  const crossAreaConnections = findCrossAreaConnections(data);

  return {
    godNodes,
    largestCommunities,
    crossAreaConnections,
    orphanedNodes,
    health,
  };
}

/**
 * Compute health metrics from graph data.
 */
export function computeHealthMetrics(data: GraphData): GraphHealthMetrics {
  const nodeCount = data.nodes.length;
  const edgeCount = data.edges.length;
  const communityCount = data.communities.length;

  const connectedNodeIds = new Set<string>();
  for (const edge of data.edges) {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  }
  const orphanedNodes = data.nodes.filter(n => !connectedNodeIds.has(n.id)).length;

  const ambiguousEdges = data.edges.filter(e => e.confidence === 'AMBIGUOUS').length;
  const ambiguousEdgeRatio = edgeCount > 0 ? ambiguousEdges / edgeCount : 0;

  return { nodeCount, edgeCount, communityCount, orphanedNodes, ambiguousEdgeRatio };
}

/**
 * Find god nodes (highest degree centrality).
 */
function findGodNodes(nodes: GraphNode[], limit: number): Array<{ name: string; degree: number }> {
  return [...nodes]
    .filter(n => typeof n.degree === 'number')
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
    .slice(0, limit)
    .map(n => ({ name: n.name, degree: n.degree ?? 0 }));
}

/**
 * Find the largest communities.
 */
function findLargestCommunities(
  communities: GraphCommunity[],
  limit: number,
): Array<{ id: number; size: number; label?: string }> {
  return [...communities]
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .map(c => ({ id: c.id, size: c.size, label: c.label }));
}

/**
 * Find nodes with no edges (orphaned).
 */
function findOrphanedNodes(data: GraphData): string[] {
  const connectedIds = new Set<string>();
  for (const edge of data.edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  return data.nodes
    .filter(n => !connectedIds.has(n.id))
    .map(n => n.name);
}

/**
 * Find cross-area connections (edges between nodes in different vault areas).
 */
function findCrossAreaConnections(
  data: GraphData,
): Array<{ source: string; target: string; areas: string[] }> {
  const nodeMap = new Map<string, GraphNode>();
  for (const node of data.nodes) {
    nodeMap.set(node.id, node);
  }

  const results: Array<{ source: string; target: string; areas: string[]; confidence: string }> = [];

  for (const edge of data.edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceArea = extractVaultArea(sourceNode.source_file);
    const targetArea = extractVaultArea(targetNode.source_file);

    if (sourceArea && targetArea && sourceArea !== targetArea) {
      results.push({
        source: sourceNode.name,
        target: targetNode.name,
        areas: [sourceArea, targetArea],
        confidence: edge.confidence,
      });
    }
  }

  // Limit to 10 most interesting (non-AMBIGUOUS first)
  const confRank: Record<string, number> = { EXTRACTED: 2, INFERRED: 1, AMBIGUOUS: 0 };
  results.sort((a, b) => (confRank[b.confidence] ?? 0) - (confRank[a.confidence] ?? 0));
  return results.slice(0, 10).map(({ source, target, areas }) => ({ source, target, areas }));
}

/**
 * Extract the PARA area from a vault path (e.g., "01-projects" from "vault/01-projects/foo.md").
 */
function extractVaultArea(filePath: string): string | null {
  const match = filePath.match(/(?:^|\/)(0[0-4]-[a-z]+|daily|templates)\//);
  return match?.[1] ?? null;
}

/**
 * Parse GRAPH_REPORT.md for god nodes section.
 * Fallback: extract from graph data directly if report is missing.
 */
export async function parseGraphReport(reportPath: string): Promise<{
  godNodes: string[];
  communities: string[];
  questions: string[];
} | null> {
  try {
    const raw = await readFile(reportPath, 'utf8');
    const godNodes = extractSection(raw, 'God Nodes', 'Hub Nodes');
    const communities = extractSection(raw, 'Communities');
    const questions = extractSection(raw, 'Questions', 'Suggested Questions');

    return { godNodes, communities, questions };
  } catch {
    return null;
  }
}

/**
 * Extract items from a markdown section.
 * Collects both bullet items (- ...) and sub-headings (### ...).
 */
function extractSection(markdown: string, ...headings: string[]): string[] {
  for (const heading of headings) {
    const pattern = new RegExp(`##\\s*${heading}[\\s\\S]*?(?=\\n## [^#]|$)`, 'i');
    const match = markdown.match(pattern);
    if (match) {
      const lines = match[0].split('\n');
      const items: string[] = [];
      for (const line of lines) {
        if (line.match(/^\s*[-*]\s+/)) {
          items.push(line.replace(/^\s*[-*]\s+/, '').trim());
        } else if (line.match(/^###\s+/)) {
          items.push(line.replace(/^###\s+/, '').trim());
        }
      }
      return items.filter(Boolean);
    }
  }
  return [];
}
