import type {
  Particle, BigMoment, HiveEvent, BigMomentType, HiveEventCategory,
} from '@/components/hive/hive-types';
import {
  EVENT_CATEGORY_COLORS, EVENT_CATEGORY_SPEEDS, EVENT_CATEGORY_GLOW,
} from '@/components/hive/hive-types';

const TRAIL_LENGTH = 5;
const MAX_PARTICLES = 100;
const MAX_PARTICLES_MOBILE = 20;
const MAX_BIG_MOMENTS = 10;

interface NodePos { x: number; y: number }

export class ParticleEngine {
  particles: Particle[] = [];
  bigMoments: BigMoment[] = [];
  private nodePositions = new Map<string, NodePos>();
  private idCounter = 0;
  private maxParticles: number;

  constructor(mobile = false) {
    this.maxParticles = mobile ? MAX_PARTICLES_MOBILE : MAX_PARTICLES;
  }

  /** Called every frame to sync live node positions from force graph */
  updateNodePositions(nodes: Array<{ id: string; x?: number; y?: number }>) {
    for (const n of nodes) {
      if (n.x != null && n.y != null) {
        this.nodePositions.set(n.id, { x: n.x, y: n.y });
      }
    }
  }

  /** Spawn particle(s) from a HiveEvent */
  spawnFromEvent(event: HiveEvent) {
    // Prune if over capacity
    while (this.particles.length >= this.maxParticles) {
      const idx = this.particles.findIndex(p => p.alive);
      if (idx >= 0) this.particles[idx]!.alive = false;
      else break;
    }

    if (event.target === '*') {
      // Broadcast: spawn one particle to every agent node (skip dept anchors)
      for (const [nodeId] of this.nodePositions) {
        if (nodeId !== event.source && !nodeId.startsWith('dept:')) {
          this._spawnOne(event, event.source, nodeId);
        }
      }
    } else {
      this._spawnOne(event, event.source, event.target);
    }
  }

  private _spawnOne(event: HiveEvent, sourceId: string, targetId: string) {
    const source = this.nodePositions.get(sourceId);
    const target = this.nodePositions.get(targetId);
    if (!source || !target) return;

    // Quadratic bezier control point: perpendicular offset from midpoint
    const mid = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // Alternate curve direction for visual variety
    const sign = (this.idCounter % 2 === 0) ? 1 : -1;
    // Wider curves for external streams (visually "reaching out")
    const isExternal = sourceId.startsWith('ext:') || targetId.startsWith('ext:');
    const perpOffset = dist * (isExternal ? 0.35 : 0.25) * sign;
    const nx = -dy / dist;
    const ny = dx / dist;
    const cp = { x: mid.x + nx * perpOffset, y: mid.y + ny * perpOffset };

    // Convert px/frame speed to progress/frame
    const speedPx = EVENT_CATEGORY_SPEEDS[event.category] ?? 1.5;
    const progressPerFrame = Math.min(speedPx / dist, 0.05);

    this.particles.push({
      id: `p_${this.idCounter++}`,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      category: event.category,
      color: EVENT_CATEGORY_COLORS[event.category] ?? '#ffffff',
      speed: progressPerFrame,
      progress: 0,
      trail: [],
      glowRadius: EVENT_CATEGORY_GLOW[event.category] ?? 5,
      alive: true,
      p0: { ...source },
      cp,
      p2: { ...target },
    });
  }

  /** Spawn a Big Moment overlay effect */
  spawnBigMoment(type: BigMomentType, originNodeId: string, color: string, duration = 1200) {
    if (this.bigMoments.length >= MAX_BIG_MOMENTS) this.bigMoments.shift();

    const origin = this.nodePositions.get(originNodeId);
    if (!origin) return;

    const targets: Array<{ x: number; y: number }> = [];
    if (type === 'starburst') {
      for (const [id, pos] of this.nodePositions) {
        if (id !== originNodeId && !id.startsWith('dept:')) {
          targets.push({ ...pos });
        }
      }
    }

    this.bigMoments.push({
      type, originX: origin.x, originY: origin.y,
      color, startTime: performance.now(), duration, alive: true,
      targetNodes: targets,
    });
  }

