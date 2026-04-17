'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AHCommit } from '@/lib/agenthub-api';
import { getAgentHubDiff } from '@/lib/actions/agenthub-actions';
import { DiffViewer } from './DiffViewer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExplorationDAGProps {
  commits: AHCommit[];
  leaves: AHCommit[];
  selectedHash?: string;
  onSelectCommit: (hash: string) => void;
}

type CommitNodeData = {
  label: string;
  agent: string;
  hash: string;
  message: string;
  createdAt: string;
  isLeaf: boolean;
  isWinner: boolean;
  isSelected: boolean;
};

// ─── Agent Colors ─────────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'worker-1': { bg: 'bg-blue-500/20', border: 'border-blue-500/60', text: 'text-blue-400' },
  'worker-2': { bg: 'bg-emerald-500/20', border: 'border-emerald-500/60', text: 'text-emerald-400' },
  'worker-3': { bg: 'bg-purple-500/20', border: 'border-purple-500/60', text: 'text-purple-400' },
  builder: { bg: 'bg-mc-info/20', border: 'border-mc-info/60', text: 'text-mc-info' },
  architect: { bg: 'bg-mc-accent/20', border: 'border-mc-accent/60', text: 'text-mc-accent' },
  designer: { bg: 'bg-mc-blocked/20', border: 'border-mc-blocked/60', text: 'text-mc-blocked' },
  deployer: { bg: 'bg-mc-success/20', border: 'border-mc-success/60', text: 'text-mc-success' },
};

const DEFAULT_COLOR = { bg: 'bg-mc-border/30', border: 'border-mc-border', text: 'text-mc-text-tertiary' };

// ─── Custom Node ─────────────────────────────────────────────────────────────────

function CommitNode({ data }: NodeProps<Node<CommitNodeData>>) {
  const color = AGENT_COLORS[data.agent] ?? DEFAULT_COLOR;
  const winnerRing = data.isWinner ? 'ring-2 ring-yellow-400/60' : '';
  // Pre-flip used terminal-purple for the "selected" ring + terminal-cyan for
  // the "architect" agent-role color; mechanical flip collapsed both to
  // mc-accent. Route the selected-ring purple -> mc-dept-finance so selection
  // state stays visually distinct from the architect agent tint.
  const selectedRing = data.isSelected ? 'ring-2 ring-mc-dept-finance' : '';
  const leafPulse = data.isLeaf && !data.isWinner ? 'animate-pulse' : '';

  return (
    <div
      className={`px-3 py-2 rounded border ${color.bg} ${color.border} ${winnerRing} ${selectedRing} ${leafPulse} cursor-pointer min-w-[140px] max-w-[200px]`}
    >
      <Handle type="target" position={Position.Left} className="!bg-mc-text-tertiary !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5 mb-1">
        {data.isWinner && <span className="text-yellow-400 text-[10px]">*</span>}
        <span className={`text-[10px] font-mono font-bold ${color.text}`}>{data.agent}</span>
      </div>
      <div className="text-[10px] font-mono text-mc-text-tertiary truncate" title={data.hash}>
        {data.hash.slice(0, 8)}
      </div>
      <div className="text-[10px] text-mc-text truncate mt-0.5" title={data.message}>
        {data.message.split('\n')[0]?.slice(0, 40)}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-mc-text-tertiary !w-1.5 !h-1.5" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  commit: CommitNode,
};

// ─── Layout Engine ─────────────────────────────────────────────────────────────────

function computeLayout(commits: AHCommit[]): { nodes: Node<CommitNodeData>[]; edges: Edge[] } {
  if (commits.length === 0) return { nodes: [], edges: [] };

  // Build parent-to-children map
  const childrenMap = new Map<string, string[]>();
  const commitMap = new Map<string, AHCommit>();
  for (const c of commits) {
    commitMap.set(c.hash, c);
    if (c.parent_hash) {
      const existing = childrenMap.get(c.parent_hash) ?? [];
      existing.push(c.hash);
      childrenMap.set(c.parent_hash, existing);
    }
  }

  // Find roots (commits whose parent isn't in the set)
  const hashSet = new Set(commits.map(c => c.hash));
  const roots = commits.filter(c => !c.parent_hash || !hashSet.has(c.parent_hash));

  // BFS to assign layers
  const layerMap = new Map<string, number>();
  const queue: { hash: string; layer: number }[] = roots.map(r => ({ hash: r.hash, layer: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.hash)) continue;
    visited.add(item.hash);
    layerMap.set(item.hash, item.layer);
    const children = childrenMap.get(item.hash) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        queue.push({ hash: child, layer: item.layer + 1 });
      }
    }
  }

  // Also include commits not reachable from roots
  for (const c of commits) {
    if (!layerMap.has(c.hash)) {
      layerMap.set(c.hash, 0);
    }
  }

  // Group by layer and assign vertical positions
  const layers = new Map<number, string[]>();
  for (const [hash, layer] of layerMap) {
    const existing = layers.get(layer) ?? [];
    existing.push(hash);
    layers.set(layer, existing);
  }

  const NODE_HEIGHT = 80;
  const LAYER_GAP = 260;
  const NODE_GAP = 90;

  const nodes: Node<CommitNodeData>[] = [];
  const edges: Edge[] = [];

  for (const [layer, hashes] of layers) {
    const totalHeight = hashes.length * NODE_HEIGHT + (hashes.length - 1) * NODE_GAP;
    const startY = -totalHeight / 2;

    hashes.forEach((hash, idx) => {
      const commit = commitMap.get(hash);
      if (!commit) return;

      const isWinner = commit.message.toLowerCase().includes('promoted') ||
                       commit.message.toLowerCase().includes('winner');

      nodes.push({
        id: hash,
        type: 'commit',
        position: { x: layer * LAYER_GAP, y: startY + idx * (NODE_HEIGHT + NODE_GAP) },
        data: {
          label: hash.slice(0, 8),
          agent: commit.agent_id,
          hash: commit.hash,
          message: commit.message,
          createdAt: commit.created_at,
          isLeaf: !(childrenMap.get(hash)?.length),
          isWinner,
          isSelected: false,
        },
      });

      // Edge to parent
      if (commit.parent_hash && hashSet.has(commit.parent_hash)) {
        edges.push({
          id: `${commit.parent_hash}-${hash}`,
          source: commit.parent_hash,
          target: hash,
          style: { stroke: 'rgba(255,255,255,0.30)', strokeWidth: 1.5 },
          animated: isWinner,
        });
      }
    });
  }

  return { nodes, edges };
}

