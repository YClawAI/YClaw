'use client';

// Message velocity has no real data source — component retained as a no-op empty state.

export function MessageVelocity() {
  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
        Message Velocity
      </div>
      <div className="flex items-center justify-center py-6">
        <span className="text-xs text-mc-text-tertiary">No velocity data available</span>
      </div>
    </div>
  );
}
