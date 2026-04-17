import type { AgentSystem } from '@/lib/agents';

const BADGE_STYLES: Record<AgentSystem, string> = {
  yclaw: 'bg-mc-info/20 text-mc-info border-mc-info/40',
  openclaw: 'bg-mc-accent/20 text-mc-accent border-mc-accent/40',
  // "both" splits visual weight — warning tone keeps it distinct from the
  // single-system cyan/blue badges and signals "runs on multiple surfaces".
  both: 'bg-mc-warning/20 text-mc-warning border-mc-warning/40',
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
