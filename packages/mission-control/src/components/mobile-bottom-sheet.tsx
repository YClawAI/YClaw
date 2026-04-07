'use client';

import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';

interface BottomSheetProps {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  snapPoints?: number[];
  initialSnap?: number;
}

const DEFAULT_SNAPS = [0, 0.5, 0.92];

export function BottomSheet({
  children,
  isOpen,
  onClose,
  snapPoints = DEFAULT_SNAPS,
  initialSnap = 1,
}: BottomSheetProps) {
  const dragStartY = useRef(0);
  const currentSnapIdx = useRef(initialSnap);
  const [translateY, setTranslateY] = useState(100);
  const [isDragging, setIsDragging] = useState(false);

  const snapTo = useCallback((idx: number) => {
    const snapFraction = snapPoints[idx] ?? 0;
    const percent = (1 - snapFraction) * 100;
    setTranslateY(percent);
    currentSnapIdx.current = idx;
    if (idx === 0) onClose();
  }, [snapPoints, onClose]);

  useEffect(() => {
    if (isOpen) {
      snapTo(initialSnap);
    } else {
      setTranslateY(100);
    }
  }, [isOpen, initialSnap, snapTo]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    dragStartY.current = touch.clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (!touch) return;
    const deltaY = touch.clientY - dragStartY.current;
    const vh = window.innerHeight;
    const snap = snapPoints[currentSnapIdx.current];
    const currentPercent = (1 - (snap ?? 0)) * 100;
    const newPercent = Math.max(0, Math.min(100, currentPercent + (deltaY / vh) * 100));
    setTranslateY(newPercent);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    const currentFraction = 1 - translateY / 100;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < snapPoints.length; i++) {
      const sp = snapPoints[i];
      if (sp == null) continue;
      const dist = Math.abs(currentFraction - sp);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    snapTo(nearestIdx);
  };

  return (
    <>
      {isOpen && translateY < 80 && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => snapTo(0)}
        />
      )}

      <div
        className="fixed inset-x-0 bottom-0 z-50 bg-gray-900 rounded-t-2xl shadow-2xl border-t border-gray-700"
        style={{
          transform: `translateY(${translateY}%)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          height: '92vh',
        }}
      >
        <div
          className="flex justify-center py-3 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        <div className="overflow-y-auto h-full pb-8" style={{ touchAction: 'pan-y' }}>
          {children}
        </div>
      </div>
    </>
  );
}
