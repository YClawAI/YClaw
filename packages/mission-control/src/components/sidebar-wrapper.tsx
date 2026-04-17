'use client';

import { useSidebarStore } from '@/stores/sidebar-store';
import type { ReactNode } from 'react';

export function SidebarWrapper({ children }: { children: ReactNode }) {
  const collapsed = useSidebarStore((s) => s.collapsed);
  return (
    <aside
      className={`shrink-0 bg-mc-bg border-r border-mc-border overflow-y-auto transition-all duration-mc ease-mc-out ${
        collapsed ? 'w-16' : 'w-[260px]'
      }`}
    >
      {children}
    </aside>
  );
}
