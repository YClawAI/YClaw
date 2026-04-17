type Status = 'active' | 'idle' | 'error' | 'blocked' | 'processing';

const STATUS_CLASSES: Record<Status, string> = {
  active: 'bg-mc-success shadow-[0_0_6px_#30D158]',
  idle: 'bg-mc-text-tertiary',
  error: 'bg-mc-danger shadow-[0_0_6px_#FF453A]',
  blocked: 'bg-mc-warning shadow-[0_0_6px_#FFD60A]',
  processing: 'bg-mc-info shadow-[0_0_6px_#64D2FF] animate-pulse',
};

export function StatusDot({ status, size = 'sm' }: { status: Status; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2';
  return (
    <span
      className={`inline-block rounded-full ${sizeClass} ${STATUS_CLASSES[status] ?? STATUS_CLASSES.idle}`}
      title={status}
    />
  );
}
