'use client';

import { useEffect, useState, useTransition, useRef } from 'react';
import { getAgent, DEPT_META } from '@/lib/agents';
import { getAgentDetail } from '@/lib/actions/agent-detail';
import { triggerAgent } from '@/lib/actions/agent-trigger';
import type { AgentDetailData } from '@/lib/actions/agent-detail';
import type { CronSchedule } from '@/lib/yclaw-api';

// Static mapping of agent -> available tasks (from YAML triggers)
const AGENT_TASKS: Record<string, string[]> = {
  strategist: ['standup_synthesis', 'weekly_directive', 'midweek_review', 'monthly_strategy', 'model_review', 'heartbeat'],
  reviewer: ['daily_standup'],
  architect: ['daily_standup', 'tech_debt_scan'],
  builder: ['daily_standup'],
  deployer: ['daily_standup'],
  designer: ['daily_standup'],
  ember: ['daily_standup', 'daily_content_batch', 'midday_post', 'afternoon_engagement', 'weekend_content'],
  forge: ['daily_standup'],
  scout: ['daily_standup', 'daily_intel_scan', 'weekly_prospecting', 'follow_ups', 'pipeline_report', 'x_algorithm_research'],
  sentinel: ['daily_standup', 'deployment_health', 'code_quality_audit', 'weekly_repo_digest'],
  keeper: ['handle_message'],
  guide: ['daily_standup'],
  treasurer: ['daily_standup', 'treasury_check', 'weekly_spend', 'monthly_summary'],
};

