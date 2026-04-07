export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import { redisZcard, getRedisConnectionState } from '@/lib/redis';
import { AGENTS, DEPARTMENTS, DEPT_META, getAgentsByDept } from '@/lib/agents';
import { LiveActivity } from '@/components/live-activity';
import { HiveContainer } from '@/components/hive/hive-container';
import { DEPT_HEX } from '@/components/hive/hive-types';
import { OrgSidecar } from '@/components/org-sidecar';
import { getEcsFleetStatus } from '@/lib/actions/ecs-fleet';
import { AlertBoard } from '@/components/alert-board';
import { getActiveAlerts } from '@/lib/alerts';

interface AgentActivity {
  agentId?: string;
  activeSessions: number;
  lastRunAt?: string;
  lastStatus?: string;
}

interface RecentRun {
  agentId: string;
  status: string;
  createdAt: string;
  taskId?: string;
  executionId?: string;
}

async function getDashboardData() {
  const [db, ecsStatus, derivedAlerts] = await Promise.all([getDb(), getEcsFleetStatus(), getActiveAlerts()]);
  const agentActivity: Record<string, AgentActivity> = {};
  const recentRuns: RecentRun[] = [];

  let queueDepth = 0;
  try {
    const queueCounts = await Promise.all(
      ['P0', 'P1', 'P2', 'P3'].map((priority) => redisZcard(`builder:task_queue:${priority}`)),
    );
    queueDepth = queueCounts.reduce((sum, count) => sum + count, 0);
  } catch { /* graceful */ }

  if (db) {
    try {
      const runs = await db
        .collection('run_records')
        .find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();

      for (const run of runs) {
        const agentId = run.agentId as string | undefined;
        if (!agentId) continue;

        if (recentRuns.length < 15) {
          recentRuns.push({
            agentId,
            status: run.status as string,
            createdAt: run.createdAt as string,
            taskId: run.taskId as string | undefined,
            executionId: run.executionId as string | undefined,
          });
        }
        if (!agentActivity[agentId]) {
          agentActivity[agentId] = {
            agentId,
            activeSessions: 0,
            lastStatus: run.status as string,
            lastRunAt: run.createdAt as string,
          };
        } else if (!agentActivity[agentId]!.lastRunAt) {
          agentActivity[agentId]!.lastStatus = run.status as string;
          agentActivity[agentId]!.lastRunAt = run.createdAt as string;
        }
      }
    } catch { /* graceful */ }
  }

  const activeAgents = Object.values(agentActivity).filter((a) => a.activeSessions > 0).length;

  const redisState = getRedisConnectionState();

  return {
    agentActivity,
    recentRuns,
    activeAgents,
    totalAgents: AGENTS.length,
    sessionCount: 0,
    queueDepth,
    redisAvailable: redisState === 'connected',
    ecsStatus,
    derivedAlerts,
  };
}

