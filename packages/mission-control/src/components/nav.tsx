'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DEPARTMENTS, DEPT_META, DEPT_COLORS, getAgentsByDept } from '@/lib/agents';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useChatStore } from '@/stores/chat-store';
import { SidebarAgentItem } from './sidebar-agent-item';

// ── Inline SVG Icons (w-4 h-4, strokeWidth 1.5, fill none) ──

function IconDiamond({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2l10 10-10 10L2 12z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHexagon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUser({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconActivity({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLock({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function IconQueue({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
    </svg>
  );
}

function IconSession({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <path d="M8 21h8M12 17v4" strokeLinecap="round" />
    </svg>
  );
}

function IconVault({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V3M12 21v-6" strokeLinecap="round" />
    </svg>
  );
}

function IconPulse({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M2 12h4l3-9 6 18 3-9h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconGear({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function IconChat({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Department icons (inline SVG instead of emoji)
const DEPT_ICONS: Record<string, () => JSX.Element> = {
  executive: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2l2.09 6.26L21 9.27l-5.18 4.73L17.82 21 12 17.27 6.18 21l1.82-7L3 9.27l6.91-1.01z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  development: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  marketing: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  operations: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  finance: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  support: () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ── NavLink ──

interface NavLinkProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  badgeColor?: 'default' | 'red';
  collapsed: boolean;
}

function NavLink({ href, icon, label, badge, badgeColor, collapsed }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
  const badgeClasses = badgeColor === 'red'
    ? 'text-[10px] font-mono text-terminal-red bg-terminal-red/10 px-1.5 py-0.5 rounded'
    : 'text-[10px] font-mono text-terminal-dim bg-terminal-muted px-1.5 py-0.5 rounded';

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded text-sm font-mono transition-colors ${
        isActive
          ? 'bg-terminal-muted text-terminal-text border-l-2 border-terminal-purple'
          : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface'
      }`}
      title={collapsed ? label : undefined}
    >
      <span className="w-4 flex items-center justify-center">{icon}</span>
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {badge && (
            <span className={badgeClasses}>
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div className="h-px bg-terminal-border mx-2 my-3" />;
  return (
    <div className="px-3 mt-5 mb-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim/60">{label}</span>
    </div>
  );
}

interface NavProps {
  agentStatuses?: Record<string, 'active' | 'idle' | 'error' | 'offline'>;
}

export function Nav({ agentStatuses }: NavProps) {
  const pathname = usePathname();
  const { collapsed, expandedDepts, hydrated, hydrate, toggleCollapsed, toggleDept } = useSidebarStore();
  const toggleChat = useChatStore((s) => s.toggle);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [activeLocks, setActiveLocks] = useState(0);

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  // Fetch operator badge counts client-side (non-blocking)
  useEffect(() => {
    let cancelled = false;
    async function fetchBadges() {
      try {
        const [approvalsRes, locksRes] = await Promise.all([
          fetch('/api/operators/approvals/cross-dept').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/operators/locks').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (cancelled) return;
        if (approvalsRes?.requests) {
          setPendingApprovals(approvalsRes.requests.filter((r: { status: string }) => r.status === 'pending').length);
        }
        if (locksRes?.locks) {
          setActiveLocks(locksRes.locks.length);
        }
      } catch { /* badges stay at 0 */ }
    }
    fetchBadges();
    const interval = setInterval(fetchBadges, 30_000); // refresh every 30s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <nav className="flex flex-col h-full py-4 px-2 gap-0.5 overflow-y-auto overflow-x-hidden">
      {/* Branding */}
      <div className="px-3 mb-4 flex items-center justify-between">
        {!collapsed && (
          <div>
            <div className="font-mono text-sm font-bold text-terminal-purple tracking-widest">YCLAW</div>
            <div className="font-mono text-[10px] text-terminal-dim tracking-widest">MISSION CONTROL</div>
          </div>
        )}
        <button
          onClick={toggleCollapsed}
          className="text-terminal-dim hover:text-terminal-text transition-colors text-xs p-1"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            {collapsed
              ? <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              : <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            }
          </svg>
        </button>
      </div>

      {/* COMMAND */}
      <SectionLabel label="Command" collapsed={collapsed} />
      <NavLink href="/" icon={<IconDiamond />} label="Mission Control" collapsed={collapsed} />
      <NavLink href="/openclaw" icon={<IconHexagon />} label="OpenClaw" collapsed={collapsed} />
      <NavLink href="/events" icon={<IconBolt />} label="Event Stream" collapsed={collapsed} />

      {/* DEPARTMENTS */}
      <SectionLabel label="Departments" collapsed={collapsed} />
      {DEPARTMENTS.map((dept) => {
        const meta = DEPT_META[dept];
        const colorClass = DEPT_COLORS[dept];
        const agents = getAgentsByDept(dept);
        const isActive = pathname.startsWith(`/departments/${dept}`);
        const isExpanded = expandedDepts[dept] ?? false;
        const DeptIcon = DEPT_ICONS[dept];

        return (
          <div key={dept}>
            <div className="flex items-center">
              <Link
                href={`/departments/${dept}`}
                className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-l text-sm font-mono transition-colors ${
                  isActive
                    ? 'bg-terminal-muted text-terminal-text border-l-2 border-terminal-purple'
                    : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface'
                }`}
                title={collapsed ? meta.label : undefined}
              >
                <span className="w-4 flex items-center justify-center">
                  {DeptIcon ? <DeptIcon /> : null}
                </span>
                {!collapsed && <span className={`flex-1 ${colorClass}`}>{meta.label}</span>}
              </Link>
              {!collapsed && (
                <button
                  onClick={() => toggleDept(dept)}
                  className="px-2 py-2 text-terminal-dim hover:text-terminal-text transition-colors text-[10px]"
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
              )}
            </div>
            {!collapsed && isExpanded && (
              <div className="ml-1 mb-1">
                {agents.map((agent) => (
                  <SidebarAgentItem key={agent.name} agent={agent} status={agentStatuses?.[agent.name] ?? 'offline'} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ADMIN */}
      <SectionLabel label="Admin" collapsed={collapsed} />
      <NavLink href="/operators" icon={<IconUser />} label="Operators" collapsed={collapsed} />
      <NavLink href="/operators/activity" icon={<IconActivity />} label="Activity" collapsed={collapsed} />
      <NavLink href="/operators/audit" icon={<IconList />} label="Audit Log" collapsed={collapsed} />
      <NavLink href="/operators/approvals" icon={<IconCheck />} label="Approvals" badge={pendingApprovals ? String(pendingApprovals) : undefined} badgeColor={pendingApprovals ? 'red' : 'default'} collapsed={collapsed} />
      <NavLink href="/operators/locks" icon={<IconLock />} label="Locks" badge={activeLocks ? String(activeLocks) : undefined} collapsed={collapsed} />

      {/* SYSTEM */}
      <SectionLabel label="System" collapsed={collapsed} />
      <NavLink href="/observability" icon={<IconPulse />} label="Observability" collapsed={collapsed} />
      <NavLink href="/system/queues" icon={<IconQueue />} label="Task Queue" collapsed={collapsed} />
      <NavLink href="/system/approvals" icon={<IconCheck />} label="Approvals" collapsed={collapsed} />
      <NavLink href="/system/sessions" icon={<IconSession />} label="Sessions" collapsed={collapsed} />
      <NavLink href="/system/vault" icon={<IconVault />} label="Vault" collapsed={collapsed} />
      <NavLink href="/settings" icon={<IconGear />} label="Settings" collapsed={collapsed} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom */}
      <div className="border-t border-terminal-border pt-3 mt-3 space-y-1">
        {!collapsed && (
          <button
            onClick={toggleChat}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm font-mono text-terminal-dim hover:text-terminal-purple hover:bg-terminal-surface transition-colors border border-terminal-border"
          >
            <span className="w-4 flex items-center justify-center"><IconChat /></span>
            <span className="flex-1 text-left text-xs">Chat with OpenClaw</span>
          </button>
        )}
        {collapsed && (
          <button
            onClick={toggleChat}
            className="w-full flex items-center justify-center py-2 text-terminal-dim hover:text-terminal-purple transition-colors"
            title="Chat with OpenClaw"
          >
            <IconChat />
          </button>
        )}
      </div>
    </nav>
  );
}