interface AgentDetailDrawerProps {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
  fleetOnline?: boolean;
  /** Optional extension content rendered at the bottom (e.g., AgentHub tabs) */
  children?: React.ReactNode;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'success' ? 'text-terminal-green bg-terminal-green/10 border-terminal-green/30' :
    status === 'error' ? 'text-terminal-red bg-terminal-red/10 border-terminal-red/30' :
    status === 'running' ? 'text-terminal-blue bg-terminal-blue/10 border-terminal-blue/30' :
    'text-terminal-dim bg-terminal-muted border-terminal-border';

  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${color}`}>
      {status}
    </span>
  );
}

function CostSparkline({ data }: { data: { date: string; cents: number }[] }) {
  if (data.length < 2) return <span className="text-[10px] text-terminal-dim">No cost data</span>;
  const max = Math.max(...data.map(d => d.cents));
  const min = Math.min(...data.map(d => d.cents));
  const range = max - min || 1;
  const w = 120;
  const h = 24;
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d.cents - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div>
      <svg className="text-terminal-purple" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-terminal-dim font-mono mt-0.5">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

export function AgentDetailDrawer({ agentId, open, onClose, fleetOnline = false, children }: AgentDetailDrawerProps) {
  const [data, setData] = useState<AgentDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);

  // Trigger state
  const [selectedTask, setSelectedTask] = useState<string>('');
  const [triggerResult, setTriggerResult] = useState<{ ok: boolean; executionId?: string; error?: string } | null>(null);
  const [isTriggerPending, startTriggerTransition] = useTransition();
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const schedules: CronSchedule[] = data?.schedules ?? [];

  useEffect(() => {
    if (open && agentId) {
      const version = ++requestVersion.current;
      setLoading(true);
      setData(null);
      getAgentDetail(agentId)
        .then((result) => {
          if (requestVersion.current === version) setData(result);
        })
        .catch(() => {
          if (requestVersion.current === version) setData(null);
        })
        .finally(() => {
          if (requestVersion.current === version) setLoading(false);
        });
    } else {
      requestVersion.current++;
      setData(null);
    }
    // Reset trigger state on agent change
    setSelectedTask('');
    setTriggerResult(null);
  }, [open, agentId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open || !agentId) return null;

  const agent = getAgent(agentId);
  if (!agent) return null;

  const dept = DEPT_META[agent.department];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-terminal-surface border-l border-terminal-border shadow-2xl overflow-y-auto max-sm:top-auto max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:max-w-full max-sm:max-h-[80vh] max-sm:rounded-t-xl max-sm:border-t max-sm:border-l-0">
        {/* Header */}
        <div className="sticky top-0 bg-terminal-surface px-6 py-4 border-b border-terminal-border flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span className="text-lg">{agent.emoji}</span>
            <h2 className="text-sm font-bold text-terminal-text">{agent.label}</h2>
            {agent.model && (
              <span className="text-[10px] font-mono text-terminal-dim bg-terminal-muted px-1.5 py-0.5 rounded">
                {agent.model}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-terminal-dim hover:text-terminal-text transition-colors text-lg"
          >
            &times;
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Agent Info */}
          <div>
            <div className="text-xs text-terminal-dim mb-1">{dept.icon} {dept.label} Department</div>
            <div className="text-xs text-terminal-text">{agent.description}</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-terminal-border text-terminal-dim">
                {agent.system}
              </span>
              {agent.role === 'lead' && (
                <span className="text-[10px] font-mono text-terminal-cyan bg-terminal-cyan/10 border border-terminal-cyan/30 px-1.5 py-0.5 rounded">
                  LEAD
                </span>
              )}
            </div>
          </div>

          {/* Trigger Section */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-2">Trigger</h3>
            {(() => {
              const tasks = agentId ? (AGENT_TASKS[agentId] ?? []) : [];
              if (tasks.length === 0) {
                return <div className="text-xs text-terminal-dim">No triggerable tasks for this agent</div>;
              }
              return (
                <div className="bg-terminal-bg rounded p-3 border border-terminal-border space-y-2">
                  <select
                    value={selectedTask}
                    onChange={(e) => { setSelectedTask(e.target.value); setTriggerResult(null); }}
                    className="w-full bg-terminal-surface border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-blue"
                  >
                    <option value="">Select a task...</option>
                    {tasks.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <div className="relative inline-block">
                    <button
                      disabled={!fleetOnline || !selectedTask || isTriggerPending}
                      onMouseEnter={() => { if (!fleetOnline) setTooltipVisible(true); }}
                      onMouseLeave={() => setTooltipVisible(false)}
                      onClick={() => {
                        if (!agentId || !selectedTask) return;
                        setTriggerResult(null);
                        startTriggerTransition(async () => {
                          const result = await triggerAgent(agentId, selectedTask);
                          setTriggerResult(result);
                          if (result.ok) {
                            // Clear result after 5 seconds
                            setTimeout(() => setTriggerResult(null), 5000);
                          }
                        });
                      }}
                      className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
                        fleetOnline && selectedTask
                          ? 'border-terminal-blue/40 text-terminal-blue hover:bg-terminal-blue/10'
                          : 'border-terminal-border text-terminal-dim/50 cursor-not-allowed'
                      }`}
                    >
                      {isTriggerPending ? 'Triggering...' : 'Trigger'}
                    </button>
                    {tooltipVisible && !fleetOnline && (
                      <div className="absolute bottom-full left-0 mb-1 px-2 py-1 text-[9px] font-mono bg-terminal-bg border border-terminal-border rounded text-terminal-dim whitespace-nowrap z-10">
                        Unavailable
                      </div>
                    )}
                  </div>
                  {triggerResult && (
                    <div className={`text-xs font-mono px-2 py-1 rounded ${
                      triggerResult.ok
                        ? 'text-terminal-green bg-terminal-green/10 border border-terminal-green/30'
                        : 'text-terminal-red bg-terminal-red/10 border border-terminal-red/30'
                    }`}>
                      {triggerResult.ok
                        ? `Triggered. ID: ${triggerResult.executionId ?? 'n/a'}`
                        : `Error: ${triggerResult.error ?? 'Unknown error'}`}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Schedules Section */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-2">Schedules</h3>
            {schedules.length === 0 ? (
              <div className="text-xs text-terminal-dim">No schedule data</div>
            ) : (
              <div className="space-y-2">
                {schedules.map((s) => (
                  <div key={s.taskId} className="bg-terminal-bg rounded p-3 border border-terminal-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-terminal-text">{s.taskId}</span>
                      <span className="text-[10px] font-mono text-terminal-dim">{s.schedule}</span>
                    </div>
                    <div className="text-[10px] text-terminal-dim">
                      Next fire: {s.nextFireAt ? new Date(s.nextFireAt).toLocaleString() : '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-xs text-terminal-dim animate-pulse">Loading agent data...</div>
          ) : data ? (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-terminal-bg rounded p-3 border border-terminal-border">
                  <div className="text-lg font-bold font-mono text-terminal-text">{data.kpis.runCount24h}</div>
                  <div className="text-[10px] text-terminal-dim">Runs (24h)</div>
                </div>
                <div className="bg-terminal-bg rounded p-3 border border-terminal-border">
                  <div className="text-lg font-bold font-mono text-terminal-text">{data.kpis.runCount7d}</div>
                  <div className="text-[10px] text-terminal-dim">Runs (7d)</div>
                </div>
                <div className="bg-terminal-bg rounded p-3 border border-terminal-border">
                  <div className="text-lg font-bold font-mono text-terminal-text">{data.kpis.errorCount24h}</div>
                  <div className="text-[10px] text-terminal-dim">Errors (24h)</div>
                </div>
                <div className="bg-terminal-bg rounded p-3 border border-terminal-border">
                  <div className="text-lg font-bold font-mono text-terminal-text">${data.kpis.spendMTD.toFixed(2)}</div>
                  <div className="text-[10px] text-terminal-dim">Spend (MTD)</div>
                </div>
              </div>

              {/* Cost Sparkline */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-2">7-Day Spend</h3>
                <CostSparkline data={data.costSparkline} />
              </div>

              {/* Recent Executions */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim mb-2">Recent Executions</h3>
                {data.recentRuns.length === 0 ? (
                  <div className="text-xs text-terminal-dim">No recent executions</div>
                ) : (
                  <div className="space-y-2">
                    {data.recentRuns.map((run, i) => (
                      <div key={run.executionId ?? i} className="bg-terminal-bg rounded p-3 border border-terminal-border">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={run.status} />
                            {run.taskId && (
                              <span className="text-[10px] font-mono text-terminal-dim">{run.taskId}</span>
                            )}
                          </div>
                          <span className="text-[10px] text-terminal-dim">{formatRelativeTime(run.createdAt)}</span>
                        </div>
                        {run.cost !== undefined && (
                          <div className="text-[10px] text-terminal-dim font-mono">{formatCents(Math.round(run.cost * 100))}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-terminal-dim">No data available</div>
          )}

          {/* Extension content (AgentHub tabs, etc.) */}
          {children}
        </div>
      </div>
    </>
  );
}
