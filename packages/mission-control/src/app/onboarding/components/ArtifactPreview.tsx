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
    draft: 'bg-terminal-yellow/10 text-terminal-yellow border-terminal-yellow/30',
    approved: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
    rejected: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30',
  };

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-terminal-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-terminal-text">{artifact.filename}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${statusStyles[artifact.status] ?? ''}`}>
            {artifact.status}
          </span>
        </div>
        <span className="text-xs text-terminal-dim">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="border-t border-terminal-border">
          <pre className="p-4 text-xs text-terminal-text font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {artifact.content}
          </pre>

          {artifact.status === 'draft' && (
            <div className="flex gap-2 p-4 border-t border-terminal-border">
              <button
                onClick={onApprove}
                className="px-3 py-1.5 text-xs font-mono rounded border bg-terminal-green/20 text-terminal-green border-terminal-green/40 hover:bg-terminal-green/30 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={onReject}
                className="px-3 py-1.5 text-xs font-mono rounded border bg-terminal-red/20 text-terminal-red border-terminal-red/40 hover:bg-terminal-red/30 transition-colors"
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
