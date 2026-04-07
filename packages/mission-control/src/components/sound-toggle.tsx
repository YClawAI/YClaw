'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { SoundEngine } from '@/lib/audio/sound-engine';

interface SoundToggleProps {
  soundEngine: SoundEngine;
}

export function SoundToggle({ soundEngine }: SoundToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [showSlider, setShowSlider] = useState(false);
  const [volume, setVolume] = useState(70);
  const sliderRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    if (enabled) {
      soundEngine.disable();
      setEnabled(false);
    } else {
      soundEngine.enable();
      setEnabled(true);
    }
  }, [enabled, soundEngine]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value);
    setVolume(vol);
    soundEngine.setMasterVolume(vol / 100);
  }, [soundEngine]);

  // Close slider on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (sliderRef.current && !sliderRef.current.contains(e.target as Node)) {
        setShowSlider(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Page visibility
  useEffect(() => {
    const handler = () => soundEngine.handleVisibilityChange(document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [soundEngine]);

  return (
    <div className="relative" ref={sliderRef}>
      <button
        onClick={toggle}
        onContextMenu={(e) => { e.preventDefault(); setShowSlider(!showSlider); }}
        className={`p-2 rounded-lg transition-colors ${
          enabled
            ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
        }`}
        title={enabled ? 'Mute (right-click for volume)' : 'Enable sound'}
      >
        {enabled ? '\u{1F50A}' : '\u{1F507}'}
      </button>

      {showSlider && (
        <div className="absolute top-full right-0 mt-1 p-3 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-20">
          <div className="flex items-center gap-2 min-w-[140px]">
            <span className="text-xs text-gray-400">{'\u{1F508}'}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeChange}
              className="flex-1 h-1 accent-blue-500"
            />
            <span className="text-xs text-gray-400 w-8 text-right">{volume}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
