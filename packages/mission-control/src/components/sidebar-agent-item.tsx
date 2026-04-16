'use client';

import Link from 'next/link';
import type { AgentInfo } from '@/lib/agents';

type AgentStatus = 'active' | 'idle' | 'error' | 'offline';

interface SidebarAgentItemProps {
  agent: AgentInfo;
  status?: AgentStatus;
}

const DOT_CLASSES: Record<AgentStatus, string> = {
  active: 'bg-mc-success animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-success',
  idle: 'bg-mc-text-tertiary',
  error: 'bg-mc-danger animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-danger',
  offline: 'bg-mc-text-tertiary/40',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: 'act',
  error: 'err',
  offline: 'off',
  idle: '',
};

export function SidebarAgentItem({ agent, status = 'idle' }: SidebarAgentItemProps) {
  return (
    <Link
      href={`/departments/${agent.department}?agent=${agent.name}`}
      className="flex items-center gap-2 pl-8 pr-3 py-1 font-sans text-[11px] text-mc-text-tertiary hover:text-mc-text transition-colors duration-mc ease-mc-out"
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${DOT_CLASSES[status]}`} />
      <span className={status === 'offline' ? 'opacity-50' : ''}>{agent.label}</span>
      <span className="ml-auto font-mono tabular-nums text-[10px] text-mc-text-tertiary">{STATUS_LABEL[status]}</span>
    </Link>
  );
}
