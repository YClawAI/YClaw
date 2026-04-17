'use client';

import { useState } from 'react';

interface Artifact {
  id: string;
  type: string;
  filename: string;
  content: string;
  status: 'draft' | 'approved' | 'rejected';
}

interface Props {
  artifact: Artifact;
  onApprove: () => void;
  onReject: () => void;
}

export function ArtifactPreview({ artifact, onApprove, onReject }: Props) {
  const [expanded, setExpanded] = useState(false);

  const statusStyles: Record<string, string> = {
    draft: 'bg-mc-warning/10 text-mc-warning border-mc-warning/30',
    approved: 'bg-mc-success/10 text-mc-success border-mc-success/30',
    rejected: 'bg-mc-danger/10 text-mc-danger border-mc-danger/30',
  };

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-mc-border/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-mc-text">{artifact.filename}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${statusStyles[artifact.status] ?? ''}`}>
            {artifact.status}
          </span>
        </div>
        <span className="text-xs text-mc-text-tertiary">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="border-t border-mc-border">
          <pre className="p-4 text-xs text-mc-text font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {artifact.content}
          </pre>

          {artifact.status === 'draft' && (
            <div className="flex gap-2 p-4 border-t border-mc-border">
              <button
                onClick={onApprove}
                className="px-3 py-1.5 text-xs font-mono rounded border bg-mc-success/20 text-mc-success border-mc-success/40 hover:bg-mc-success/30 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={onReject}
                className="px-3 py-1.5 text-xs font-mono rounded border bg-mc-danger/20 text-mc-danger border-mc-danger/40 hover:bg-mc-danger/30 transition-colors"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
