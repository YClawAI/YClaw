'use client';

import { useState, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { TabLayout } from '@/components/tab-layout';
import { KPICard } from '@/components/kpi-card';
import { EventFeed } from '@/components/event-feed';
import { MarketingSettings } from '@/components/marketing-settings';
import { BatchCountdown } from '@/components/batch-countdown';
import { MarketingAgentCard } from '@/components/marketing-agent-card';
import { ContentCalendar } from '@/components/content-calendar';
import { PostPerformanceTable } from '@/components/post-performance';
import { ForgeGallery } from '@/components/forge-gallery';
import { ScoutIntel } from '@/components/scout-intel';
import { AgentDetailDrawer } from '@/components/agent-detail-drawer';
import { ExperimentDashboard } from '@/components/agenthub/ExperimentDashboard';
import { CrossLearnPanel } from '@/components/agenthub/CrossLearnPanel';
import { GrowthControlPanel } from '@/components/agenthub/GrowthControlPanel';
import { AgentHubTabs } from '@/components/agenthub/AgentHubTabs';
import type { AHCommit, AHPost, AgentHubHealth } from '@/lib/agenthub-api';
import type { AgentInfo } from '@/lib/agents';
import type { DepartmentBaseData } from '@/lib/department-data';
import type { DepartmentKPIs } from '@/lib/department-kpis';
import type { RunRecord } from '@/lib/run-records';
import type { PublishedContent, ForgeAssetRecord, ScoutReport } from '@/lib/marketing-queries';
import type { AgentSpend } from '@/lib/cost-queries';
import type { CronSchedule } from '@/lib/yclaw-api';
import type { CalendarSlot } from '@/components/content-calendar';
import type { AgentBudget } from '@/lib/actions/budget';
import type { BudgetMode } from '@/lib/actions/budget-config';
import type { GrowthRuntimeStatus } from '@/lib/runtime-controls';

// ─── Ember Schedule Mapping ─────────────────────────────────────────────────

const EMBER_CRON_MAP: { taskId: string; time: string; label: string; days: string[] }[] = [
  { taskId: 'morning_batch', time: '14:00', label: 'Morning Batch (10am ET)', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  { taskId: 'midday_post', time: '16:30', label: 'Midday Post (12:30pm ET)', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  { taskId: 'afternoon_engagement', time: '22:00', label: 'Afternoon Engagement (6pm ET)', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  { taskId: 'weekend_content', time: '15:00', label: 'Weekend Content (11am ET)', days: ['sat', 'sun'] },
];

/** Parse a cron expression (min hour * * dow) to extract HH:MM time string */
function parseCronTime(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parts[0];
  const hour = parts[1];
  if (minute === undefined || hour === undefined) return null;
  const m = parseInt(minute, 10);
  const h = parseInt(hour, 10);
  if (isNaN(m) || isNaN(h)) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Map cron DOW field to day keys. Supports 0-6 (Sun-Sat) and 1-7 (Mon-Sun), ranges, and lists */
function parseCronDays(expr: string): string[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return [];
  const dow = parts[4];
  if (!dow || dow === '*') return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const dayMap: Record<string, string> = {
    '0': 'sun', '1': 'mon', '2': 'tue', '3': 'wed', '4': 'thu', '5': 'fri', '6': 'sat', '7': 'sun',
  };
  const days: string[] = [];
  for (const segment of dow.split(',')) {
    const rangeParts = segment.split('-');
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0] ?? '', 10);
      const end = parseInt(rangeParts[1] ?? '', 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          const d = dayMap[String(i)];
          if (d && !days.includes(d)) days.push(d);
        }
      }
    } else {
      const d = dayMap[segment];
      if (d && !days.includes(d)) days.push(d);
    }
  }
  return days;
}

function buildCalendarSlots(schedules: CronSchedule[]): CalendarSlot[] {
  const emberSchedules = schedules.filter(s => s.agentId === 'ember');
  const slots: CalendarSlot[] = [];
  const usedKeys = new Set<string>();

  // First, map schedules using parsed cron expressions
  for (const sched of emberSchedules) {
    const time = parseCronTime(sched.schedule);
    const days = parseCronDays(sched.schedule);
    if (!time || days.length === 0) continue;

    // Find matching label from EMBER_CRON_MAP
    const match = EMBER_CRON_MAP.find(c => c.taskId === sched.taskId);
    const label = match?.label ?? sched.taskId;

    for (const day of days) {
      const key = `${day}:${time}`;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      slots.push({
        day,
        time,
        topic: `${label} — Scheduled`,
        status: sched.lastRunAt ? 'published' : undefined,
      });
    }
  }

  // Fill in any EMBER_CRON_MAP entries not covered by live schedules
  for (const cron of EMBER_CRON_MAP) {
    for (const day of cron.days) {
      const key = `${day}:${cron.time}`;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      slots.push({
        day,
        time: cron.time,
        topic: `${cron.label} — Not scheduled`,
      });
    }
  }

  return slots;
}

const DAY_TO_DOW: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function computeNextFireDate(day: string, time: string): Date {
  const [hourStr, minStr] = time.split(':');
  const hour = parseInt(hourStr ?? '0', 10);
  const min = parseInt(minStr ?? '0', 10);
  const targetDow = DAY_TO_DOW[day] ?? 0;

  const now = new Date();
  let daysUntil = (targetDow - now.getUTCDay() + 7) % 7;

  // If today, check whether the UTC fire time has already passed
  if (daysUntil === 0) {
    const todayFire = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, min, 0, 0,
    ));
    if (todayFire <= now) daysUntil = 7;
  }

  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntil, hour, min, 0, 0,
  ));
}

