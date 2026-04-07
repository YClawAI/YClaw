'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createNoise2D } from 'simplex-noise';

// ---------------------------------------------------------------------------
// Ambient Motes — simplex-noise-driven particles on a separate overlay canvas.
// Uses pointer-events:none + mix-blend-mode:screen for non-intrusive layering.
// ---------------------------------------------------------------------------

const MOTE_COUNT = 30;
const BASE_HUE = 240; // desaturated blue-ish

interface Mote {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  hueOffset: number;
}

function createMotes(width: number, height: number): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < MOTE_COUNT; i++) {
    motes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 2 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.4,
      hueOffset: (Math.random() - 0.5) * 20,
    });
  }
  return motes;
}

interface HiveOverlayProps {
  width: number;
  height: number;
  intensity: number; // 0-1, from AnimationManager
}

export function HiveOverlay({ width, height, intensity }: HiveOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motesRef = useRef<Mote[]>([]);
  const rafRef = useRef<number>(0);
  const noise2D = useMemo(() => createNoise2D(), []);

  // Bucket dimensions so motes only recreate on significant resize
  const widthBucket = Math.round(width / 100);
  const heightBucket = Math.round(height / 100);

  useEffect(() => {
    motesRef.current = createMotes(width, height);
  }, [widthBucket, heightBucket, width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;

      // Skip rendering when intensity is negligible
      if (intensity < 0.02) {
        ctx.clearRect(0, 0, width, height);
        rafRef.current = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, width, height);
      const t = Date.now() / 1000;

      // Subtle background hue shift
      const bgHue = BASE_HUE + Math.sin(t * 0.05) * 10;
      ctx.fillStyle = `hsla(${bgHue}, 30%, 4%, ${0.03 * intensity})`;
      ctx.fillRect(0, 0, width, height);

      // Draw motes
      const motes = motesRef.current;
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i]!;

        // Simplex noise drives position offset
        const nx = noise2D(i * 0.1, t * m.speed * 0.1) * 30;
        const ny = noise2D(i * 0.1 + 100, t * m.speed * 0.1) * 30;

        const drawX = m.x + nx;
        const drawY = m.y + ny;

        // Wrap around
        if (drawX < -10) m.x += width + 20;
        if (drawX > width + 10) m.x -= width + 20;
        if (drawY < -10) m.y += height + 20;
        if (drawY > height + 10) m.y -= height + 20;

        // Pulse alpha with noise
        const alphaNoise = noise2D(i * 0.5, t * 0.3);
        const alpha = (0.06 + alphaNoise * 0.04) * intensity;

        const hue = BASE_HUE + m.hueOffset + Math.sin(t * 0.1 + m.phase) * 5;

        // Radial gradient for soft look
        const grad = ctx.createRadialGradient(
          drawX, drawY, 0,
          drawX, drawY, m.size * 2,
        );
        grad.addColorStop(0, `hsla(${hue}, 20%, 70%, ${alpha})`);
        grad.addColorStop(1, `hsla(${hue}, 20%, 70%, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(drawX, drawY, m.size * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [width, height, intensity, noise2D]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        zIndex: 5,
      }}
    />
  );
}
