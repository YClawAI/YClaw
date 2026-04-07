type Status = 'active' | 'idle' | 'error' | 'blocked' | 'processing';

const STATUS_CLASSES: Record<Status, string> = {
  active: 'bg-terminal-green shadow-[0_0_6px_#a6e3a1]',
  idle: 'bg-terminal-dim',
  error: 'bg-terminal-red shadow-[0_0_6px_#f38ba8]',
  blocked: 'bg-terminal-yellow shadow-[0_0_6px_#f9e2af]',
  processing: 'bg-terminal-blue shadow-[0_0_6px_#89b4fa] animate-pulse',
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
