'use client';

import { useMemo, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DiffViewerProps {
  hashA: string;
  hashB: string;
  diff: string;
}

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'header';
  content: string;
  lineNo?: number;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];

  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of raw.split('\n')) {
    // New file header
    if (line.startsWith('diff --git')) {
      if (current) files.push(current);
      const pathMatch = line.match(/b\/(.+)$/);
      current = {
        path: pathMatch?.[1] ?? 'unknown',
        additions: 0,
        deletions: 0,
        lines: [],
      };
      continue;
    }

    if (!current) continue;

    // Hunk header
    if (line.startsWith('@@')) {
      current.lines.push({ type: 'header', content: line });
      continue;
    }

    // Skip other git headers
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ')) {
      continue;
    }

    if (line.startsWith('+')) {
      current.additions++;
      current.lines.push({ type: 'add', content: line.slice(1) });
    } else if (line.startsWith('-')) {
      current.deletions++;
      current.lines.push({ type: 'del', content: line.slice(1) });
    } else {
      current.lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
    }
  }

  if (current) files.push(current);
  return files;
}

// ─── Line Colors ─────────────────────────────────────────────────────────────

const LINE_STYLES: Record<DiffLine['type'], string> = {
  add: 'bg-terminal-green/10 text-terminal-green',
  del: 'bg-terminal-red/10 text-terminal-red',
  context: 'text-terminal-dim',
  header: 'text-terminal-blue bg-terminal-blue/5',
};

const LINE_PREFIX: Record<DiffLine['type'], string> = {
  add: '+',
  del: '-',
  context: ' ',
  header: '',
};

// ─── File Diff Block ─────────────────────────────────────────────────────────

function FileDiff({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border border-terminal-border rounded overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-terminal-muted/20 border-b border-terminal-border hover:bg-terminal-muted/30 transition-colors text-left"
      >
        <span className="text-[8px] text-terminal-dim">{collapsed ? '>' : 'v'}</span>
        <span className="text-xs font-mono text-terminal-text truncate flex-1">{file.path}</span>
        <span className="text-[10px] font-mono text-terminal-green">+{file.additions}</span>
        <span className="text-[10px] font-mono text-terminal-red">-{file.deletions}</span>
      </button>
      {!collapsed && (
        <div className="overflow-x-auto">
          <pre className="text-[11px] font-mono leading-5">
            {file.lines.map((line, i) => (
              <div key={i} className={`px-3 ${LINE_STYLES[line.type]}`}>
                <span className="select-none text-terminal-dim/40 mr-2 inline-block w-3 text-right">
                  {LINE_PREFIX[line.type]}
                </span>
                {line.content}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function DiffViewer({ hashA, hashB, diff }: DiffViewerProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  if (!diff.trim()) {
    return (
      <div className="bg-terminal-surface border border-terminal-border border-dashed rounded p-4 text-center">
        <div className="text-xs text-terminal-dim">No diff available</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-terminal-dim">
        <span>{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
        <span className="text-terminal-green">+{totalAdditions}</span>
        <span className="text-terminal-red">-{totalDeletions}</span>
        <span className="ml-auto text-terminal-dim/60">
          {hashA.slice(0, 8)}..{hashB.slice(0, 8)}
        </span>
      </div>

      {/* File diffs */}
      <div className="space-y-2">
        {files.map((file) => (
          <FileDiff key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}
