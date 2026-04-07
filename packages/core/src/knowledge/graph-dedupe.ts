/**
 * Graph-enhanced deduplication.
 *
 * Augments existing similarity-based dedupe with graph signals:
 * - Shared community membership raises duplicate confidence
 * - Shared neighbors raise duplicate confidence
 * - AMBIGUOUS-only links do NOT trigger aggressive merge
 *
 * Graph signals augment existing dedupe — they never replace it.
 */

import { createLogger } from '../logging/logger.js';
import type { GraphData, DedupeCandidate, DedupeReason } from './graphify-types.js';

const logger = createLogger('graph-dedupe');

/** Confidence boost for community match (additive, 0-1 scale). */
const COMMUNITY_BOOST = 0.15;

/** Confidence boost for shared neighbors (additive, 0-1 scale). */
const NEIGHBOR_BOOST = 0.10;

/** Minimum number of non-AMBIGUOUS shared edges to boost. */
const MIN_RELIABLE_SHARED_EDGES = 1;

export interface DedupeInput {
  /** File path of the candidate note. */
  filePath: string;
  /** Base similarity confidence from existing dedupe (0-1). */
  baseConfidence: number;
  /** Reasons from existing dedupe. */
  baseReasons: DedupeReason[];
  /** Entity names extracted from the candidate note. */
  entities: string[];
}

/**
 * Enhance a batch of dedupe candidates with graph signals.
 *
 * For each candidate:
 * 1. Find which graph nodes match the note's entities
 * 2. Check if those nodes share a community with existing cluster nodes
 * 3. Check if those nodes share neighbors with existing cluster nodes
 * 4. Boost confidence (but clamp at 0.95 — never auto-merge)
 *
 * If graph has only AMBIGUOUS links to the candidate, no boost is applied.
 */
export function enhanceDedupeWithGraph(
  candidates: DedupeInput[],
  graph: GraphData,
  existingClusterEntities: string[],
): DedupeCandidate[] {
  // Build lookup structures
  const nodeByName = new Map<string, string>();
  for (const node of graph.nodes) {
    nodeByName.set(node.name.toLowerCase(), node.id);
  }

  const nodeCommunity = new Map<string, number>();
  for (const community of graph.communities) {
    for (const nodeId of community.nodes) {
      nodeCommunity.set(nodeId, community.id);
    }
  }

  // Build adjacency for neighbor lookup
  const adjacency = new Map<string, Set<string>>();
  const edgeConfidence = new Map<string, string>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);

    // Track the best confidence for each edge pair
    const key = [edge.source, edge.target].sort().join(':');
    const existing = edgeConfidence.get(key);
    if (!existing || confidenceRank(edge.confidence) > confidenceRank(existing)) {
      edgeConfidence.set(key, edge.confidence);
    }
  }

  // Resolve existing cluster entity IDs
  const clusterNodeIds = new Set<string>();
  for (const entity of existingClusterEntities) {
    const nodeId = nodeByName.get(entity.toLowerCase());
    if (nodeId) clusterNodeIds.add(nodeId);
  }

  return candidates.map(candidate => {
    const reasons = [...candidate.baseReasons];
    let confidence = candidate.baseConfidence;

    // Resolve candidate entity IDs
    const candidateNodeIds = new Set<string>();
    for (const entity of candidate.entities) {
      const nodeId = nodeByName.get(entity.toLowerCase());
      if (nodeId) candidateNodeIds.add(nodeId);
    }

    if (candidateNodeIds.size === 0) {
      return { filePath: candidate.filePath, confidence, reasons };
    }

    // Check shared communities
    const sharedCommunities = checkSharedCommunities(candidateNodeIds, clusterNodeIds, nodeCommunity);
    if (sharedCommunities) {
      // Only boost if we have reliable (non-AMBIGUOUS) connections
      if (hasReliableConnections(candidateNodeIds, clusterNodeIds, edgeConfidence)) {
        confidence = Math.min(confidence + COMMUNITY_BOOST, 0.95);
        reasons.push('graph_shared_community');
      }
    }

    // Check shared neighbors
    const sharedNeighborCount = countSharedNeighbors(candidateNodeIds, clusterNodeIds, adjacency);
    if (sharedNeighborCount > 0) {
      if (hasReliableNeighborPath(candidateNodeIds, clusterNodeIds, adjacency, edgeConfidence)) {
        confidence = Math.min(confidence + NEIGHBOR_BOOST, 0.95);
        reasons.push('graph_shared_neighbors');
      }
    }

    return { filePath: candidate.filePath, confidence, reasons };
  });
}

function checkSharedCommunities(
  candidateIds: Set<string>,
  clusterIds: Set<string>,
  communityMap: Map<string, number>,
): boolean {
  const candidateCommunities = new Set<number>();
  for (const id of candidateIds) {
    const community = communityMap.get(id);
    if (community !== undefined) candidateCommunities.add(community);
  }

  for (const id of clusterIds) {
    const community = communityMap.get(id);
    if (community !== undefined && candidateCommunities.has(community)) {
      return true;
    }
  }

  return false;
}

function countSharedNeighbors(
  candidateIds: Set<string>,
  clusterIds: Set<string>,
  adjacency: Map<string, Set<string>>,
): number {
  const candidateNeighbors = new Set<string>();
  for (const id of candidateIds) {
    const neighbors = adjacency.get(id);
    if (neighbors) {
      for (const n of neighbors) candidateNeighbors.add(n);
    }
  }

  let count = 0;
  for (const id of clusterIds) {
    if (candidateNeighbors.has(id)) count++;
  }

  return count;
}

function hasReliableConnections(
  candidateIds: Set<string>,
  clusterIds: Set<string>,
  edgeConfidence: Map<string, string>,
): boolean {
  for (const cId of candidateIds) {
    for (const eId of clusterIds) {
      const key = [cId, eId].sort().join(':');
      const conf = edgeConfidence.get(key);
      if (conf && conf !== 'AMBIGUOUS') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if candidate and cluster nodes are connected through shared neighbors
 * via non-AMBIGUOUS edges. Used for the neighbor boost — unlike hasReliableConnections,
 * this checks indirect paths (candidate→neighbor and neighbor→cluster).
 */
function hasReliableNeighborPath(
  candidateIds: Set<string>,
  clusterIds: Set<string>,
  adjacency: Map<string, Set<string>>,
  edgeConfidence: Map<string, string>,
): boolean {
  // Find shared neighbors
  const candidateNeighbors = new Set<string>();
  for (const cId of candidateIds) {
    const neighbors = adjacency.get(cId);
    if (neighbors) {
      for (const n of neighbors) candidateNeighbors.add(n);
    }
  }

  for (const eId of clusterIds) {
    if (!candidateNeighbors.has(eId)) continue;
    // eId is a shared neighbor — check if connections to it are reliable
    for (const cId of candidateIds) {
      const key = [cId, eId].sort().join(':');
      const conf = edgeConfidence.get(key);
      if (conf && conf !== 'AMBIGUOUS') return true;
    }
  }

  return false;
}

function confidenceRank(confidence: string): number {
  switch (confidence) {
    case 'EXTRACTED': return 2;
    case 'INFERRED': return 1;
    case 'AMBIGUOUS': return 0;
    default: return -1;
  }
}
