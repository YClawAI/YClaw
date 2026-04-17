interface HealthDotProps {
  healthy: boolean;
  label?: string;
}

export function HealthDot({ healthy, label }: HealthDotProps) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          healthy ? 'bg-mc-success shadow-[0_0_6px_#30D158]' : 'bg-mc-danger shadow-[0_0_6px_#FF453A]'
        }`}
      />
      {label && <span className={healthy ? 'text-mc-success' : 'text-mc-danger'}>{label}</span>}
    </span>
  );
}
