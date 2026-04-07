'use client';

import { useState, useEffect } from 'react';
import type { DesignStudioProject, DesignStudioApiResponse } from './design-studio-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(iso?: string): string {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function projectId(name: string): string {
  return name.split('/').pop() ?? name;
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: DesignStudioProject }) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-3 hover:border-terminal-muted transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-xs text-terminal-text font-mono truncate flex-1" title={project.title}>
          {project.title}
        </div>
        <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono border rounded whitespace-nowrap bg-terminal-blue/10 border-terminal-blue/30 text-terminal-blue">
          STITCH
        </span>
      </div>
      <div className="text-[10px] text-terminal-dim font-mono truncate" title={project.name}>
        {projectId(project.name)}
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-terminal-dim font-mono">
        {project.screenCount !== undefined && (
          <span>{project.screenCount} screen{project.screenCount !== 1 ? 's' : ''}</span>
        )}
        <span className="ml-auto">{formatTimeAgo(project.updateTime ?? project.createTime)}</span>
      </div>
    </div>
  );
}

// ─── Generate Modal Placeholder ───────────────────────────────────────────────

function GenerateModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-terminal-bg border border-terminal-border rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold font-mono text-terminal-text">Generate Design</h3>
          <button
            onClick={onClose}
            className="text-terminal-dim hover:text-terminal-text text-xs font-mono"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-terminal-dim font-mono mb-4">
          Design generation is triggered by the Strategist agent via the{' '}
          <span className="text-terminal-yellow">strategist:design_generate</span> event.
          The Designer agent will use Google Stitch to create UI screens based on the issue description and brand guidelines.
        </p>
        <div className="bg-terminal-surface border border-terminal-border rounded p-3 text-[10px] text-terminal-dim font-mono">
          <div className="text-terminal-text mb-1">Event payload:</div>
          <div>{'{'}</div>
          <div className="pl-4">&quot;issue_number&quot;: &lt;number&gt;,</div>
          <div className="pl-4">&quot;description&quot;: &lt;string&gt;,</div>
          <div className="pl-4">&quot;device_type&quot;: &quot;DESKTOP | MOBILE&quot;,</div>
          <div className="pl-4">&quot;style_notes&quot;: &lt;string&gt;</div>
          <div>{'}'}</div>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full px-3 py-2 text-xs font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DesignStudio() {
  const [projects, setProjects] = useState<DesignStudioProject[]>([]);
  const [warning, setWarning] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stitch')
      .then((r) => r.json() as Promise<DesignStudioApiResponse>)
      .then((data) => {
        if (cancelled) return;
        setProjects(data.projects ?? []);
        setWarning(data.warning ?? data.error);
      })
      .catch(() => {
        if (!cancelled) setWarning('Could not reach Stitch API');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
            Design Studio
          </h3>
          <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono border rounded bg-terminal-blue/10 border-terminal-blue/30 text-terminal-blue">
            Google Stitch
          </span>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="px-2.5 py-1 text-[10px] font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-muted/30 transition-colors"
        >
          Generate Design
        </button>
      </div>

      {warning && (
        <div className="mb-3 px-3 py-2 rounded border border-terminal-yellow/30 bg-terminal-yellow/5 text-[10px] font-mono text-terminal-yellow">
          {warning}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-terminal-dim font-mono animate-pulse">Loading projects…</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-terminal-dim font-mono">No Stitch projects found</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {projects.map((p) => (
            <ProjectCard key={p.name} project={p} />
          ))}
        </div>
      )}

      {modalOpen && <GenerateModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