export default async function MissionControlHome() {
  const { agentActivity, recentRuns, activeAgents, totalAgents, sessionCount, queueDepth, redisAvailable, ecsStatus, derivedAlerts } = await getDashboardData();
  return (
    <div className="space-y-6">
      {/* ── Zone 1: The Hive — Live Agent Visualization ──────────── */}
      <section
        className="relative bg-terminal-surface border border-terminal-border rounded overflow-hidden"
        style={{ height: 'clamp(450px, 60vh, 750px)' }}
      >
        {/* Header overlay */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
            THE HIVE
          </h2>
          <span className="text-[10px] text-terminal-dim/40 hidden sm:inline">
            Live Agent Visualization
          </span>
        </div>

        {/* Department legend */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-x-4 gap-y-1">
          {DEPARTMENTS.map((dept) => {
            const meta = DEPT_META[dept];
            const hex = DEPT_HEX[dept];
            const agents = getAgentsByDept(dept);
            const activeCount = agents.filter(
              (a) => (agentActivity[a.name]?.activeSessions ?? 0) > 0,
            ).length;

            return (
              <Link
                key={dept}
                href={`/departments/${dept}`}
                className="flex items-center gap-1.5 text-[10px] hover:opacity-80 transition-opacity"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: hex }}
                />
                <span className="text-terminal-dim">{meta.label}</span>
                <span className="font-mono" style={{ color: hex }}>
                  {agents.length}
                </span>
                {activeCount > 0 && (
                  <span className="text-terminal-green font-mono">
                    ({activeCount})
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Force graph + particle engine */}
        <HiveContainer agentActivity={agentActivity} />

      </section>

      {/* ── Section header with Settings ────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-terminal-text">Mission Control</h2>
        <OrgSidecar />
      </div>

      {/* ── Zone 2: KPI Stats ────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Active Agents"
            value={`${activeAgents}/${totalAgents}`}
            sub={`${totalAgents - activeAgents} idle`}
          />
          <StatCard label="Active Sessions" value={sessionCount.toString()} />
          <StatCard
            label="Tasks in Queue"
            value={redisAvailable ? queueDepth.toString() : '—'}
            sub={redisAvailable ? undefined : 'Redis reconnecting'}
            href="/system/queues"
          />
          <StatCard
            label="Active Alerts"
            value={derivedAlerts.length.toString()}
            sub={derivedAlerts.length === 0 ? 'No active alerts' : `${derivedAlerts.length} alert${derivedAlerts.length !== 1 ? 's' : ''} detected`}
          />
        </div>
      </section>

      {/* ── Zone 3: Activity Feed + Quick Actions ────────────────── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <LiveActivity initialRuns={recentRuns} />
          </div>
          <div className="lg:col-span-2 space-y-4">
            {/* Alert Board */}
            <AlertBoard alerts={derivedAlerts} />

            {/* Top Active Agents */}
            <div className="bg-terminal-surface border border-terminal-border rounded p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
                Top Active
              </h3>
              {Object.entries(agentActivity)
                .filter(([, a]) => a.activeSessions > 0)
                .sort(([, a], [, b]) => b.activeSessions - a.activeSessions)
                .slice(0, 5)
                .map(([name, act]) => {
                  const agent = AGENTS.find((a) => a.name === name);
                  return (
                    <div
                      key={name}
                      className="flex items-center justify-between py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span>{agent?.emoji || '?'}</span>
                        <span className="text-terminal-text">
                          {agent?.label || name}
                        </span>
                      </div>
                      <span className="text-terminal-cyan font-mono">
                        {act.activeSessions} sessions
                      </span>
                    </div>
                  );
                })}
              {Object.values(agentActivity).every(
                (a) => a.activeSessions === 0,
              ) && (
                <div className="text-xs text-terminal-dim">
                  No active agents
                </div>
              )}
            </div>

            {/* Quick Links */}
            <div className="bg-terminal-surface border border-terminal-border rounded p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
                Quick Links
              </h3>
              <div className="space-y-1.5">
                <Link
                  href="/openclaw"
                  className="block text-xs text-terminal-purple hover:text-terminal-text transition-colors font-mono"
                >
                  &rarr; OpenClaw Orchestrator
                </Link>
                <Link
                  href="/system/queues"
                  className="block text-xs text-terminal-blue hover:text-terminal-text transition-colors font-mono"
                >
                  &rarr; Task Queue
                </Link>
                <Link
                  href="/system/approvals"
                  className="block text-xs text-terminal-orange hover:text-terminal-text transition-colors font-mono"
                >
                  &rarr; Pending Approvals
                </Link>
                <Link
                  href="/system/vault"
                  className="block text-xs text-terminal-green hover:text-terminal-text transition-colors font-mono"
                >
                  &rarr; Claudeception Vault
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const content = (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4 hover:border-terminal-muted transition-colors">
      <div className="text-2xl font-bold text-terminal-text font-mono">
        {value}
      </div>
      <div className="text-xs text-terminal-dim mt-1">{label}</div>
      {sub && (
        <div className="text-[10px] text-terminal-dim/60 mt-0.5">{sub}</div>
      )}
    </div>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}
