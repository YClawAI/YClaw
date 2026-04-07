'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { HiveEvent, AgentRealtimeStatus } from '@/components/hive/hive-types';
import type { ParticleEngine } from '@/lib/hive/particle-engine';
import type { ExternalActivity } from '@/components/hive/external-tooltip';
import type { SoundEngine } from '@/lib/audio/sound-engine';
import { evaluateBigMoment } from '@/lib/hive/big-moments';

interface UseHiveSSEOptions {
  particleEngine: ParticleEngine | null;
  agentStatusRef: React.MutableRefObject<Map<string, AgentRealtimeStatus>>;
  externalActivityRef?: React.MutableRefObject<Map<string, ExternalActivity>>;
  soundEngine?: SoundEngine;
  onStatusChange?: () => void;
}

/** Track when we last showed an LLM particle per agent (throttle: 1 per 5s) */
const lastLLMParticle = new Map<string, number>();

function trackExternalNode(
  ref: React.MutableRefObject<Map<string, ExternalActivity>> | undefined,
  nodeId: string,
  agentId?: string,
  detail?: string,
) {
  if (!ref) return;
  const now = Date.now();
  const entry = ref.current.get(nodeId) ?? {
    lastEventAt: 0,
    count60s: 0,
    events: [],
  };
  entry.lastEventAt = now;
  entry.events.push({ timestamp: now, agentId, detail });
  // Prune events older than 60s
  entry.events = entry.events.filter((ev) => now - ev.timestamp < 60_000);
  entry.count60s = entry.events.length;
  ref.current.set(nodeId, entry);
}

export function useHiveSSE({
  particleEngine,
  agentStatusRef,
  externalActivityRef,
  soundEngine,
  onStatusChange,
}: UseHiveSSEOptions) {
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    const es = new EventSource('/api/hive/stream');

    es.addEventListener('hive:event', (e) => {
      if (!particleEngine) return;
      try {
        const event: HiveEvent = JSON.parse(e.data);

        // LLM call throttle: max 1 particle per agent per 5s
        if (event.category === 'llm_call') {
          const last = lastLLMParticle.get(event.source);
          if (last && Date.now() - last < 5000) return;
          lastLLMParticle.set(event.source, Date.now());
        }

        particleEngine.spawnFromEvent(event);
        evaluateBigMoment(event, particleEngine);
        soundEngine?.handleHiveEvent(event.type);

        // Track external node activity
        if (event.source.startsWith('ext:')) {
          trackExternalNode(externalActivityRef, event.source, event.target, event.detail);
        }
        if (event.target.startsWith('ext:')) {
          trackExternalNode(externalActivityRef, event.target, event.source, event.detail);
        }
      } catch { /* skip malformed */ }
    });

    es.addEventListener('agent:status', (e) => {
      try {
        const status: AgentRealtimeStatus = JSON.parse(e.data);
        agentStatusRef.current.set(status.agentName, status);
        onStatusChange?.();
      } catch { /* skip */ }
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 3s
      reconnectTimeout.current = setTimeout(connect, 3000);
    };

    return es;
  }, [particleEngine, agentStatusRef, externalActivityRef, soundEngine, onStatusChange]);

  useEffect(() => {
    const es = connect();
    return () => {
      es.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, [connect]);

  // Fallback: poll agent status every 5s in case SSE misses updates
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/hive/status');
        const statuses: AgentRealtimeStatus[] = await res.json();
        for (const s of statuses) {
          agentStatusRef.current.set(s.agentName, s);
        }
        onStatusChange?.();
      } catch { /* silent */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [agentStatusRef, onStatusChange]);
}
