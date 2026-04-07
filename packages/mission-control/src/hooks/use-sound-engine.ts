'use client';

import { useEffect, useMemo } from 'react';
import { SoundEngine } from '@/lib/audio/sound-engine';

export function useSoundEngine() {
  const engine = useMemo(() => new SoundEngine(), []);

  useEffect(() => {
    return () => engine.destroy();
  }, [engine]);

  return engine;
}
