'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useEventStream } from '@/lib/hooks/use-event-stream';
import { useChatStore } from '@/stores/chat-store';
import { FleetKillSwitch } from './fleet-kill-switch';
import type { FleetStatus } from '@/lib/actions/fleet';
import type { EcsFleetStatus } from '@/lib/actions/ecs-fleet';

interface HealthState {
  mongo: boolean;
  redis: boolean;
  redisState?: 'connected' | 'reconnecting' | 'disconnected';
  gateway: boolean;
  gatewayVersion?: string;
}

export interface StatusHeaderProps {
  initialHealth: {
    mongo: boolean;
    redis: boolean;
    redisState?: 'connected' | 'reconnecting' | 'disconnected';
    gateway: boolean;
    gatewayVersion?: string;
  };
  initialFleetStatus: FleetStatus;
  initialEcsStatus: EcsFleetStatus;
  initialAlertCount?: number;
}

function ConnDot({
  healthy,
  reconnecting,
  shortLabel,
  longLabel,
}: {
  healthy: boolean;
  reconnecting?: boolean;
  shortLabel: string;
  longLabel: string;
}) {
  const dotClass = reconnecting
    ? 'bg-mc-warning animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-warning'
    : healthy
      ? 'bg-mc-success animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-success'
      : 'bg-mc-danger animate-mc-pulse shadow-[0_0_6px_currentColor] text-mc-danger';
  const textClass = reconnecting
    ? 'text-mc-warning'
    : healthy ? 'text-mc-text-tertiary' : 'text-mc-danger';
  const titleStatus = reconnecting ? 'reconnecting' : healthy ? 'connected' : 'disconnected';

  return (
    <span
      className="inline-flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-label"
      title={`${longLabel}: ${titleStatus}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className={textClass}>
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{longLabel}</span>
      </span>
    </span>
  );
}

export function StatusHeader({ initialHealth, initialFleetStatus, initialEcsStatus, initialAlertCount = 0 }: StatusHeaderProps) {
  const [health, setHealth] = useState<HealthState>(initialHealth);
  const [alertCount, setAlertCount] = useState(initialAlertCount);
  const toggleChat = useChatStore((s) => s.toggle);

  // Sync alertCount when server re-renders with new prop (e.g. on navigation)
  const [prevAlertCount, setPrevAlertCount] = useState(initialAlertCount);
  if (initialAlertCount !== prevAlertCount) {
    setPrevAlertCount(initialAlertCount);
    setAlertCount(initialAlertCount);
  }

  useEventStream({
    'system:health': (data) => {
      const d = data as HealthState;
      setHealth((prev) => ({ ...prev, ...d }));
    },
    'alerts:update': (data) => {
      const d = data as { count?: number };
      if (typeof d.count === 'number') setAlertCount(d.count);
    },
  });

  return (
    <header className="h-14 shrink-0 bg-mc-bg/80 backdrop-blur-sm border-b border-mc-border flex items-center px-4 gap-4">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <span className="text-mc-accent text-sm">◈</span>
        <span className="font-sans text-xs font-medium text-mc-text tracking-label uppercase">Mission Control</span>
      </Link>

      <div className="h-4 w-px bg-mc-border" />

      <div className="flex items-center gap-3">
        <ConnDot
          healthy={health.gateway}
          shortLabel={health.gatewayVersion ? `OC v${health.gatewayVersion}` : 'OC'}
          longLabel={health.gatewayVersion ? `OpenClaw v${health.gatewayVersion}` : 'OpenClaw'}
        />
        <ConnDot healthy={health.mongo} shortLabel="DB" longLabel="MongoDB" />
        <ConnDot healthy={health.redis} reconnecting={health.redisState === 'reconnecting'} shortLabel="Redis" longLabel="Redis" />
      </div>

      <div className="h-4 w-px bg-mc-border" />

      <FleetKillSwitch initialStatus={initialFleetStatus} initialEcsStatus={initialEcsStatus} />

      <div className="flex-1" />

      <button
        onClick={() => toggleChat()}
        className="text-mc-text-tertiary hover:text-mc-accent transition-colors duration-mc ease-mc-out text-sm"
        title="Chat with OpenClaw"
      >
        💬
      </button>

      <button className="relative text-mc-text-tertiary hover:text-mc-text transition-colors duration-mc ease-mc-out text-sm" title="Alerts">
        🔔
        {alertCount > 0 && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-mc-danger text-white font-mono tabular-nums text-[8px] rounded-full flex items-center justify-center">
            {alertCount}
          </span>
        )}
      </button>
    </header>
  );
}
