/**
 * Shared types for the graphify knowledge graph integration.
 */

import { z } from 'zod';

// ─── Config Schema ──────────────────────────────────────────────────────────

export const GraphifyConfigSchema = z.object({
  /** Whether the graph integration is enabled. Default: false. */
  enabled: z.boolean().default(false),
  /** Root directory of the vault to index. */
  source_root: z.string().default('vault'),
  /** Output directory for graph artifacts. */
  output_dir: z.string().default('vault/.graphify'),
  /** Directories to exclude from indexing (relative to source_root). */
  exclude: z.array(z.string()).default(['05-inbox', '.obsidian']),
  /** Model for LLM-based entity extraction. */
  model: z.string().default('claude-3-haiku-20240307'),
  /** Max input tokens per graphify run. */
  max_tokens_per_run: z.number().positive().default(80_000),
  /** Use incremental mode (SHA256 cache). */
  incremental: z.boolean().default(true),
  /** Timeout for a single graphify run (ms). */
  timeout_ms: z.number().positive().optional(),
  /** Prompt hint injection config. */
  prompt_hint: z.object({
    enabled: z.boolean().default(false),
  }).default({}),
});

export type GraphifyConfig = z.infer<typeof GraphifyConfigSchema>;

// ─── Librarian Graph Config (top-level in agent YAML) ───────────────────────

export const LibrarianGraphConfigSchema = z.object({
  graph: GraphifyConfigSchema.default({}),
}).optional();

export type LibrarianGraphConfig = z.infer<typeof LibrarianGraphConfigSchema>;

// ─── Graph Data Types ───────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  source_file: string;
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  community?: number;
  degree?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  source_file: string;
}

export interface GraphCommunity {
  id: number;
  nodes: string[];
  label?: string;
  size: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
  metadata?: {
    created_at?: string;
    updated_at?: string;
    files_processed?: number;
    version?: string;
  };
}

export interface GraphHealthMetrics {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  orphanedNodes: number;
  ambiguousEdgeRatio: number;
}

export interface GraphSummary {
  godNodes: Array<{ name: string; degree: number }>;
  largestCommunities: Array<{ id: number; size: number; label?: string }>;
  crossAreaConnections: Array<{ source: string; target: string; areas: string[] }>;
  orphanedNodes: string[];
  health: GraphHealthMetrics;
}

export interface GraphQueryInput {
  query: string;
  confidence?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  limit?: number;
}

export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
  summary: string;
}

// ─── Dedupe Signal Types ────────────────────────────────────────────────────

export type DedupeReason =
  | 'string_similarity'
  | 'embedding_similarity'
  | 'graph_shared_community'
  | 'graph_shared_neighbors';

export interface DedupeCandidate {
  filePath: string;
  confidence: number;
  reasons: DedupeReason[];
}
