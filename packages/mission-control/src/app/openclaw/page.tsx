export const dynamic = 'force-dynamic';

import {
  getGatewayHealth,
  getSessions,
  getChannels,
  getCronJobs,
  getCronStatus,
  getSkills,
  getGatewayConfig,
  getModels,
} from '@/lib/openclaw';
import type {
  GatewayStatus,
  ChannelStatus,
  SessionInfo,
  CronJob,
  CronStatus,
  SkillInfo,
  GatewayConfig,
  ModelInfo,
} from '@/types/gateway';
import { HealthDot } from '@/components/health-dot';
import { StatusBadge } from '@/components/status-badge';
import { OpenClawSettingsDrawer } from '@/components/openclaw-settings-drawer';
import { OpenClawLiveWrapper } from '@/components/openclaw-live-wrapper';

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateInput: string | number): string {
  const timestamp = typeof dateInput === 'number' ? dateInput : new Date(dateInput).getTime();
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── SVG Icons ────────────────────────────────────────────────────────────────

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className ?? 'w-4 h-4'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function OpenClawPage() {
  const [gateway, sessions, channels, cronJobs, cronStatus, skills, config, models] = await Promise.all([
    getGatewayHealth(),
    getSessions(),
    getChannels(),
    getCronJobs(),
    getCronStatus(),
    getSkills(),
    getGatewayConfig(),
    getModels(),
  ]);

  const openClawUrl = process.env.OPENCLAW_URL || '';

  // Derive alerts from current state
  const alerts: Array<{ level: 'error' | 'warning'; message: string }> = [];
  if (!gateway) {
    alerts.push({ level: 'error', message: 'Gateway unreachable' });
  }
  const disconnectedChannels = channels.filter((ch) => !ch.connected);
  if (disconnectedChannels.length > 0) {
    alerts.push({
      level: 'warning',
      message: `${disconnectedChannels.length} channel${disconnectedChannels.length > 1 ? 's' : ''} disconnected`,
    });
  }

  return (
    <OpenClawLiveWrapper>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-terminal-purple">OpenClaw</h1>
          <p className="text-xs text-terminal-dim">Orchestrator — Gateway to the Agent Fleet</p>
        </div>
        <div className="flex items-center gap-2">
          {gateway ? <StatusBadge status="active" /> : <StatusBadge status="error" />}
          <OpenClawSettingsDrawer
            gateway={gateway}
            config={config}
            cronJobs={cronJobs}
            cronStatus={cronStatus}
            sessions={sessions}
            channels={channels}
            skills={skills}
            models={models}
          />
        </div>
      </div>

      {/* ── Full-width layout ───────────────────────────────────── */}
      <div className="space-y-6">

        {/* ── Card 1: Gateway Health (Hero) — full width ──────── */}
        <div className="bg-terminal-surface border border-terminal-purple/30 rounded p-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
            Gateway Health
          </h2>
          {gateway ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-terminal-bg rounded text-center">
                  <div className="text-lg font-bold text-terminal-green">Connected</div>
                  <div className="text-[10px] text-terminal-dim">Status</div>
                </div>
                <div className="p-3 bg-terminal-bg rounded text-center">
                  <div className="text-lg font-bold text-terminal-purple">{gateway.model || 'Unknown'}</div>
                  <div className="text-[10px] text-terminal-dim">Model</div>
                </div>
                <div className="p-3 bg-terminal-bg rounded text-center">
                  <div className="text-lg font-bold text-terminal-text">{gateway.version || 'N/A'}</div>
                  <div className="text-[10px] text-terminal-dim">Version</div>
                </div>
                <div className="p-3 bg-terminal-bg rounded text-center">
                  <div className="text-lg font-bold text-terminal-text">{sessions.length}</div>
                  <div className="text-[10px] text-terminal-dim">Sessions</div>
                </div>
                <div className="p-3 bg-terminal-bg rounded text-center sm:col-span-2">
                  <div className="text-lg font-bold text-terminal-text">
                    {gateway.contextTokens ? `${Math.round(gateway.contextTokens / 1000)}k` : '—'} / {gateway.totalTokens ? `${Math.round(gateway.totalTokens / 1000)}k` : '—'}
                  </div>
                  <div className="text-[10px] text-terminal-dim">Context / Total Tokens</div>
                </div>
              </div>
              <div className="flex gap-4 mt-3 text-xs text-terminal-dim">
                <span>
                  Thinking:{' '}
                  <span className="text-terminal-text">{gateway.thinkMode || 'off'}</span>
                </span>
                <span>
                  Elevated:{' '}
                  <span className={gateway.elevated ? 'text-terminal-green' : 'text-terminal-text'}>
                    {gateway.elevated ? 'on' : 'off'}
                  </span>
                </span>
                {gateway.uptime && (
                  <span>
                    Uptime: <span className="text-terminal-text">{gateway.uptime}</span>
                  </span>
                )}
              </div>
              {openClawUrl && (
                <div className="mt-3">
                  <a
                    href={openClawUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-terminal-blue hover:underline font-mono"
                  >
                    Open WebUI ↗
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-terminal-dim">Gateway unreachable</div>
          )}
        </div>

        {/* ── Row: Model Pipeline + Sessions side by side ─────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Card 2: Model Pipeline */}
          <div className="bg-terminal-surface border border-terminal-purple/30 rounded p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
              Model Pipeline
            </h2>
            <div className="space-y-2">
              {models.length > 0 ? (
                models.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-2 bg-terminal-bg rounded">
                    <div className="flex items-center gap-2">
                      <HealthDot healthy={m.available} />
                      <span className="text-xs text-terminal-purple">{m.alias || m.id}</span>
                      <span className="text-[10px] text-terminal-dim">{m.provider}</span>
                    </div>
                    <StatusBadge status={m.available ? 'active' : 'error'} />
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between p-2 bg-terminal-bg rounded">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-terminal-dim">Primary</span>
                    <span className="text-xs text-terminal-purple">{gateway?.model || 'Unknown'}</span>
                  </div>
                  <StatusBadge status="active" />
                </div>
              )}
            </div>
            {gateway && (
              <div className="flex gap-4 mt-3 text-xs text-terminal-dim">
                <span>
                  Thinking:{' '}
                  <span className="text-terminal-text">{gateway.thinkMode || 'off'}</span>
                </span>
                <span>
                  Elevated:{' '}
                  <span className={gateway.elevated ? 'text-terminal-green' : 'text-terminal-text'}>
                    {gateway.elevated ? 'on' : 'off'}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Card 3: Sessions & Load */}
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
              Sessions & Load
            </h2>
            <div className="mb-3">
              <div className="text-lg font-bold text-terminal-text">
                {sessions.length}
                <span className="text-xs font-normal text-terminal-dim ml-2">Active Sessions</span>
              </div>
            </div>

            {sessions.length > 0 ? (
              <div className="space-y-1">
                {sessions.slice(0, 5).map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-xs py-1">
                    <div className="flex items-center gap-2 truncate max-w-[300px]">
                      <span className="text-terminal-text">{s.displayName || s.key}</span>
                      {s.channel && (
                        <span className="text-[10px] text-terminal-dim">{s.channel}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.totalTokens && s.contextTokens && (
                        <span className="text-[10px] text-terminal-dim">
                          {Math.round(s.totalTokens / 1000)}k/{Math.round(s.contextTokens / 1000)}k
                        </span>
                      )}
                      <span className="text-[10px] text-terminal-dim">
                        {s.updatedAt ? relativeTime(s.updatedAt) : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-terminal-dim">No session data</div>
            )}
          </div>
        </div>

        {/* ── Card 4: Channels — full width ──────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
            Channels
          </h2>
          {channels.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {channels.map((ch) => (
                <div key={ch.provider} className="flex items-center gap-2 p-2 bg-terminal-bg rounded">
                  <HealthDot healthy={ch.connected} />
                  <div>
                    <div className="text-xs text-terminal-text capitalize">{ch.provider}</div>
                    {ch.error && (
                      <div className="text-[10px] text-terminal-red truncate max-w-[120px]">{ch.error}</div>
                    )}
                    {ch.stats && (
                      <div className="text-[10px] text-terminal-dim">
                        {ch.stats.sent}s / {ch.stats.received}r
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-terminal-dim">No channel data</div>
          )}
        </div>

        {/* ── Card 5: Cron Jobs — full width ─────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
            Cron Jobs
          </h2>
          {cronJobs.length > 0 ? (
            <div className="space-y-1">
              {cronJobs.map((job) => (
                  <div key={job.name} className="flex items-center justify-between py-1.5 border-b border-terminal-border/30 last:border-0">
                    <div className="flex items-center gap-2">
                      <HealthDot healthy={job.enabled} />
                      <span className="text-xs text-terminal-text">{job.name}</span>
                      <span className="text-[10px] text-terminal-dim font-mono">{job.schedule.expr || job.schedule.at || (job.schedule.everyMs ? `every ${Math.round(job.schedule.everyMs / 60000)}m` : job.schedule.kind)}</span>
                    </div>
                  </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-terminal-dim">No cron jobs configured</div>
          )}
        </div>

        {/* ── Card 6: Skills — full width ─────────────────────── */}
        {skills.length > 0 && (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
              Skills ({skills.length})
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {skills.map((skill) => (
                <div key={skill.name} className="p-2 bg-terminal-bg rounded">
                  <div className="text-xs text-terminal-text">{skill.name}</div>
                  {skill.description && (
                    <div className="text-[10px] text-terminal-dim truncate">{skill.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </OpenClawLiveWrapper>
  );
}
