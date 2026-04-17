'use client';

import { useState } from 'react';
import { useEventStream } from '@/lib/hooks/use-event-stream';
import type { AgentInfo, Department } from '@/lib/agents';

interface AgentStatus {
  agentId: string;
  activeSessions: number;
  lastRunAt?: string;
  lastStatus?: string;
}

interface LiveFleetGridProps {
  agents: AgentInfo[];
  departments: Department[];
  deptColors: Record<Department, string>;
  initialSessions: Record<string, number>;
  initialActivity: Record<string, { lastRunAt?: string; lastStatus?: string }>;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function healthColor(sessions: number, lastRunAt?: string): string {
  if (sessions > 0) return 'bg-mc-success shadow-[0_0_6px_#30D158]'; // active
  if (lastRunAt) {
    const diff = Date.now() - new Date(lastRunAt).getTime();
    if (diff < 3600_000) return 'bg-mc-warning shadow-[0_0_6px_#FFD60A]'; // idle <1h
    return 'bg-mc-blocked shadow-[0_0_4px_#FF9F0A]'; // offline >1h
  }
  return 'bg-mc-text-tertiary'; // never ran
}

export function LiveFleetGrid({ agents, departments, deptColors, initialSessions, initialActivity }: LiveFleetGridProps) {
  const [sessions, setSessions] = useState(initialSessions);
  const [activity, setActivity] = useState(initialActivity);

  useEventStream({
    'agent:status': (data) => {
      const statuses = data as AgentStatus[];
      const newSessions: Record<string, number> = {};
      for (const s of statuses) {
        newSessions[s.agentId] = s.activeSessions;
      }
      setSessions(newSessions);
      // Functional update avoids stale closure (Fix #6)
      setActivity((prev) => {
        const next = { ...prev };
        for (const s of statuses) {
          if (s.lastRunAt || s.lastStatus) {
            next[s.agentId] = { lastRunAt: s.lastRunAt, lastStatus: s.lastStatus };
          }
        }
        return next;
      });
    },
  });

  return (
    <>
      {departments.map((dept) => {
        const deptAgents = agents.filter((a) => a.department === dept);
        return (
          <div key={dept} className="mb-8">
            <h2 className={`text-xs font-bold uppercase tracking-widest mb-3 ${deptColors[dept]}`}>
              {dept}
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {deptAgents.map((agent) => {
                const sessionCount = sessions[agent.name] ?? 0;
                const agentActivity = activity[agent.name];
                const href = `/agents/${agent.name}`;
                const dotColor = healthColor(sessionCount, agentActivity?.lastRunAt);

                return (
                  <a
                    key={agent.name}
                    href={href}
                    className="flex flex-col gap-2 p-4 rounded border border-mc-border bg-mc-surface-hover hover:border-mc-border transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {agent.emoji && <span className="text-lg">{agent.emoji}</span>}
                        <span className="font-bold text-mc-text">{agent.label}</span>
                      </div>
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor}`} />
                    </div>
                    <p className="text-xs text-mc-text-tertiary">{agent.description}</p>
                    <div className="flex items-center gap-2 mt-auto text-xs">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-mono border ${
                        agent.system === 'yclaw'
                          ? 'bg-mc-info/10 text-mc-info border-mc-info/30'
                          : agent.system === 'openclaw'
                            ? 'bg-mc-accent/10 text-mc-accent border-mc-accent/30'
                            : 'bg-mc-warning/10 text-mc-warning border-mc-warning/30'
                      }`}>
                        {agent.system}
                      </span>
                      {sessionCount > 0 && (
                        <span className="text-mc-accent font-mono">
                          {sessionCount} session{sessionCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {agentActivity?.lastRunAt && (
                        <span className="ml-auto text-mc-text-tertiary font-mono">
                          {timeAgo(agentActivity.lastRunAt)}
                        </span>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