  /**
   * Main draw loop — called from onRenderFramePost every frame.
   * Updates particle positions and renders everything to canvas.
   */
  draw(ctx: CanvasRenderingContext2D, globalScale: number) {
    const now = performance.now();

    // ── Particles ──
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      if (!p.alive) { this.particles.splice(i, 1); continue; }

      p.progress += p.speed;
      if (p.progress >= 1) { this.particles.splice(i, 1); continue; }

      // Quadratic bezier position: P(t) = (1-t)²·p0 + 2(1-t)t·cp + t²·p2
      const t = p.progress;
      const it = 1 - t;
      const x = it * it * p.p0.x + 2 * it * t * p.cp.x + t * t * p.p2.x;
      const y = it * it * p.p0.y + 2 * it * t * p.cp.y + t * t * p.p2.y;

      // Trail management
      p.trail.unshift({ x, y, alpha: 1 });
      if (p.trail.length > TRAIL_LENGTH) p.trail.pop();
      for (let j = 0; j < p.trail.length; j++) {
        p.trail[j]!.alpha = 1 - j / TRAIL_LENGTH;
      }

      // Draw trail segments (dashed for external streams)
      const isExtStream = p.sourceNodeId.startsWith('ext:') || p.targetNodeId.startsWith('ext:');
      if (isExtStream) {
        ctx.setLineDash([3 / globalScale, 3 / globalScale]);
      }
      for (let j = p.trail.length - 1; j >= 1; j--) {
        const seg = p.trail[j]!;
        const prev = p.trail[j - 1]!;
        ctx.beginPath();
        ctx.moveTo(seg.x, seg.y);
        ctx.lineTo(prev.x, prev.y);
        ctx.strokeStyle = this._rgba(p.color, seg.alpha * 0.5);
        ctx.lineWidth = (p.glowRadius * 0.4 * (1 - j / TRAIL_LENGTH)) / globalScale;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      if (isExtStream) {
        ctx.setLineDash([]);
      }

      // Draw particle head with additive glow (no shadowBlur — kills FPS)
      const glowSize = p.glowRadius / globalScale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Outer glow via radial gradient
      const headGlow = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
      headGlow.addColorStop(0, this._rgba(p.color, 0.8));
      headGlow.addColorStop(0.5, this._rgba(p.color, 0.3));
      headGlow.addColorStop(1, this._rgba(p.color, 0));
      ctx.fillStyle = headGlow;
      ctx.beginPath();
      ctx.arc(x, y, glowSize, 0, Math.PI * 2);
      ctx.fill();

      // Bright inner core
      ctx.beginPath();
      ctx.arc(x, y, glowSize * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }

    // ── Big Moments ──
    for (let i = this.bigMoments.length - 1; i >= 0; i--) {
      const bm = this.bigMoments[i]!;
      const elapsed = now - bm.startTime;
      if (elapsed > bm.duration) { this.bigMoments.splice(i, 1); continue; }
      const progress = elapsed / bm.duration;
      this._drawBigMoment(ctx, bm, progress, globalScale);
    }
  }

  private _drawBigMoment(
    ctx: CanvasRenderingContext2D, bm: BigMoment,
    progress: number, globalScale: number
  ) {
    const alpha = 1 - progress;

    switch (bm.type) {
      case 'starburst': {
        if (bm.targetNodes) {
          for (const target of bm.targetNodes) {
            const lineProgress = Math.min(progress * 2, 1);
            const lineAlpha = progress < 0.5 ? 1 : (1 - (progress - 0.5) * 2);
            const ex = bm.originX + (target.x - bm.originX) * lineProgress;
            const ey = bm.originY + (target.y - bm.originY) * lineProgress;
            ctx.beginPath();
            ctx.moveTo(bm.originX, bm.originY);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = this._rgba(bm.color, lineAlpha * 0.7);
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();
          }
        }
        if (progress < 0.3) {
          const flashAlpha = 1 - progress / 0.3;
          const flashRadius = (20 + progress * 60) / globalScale;
          const grad = ctx.createRadialGradient(
            bm.originX, bm.originY, 0, bm.originX, bm.originY, flashRadius
          );
          grad.addColorStop(0, this._rgba('#ffffff', flashAlpha * 0.8));
          grad.addColorStop(0.4, this._rgba(bm.color, flashAlpha * 0.5));
          grad.addColorStop(1, this._rgba(bm.color, 0));
          ctx.beginPath();
          ctx.arc(bm.originX, bm.originY, flashRadius, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }
        break;
      }

      case 'ripple': {
        const maxR = 300 / globalScale;
        const r = maxR * progress;
        ctx.beginPath();
        ctx.arc(bm.originX, bm.originY, r, 0, Math.PI * 2);
        ctx.strokeStyle = this._rgba(bm.color, alpha * 0.6);
        ctx.lineWidth = (3 / globalScale) * (1 - progress);
        ctx.stroke();
        if (progress > 0.15) {
          const innerP = (progress - 0.15) / 0.85;
          ctx.beginPath();
          ctx.arc(bm.originX, bm.originY, maxR * innerP, 0, Math.PI * 2);
          ctx.strokeStyle = this._rgba(bm.color, (1 - innerP) * 0.3);
          ctx.lineWidth = (2 / globalScale) * (1 - innerP);
          ctx.stroke();
        }
        break;
      }

      case 'goldPulse': {
        const maxR = 200 / globalScale;
        const r = maxR * progress;
        const grad = ctx.createRadialGradient(
          bm.originX, bm.originY, r * 0.8, bm.originX, bm.originY, r
        );
        grad.addColorStop(0, this._rgba(bm.color, 0));
        grad.addColorStop(1, this._rgba(bm.color, alpha * 0.4));
        ctx.beginPath();
        ctx.arc(bm.originX, bm.originY, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        break;
      }

      case 'errorFlash': {
        const flashAlpha = alpha * 0.3;
        const r = (80 + progress * 40) / globalScale;
        // Additive glow instead of shadowBlur
        const errGrad = ctx.createRadialGradient(
          bm.originX, bm.originY, 0, bm.originX, bm.originY, r
        );
        errGrad.addColorStop(0, this._rgba(bm.color, flashAlpha));
        errGrad.addColorStop(0.5, this._rgba(bm.color, flashAlpha * 0.4));
        errGrad.addColorStop(1, this._rgba(bm.color, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.arc(bm.originX, bm.originY, r, 0, Math.PI * 2);
        ctx.fillStyle = errGrad;
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'openclawPulse': {
        // Expanding ring + inner flash (red/coral)
        const maxR = 250 / globalScale;
        const r = maxR * progress;

        // Expanding ring
        ctx.beginPath();
        ctx.arc(bm.originX, bm.originY, r, 0, Math.PI * 2);
        ctx.strokeStyle = this._rgba(bm.color, alpha * 0.6);
        ctx.lineWidth = (3 / globalScale) * (1 - progress);
        ctx.stroke();

        // Inner flash (first 40%)
        if (progress < 0.4) {
          const flashP = progress / 0.4;
          const flashR = (15 + flashP * 30) / globalScale;
          const grad = ctx.createRadialGradient(
            bm.originX, bm.originY, 0, bm.originX, bm.originY, flashR
          );
          grad.addColorStop(0, this._rgba('#ffffff', (1 - flashP) * 0.6));
          grad.addColorStop(0.5, this._rgba(bm.color, (1 - flashP) * 0.4));
          grad.addColorStop(1, this._rgba(bm.color, 0));
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath();
          ctx.arc(bm.originX, bm.originY, flashR, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.restore();
        }
        break;
      }
    }
  }

  private _rgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
  }

  destroy() {
    this.particles.length = 0;
    this.bigMoments.length = 0;
    this.nodePositions.clear();
  }
}
