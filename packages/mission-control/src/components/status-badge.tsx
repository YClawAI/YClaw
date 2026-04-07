interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
  running: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
  completed: 'bg-terminal-blue/10 text-terminal-blue border-terminal-blue/30',
  merged: 'bg-terminal-blue/10 text-terminal-blue border-terminal-blue/30',
  failed: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30',
  error: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30',
  pending: 'bg-terminal-yellow/10 text-terminal-yellow border-terminal-yellow/30',
  queued: 'bg-terminal-yellow/10 text-terminal-yellow border-terminal-yellow/30',
  review: 'bg-terminal-purple/10 text-terminal-purple border-terminal-purple/30',
  blocked: 'bg-terminal-orange/10 text-terminal-orange border-terminal-orange/30',
  idle: 'bg-terminal-muted/50 text-terminal-dim border-terminal-border',
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const styles = STATUS_STYLES[status.toLowerCase()] ?? STATUS_STYLES.idle;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${styles} ${className}`}
    >
      {status}
    </span>
  );
}
