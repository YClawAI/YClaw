'use client';

import { useState, useEffect } from 'react';

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

const BREAKPOINTS = {
  phone: 480,
  tablet: 1024,
} as const;

export function useDeviceClass(): DeviceClass {
  const [device, setDevice] = useState<DeviceClass>('desktop');

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < BREAKPOINTS.phone) setDevice('phone');
      else if (w < BREAKPOINTS.tablet) setDevice('tablet');
      else setDevice('desktop');
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return device;
}

export function useWindowSize() {
  const [size, setSize] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    let raf: number;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setSize({ width: window.innerWidth, height: window.innerHeight });
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      cancelAnimationFrame(raf);
    };
  }, []);

  return size;
}
