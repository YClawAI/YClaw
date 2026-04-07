'use client';

// Message velocity has no real data source — component retained as a no-op empty state.

export function MessageVelocity() {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
        Message Velocity
      </div>
      <div className="flex items-center justify-center py-6">
        <span className="text-xs text-terminal-dim">No velocity data available</span>
      </div>
    </div>
  );
}
