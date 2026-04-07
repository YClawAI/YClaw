'use client';

import { useState } from 'react';
import { useEventStream } from '@/lib/hooks/use-event-stream';

interface HealthState {
  mongo: boolean;
  redis: boolean;
  gateway: boolean;
}

function Dot({ healthy, label }: { healthy: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          healthy ? 'bg-terminal-green shadow-[0_0_6px_#a6e3a1]' : 'bg-terminal-red shadow-[0_0_6px_#f38ba8]'
        }`}
      />
      <span className={healthy ? 'text-terminal-green' : 'text-terminal-red'}>{label}</span>
    </span>
  );
}

export function LiveHealthBar({ initial }: { initial: HealthState & { gatewayVersion?: string; slackOk?: boolean; signalOk?: boolean } }) {
  const [health, setHealth] = useState(initial);

  useEventStream({
    'system:health': (data) => {
      const d = data as HealthState;
      setHealth((prev) => ({ ...prev, ...d }));
    },
  });

  return (
    <div className="flex gap-4 items-center">
      <Dot healthy={health.gateway} label={initial.gatewayVersion ? `v${initial.gatewayVersion}` : 'OpenClaw'} />
      <Dot healthy={health.mongo} label="MongoDB" />
      <Dot healthy={health.redis} label="Redis" />
      {initial.slackOk !== undefined && <Dot healthy={initial.slackOk} label="Slack" />}
      {initial.signalOk !== undefined && <Dot healthy={initial.signalOk} label="Signal" />}
    </div>
  );
}
