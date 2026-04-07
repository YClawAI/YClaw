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
      <div className="flex items-center justify-center h-full text-gray-500">
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
      <div className="h-full flex flex-col bg-gray-950">
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
              <p className="text-sm text-gray-300 font-medium">Quick Links</p>
              <a href="/settings" className="block text-sm text-blue-400 py-2 border-b border-gray-800">
                Fleet Settings
              </a>
              <a href="/events" className="block text-sm text-blue-400 py-2 border-b border-gray-800">
                Event Stream
              </a>
              <a href="/system/queues" className="block text-sm text-blue-400 py-2 border-b border-gray-800">
                Task Queue
              </a>
              <a href="/system/approvals" className="block text-sm text-blue-400 py-2 border-b border-gray-800">
                Approvals
              </a>
              <p className="text-[10px] text-gray-500 pt-2">
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
            <h2 className="text-lg font-semibold text-gray-100 capitalize mb-4">
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
        <div className="bg-gray-800/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">Status</div>
          <div className="text-sm font-medium text-gray-100 capitalize mt-1">
            {status?.state || 'unknown'}
          </div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">Executions (5m)</div>
          <div className="text-sm font-medium text-gray-100 mt-1">
            {status?.execCount5m || 0}
          </div>
        </div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-3">
        <div className="text-xs text-gray-400 mb-1">Last Run</div>
        <div className="text-sm text-gray-200">
          {status?.lastRunAt
            ? new Date(status.lastRunAt).toLocaleString()
            : 'Never'}
        </div>
      </div>
    </div>
  );
}
