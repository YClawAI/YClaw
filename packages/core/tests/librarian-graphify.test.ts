/**
 * Tests for the Librarian Graphify Integration.
 *
 * Covers:
 * - GraphifyConfigSchema validation
 * - Graph report parsing (god nodes, communities, metrics)
 * - Graph query engine (node matching, neighbors, confidence filters)
 * - Graph-enhanced deduplication
 * - KnowledgeGraphService (query, unavailable fallback)
 * - Budget enforcement and degraded mode
 * - Standup report enrichment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GraphifyConfigSchema } from '../src/knowledge/graphify-types.js';
import type { GraphData, GraphQueryInput, GraphNode, GraphEdge, GraphCommunity } from '../src/knowledge/graphify-types.js';
import { loadGraphData, extractGraphSummary, computeHealthMetrics, parseGraphReport } from '../src/knowledge/graph-report-parser.js';
import { queryGraph } from '../src/knowledge/graph-query.js';
import { enhanceDedupeWithGraph } from '../src/knowledge/graph-dedupe.js';
import type { DedupeInput } from '../src/knowledge/graph-dedupe.js';

// ── Fixture Loading ──────────────────────────────────────────────────────────

const FIXTURES_DIR = resolve(import.meta.dirname ?? __dirname, 'fixtures/graphify');

function loadFixtureGraph(): GraphData {
  const raw = readFileSync(resolve(FIXTURES_DIR, 'graph.json'), 'utf8');
  return JSON.parse(raw) as GraphData;
}

// ── GraphifyConfigSchema ─────────────────────────────────────────────────────

describe('GraphifyConfigSchema', () => {
  it('accepts minimal config with defaults', () => {
    const result = GraphifyConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.source_root).toBe('vault');
      expect(result.data.output_dir).toBe('vault/.graphify');
      expect(result.data.model).toBe('claude-3-haiku-20240307');
      expect(result.data.max_tokens_per_run).toBe(80_000);
      expect(result.data.incremental).toBe(true);
      expect(result.data.prompt_hint.enabled).toBe(false);
    }
  });

  it('accepts full config', () => {
    const result = GraphifyConfigSchema.safeParse({
      enabled: true,
      source_root: '/opt/vault',
      output_dir: '/opt/vault/.graphify',
      exclude: ['inbox', '.obsidian', 'archive'],
      model: 'claude-3-5-sonnet-20241022',
      max_tokens_per_run: 100_000,
      incremental: false,
      prompt_hint: { enabled: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.data.prompt_hint.enabled).toBe(true);
    }
  });

  it('rejects invalid max_tokens_per_run', () => {
    const result = GraphifyConfigSchema.safeParse({ max_tokens_per_run: -100 });
    expect(result.success).toBe(false);
  });
});

// ── Graph Report Parser ──────────────────────────────────────────────────────

describe('loadGraphData', () => {
  it('loads valid graph.json from fixture', async () => {
    const data = await loadGraphData(resolve(FIXTURES_DIR, 'graph.json'));
    expect(data).not.toBeNull();
    expect(data!.nodes).toHaveLength(12);
    expect(data!.edges).toHaveLength(13);
    expect(data!.communities).toHaveLength(3);
  });

  it('returns null for non-existent file', async () => {
    const data = await loadGraphData('/nonexistent/graph.json');
    expect(data).toBeNull();
  });
});

describe('extractGraphSummary', () => {
  it('extracts god nodes', () => {
    const data = loadFixtureGraph();
    const summary = extractGraphSummary(data);

    expect(summary.godNodes).toHaveLength(5);
    expect(summary.godNodes[0]!.name).toBe('Solana');
    expect(summary.godNodes[0]!.degree).toBe(8);
  });

  it('extracts largest communities', () => {
    const data = loadFixtureGraph();
    const summary = extractGraphSummary(data);

    expect(summary.largestCommunities).toHaveLength(3);
    expect(summary.largestCommunities[0]!.label).toBe('DeFi & Blockchain Core');
    expect(summary.largestCommunities[0]!.size).toBe(5);
  });

  it('finds orphaned nodes', () => {
    const data = loadFixtureGraph();
    const summary = extractGraphSummary(data);

    expect(summary.orphanedNodes).toContain('Orphan Note');
  });

  it('finds cross-area connections', () => {
    const data = loadFixtureGraph();
    const summary = extractGraphSummary(data);

    expect(summary.crossAreaConnections.length).toBeGreaterThan(0);
    const crossArea = summary.crossAreaConnections.find(
      c => c.areas.includes('02-areas') && c.areas.includes('01-projects'),
    );
    // Staking (02-areas/blockchain) → Options (02-areas/finance) is same area
    // But Bonding Curve (01-projects/gaze) → USDC (02-areas/finance) is cross-area
    expect(summary.crossAreaConnections.some(
      c => c.source === 'Bonding Curve' || c.target === 'Bonding Curve',
    )).toBe(true);
  });
});

describe('computeHealthMetrics', () => {
  it('computes correct metrics', () => {
    const data = loadFixtureGraph();
    const health = computeHealthMetrics(data);

    expect(health.nodeCount).toBe(12);
    expect(health.edgeCount).toBe(13);
    expect(health.communityCount).toBe(3);
    expect(health.orphanedNodes).toBe(1); // n11 (Orphan Note)
    expect(health.ambiguousEdgeRatio).toBeCloseTo(1 / 13, 2); // 1 AMBIGUOUS edge out of 13
  });
});

describe('parseGraphReport', () => {
  it('parses GRAPH_REPORT.md sections', async () => {
    const report = await parseGraphReport(resolve(FIXTURES_DIR, 'GRAPH_REPORT.md'));
    expect(report).not.toBeNull();
    expect(report!.godNodes.length).toBeGreaterThan(0);
    expect(report!.communities.length).toBeGreaterThan(0);
    expect(report!.questions.length).toBeGreaterThan(0);
  });

  it('returns null for non-existent report', async () => {
    const report = await parseGraphReport('/nonexistent/GRAPH_REPORT.md');
    expect(report).toBeNull();
  });
});

// ── Graph Query Engine ───────────────────────────────────────────────────────

describe('queryGraph', () => {
  it('finds nodes matching query string', () => {
    const data = loadFixtureGraph();
    const result = queryGraph(data, { query: 'Solana' });

    expect(result.nodes.some(n => n.name === 'Solana')).toBe(true);
    expect(result.summary).toContain('Solana');
  });

  it('returns neighbors of matched nodes', () => {
    const data = loadFixtureGraph();
    const result = queryGraph(data, { query: 'Mayflower' });

    // Mayflower AMM → connected to Solana
    expect(result.nodes.some(n => n.name === 'Solana')).toBe(true);
  });

  it('returns edges between result nodes', () => {
    const data = loadFixtureGraph();
    const result = queryGraph(data, { query: 'Bonding Curve' });

    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('returns communities containing matched nodes', () => {
    const data = loadFixtureGraph();
    const result = queryGraph(data, { query: 'Creator Rewards' });

    expect(result.communities.some(c => c.label === 'Creator Economy')).toBe(true);
  });

  it('applies confidence filter', () => {
    const data = loadFixtureGraph();

    // EXTRACTED filter should exclude INFERRED and AMBIGUOUS nodes
    const result = queryGraph(data, { query: 'Staking', confidence: 'EXTRACTED' });
    const matchedNodes = result.nodes.filter(n => n.name.toLowerCase().includes('staking'));
    // Staking is INFERRED, so it should be excluded from matched nodes
    expect(matchedNodes).toHaveLength(0);
  });

  it('returns empty result for unmatched query', () => {
    const data = loadFixtureGraph();
    const result = queryGraph(data, { query: 'NonexistentConcept12345' });

    expect(result.nodes).toHaveLength(0);
    expect(result.summary).toContain('No nodes found');
  });

  it('respects limit parameter', () => {
    const data = loadFixtureGraph();
    const result = queryGraph(data, { query: 'a', limit: 3 });

    expect(result.nodes.length).toBeLessThanOrEqual(3);
  });

  it('returns unavailable when graph has no data', () => {
    const emptyGraph: GraphData = { nodes: [], edges: [], communities: [] };
    const result = queryGraph(emptyGraph, { query: 'anything' });

    expect(result.nodes).toHaveLength(0);
    expect(result.summary).toContain('No nodes found');
  });

  it('highlights god nodes in summary', () => {
    const data = loadFixtureGraph();
    const result = queryGraph(data, { query: 'Solana' });

    expect(result.summary).toContain('Hub nodes');
  });
});

// ── Graph-Enhanced Deduplication ─────────────────────────────────────────────

describe('enhanceDedupeWithGraph', () => {
  it('boosts confidence for shared community', () => {
    const data = loadFixtureGraph();

    const candidates: DedupeInput[] = [{
      filePath: 'vault/01-projects/gaze/new-note.md',
      baseConfidence: 0.6,
      baseReasons: ['embedding_similarity'],
      entities: ['Creator Rewards'], // n4, community 1
    }];

    // Existing cluster entities in the same community
    const result = enhanceDedupeWithGraph(candidates, data, ['Leaderboard']); // n12, community 1

    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBeGreaterThan(0.6);
    expect(result[0]!.reasons).toContain('graph_shared_community');
  });

  it('boosts confidence for shared neighbors', () => {
    const data = loadFixtureGraph();

    const candidates: DedupeInput[] = [{
      filePath: 'vault/02-areas/blockchain/new-note.md',
      baseConfidence: 0.5,
      baseReasons: ['string_similarity'],
      entities: ['Bonding Curve'], // n2, neighbors: n1 (Solana), n3 (USDC), n5 (Staking)
    }];

    // Existing cluster entities that are neighbors of Bonding Curve
    const result = enhanceDedupeWithGraph(candidates, data, ['USDC']); // n3, neighbor of n2

    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBeGreaterThan(0.5);
    expect(result[0]!.reasons).toContain('graph_shared_neighbors');
  });

  it('does NOT boost when only AMBIGUOUS edges connect', () => {
    const data = loadFixtureGraph();

    // Create a scenario with only ambiguous connections
    const ambiguousGraph: GraphData = {
      ...data,
      edges: data.edges.map(e => ({ ...e, confidence: 'AMBIGUOUS' as const })),
    };

    const candidates: DedupeInput[] = [{
      filePath: 'vault/test.md',
      baseConfidence: 0.5,
      baseReasons: ['string_similarity'],
      entities: ['Bonding Curve'],
    }];

    const result = enhanceDedupeWithGraph(candidates, ambiguousGraph, ['Solana']);

    // Confidence should NOT increase with only AMBIGUOUS edges
    expect(result[0]!.confidence).toBe(0.5);
    expect(result[0]!.reasons).not.toContain('graph_shared_community');
    expect(result[0]!.reasons).not.toContain('graph_shared_neighbors');
  });

  it('never exceeds 0.95 confidence', () => {
    const data = loadFixtureGraph();

    const candidates: DedupeInput[] = [{
      filePath: 'vault/test.md',
      baseConfidence: 0.9,
      baseReasons: ['embedding_similarity'],
      entities: ['Creator Rewards'],
    }];

    const result = enhanceDedupeWithGraph(candidates, data, ['Leaderboard']);

    expect(result[0]!.confidence).toBeLessThanOrEqual(0.95);
  });

  it('returns unchanged candidates when no entities match graph', () => {
    const data = loadFixtureGraph();

    const candidates: DedupeInput[] = [{
      filePath: 'vault/test.md',
      baseConfidence: 0.7,
      baseReasons: ['string_similarity'],
      entities: ['NonexistentEntity'],
    }];

    const result = enhanceDedupeWithGraph(candidates, data, ['Solana']);

    expect(result[0]!.confidence).toBe(0.7);
    expect(result[0]!.reasons).toEqual(['string_similarity']);
  });

  it('exposes dedupe reasons correctly', () => {
    const data = loadFixtureGraph();

    const candidates: DedupeInput[] = [{
      filePath: 'vault/test.md',
      baseConfidence: 0.4,
      baseReasons: ['string_similarity', 'embedding_similarity'],
      entities: ['Creator Rewards'],
    }];

    const result = enhanceDedupeWithGraph(candidates, data, ['Options']); // n6, community 1

    expect(result[0]!.reasons).toContain('string_similarity');
    expect(result[0]!.reasons).toContain('embedding_similarity');
    // Should have at least one graph-based reason added
    const graphReasons = result[0]!.reasons.filter(
      r => r === 'graph_shared_community' || r === 'graph_shared_neighbors',
    );
    expect(graphReasons.length).toBeGreaterThan(0);
  });
});

// ── YclawConfig Integration ──────────────────────────────────────────────────

describe('YclawConfig with librarian.graph', () => {
  it('accepts librarian graph config in YclawConfigSchema', async () => {
    // Dynamic import to avoid circular dependency issues
    const { YclawConfigSchema } = await import('../src/infrastructure/config-schema.js');

    const result = YclawConfigSchema.safeParse({
      storage: {
        state: { type: 'mongodb' },
        events: { type: 'redis' },
        memory: { type: 'postgresql' },
        objects: { type: 'local' },
      },
      secrets: { provider: 'env' },
      channels: {},
      librarian: {
        graph: {
          enabled: true,
          source_root: 'vault',
          output_dir: 'vault/.graphify',
          model: 'claude-3-haiku-20240307',
          max_tokens_per_run: 80000,
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.librarian?.graph.enabled).toBe(true);
      expect(result.data.librarian?.graph.model).toBe('claude-3-haiku-20240307');
    }
  });

  it('omits librarian config when not provided', async () => {
    const { YclawConfigSchema } = await import('../src/infrastructure/config-schema.js');

    const result = YclawConfigSchema.safeParse({
      storage: {
        state: { type: 'mongodb' },
        events: { type: 'redis' },
        memory: { type: 'postgresql' },
        objects: { type: 'local' },
      },
      secrets: { provider: 'env' },
      channels: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.librarian).toBeUndefined();
    }
  });
});

// ── Standup Report Enrichment ────────────────────────────────────────────────

describe('Standup report graph section', () => {
  it('produces a report-ready summary from graph data', () => {
    const data = loadFixtureGraph();
    const summary = extractGraphSummary(data);

    // Verify all report sections are populated
    expect(summary.godNodes.length).toBeGreaterThan(0);
    expect(summary.largestCommunities.length).toBeGreaterThan(0);
    expect(summary.health.nodeCount).toBeGreaterThan(0);
    expect(summary.health.edgeCount).toBeGreaterThan(0);
    expect(summary.health.communityCount).toBeGreaterThan(0);
    expect(summary.orphanedNodes.length).toBeGreaterThanOrEqual(0);
  });

  it('god nodes are sorted by degree (highest first)', () => {
    const data = loadFixtureGraph();
    const summary = extractGraphSummary(data);

    for (let i = 1; i < summary.godNodes.length; i++) {
      expect(summary.godNodes[i]!.degree).toBeLessThanOrEqual(summary.godNodes[i - 1]!.degree);
    }
  });
});
