interface HealthDotProps {
  healthy: boolean;
  label?: string;
}

export function HealthDot({ healthy, label }: HealthDotProps) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          healthy ? 'bg-terminal-green shadow-[0_0_6px_#a6e3a1]' : 'bg-terminal-red shadow-[0_0_6px_#f38ba8]'
        }`}
      />
      {label && <span className={healthy ? 'text-terminal-green' : 'text-terminal-red'}>{label}</span>}
    </span>
  );
}
