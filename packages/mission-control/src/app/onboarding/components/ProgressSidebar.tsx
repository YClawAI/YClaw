'use client';

const STAGES = [
  { key: 'org_framing', label: 'Org Framing' },
  { key: 'ingestion', label: 'Context Import' },
  { key: 'departments', label: 'Departments' },
  { key: 'operators', label: 'Operators' },
  { key: 'validation', label: 'Validation' },
];

interface Props {
  stage: string;
  artifactCount: number;
  approvedCount: number;
  assetCount: number;
  onReset: () => void;
}

export function ProgressSidebar({ stage, artifactCount, approvedCount, assetCount, onReset }: Props) {
  const currentIdx = STAGES.findIndex(s => s.key === stage);

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4 space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">Progress</h2>

      <div className="space-y-2">
        {STAGES.map((s, i) => {
          const isActive = s.key === stage;
          const isDone = i < currentIdx;
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                isDone ? 'bg-mc-success' :
                isActive ? 'bg-mc-accent animate-pulse' :
                'bg-mc-border'
              }`} />
              <span className={`text-xs font-mono ${
                isActive ? 'text-mc-text' : 'text-mc-text-tertiary'
              }`}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="border-t border-mc-border pt-3 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-mc-text-tertiary">Artifacts</span>
          <span className="text-mc-text font-mono">{approvedCount}/{artifactCount}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-mc-text-tertiary">Assets</span>
          <span className="text-mc-text font-mono">{assetCount}</span>
        </div>
      </div>

      <button
        onClick={onReset}
        className="w-full px-3 py-1.5 text-xs font-mono rounded border border-mc-danger/30 text-mc-danger hover:bg-mc-danger/10 transition-colors"
      >
        Start Over
      </button>
    </div>
  );
}
