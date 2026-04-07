'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveGrowth, pauseGrowth, resumeGrowth } from '@/lib/actions/runtime-controls';
import type { AgentHubHealth } from '@/lib/agenthub-api';
import type { GrowthRuntimeStatus } from '@/lib/runtime-controls';

interface GrowthControlPanelProps {
  health: AgentHubHealth;
  status: GrowthRuntimeStatus;
}

function StatusBadge({ running }: { running: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border ${
      running
        ? 'border-terminal-green/30 text-terminal-green bg-terminal-green/5'
        : 'border-terminal-yellow/30 text-terminal-yellow bg-terminal-yellow/5'
    }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-terminal-green' : 'bg-terminal-yellow'}`} />
      {running ? 'RUNNING' : 'PAUSED'}
    </span>
  );
}

export function GrowthControlPanel({ health, status }: GrowthControlPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function runAction(key: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyKey(key);
    setError(null);
    startTransition(async () => {
      const result = await action();
      setBusyKey(null);
      if (!result.ok) {
        setError(result.error || 'Control action failed');
        return;
      }
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
          ? 'AgentHub reachable. Growth controls are publishing directly into the core event bus.'
          : `AgentHub degraded: ${health.error || 'connectivity check failed'}`}
      </div>

      {!status.enabled ? (
        <div className="bg-terminal-surface border border-terminal-border rounded p-4 text-xs text-terminal-dim">
          Growth engine is not enabled.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runAction('pause-all', () => pauseGrowth())}
              disabled={busyKey !== null}
              className="px-3 py-1.5 text-xs font-mono rounded border border-terminal-yellow/30 text-terminal-yellow hover:bg-terminal-yellow/10 disabled:opacity-50"
            >
              {busyKey === 'pause-all' ? 'Pausing…' : 'Pause All'}
            </button>
            <button
              onClick={() => runAction('resume-all', () => resumeGrowth())}
              disabled={busyKey !== null}
              className="px-3 py-1.5 text-xs font-mono rounded border border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-50"
            >
              {busyKey === 'resume-all' ? 'Resuming…' : 'Resume All'}
            </button>
            <span className="text-[10px] text-terminal-dim font-mono">
              {status.channels.length} channels, {status.pendingApprovals.length} pending approvals
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {status.channels.map((channel) => {
              const actionKey = `${channel.channelName}:${channel.running ? 'pause' : 'resume'}`;
              return (
                <div key={channel.channelName} className="bg-terminal-surface border border-terminal-border rounded p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold font-mono text-terminal-text">{channel.channelName}</div>
                      <div className="text-[10px] text-terminal-dim">
                        Champion {channel.championVersion}
                      </div>
                    </div>
                    <StatusBadge running={channel.running} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="border border-terminal-border rounded p-2">
                      <div className="text-terminal-dim">Experiments</div>
                      <div className="text-terminal-text text-sm">{channel.experimentsRun}</div>
                    </div>
                    <div className="border border-terminal-border rounded p-2">
                      <div className="text-terminal-dim">Approvals Left</div>
                      <div className="text-terminal-text text-sm">{channel.humanApprovalRemaining}</div>
                    </div>
                    <div className="border border-terminal-border rounded p-2">
                      <div className="text-terminal-dim">Champion Score</div>
                      <div className="text-terminal-text text-sm">
                        {channel.championScore >= 0 ? `${(channel.championScore * 100).toFixed(1)}%` : '--'}
                      </div>
                    </div>
                    <div className="border border-terminal-border rounded p-2">
                      <div className="text-terminal-dim">Variable Index</div>
                      <div className="text-terminal-text text-sm">{channel.variableIndex}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => runAction(
                      actionKey,
                      () => channel.running ? pauseGrowth(channel.channelName) : resumeGrowth(channel.channelName),
                    )}
                    disabled={busyKey !== null}
                    className={`w-full px-3 py-1.5 text-xs font-mono rounded border disabled:opacity-50 ${
                      channel.running
                        ? 'border-terminal-yellow/30 text-terminal-yellow hover:bg-terminal-yellow/10'
                        : 'border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10'
                    }`}
                  >
                    {busyKey === actionKey
                      ? 'Applying…'
                      : channel.running
                        ? 'Pause Channel'
                        : 'Resume Channel'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Pending Approvals</h3>
              <span className="text-[10px] font-mono text-terminal-dim">{status.pendingApprovals.length}</span>
            </div>
            {status.pendingApprovals.length === 0 ? (
              <div className="text-xs text-terminal-dim">No growth approvals are currently blocked.</div>
            ) : (
              <div className="space-y-2">
                {status.pendingApprovals.map((approvalKey) => (
                  <div key={approvalKey} className="flex items-center gap-3 border border-terminal-border rounded p-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-terminal-text truncate">{approvalKey}</div>
                      <div className="text-[10px] text-terminal-dim">Publishes `strategist:growth_approved` for this experiment.</div>
                    </div>
                    <button
                      onClick={() => runAction(`approve:${approvalKey}`, () => approveGrowth(approvalKey))}
                      disabled={busyKey !== null}
                      className="px-3 py-1.5 text-xs font-mono rounded border border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-50"
                    >
                      {busyKey === `approve:${approvalKey}` ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-terminal-red/5 border border-terminal-red/20 rounded p-3 text-xs text-terminal-red">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
