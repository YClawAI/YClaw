'use client';

import { useRef, useState, useEffect } from 'react';
import { HiveOverlay } from './hive-overlay';
import { animationManager } from './animation-manager';

/**
 * Client wrapper that:
 * 1. Measures parent container size via ResizeObserver
 * 2. Syncs ambient intensity from AnimationManager via rAF
 * 3. Only re-renders when rounded intensity changes
 */
export function HiveOverlayWrapper() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [intensity, setIntensity] = useState(1);

  // ── Measure parent ──
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Sync intensity via rAF (not setInterval) ──
  useEffect(() => {
    let running = true;
    let prevRounded = 1;

    const sync = () => {
      if (!running) return;
      const rounded = Math.round(animationManager.ambientIntensity * 100) / 100;
      if (rounded !== prevRounded) {
        setIntensity(rounded);
        prevRounded = rounded;
      }
      requestAnimationFrame(sync);
    };

    requestAnimationFrame(sync);
    return () => { running = false; };
  }, []);

  if (size.width === 0 || size.height === 0) {
    return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />;
  }

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
      <HiveOverlay
        width={size.width}
        height={size.height}
        intensity={intensity}
      />
    </div>
  );
}
