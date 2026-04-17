'use client';

interface EmptyStateProps {
  /** Feature name shown in the placeholder */
  feature: string;
  /** Optional description */
  description?: string;
  /** Optional icon (emoji or text) */
  icon?: string;
}

export function EmptyState({ feature, icon = '◇', description }: EmptyStateProps) {
  return (
    <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 text-center">
      <span className="text-2xl text-mc-text-tertiary/40">{icon}</span>
      <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">
        {feature}
      </div>
      <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
        {description ?? 'This feature is under development. Data sources will be connected when the fleet is online.'}
      </p>
    </div>
  );
}
