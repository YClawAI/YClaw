/**
 * Canvas renderers for external service nodes and OpenClaw orchestrator.
 * Visual style is intentionally distinct from agent nodes:
 * - Smaller (8-10px base vs 12-20px for agents)
 * - Muted when idle, glow only when active
 * - OpenClaw uses hexagonal border (unique shape)
 */

import { hexAlpha } from './hive-types';
import type { ExternalServiceNode } from '@/lib/hive/external-nodes';

/** Paint an external service node (GitHub, Slack, Twitter, etc.) */
export function paintExternalNode(
  x: number,
  y: number,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  service: ExternalServiceNode,
  isActive: boolean,
  activityCount: number,
) {
  const radius = 8 / globalScale;

  // ── Background glow (only when active) ──
  if (isActive) {
    const glowAlpha = Math.min(0.3, 0.05 + activityCount * 0.02);
    const glowRadius = radius * 3;
    const grad = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowRadius);
    grad.addColorStop(0, hexAlpha(service.color, glowAlpha));
    grad.addColorStop(1, hexAlpha(service.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Outer ring ──
  const ringAlpha = isActive ? 0.7 : 0.2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha(service.color, ringAlpha);
  ctx.lineWidth = 1.5 / globalScale;
  ctx.stroke();

  // ── Inner fill ──
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = hexAlpha(service.color, isActive ? 0.15 : 0.05);
  ctx.fill();

  // ── Icon (emoji) ──
  ctx.font = `${Math.max(10, 14 / globalScale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(service.icon, x, y);

  // ── Label ──
  ctx.font = `${Math.max(6, 9 / globalScale)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = hexAlpha('#9ca3af', isActive ? 0.9 : 0.4);
  ctx.textAlign = 'center';
  ctx.fillText(service.name, x, y + radius + 6 / globalScale);
}

/** Paint the OpenClaw orchestrator node — hexagonal border, pulsing glow */
export function paintOpenClawNode(
  x: number,
  y: number,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  isActive: boolean,
  activityCount: number,
) {
  const radius = 10 / globalScale;
  const color = '#ef4444';

  // ── Pulsing glow when active ──
  if (isActive) {
    const now = performance.now();
    const pulseAlpha = 0.15 + 0.1 * Math.sin(now / 800);
    const glowRadius = radius * 4;
    const grad = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowRadius);
    grad.addColorStop(0, hexAlpha(color, pulseAlpha));
    grad.addColorStop(0.6, hexAlpha(color, pulseAlpha * 0.3));
    grad.addColorStop(1, hexAlpha(color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Hexagonal border (distinct from circular agents/externals) ──
  const sides = 6;
  const ringAlpha = isActive ? 0.8 : 0.3;
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = hexAlpha(color, ringAlpha);
  ctx.lineWidth = 2 / globalScale;
  ctx.stroke();
  ctx.fillStyle = hexAlpha(color, isActive ? 0.1 : 0.03);
  ctx.fill();

  // ── Icon ──
  ctx.font = `${Math.max(12, 16 / globalScale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🦞', x, y);

  // ── Label ──
  ctx.font = `bold ${Math.max(7, 10 / globalScale)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = hexAlpha('#f87171', isActive ? 0.9 : 0.5);
  ctx.textAlign = 'center';
  ctx.fillText('OpenClaw', x, y + radius + 8 / globalScale);

  // ── Activity count badge ──
  if (activityCount > 0) {
    const badgeX = x + radius * 0.8;
    const badgeY = y - radius * 0.8;
    const badgeR = 4 / globalScale;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = `bold ${Math.max(4, 6 / globalScale)}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(activityCount), badgeX, badgeY);
  }
}
