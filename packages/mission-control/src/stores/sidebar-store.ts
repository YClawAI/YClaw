import { create } from 'zustand';

interface SidebarStore {
  collapsed: boolean;
  expandedDepts: Record<string, boolean>;
  hydrated: boolean;
  hydrate: () => void;
  toggleCollapsed: () => void;
  toggleDept: (dept: string) => void;
  setExpandedDepts: (depts: Record<string, boolean>) => void;
}

function persistExpanded(depts: Record<string, boolean>) {
  try {
    localStorage.setItem('mc:sidebar:expanded', JSON.stringify(depts));
  } catch { /* noop */ }
}

function persistCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem('mc:sidebar:collapsed', String(collapsed));
  } catch { /* noop */ }
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  collapsed: false,
  expandedDepts: {},
  hydrated: false,
  hydrate: () => {
    if (typeof window === 'undefined') return;
    try {
      const collapsed = localStorage.getItem('mc:sidebar:collapsed') === 'true';
      const raw = localStorage.getItem('mc:sidebar:expanded');
      const expandedDepts = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      set({ collapsed, expandedDepts, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  toggleCollapsed: () =>
    set((s) => {
      const next = !s.collapsed;
      persistCollapsed(next);
      return { collapsed: next };
    }),
  toggleDept: (dept) =>
    set((s) => {
      const next = { ...s.expandedDepts, [dept]: !s.expandedDepts[dept] };
      persistExpanded(next);
      return { expandedDepts: next };
    }),
  setExpandedDepts: (depts) => {
    persistExpanded(depts);
    set({ expandedDepts: depts });
  },
}));
