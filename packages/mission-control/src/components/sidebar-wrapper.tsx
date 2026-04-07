'use client';

import { useSidebarStore } from '@/stores/sidebar-store';
import type { ReactNode } from 'react';

export function SidebarWrapper({ children }: { children: ReactNode }) {
  const collapsed = useSidebarStore((s) => s.collapsed);
  return (
    <aside
      className={`shrink-0 bg-terminal-surface border-r border-terminal-border overflow-y-auto transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-[260px]'
      }`}
    >
      {children}
    </aside>
  );
}
