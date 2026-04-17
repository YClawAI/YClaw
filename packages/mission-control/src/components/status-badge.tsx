interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-mc-success/10 text-mc-success border-mc-success/30',
  running: 'bg-mc-success/10 text-mc-success border-mc-success/30',
  completed: 'bg-mc-info/10 text-mc-info border-mc-info/30',
  merged: 'bg-mc-info/10 text-mc-info border-mc-info/30',
  failed: 'bg-mc-danger/10 text-mc-danger border-mc-danger/30',
  error: 'bg-mc-danger/10 text-mc-danger border-mc-danger/30',
  pending: 'bg-mc-warning/10 text-mc-warning border-mc-warning/30',
  queued: 'bg-mc-warning/10 text-mc-warning border-mc-warning/30',
  review: 'bg-mc-accent/10 text-mc-accent border-mc-accent/30',
  blocked: 'bg-mc-blocked/10 text-mc-blocked border-mc-blocked/30',
  idle: 'bg-mc-border/50 text-mc-text-tertiary border-mc-border',
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
