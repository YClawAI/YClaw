'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface RefreshTriggerProps {
  intervalMs?: number;
}

export function RefreshTrigger({ intervalMs = 10_000 }: RefreshTriggerProps) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
