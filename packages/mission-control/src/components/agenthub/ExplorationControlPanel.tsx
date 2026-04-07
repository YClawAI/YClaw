'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { launchExplorationDirective } from '@/lib/actions/runtime-controls';
import type { AgentHubHealth } from '@/lib/agenthub-api';
import type { ExplorationRuntimeStatus } from '@/lib/runtime-controls';

interface ExplorationControlPanelProps {
  health: AgentHubHealth;
  status: ExplorationRuntimeStatus;
}

export function ExplorationControlPanel({ health, status }: ExplorationControlPanelProps) {
  const router = useRouter();
  const [taskId, setTaskId] = useState('');
  const [description, setDescription] = useState('');
  const [context, setContext] = useState('');
  const [numWorkers, setNumWorkers] = useState(2);
  const [targetRepo, setTargetRepo] = useState('');
  const [targetBranch, setTargetBranch] = useState('master');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await launchExplorationDirective({
        taskId,
        description,
        context,
        numWorkers,
        targetRepo,
        targetBranch,
      });

      if (!result.ok) {
        setError(result.error || 'Failed to launch exploration');
        return;
      }

      setSuccess(`Exploration directive ${taskId} published.`);
      setTaskId('');
      setDescription('');
      setContext('');
      setNumWorkers(2);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className={`border rounded p-3 text-xs ${
        health.ok
          ? 'bg-terminal-green/5 border-terminal-green/20 text-terminal-dim'
          : 'bg-terminal-red/5 border-terminal-red/20 text-terminal-red'
      }`}>
        {health.ok
          ? 'AgentHub reachable. Exploration directives will be dispatched through the core event bus.'
          : `AgentHub degraded: ${health.error || 'connectivity check failed'}`}
      </div>

      {!status.enabled ? (
        <div className="bg-terminal-surface border border-terminal-border rounded p-4 text-xs text-terminal-dim">
          Exploration module is not enabled.
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Launch Exploration</h3>
              <span className="text-[10px] font-mono text-terminal-dim">{status.tasks.length} active tasks</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="text-xs text-terminal-dim">
                Task ID
                <input
                  required
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                  className="mt-1 w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-terminal-text font-mono"
                  placeholder="mission-control-contract-audit"
                />
              </label>
              <label className="text-xs text-terminal-dim">
                Workers
                <select
                  value={numWorkers}
                  onChange={(e) => setNumWorkers(Number(e.target.value))}
                  className="mt-1 w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-terminal-text font-mono"
                >
                  <option value={1}>1 worker</option>
                  <option value={2}>2 workers</option>
                  <option value={3}>3 workers</option>
                </select>
              </label>
              <label className="text-xs text-terminal-dim lg:col-span-2">
                Description
                <input
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-terminal-text"
                  placeholder="Investigate and implement the next Mission Control integration improvement."
                />
              </label>
              <label className="text-xs text-terminal-dim lg:col-span-2">
                Context
                <textarea
                  required
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  className="mt-1 w-full min-h-32 bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-terminal-text"
                  placeholder="Relevant files, constraints, and acceptance criteria."
                />
              </label>
              <label className="text-xs text-terminal-dim">
                Target Repo
                <input
                  required
                  pattern="[\w.-]+/[\w.-]+"
                  value={targetRepo}
                  onChange={(e) => setTargetRepo(e.target.value)}
                  className="mt-1 w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-terminal-text font-mono"
                  placeholder="yclaw-ai/repo-name"
                />
              </label>
              <label className="text-xs text-terminal-dim">
                Target Branch
                <input
                  required
                  value={targetBranch}
                  onChange={(e) => setTargetBranch(e.target.value)}
                  className="mt-1 w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-terminal-text font-mono"
                />
              </label>
            </div>

            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-mono rounded border border-terminal-blue/30 text-terminal-blue hover:bg-terminal-blue/10 disabled:opacity-50"
              disabled={!status.enabled}
            >
              Dispatch Directive
            </button>
          </form>

          {error && (
            <div className="bg-terminal-red/5 border border-terminal-red/20 rounded p-3 text-xs text-terminal-red">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-terminal-green/5 border border-terminal-green/20 rounded p-3 text-xs text-terminal-green">
              {success}
            </div>
          )}

          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Active Exploration Tasks</h3>
              <span className="text-[10px] font-mono text-terminal-dim">{status.tasks.length}</span>
            </div>
            {status.tasks.length === 0 ? (
              <div className="text-xs text-terminal-dim">No active exploration tasks are currently tracked.</div>
            ) : (
              <div className="space-y-3">
                {status.tasks.map((task) => (
                  <div key={task.taskId} className="border border-terminal-border rounded p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-mono text-terminal-text">{task.taskId}</div>
                        <div className="text-xs text-terminal-dim">{task.description}</div>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono border ${
                        task.allWorkersComplete
                          ? 'border-terminal-green/30 text-terminal-green bg-terminal-green/5'
                          : 'border-terminal-yellow/30 text-terminal-yellow bg-terminal-yellow/5'
                      }`}>
                        {task.allWorkersComplete ? 'READY FOR REVIEW' : `${task.completedWorkers}/${task.numWorkers} COMPLETE`}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-[10px] font-mono">
                      <div className="border border-terminal-border rounded p-2">
                        <div className="text-terminal-dim">Repo</div>
                        <div className="text-terminal-text truncate">{task.targetRepo}</div>
                      </div>
                      <div className="border border-terminal-border rounded p-2">
                        <div className="text-terminal-dim">Branch</div>
                        <div className="text-terminal-text">{task.targetBranch}</div>
                      </div>
                      <div className="border border-terminal-border rounded p-2">
                        <div className="text-terminal-dim">Root Hash</div>
                        <div className="text-terminal-text">{task.rootHash.slice(0, 8)}</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-terminal-dim">
                      Workers: {task.assignedWorkers.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
