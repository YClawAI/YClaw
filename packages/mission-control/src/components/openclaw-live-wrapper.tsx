'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGatewayEvents } from '@/hooks/useGatewayEvents';

/**
 * Client wrapper that subscribes to gateway SSE events and triggers
 * a server-component refresh when data changes. This bridges the
 * SSE real-time layer (Phase 2) with the server-rendered page.
 */
export function OpenClawLiveWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const onEvent = useCallback(
    (data: unknown) => {
      // Any gateway event means data changed — refresh server components
      router.refresh();
    },
    [router],
  );

  const { connected } = useGatewayEvents({
    events: ['status', 'channels.status', 'sessions.updated', 'reconnected'],
    onEvent,
  });

  return (
    <div>
      {!connected && (
        <div className="mb-4 px-3 py-2 bg-terminal-yellow/10 border border-terminal-yellow/30 rounded text-xs text-terminal-yellow flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-terminal-yellow animate-pulse" />
          Reconnecting to gateway...
        </div>
      )}
      {children}
    </div>
  );
}
