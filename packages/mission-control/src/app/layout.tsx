// Force dynamic rendering — prevents Next.js from attempting static
// optimisation of the root layout during RSC prefetch. Without this,
// prefetch requests for most routes return 503 because the layout's
// async data-fetching (Redis, MongoDB, gateway WS) fails in the static
// render context. See: https://github.com/yclaw-ai/yclaw/issues/437
export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Nav } from '@/components/nav';
import { SidebarWrapper } from '@/components/sidebar-wrapper';
import { StatusHeader } from '@/components/status-header';
import { ChatDrawer } from '@/components/chat-drawer';
import { ToastContainer } from '@/components/toast-container';

import { redisPing, redisGet, getRedisConnectionState } from '@/lib/redis';
import { getGatewayHealth } from '@/lib/openclaw';
import { getEcsFleetStatus, type EcsFleetStatus } from '@/lib/actions/ecs-fleet';
import { getDb } from '@/lib/mongodb';
import { getAllAgentStatuses } from '@/lib/agent-statuses';
import { getActiveAlerts } from '@/lib/alerts';
import type { FleetStatus } from '@/lib/actions/fleet';

export const metadata: Metadata = {
  title: 'YClaw Mission Control',
  description: 'Department-centric command center for the YClaw Agent System',
};

// SpaceX aesthetic font stack (Phase 1). Inter ultralight (200–400) for UI
// labels/headings, JetBrains Mono for data/code/metrics. Exposed as CSS
// variables so Tailwind's font-sans / font-mono utilities resolve to them.
const inter = Inter({
  subsets: ['latin'],
  weight: ['200', '300', '400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/** Race a promise against a timeout — returns fallback if the promise takes too long */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const ECS_FALLBACK: EcsFleetStatus = { desiredCount: 0, runningCount: 0, status: 'error' };

async function getInitialState() {
  // Wrap the entire function body so a partial failure in any data source
  // never propagates as an unhandled rejection and causes a 503 response.
  try {
    const [db, redisOk, gateway, ecsStatus, agentStatuses, alerts] = await Promise.all([
      withTimeout(getDb(), 3000, null),
      withTimeout(redisPing(), 3000, false),
      withTimeout(getGatewayHealth(), 3000, null),
      withTimeout(getEcsFleetStatus(), 800, ECS_FALLBACK),
      withTimeout(getAllAgentStatuses(), 3000, {}),
      withTimeout(getActiveAlerts(), 3000, []),
    ]);

    let fleetStatus: FleetStatus = 'unknown';
    try {
      const raw = await withTimeout(redisGet('fleet:status'), 1000, null);
      if (raw === 'active') fleetStatus = 'active';
      else if (raw === 'paused') fleetStatus = 'paused';
    } catch { /* stays unknown */ }

    return {
      health: {
        mongo: db !== null,
        redis: redisOk,
        redisState: getRedisConnectionState(),
        gateway: gateway !== null,
        gatewayVersion: gateway?.version,
      },
      fleetStatus,
      ecsStatus,
      agentStatuses,
      alertCount: alerts.length,
    };
  } catch {
    // Last-resort fallback — return safe defaults so the layout always renders
    return {
      health: {
        mongo: false,
        redis: false,
        redisState: getRedisConnectionState(),
        gateway: false,
        gatewayVersion: undefined,
      },
      fleetStatus: 'unknown' as FleetStatus,
      ecsStatus: ECS_FALLBACK,
      agentStatuses: {} as Record<string, import('@/lib/agent-statuses').AgentStatus>,
      alertCount: 0,
    };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { health, fleetStatus, ecsStatus, agentStatuses, alertCount } = await getInitialState();

  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-terminal-bg text-terminal-text font-mono min-h-screen">
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <SidebarWrapper>
              <Nav agentStatuses={agentStatuses} />
            </SidebarWrapper>

            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <StatusHeader
                initialHealth={health}
                initialFleetStatus={fleetStatus}
                initialEcsStatus={ecsStatus}
                initialAlertCount={alertCount}
              />
              <main className="flex-1 overflow-y-auto p-6">
                {children}
              </main>
            </div>

            <ChatDrawer />
            <ToastContainer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
