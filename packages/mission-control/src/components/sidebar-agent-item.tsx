'use client';

import Link from 'next/link';
import type { AgentInfo } from '@/lib/agents';

type AgentStatus = 'active' | 'idle' | 'error' | 'offline';

interface SidebarAgentItemProps {
  agent: AgentInfo;
  status?: AgentStatus;
}

const DOT_CLASSES: Record<AgentStatus, string> = {
  active: 'bg-terminal-green shadow-[0_0_4px_#a6e3a1]',
  idle: 'bg-terminal-dim',
  error: 'bg-terminal-red shadow-[0_0_4px_#f38ba8]',
  offline: 'bg-terminal-dim/40',
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
      className="flex items-center gap-2 pl-8 pr-3 py-1 text-xs font-mono text-terminal-dim hover:text-terminal-text transition-colors"
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${DOT_CLASSES[status]}`} />
      <span className={status === 'offline' ? 'opacity-50' : ''}>{agent.label}</span>
      <span className="ml-auto text-[10px]">{STATUS_LABEL[status]}</span>
    </Link>
  );
}
