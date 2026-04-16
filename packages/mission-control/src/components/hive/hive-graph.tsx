'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AGENTS,
  DEPARTMENTS,
  DEPT_META,
} from '@/lib/agents';
import type { Department } from '@/lib/agents';
import { DEPT_HEX, DEPT_ANCHOR_POS, hexAlpha } from './hive-types';
import type { HiveNode, HiveLink, AgentRealtimeStatus } from './hive-types';
import type { ParticleEngine } from '@/lib/hive/particle-engine';
import { animationManager } from './animation-manager';
import {
  EXTERNAL_SERVICES, OPENCLAW_NODE,
  calculateExternalPositions, getExternalService,
} from '@/lib/hive/external-nodes';
import { paintExternalNode, paintOpenClawNode } from './paint-external';
import { ExternalTooltip } from './external-tooltip';
import type { ExternalActivity } from './external-tooltip';

// Dynamic import — ForceGraph2D requires browser APIs (canvas, etc.)
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => <HiveLoader />,
});

// ---------------------------------------------------------------------------
// Custom d3 force: gentle sinusoidal drift for agent nodes
// ---------------------------------------------------------------------------
function createDriftForce() {
  let nodes: HiveNode[] = [];

  function force(_alpha: number) {
    const t = Date.now() / 1000;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || node.type !== 'agent') continue;
      // Each agent gets a unique frequency and phase for organic motion
      const speed = 0.06 + (i % 5) * 0.012;
      const phase = i * 1.3;
      node.vx = (node.vx ?? 0) + Math.sin(t * speed + phase) * 0.02;
      node.vy = (node.vy ?? 0) + Math.cos(t * speed * 1.1 + phase) * 0.02;
    }
  }

  force.initialize = function (_nodes: HiveNode[]) {
    nodes = _nodes;
  };

  return force;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface AgentActivity {
  activeSessions: number;
  lastRunAt?: string;
  lastStatus?: string;
}

interface HiveGraphProps {
  agentActivity?: Record<string, AgentActivity>;
  particleEngine?: ParticleEngine | null;
  agentStatusRef?: React.MutableRefObject<Map<string, AgentRealtimeStatus>>;
  externalActivityRef?: React.MutableRefObject<Map<string, ExternalActivity>>;
  width?: number;
  height?: number;
  performanceMode?: boolean;
}

