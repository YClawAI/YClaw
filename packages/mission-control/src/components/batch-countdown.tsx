'use client';

interface BatchCountdownProps {
  label?: string;
  muted?: boolean;
}

export function BatchCountdown({ label, muted }: BatchCountdownProps) {
  const displayLabel = label ?? 'No scheduled batches';
  const isMuted = muted ?? true;

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
        NEXT BATCH
      </div>
      <div className="flex items-center justify-center py-4">
        <span className={`text-xs text-center font-mono ${isMuted ? 'text-terminal-dim' : 'text-terminal-text'}`}>
          {displayLabel}
        </span>
      </div>
    </div>
  );
}