// ─── Commit Detail Panel ──────────────────────────────────────────────────────────

function CommitDetailPanel({
  commit,
  onClose,
  onViewDiff,
  diffLoading,
}: {
  commit: AHCommit;
  onClose: () => void;
  onViewDiff: (parentHash: string) => void;
  diffLoading: boolean;
}) {
  const color = AGENT_COLORS[commit.agent_id] ?? DEFAULT_COLOR;
  const relTime = formatRelativeTime(commit.created_at);

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono font-bold ${color.text}`}>{commit.agent_id}</span>
          <span className="text-[10px] font-mono text-mc-text-tertiary">{commit.hash.slice(0, 12)}</span>
        </div>
        <button onClick={onClose} className="text-mc-text-tertiary hover:text-mc-text text-sm">&times;</button>
      </div>
      <div className="text-xs text-mc-text">{commit.message}</div>
      <div className="text-[10px] text-mc-text-tertiary">{relTime}</div>
      {commit.parent_hash && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-mc-text-tertiary">
            Parent: <span className="font-mono">{commit.parent_hash.slice(0, 12)}</span>
          </span>
          <button
            onClick={() => onViewDiff(commit.parent_hash)}
            disabled={diffLoading}
            className="text-[10px] font-mono text-mc-info hover:text-mc-info/80 transition-colors disabled:opacity-50"
          >
            {diffLoading ? 'Loading diff...' : 'View diff from parent'}
          </button>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '--';
  const diff = Date.now() - ts;
  if (diff < 0 || diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Main Component ─────────────────────────────────────────────────────────────────

export function ExplorationDAG({ commits, leaves, selectedHash, onSelectCommit }: ExplorationDAGProps) {
  const [detailCommit, setDetailCommit] = useState<AHCommit | null>(null);
  const [diffData, setDiffData] = useState<{ hashA: string; hashB: string; diff: string } | null>(null);
  const [isDiffPending, startDiffTransition] = useTransition();

  const leafHashes = useMemo(() => new Set(leaves.map(l => l.hash)), [leaves]);

  const { nodes, edges } = useMemo(() => {
    const layout = computeLayout(commits);
    return {
      nodes: layout.nodes.map(n => ({
        ...n,
        data: {
          ...n.data,
          isSelected: n.id === selectedHash,
          isLeaf: leafHashes.has(n.id) || n.data.isLeaf,
        },
      })),
      edges: layout.edges,
    };
  }, [commits, selectedHash, leafHashes]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    onSelectCommit(node.id);
    const commit = commits.find(c => c.hash === node.id);
    if (commit) {
      setDetailCommit(commit);
      setDiffData(null);
    }
  }, [commits, onSelectCommit]);

  const handleViewDiff = useCallback((parentHash: string) => {
    if (!detailCommit) return;
    startDiffTransition(async () => {
      const diff = await getAgentHubDiff(parentHash, detailCommit.hash);
      setDiffData({ hashA: parentHash, hashB: detailCommit.hash, diff });
    });
  }, [detailCommit]);

  if (commits.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 text-center">
        <span className="text-2xl text-mc-text-tertiary/40">&#9671;</span>
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">Exploration DAG</div>
        <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
          No AgentHub commit data available. The DAG will populate when Builder workers push exploration branches.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-mc-surface-hover border border-mc-border rounded" style={{ height: 400 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          style={{ background: '#0a0a0f' }}
        >
          <Background color="rgba(90,200,250,0.12)" gap={20} />
          <Controls
            showInteractive={false}
            className="!bg-mc-surface-hover !border-mc-border !shadow-none [&>button]:!bg-mc-surface-hover [&>button]:!border-mc-border [&>button]:!text-mc-text-tertiary [&>button:hover]:!bg-mc-border"
          />
        </ReactFlow>
      </div>

      {/* Commit Detail Panel */}
      {detailCommit && (
        <CommitDetailPanel
          commit={detailCommit}
          onClose={() => { setDetailCommit(null); setDiffData(null); }}
          onViewDiff={handleViewDiff}
          diffLoading={isDiffPending}
        />
      )}

      {/* Diff Viewer (F8: wired on demand) */}
      {diffData && diffData.diff && (
        <DiffViewer hashA={diffData.hashA} hashB={diffData.hashB} diff={diffData.diff} />
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-mc-text-tertiary">
        <span>Agents:</span>
        {Object.entries(AGENT_COLORS).slice(0, 5).map(([agent, color]) => (
          <span key={agent} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-sm ${color.bg} border ${color.border}`} />
            <span>{agent}</span>
          </span>
        ))}
        <span className="flex items-center gap-1 ml-2">
          <span className="w-2 h-2 rounded-sm bg-yellow-400/20 border border-yellow-400/60" />
          <span>winner</span>
        </span>
      </div>
    </div>
  );
}
