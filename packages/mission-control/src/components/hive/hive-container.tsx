'use client';

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { HiveGraph } from './hive-graph';
import { HiveOverlayWrapper } from './hive-overlay-wrapper';
import { ViewModeToggle } from './view-mode-toggle';
import { ParticleEngine } from '@/lib/hive/particle-engine';
import { useHiveSSE } from '@/hooks/use-hive-sse';
import { useDeviceClass, useWindowSize } from '@/hooks/use-media-query';
import { MobileAgentList } from './mobile-agent-list';
import { MobileHiveSummary } from './mobile-hive-summary';
import { MobileNavBar, type MobileTab } from '@/components/mobile-nav-bar';
import { BottomSheet } from '@/components/mobile-bottom-sheet';
import { useHiveGraphData } from './use-hive-graph-data';
import { getAgent } from '@/lib/agents';
import type { AgentRealtimeStatus, ViewMode } from './hive-types';
import type { ExternalActivity } from './external-tooltip';

// Dynamic import for 3D renderer (SSR disabled — needs WebGL/DOM)
const GraphRenderer3D = dynamic(
  () => import('./graph-renderer-3d').then(m => ({ default: m.GraphRenderer3D })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full font-sans text-mc-text-tertiary">
        Loading 3D...
      </div>
    ),
  }
);

interface HiveContainerProps {
  agentActivity: Record<string, { activeSessions: number; lastRunAt?: string; lastStatus?: string }>;
}

export function HiveContainer({ agentActivity }: HiveContainerProps) {
  const router = useRouter();
  const device = useDeviceClass();
  const { width, height } = useWindowSize();
  const agentStatusRef = useRef(new Map<string, AgentRealtimeStatus>());
  const externalActivityRef = useRef(new Map<string, ExternalActivity>());
  const [mobileTab, setMobileTab] = useState<MobileTab>('hive');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [, setMobileStatusVersion] = useState(0);

  const isPhone = device === 'phone';
  const isDesktop = device === 'desktop';
  const graphData = useHiveGraphData();

  const particleEngine = useMemo(
    () => new ParticleEngine(!isDesktop),
    [isDesktop]
  );

  const handleStatusChange = useCallback(() => {
    if (device === 'phone') {
      setMobileStatusVersion((version) => version + 1);
    }
  }, [device]);

  useHiveSSE({ particleEngine, agentStatusRef, externalActivityRef, onStatusChange: handleStatusChange });

  useEffect(() => () => particleEngine.destroy(), [particleEngine]);

  const handleAgentTap = useCallback((agentName: string) => {
    setSelectedAgent(agentName);
    setSheetOpen(true);
  }, []);

  // Phone layout
  if (isPhone) {
    return (
      <div className="h-full flex flex-col bg-mc-bg">
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'hive' ? (
            <MobileHiveSummary agentStatusRef={agentStatusRef} />
          ) : mobileTab === 'agents' ? (
            <MobileAgentList
              agentStatusRef={agentStatusRef}
              onAgentTap={handleAgentTap}
            />
          ) : mobileTab === 'settings' ? (
            <div className="px-4 pt-4 space-y-3">
              <p className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label">Quick Links</p>
              <a href="/settings" className="block font-mono text-sm text-mc-accent py-2 border-b border-mc-border hover:text-mc-text transition-colors duration-mc ease-mc-out">
                Fleet Settings
              </a>
              <a href="/events" className="block font-mono text-sm text-mc-accent py-2 border-b border-mc-border hover:text-mc-text transition-colors duration-mc ease-mc-out">
                Event Stream
              </a>
              <a href="/system/queues" className="block font-mono text-sm text-mc-accent py-2 border-b border-mc-border hover:text-mc-text transition-colors duration-mc ease-mc-out">
                Task Queue
              </a>
              <a href="/system/approvals" className="block font-mono text-sm text-mc-accent py-2 border-b border-mc-border hover:text-mc-text transition-colors duration-mc ease-mc-out">
                Approvals
              </a>
              <p className="font-sans text-[10px] text-mc-text-tertiary pt-2">
                Full settings are available on desktop.
              </p>
            </div>
          ) : null}
        </div>

        <BottomSheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
        >
          <div className="px-4">
            <h2 className="font-sans text-lg font-extralight text-mc-text capitalize mb-4">
              {selectedAgent}
            </h2>
            <AgentDetailMobile
              agentName={selectedAgent}
              status={agentStatusRef.current.get(selectedAgent || '')}
            />
          </div>
        </BottomSheet>

        <MobileNavBar activeTab={mobileTab} onTabChange={setMobileTab} />
      </div>
    );
  }

  // Tablet and desktop
  return (
    <>
      <HiveOverlayWrapper />

      {/* Toolbar overlay */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <ViewModeToggle
          mode={viewMode}
          onChange={setViewMode}
          disabled={!isDesktop}
          disabledReason="3D requires desktop"
        />
      </div>

      {viewMode === '2d' ? (
        <HiveGraph
          agentActivity={agentActivity}
          particleEngine={particleEngine}
          agentStatusRef={agentStatusRef}
          externalActivityRef={externalActivityRef}
          performanceMode={!isDesktop}
        />
      ) : (
        <GraphRenderer3D
          graphData={graphData}
          agentStatusRef={agentStatusRef}
          width={width}
          height={height}
          onNodeClick={(node: any) => {
            const agent = getAgent(node.id);
            if (agent) {
              router.push(`/departments/${agent.department}?agent=${node.id}`);
            }
          }}
        />
      )}
    </>
  );
}

function AgentDetailMobile({
  agentName,
  status,
}: {
  agentName: string | null;
  status?: AgentRealtimeStatus;
}) {
  if (!agentName) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-mc-border rounded-panel bg-transparent p-3">
          <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label">Status</div>
          <div className="font-sans text-sm text-mc-text capitalize mt-1">
            {status?.state || 'unknown'}
          </div>
        </div>
        <div className="border border-mc-border rounded-panel bg-transparent p-3">
          <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label">Executions (5m)</div>
          <div className="font-mono tabular-nums text-sm text-mc-text mt-1">
            {status?.execCount5m || 0}
          </div>
        </div>
      </div>
      <div className="border border-mc-border rounded-panel bg-transparent p-3">
        <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-1">Last Run</div>
        <div className="font-mono tabular-nums text-sm text-mc-text-secondary">
          {status?.lastRunAt
            ? new Date(status.lastRunAt).toLocaleString()
            : 'Never'}
        </div>
      </div>
    </div>
  );
}
