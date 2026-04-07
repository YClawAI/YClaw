import type { AgentSystem } from '@/lib/agents';

const BADGE_STYLES: Record<AgentSystem, string> = {
  yclaw: 'bg-terminal-blue/20 text-terminal-blue border-terminal-blue/40',
  openclaw: 'bg-terminal-purple/20 text-terminal-purple border-terminal-purple/40',
  both: 'bg-terminal-cyan/20 text-terminal-cyan border-terminal-cyan/40',
};

const BADGE_LABELS: Record<AgentSystem, string> = {
  yclaw: 'YCLAW',
  openclaw: 'OPENCLAW',
  both: 'BOTH',
};

const BADGE_TOOLTIPS: Record<AgentSystem, string> = {
  yclaw: 'Runs on the primary agent infrastructure',
  openclaw: 'Runs exclusively on OpenClaw',
  both: 'Runs on both primary infrastructure and OpenClaw',
};

export function SystemBadge({ system }: { system: AgentSystem }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-bold tracking-wider border rounded ${BADGE_STYLES[system]}`}
      title={BADGE_TOOLTIPS[system]}
    >
      {BADGE_LABELS[system]}
    </span>
  );
}