function formatNextFireDate(date: Date): string {
  const now = new Date();
  const diffDays = Math.floor((date.getTime() - now.getTime()) / 86400000);
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const timeStr = `${h}:${m} UTC`;
  if (diffDays === 0) return `Today ${timeStr}`;
  if (diffDays === 1) return `Tomorrow ${timeStr}`;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${dayNames[date.getUTCDay()] ?? ''} ${timeStr}`;
}

function buildStaticCalendarSlots(): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  for (const cron of EMBER_CRON_MAP) {
    for (const day of cron.days) {
      const nextFire = computeNextFireDate(day, cron.time);
      slots.push({
        day,
        time: cron.time,
        topic: `${cron.label} — Next: ${formatNextFireDate(nextFire)}`,
      });
    }
  }
  return slots;
}

function getNextBatchCountdown(schedules: CronSchedule[]): { label: string; muted: boolean } {
  const emberSchedules = schedules.filter(s => s.agentId === 'ember');
  if (emberSchedules.length === 0) {
    return { label: 'No upcoming batches', muted: true };
  }

  const withNextFire = emberSchedules
    .filter(s => s.nextFireAt)
    .map(s => ({ ...s, nextFireMs: new Date(s.nextFireAt!).getTime() }))
    .sort((a, b) => a.nextFireMs - b.nextFireMs);

  if (withNextFire.length === 0) {
    return { label: 'No upcoming fires scheduled', muted: true };
  }

  const next = withNextFire[0]!;
  const diffMs = next.nextFireMs - Date.now();
  if (diffMs <= 0) {
    return { label: `${next.taskId} — firing now`, muted: false };
  }
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return {
    label: `${next.taskId} in ${hours}h ${mins}m`,
    muted: false,
  };
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'experiments', label: 'Experiments' },
  { key: 'content', label: 'Content' },
  { key: 'studio', label: 'Studio' },
  { key: 'intel', label: 'Intel' },
  { key: 'activity', label: 'Activity' },
];

// ─── Main Client ────────────────────────────────────────────────────────────

interface MarketingClientProps {
  agents: AgentInfo[];
  live?: DepartmentBaseData;
  kpis: DepartmentKPIs;
  recentRuns: RunRecord[];
  publishedContent: PublishedContent[];
  forgeAssets: ForgeAssetRecord[];
  scoutReports: ScoutReport[];
  agentSpend: AgentSpend[];
  schedules: CronSchedule[];
  budgets?: AgentBudget[];
  budgetMode?: BudgetMode;
  ahExperimentPosts?: AHPost[];
  ahCrossLearnPosts?: AHPost[];
  ahCommits?: AHCommit[];
  growthStatus?: GrowthRuntimeStatus;
  agentHubHealth: AgentHubHealth;
}

function MarketingClientInner({ agents, live, kpis, recentRuns, publishedContent, forgeAssets, scoutReports, agentSpend, schedules, budgets, budgetMode, ahExperimentPosts, ahCrossLearnPosts, ahCommits, growthStatus, agentHubHealth }: MarketingClientProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const drawerAgent = searchParams.get('agent');

  const forgeRunCount = recentRuns.filter((r) => r.agentId === 'forge').length;
  const scoutRunCount = recentRuns.filter((r) => r.agentId === 'scout').length;

  // Build agent status lookup from live data
  const agentStatusMap = new Map<string, { status: string; lastRunAt?: string; runCount24h?: number }>();
  if (live) {
    for (const a of live.agents) {
      agentStatusMap.set(a.name, {
        status: a.state,
        lastRunAt: a.lastRunAt ? new Date(a.lastRunAt).toISOString() : undefined,
        runCount24h: a.execCount24h,
      });
    }
  }

  // Build calendar slots from schedules
  const hasLiveSchedules = schedules.length > 0;
  const calendarSlots = useMemo(() => {
    if (!hasLiveSchedules) return buildStaticCalendarSlots();
    return buildCalendarSlots(schedules);
  }, [schedules, hasLiveSchedules]);

  // Build batch countdown
  const batchCountdown = useMemo(() => getNextBatchCountdown(schedules), [schedules]);

  // Map published content → PostPerformance[]
  const postPerformanceData = useMemo(() =>
    publishedContent.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      publishedAt: c.publishedAt,
    })),
    [publishedContent],
  );

  // Map forge assets → ForgeAsset[]
  const forgeAssetData = useMemo(() =>
    forgeAssets.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      model: a.model,
    })),
    [forgeAssets],
  );

  // Map scout reports → IntelHighlight[]
  const intelHighlightData = useMemo(() =>
    scoutReports.map((r) => ({
      id: r.id,
      topic: r.topic,
      summary: r.summary,
      sentiment: r.sentiment,
    })),
    [scoutReports],
  );

  return (
    <>
      {/* Settings button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setSettingsOpen(true)}
          className="px-3 py-1.5 text-xs font-mono border border-terminal-border rounded text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface transition-colors"
        >
          Settings
        </button>
      </div>

      <TabLayout tabs={TABS} defaultTab="overview">
        {{
          /* ─── Overview Tab ─────────────────────────────────────────── */
          overview: (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  label="Runs (7d)"
                  value={String(kpis.runCount7d)}
                  subtext={`${kpis.runCount24h} in last 24h`}
                />
                <KPICard
                  label="Forge Runs (recent)"
                  value={String(forgeRunCount)}
                  subtext="Asset generation runs (from last 30 runs)"
                />
                <KPICard
                  label="Scout Runs (recent)"
                  value={String(scoutRunCount)}
                  subtext="Intel collection runs (from last 30 runs)"
                />
                <KPICard
                  label="Dept Spend (MTD)"
                  value={`$${kpis.spendMTD.toFixed(2)}`}
                  subtext={`${kpis.errorCount24h} errors (24h)`}
                />
              </div>

              {/* Batch Countdown */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Batch Countdown</span>
                </div>
                <BatchCountdown label={batchCountdown.label} muted={batchCountdown.muted} />
              </div>

              {/* Agent Cards */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold uppercase tracking-widest text-terminal-dim">AGENTS</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {agents.map((agent) => {
                    const info = agentStatusMap.get(agent.name);
                    return (
                      <MarketingAgentCard
                        key={agent.name}
                        agent={agent}
                        status={info?.status}
                        lastRunAt={info?.lastRunAt}
                        runCount24h={info?.runCount24h}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ),

          /* ─── Experiments Tab ──────────────────────────────────────── */
          experiments: (
            <div className="space-y-8">
              <GrowthControlPanel
                health={agentHubHealth}
                status={growthStatus ?? { enabled: false, channels: [], pendingApprovals: [] }}
              />
              <ExperimentDashboard
                resultPosts={ahExperimentPosts ?? []}
                growthStatus={growthStatus}
              />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">Cross-Channel Learning</h3>
                <CrossLearnPanel insights={ahCrossLearnPosts ?? []} />
              </div>
            </div>
          ),

          /* ─── Content Tab ──────────────────────────────────────────── */
          content: (
            <div className="space-y-8">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Content Calendar</span>
                <div className="mt-2">
                  <ContentCalendar slots={calendarSlots} scheduleSource={hasLiveSchedules ? 'live' : 'static'} />
                </div>
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Post Performance</span>
                <div className="mt-2">
                  <PostPerformanceTable posts={postPerformanceData} />
                </div>
              </div>
            </div>
          ),

          /* ─── Studio Tab ───────────────────────────────────────────── */
          studio: (
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Forge Gallery</span>
              <div className="mt-2">
                <ForgeGallery assets={forgeAssetData} requests={[]} />
              </div>
            </div>
          ),

          /* ─── Intel Tab ────────────────────────────────────────────── */
          intel: (
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-terminal-dim">Scout Intel</span>
              <div className="mt-2">
                <ScoutIntel
                  highlights={intelHighlightData}
                  prospects={[]}
                  outreach={[]}
                />
              </div>
            </div>
          ),

          /* ─── Activity Tab ─────────────────────────────────────────── */
          activity: (
            <EventFeed
              initialRuns={recentRuns.map((r) => ({
                agentId: r.agentId,
                status: r.status,
                createdAt: r.createdAt,
                taskId: r.taskId,
                executionId: r.executionId,
              }))}
              agentNames={agents.map((a) => a.name)}
            />
          ),
        }}
      </TabLayout>

      {/* Settings Drawer */}
      <MarketingSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Agent Detail Drawer */}
      <AgentDetailDrawer
        agentId={drawerAgent}
        open={!!drawerAgent}
        onClose={() => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete('agent');
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
        fleetOnline={live ? live.agents.some(a => a.state === 'active') : false}
      >
        {drawerAgent && <AgentHubTabs agentId={drawerAgent} commits={ahCommits ?? []} posts={ahExperimentPosts ?? []} />}
      </AgentDetailDrawer>
    </>
  );
}

export function MarketingClient(props: MarketingClientProps) {
  return (
    <Suspense fallback={<div className="text-xs text-terminal-dim text-center py-8">Loading marketing dashboard...</div>}>
      <MarketingClientInner {...props} />
    </Suspense>
  );
}
