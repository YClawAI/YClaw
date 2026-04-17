'use client';

// ─── Local Types ──────────────────────────────────────────────────────────────

export interface EventMeshNode {
  id: string;
  label: string;
  emoji?: string;
}

export interface EventMeshEdge {
  from: string;
  to: string;
  label?: string;
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface EventMeshProps {
  nodes: EventMeshNode[];
  edges: EventMeshEdge[];
}

export function EventMesh({ nodes, edges }: EventMeshProps) {
  // Layout nodes horizontally
  const nodeWidth = 80;
  const nodeHeight = 44;
  const gap = 60;
  const totalWidth = nodes.length > 0
    ? nodes.length * nodeWidth + (nodes.length - 1) * gap
    : nodeWidth;
  const svgWidth = totalWidth + 40;
  const svgHeight = 100;

  if (nodes.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4 flex items-center justify-center py-8">
        <span className="text-xs text-mc-text-tertiary">No event mesh data</span>
      </div>
    );
  }

  // Compute positions
  const nodePositions = nodes.map((_, i) => ({
    x: 20 + i * (nodeWidth + gap),
    y: (svgHeight - nodeHeight) / 2,
    cx: 20 + i * (nodeWidth + gap) + nodeWidth / 2,
    cy: svgHeight / 2,
  }));

  // Build id-to-index map
  const idToIdx: Record<string, number> = {};
  nodes.forEach((n, i) => { idToIdx[n.id] = i; });

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">Event Flow</h3>
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-mc-text-tertiary/50 font-mono">Static topology — last updated: 2026-03-17</span>
          <span className="text-[10px] text-mc-text-tertiary font-mono">{edges.length} connections</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full"
          style={{ minWidth: `${Math.min(svgWidth, 600)}px` }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="6"
              markerHeight="4"
              refX="5"
              refY="2"
              orient="auto"
            >
              <polygon points="0 0, 6 2, 0 4" fill="rgba(255,255,255,0.30)" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((edge, idx) => {
            const fromIdx = idToIdx[edge.from];
            const toIdx = idToIdx[edge.to];
            if (fromIdx === undefined || toIdx === undefined) return null;

            const fromPos = nodePositions[fromIdx]!;
            const toPos = nodePositions[toIdx]!;
            const x1 = fromPos.x + nodeWidth;
            const x2 = toPos.x;
            const y = svgHeight / 2;

            return (
              <g key={`edge-${idx}`}>
                <line
                  x1={x1}
                  y1={y}
                  x2={x2}
                  y2={y}
                  stroke="#2a2a3a"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
                <circle r="2.5" fill="#64D2FF">
                  <animateMotion
                    dur={`${2 + idx * 0.5}s`}
                    repeatCount="indefinite"
                    path={`M${x1},${y} L${x2},${y}`}
                  />
                </circle>
                <text
                  x={(x1 + x2) / 2}
                  y={y - 10}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.30)"
                  fontSize="7"
                  fontFamily="monospace"
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node, idx) => {
            const pos = nodePositions[idx]!;
            return (
              <g key={node.id}>
                <title>{node.label}</title>
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="4"
                  fill="#111118"
                  stroke="rgba(90,200,250,0.12)"
                  strokeWidth="1"
                />
                {node.emoji && (
                  <text
                    x={pos.cx}
                    y={pos.cy - 5}
                    textAnchor="middle"
                    fontSize="14"
                    dominantBaseline="middle"
                  >
                    {node.emoji}
                  </text>
                )}
                <text
                  x={pos.cx}
                  y={pos.cy + 12}
                  textAnchor="middle"
                  fill="#cdd6f4"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