/** Mix two hex colors by weight (0 = all hex1, 1 = all hex2) */
function mixColor(hex1: string, hex2: string, weight: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 * (1 - weight) + r2 * weight);
  const g = Math.round(g1 * (1 - weight) + g2 * weight);
  const b = Math.round(b1 * (1 - weight) + b2 * weight);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function HiveGraph({ agentActivity, particleEngine, agentStatusRef, externalActivityRef, width: propWidth, height: propHeight, performanceMode }: HiveGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null); // force-graph imperative API
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<HiveNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const forcesConfigured = useRef(false);
  const router = useRouter();
  const hideTooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Build graph data ───────────────────────────────────────
  const graphData = useMemo(() => {
    const nodes: HiveNode[] = [];
    const links: HiveLink[] = [];

    // Department anchor nodes (invisible, fixed position)
    for (const dept of DEPARTMENTS) {
      const pos = DEPT_ANCHOR_POS[dept];
      nodes.push({
        id: `dept:${dept}`,
        type: 'department',
        department: dept,
        label: DEPT_META[dept].label,
        fx: pos[0],
        fy: pos[1],
      });
    }

    // Agent nodes
    for (const agent of AGENTS) {
      nodes.push({
        id: agent.name,
        type: 'agent',
        department: agent.department,
        label: agent.label,
        emoji: agent.emoji,
        role: agent.role,
        description: agent.description,
      });

      // Invisible link from agent → department anchor (clustering force)
      links.push({
        source: `dept:${agent.department}`,
        target: agent.name,
      });
    }

    // External service nodes (fixed positions on outer ring)
    // Use approximate cluster radius based on dept anchor positions
    const extPositions = calculateExternalPositions(
      0, 0, 200, EXTERNAL_SERVICES, OPENCLAW_NODE
    );

    for (const service of EXTERNAL_SERVICES) {
      const pos = extPositions.get(service.id);
      if (!pos) continue;
      nodes.push({
        id: service.id,
        type: 'external',
        department: 'operations' as Department, // placeholder — externals aren't dept-bound
        label: service.name,
        emoji: service.icon,
        color: service.color,
        category: service.category,
        fx: pos.x,
        fy: pos.y,
      });
    }

    // OpenClaw orchestrator node
    const clawPos = extPositions.get(OPENCLAW_NODE.id);
    if (clawPos) {
      nodes.push({
        id: OPENCLAW_NODE.id,
        type: 'orchestrator',
        department: 'operations' as Department,
        label: OPENCLAW_NODE.name,
        emoji: OPENCLAW_NODE.icon,
        color: OPENCLAW_NODE.color,
        fx: clawPos.x,
        fy: clawPos.y,
      });
    }

    return { nodes, links };
  }, []);

  // ── Responsive sizing ───────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Configure d3 forces ─────────────────────────────────────
  useEffect(() => {
    if (forcesConfigured.current) return;

    const check = setInterval(() => {
      const fg = graphRef.current;
      if (!fg) return;

      clearInterval(check);
      forcesConfigured.current = true;

      // Charge: only agents repel each other
      fg.d3Force('charge')?.strength((node: HiveNode) =>
        node.type === 'agent' ? -20 : 0,
      );

      // Link: pull agents toward their department anchor
      fg.d3Force('link')?.distance(55).strength(0.2);

      // Remove center force — department anchors provide structure
      fg.d3Force('center', null);

      // Add custom drift force for idle animation
      fg.d3Force('drift', createDriftForce());

      // Zoom to fit all nodes after initial settling
      setTimeout(() => fg.zoomToFit(500, 60), 1200);
    }, 100);

    return () => clearInterval(check);
  }, []);

  // ── Background: department zone nebulae ───────────────────────
  const paintDeptZones = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const nodes = graphData.nodes;

      for (let di = 0; di < DEPARTMENTS.length; di++) {
        const dept = DEPARTMENTS[di]!;
        const color = DEPT_HEX[dept];
        const deptAgents = nodes.filter(
          (n) => n.type === 'agent' && n.department === dept,
        );
        if (deptAgents.length === 0) continue;

        // Center of mass
        let cx = 0;
        let cy = 0;
        for (const a of deptAgents) {
          cx += a.x ?? 0;
          cy += a.y ?? 0;
        }
        cx /= deptAgents.length;
        cy /= deptAgents.length;

        // Radius = max agent distance from center + padding
        let maxDist = 0;
        for (const a of deptAgents) {
          const dx = (a.x ?? 0) - cx;
          const dy = (a.y ?? 0) - cy;
          maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
        }

        // Breathing animation (unique phase per department)
        const breathe =
          1 + 0.04 * Math.sin(Date.now() / 3000 + di * 1.05);
        const radius = (maxDist + 55) * breathe;

        // Radial gradient nebula
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, hexAlpha(color, 0.07));
        gradient.addColorStop(0.6, hexAlpha(color, 0.03));
        gradient.addColorStop(1, hexAlpha(color, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Department label (very faint, above the zone)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = hexAlpha(color, 0.18);
        const fontSize = Math.max(10, 13 / globalScale);
        ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
        ctx.fillText(
          DEPT_META[dept].label.toUpperCase(),
          cx,
          cy - radius * 0.65,
        );
      }
    },
    [graphData.nodes],
  );

  // ── Node canvas rendering (routes to agent/external/orchestrator painters) ──
  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as HiveNode;
      if (n.type === 'department') return; // invisible anchor

      const nx = n.x ?? 0;
      const ny = n.y ?? 0;

      // ── External service nodes ──
      if (n.type === 'external') {
        const service = getExternalService(n.id);
        if (!service) return;
        const extAct = externalActivityRef?.current?.get(n.id);
        const isActive = extAct?.lastEventAt
          ? Date.now() - extAct.lastEventAt < 10_000
          : false;
        paintExternalNode(nx, ny, ctx, globalScale, service, isActive, extAct?.count60s ?? 0);
        return;
      }

      // ── OpenClaw orchestrator ──
      if (n.type === 'orchestrator') {
        const extAct = externalActivityRef?.current?.get(n.id);
        const isActive = extAct?.lastEventAt
          ? Date.now() - extAct.lastEventAt < 10_000
          : false;
        paintOpenClawNode(nx, ny, ctx, globalScale, isActive, extAct?.count60s ?? 0);
        return;
      }

      // ── Agent nodes (existing logic) ──
      const x = nx;
      const y = ny;
      const idx = AGENTS.findIndex((a) => a.name === n.id);
      const now = Date.now();

      // Phase 2: state-driven visuals from real-time status
      const status = agentStatusRef?.current?.get(n.id);

      // Size: lerp 12-20 based on execCount5m (0-50 range)
      const baseRadius = status
        ? 12 + Math.min((status.execCount5m / 50) * 8, 8)
        : 14;

      // Pulse frequency
      const pulseHz = !status ? 0.3
        : status.state === 'running' ? 1.5
        : status.state === 'error' ? 3.0
        : status.state === 'paused' ? 0
        : 0.3;
      const breathe = pulseHz === 0
        ? 1
        : 1 + 0.06 * Math.sin(now / 1000 * Math.PI * 2 * pulseHz + (idx >= 0 ? idx : 0) * 1.3);
      const radius = baseRadius * breathe;

      // Is this agent currently active (Phase 1 fallback + Phase 2 state)
      const isActive =
        (agentActivity?.[n.id]?.activeSessions ?? 0) > 0 ||
        status?.state === 'running';
      const isHovered = hoveredNode?.id === n.id;

      // Glow alpha from state
      const glowAlpha = !status ? (isActive ? 0.35 : isHovered ? 0.25 : 0.12)
        : status.state === 'running' ? 0.35
        : status.state === 'error' ? 0.5
        : status.state === 'paused' ? 0.05
        : 0.12;

      // Error shake: offset draw position
      let drawX = x;
      let drawY = y;
      if (status?.state === 'error') {
        drawX += Math.sin(now * 0.03) * 3;
        drawY += Math.cos(now * 0.037) * 3;
      }

      // Success flash (500ms bright pulse after lastSuccessAt)
      const isFlashing = status != null && (now - status.lastSuccessAt) < 500;
      const flashBoost = isFlashing ? 0.3 : 0;

      // Color override for error state
      const color = status?.state === 'error'
        ? mixColor(DEPT_HEX[n.department], '#ef4444', 0.7)
        : DEPT_HEX[n.department];

      // ── Layer 1: Outer glow ──
      const glowR = radius * (isActive ? 2.8 : isHovered ? 2.5 : 2);
      const glow = ctx.createRadialGradient(
        drawX, drawY, radius * 0.3,
        drawX, drawY, glowR,
      );
      glow.addColorStop(0, hexAlpha(color, glowAlpha + flashBoost));
      glow.addColorStop(1, hexAlpha(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(drawX, drawY, glowR, 0, Math.PI * 2);
      ctx.fill();

      // ── Layer 2: Inner orb ──
      const orb = ctx.createRadialGradient(
        drawX - radius * 0.2, drawY - radius * 0.3, 0,
        drawX, drawY, radius,
      );
      const orbAlpha = isActive ? 0.85 : 0.5;
      orb.addColorStop(0, hexAlpha(color, Math.min(1, orbAlpha + 0.15 + flashBoost)));
      orb.addColorStop(0.7, hexAlpha(color, orbAlpha));
      orb.addColorStop(1, hexAlpha(color, orbAlpha * 0.6));
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
      ctx.fill();

      // ── Layer 3: Border ring ──
      ctx.strokeStyle = hexAlpha(color, isActive ? 0.9 : 0.6);
      ctx.lineWidth = (isActive ? 2 : 1.2) / globalScale;
      ctx.stroke();

      // ── Layer 4: Emoji ──
      if (n.emoji) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const emojiSize = Math.max(10, 13 / globalScale);
        ctx.font = `${emojiSize}px serif`;
        ctx.fillText(n.emoji, drawX, drawY + 0.5);
      }

      // ── Layer 5: Label ──
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isHovered ? '#cdd6f4' : hexAlpha('#cdd6f4', 0.8);
      const labelSize = Math.max(7, 9 / globalScale);
      ctx.font = `500 ${labelSize}px "JetBrains Mono", monospace`;
      ctx.fillText(n.label, drawX, drawY + radius + 4 / globalScale);

      // ── Layer 6: Lead badge ──
      if (n.role === 'lead') {
        ctx.fillStyle = hexAlpha(color, 0.45);
        const badgeSize = Math.max(5, 6.5 / globalScale);
        ctx.font = `bold ${badgeSize}px "JetBrains Mono", monospace`;
        ctx.fillText(
          'LEAD',
          drawX,
          drawY + radius + 4 / globalScale + labelSize + 2 / globalScale,
        );
      }
    },
    [agentActivity, hoveredNode, agentStatusRef, externalActivityRef],
  );

  // ── Pointer area for hit detection ──────────────────────────────
  const paintPointerArea = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as HiveNode;
      if (n.type === 'department') return;
      const hitRadius = n.type === 'agent' ? 18 : 12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, hitRadius, 0, Math.PI * 2);
      ctx.fill();
    },
    [],
  );

  // ── Mouse tracking for tooltip position ─────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, []);

  // ── Hover handler ───────────────────────────────────────────
  const handleNodeHover = useCallback((node: any) => {
    const n = node as HiveNode | null;
    // Show tooltip for agents, externals, and orchestrator (not dept anchors)
    const resolved = n && n.type !== 'department' ? n : null;
    if (resolved) {
      clearTimeout(hideTooltipTimer.current);
      setHoveredNode(resolved);
    } else {
      // Delay clearing so mouse can reach the tooltip before it disappears
      hideTooltipTimer.current = setTimeout(() => setHoveredNode(null), 150);
    }
  }, []);

  // ── Click handler — navigate to agent detail page ───────────────────
  const handleNodeClick = useCallback((node: any) => {
    const n = node as HiveNode;
    if (n.type === 'agent') {
      router.push(`/agents/${n.id}`);
    }
  }, [router]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseMove={handleMouseMove}
    >
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={propWidth ?? dimensions.width}
        height={propHeight ?? dimensions.height}
        backgroundColor="#0a0a0f"
        // Custom rendering
        nodeCanvasObject={paintNode}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={paintPointerArea}
        onRenderFramePre={performanceMode ? undefined : paintDeptZones}
        // Links are invisible (only for force clustering)
        linkColor={() => 'rgba(0,0,0,0)'}
        linkWidth={0}
        // Disable default node sizing
        nodeRelSize={0}
        // Interaction
        enableZoomInteraction={true}
        enablePanInteraction={true}
        enableNodeDrag={true}
        // Keep simulation alive for drift animation
        d3AlphaDecay={0}
        d3VelocityDecay={0.5}
        cooldownTicks={Infinity}
        // Handlers
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}
        // Phase 2 particles + Phase 3 bloom pass + animation manager tick
        onRenderFramePost={particleEngine ? (ctx: CanvasRenderingContext2D, globalScale: number) => {
          // Tick animation manager (ambient intensity, queued animations)
          animationManager.tick();

          particleEngine.updateNodePositions(
            graphData.nodes.filter(n => n.x != null)
          );
          particleEngine.draw(ctx, globalScale);

          // Phase 3: Bloom pass — additive compositing over all visible nodes
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const nodes = graphData.nodes;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i]!;
            if (n.type === 'department') continue;
            const bx = n.x ?? 0;
            const by = n.y ?? 0;
            if (bx === 0 && by === 0) continue;

            // Resolve node color (dept hex for agents, custom for externals)
            const nodeColor = (n.type === 'external' || n.type === 'orchestrator')
              ? (n.color ?? '#6b7280')
              : DEPT_HEX[n.department];

            const status = agentStatusRef?.current?.get(n.id);
            const isRunning = n.type === 'agent' && (
              status?.state === 'running' ||
              (agentActivity?.[n.id]?.activeSessions ?? 0) > 0
            );
            const bloomAlpha = isRunning ? 0.12 : 0.04;
            const bloomRadius = isRunning ? 30 : (n.type === 'agent' ? 20 : 15);

            const bloomGrad = ctx.createRadialGradient(
              bx, by, 0, bx, by, bloomRadius / globalScale,
            );
            bloomGrad.addColorStop(0, hexAlpha(nodeColor, bloomAlpha));
            bloomGrad.addColorStop(1, hexAlpha(nodeColor, 0));
            ctx.fillStyle = bloomGrad;
            ctx.beginPath();
            ctx.arc(bx, by, bloomRadius / globalScale, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } : undefined}
      />

      {/* ── Tooltip ─────────────────────────────────────── */}
      {hoveredNode && (
        <div
          className="absolute z-20"
          style={{
            left: Math.min(mousePos.x + 16, dimensions.width - 220),
            top: Math.max(mousePos.y - 10, 8),
          }}
          onMouseEnter={() => clearTimeout(hideTooltipTimer.current)}
          onMouseLeave={() => setHoveredNode(null)}
        >
          {hoveredNode.type === 'agent' ? (
            <HiveTooltip
              node={hoveredNode}
              isActive={
                (agentActivity?.[hoveredNode.id]?.activeSessions ?? 0) > 0
              }
            />
          ) : (hoveredNode.type === 'external' || hoveredNode.type === 'orchestrator') ? (
            (() => {
              const service = getExternalService(hoveredNode.id);
              return service ? (
                <ExternalTooltip
                  service={service}
                  activity={externalActivityRef?.current?.get(hoveredNode.id)}
                />
              ) : null;
            })()
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
function HiveTooltip({
  node,
  isActive,
}: {
  node: HiveNode;
  isActive: boolean;
}) {
  const color = DEPT_HEX[node.department];
  const deptLabel = DEPT_META[node.department].label;

  return (
    <div
      className="bg-mc-bg/95 backdrop-blur-sm border border-mc-border rounded-panel shadow-2xl p-3 min-w-[180px]"
      style={{ borderColor: hexAlpha(color, 0.3) }}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-lg">{node.emoji}</span>
        <div>
          <div className="font-sans text-sm font-medium text-mc-text">
            {node.label}
          </div>
          <div
            className="font-sans text-[10px] uppercase tracking-label"
            style={{ color }}
          >
            {deptLabel}
          </div>
        </div>
      </div>

      {node.role === 'lead' && (
        <span
          className="inline-block px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-label rounded-badge mb-1.5 border"
          style={{
            color,
            backgroundColor: hexAlpha(color, 0.1),
            borderColor: hexAlpha(color, 0.25),
          }}
        >
          Department Lead
        </span>
      )}

      {node.description && (
        <p className="font-sans text-xs text-mc-text-secondary leading-relaxed">
          {node.description}
        </p>
      )}

      <div className="mt-2 pt-2 border-t border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-mc-success animate-mc-pulse shadow-[0_0_6px_currentColor]' : 'bg-mc-text-tertiary'}`}
          />
          <span className="font-sans text-[10px] text-mc-text-secondary">
            {isActive ? 'Active' : 'Idle'}
          </span>
        </div>
        <Link
          href={`/agents/${node.id}`}
          className="font-sans text-[10px] text-mc-accent hover:text-mc-text transition-colors duration-mc ease-mc-out pointer-events-auto"
        >
          View →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading placeholder
// ---------------------------------------------------------------------------
function HiveLoader() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-mc-bg">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 font-sans text-mc-text-secondary text-xs">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-mc-accent animate-mc-pulse shadow-[0_0_6px_currentColor]" />
          Initializing Hive...
        </div>
      </div>
    </div>
  );
}
