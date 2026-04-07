'use client';

import { useMemo } from 'react';
import { AGENTS, DEPARTMENTS, DEPT_META } from '@/lib/agents';
import type { Department } from '@/lib/agents';
import { DEPT_ANCHOR_POS } from './hive-types';
import type { HiveNode, HiveLink } from './hive-types';
import {
  EXTERNAL_SERVICES, OPENCLAW_NODE,
  calculateExternalPositions,
} from '@/lib/hive/external-nodes';

export function useHiveGraphData() {
  return useMemo(() => {
    const nodes: HiveNode[] = [];
    const links: HiveLink[] = [];

    for (const dept of DEPARTMENTS) {
      const pos = DEPT_ANCHOR_POS[dept];
      nodes.push({
        id: `dept:${dept}`,
        type: 'department',
        department: dept,
        label: DEPT_META[dept].label,
        fx: pos[0],
        fy: pos[1],
      });
    }

    for (const agent of AGENTS) {
      nodes.push({
        id: agent.name,
        type: 'agent',
        department: agent.department,
        label: agent.label,
        emoji: agent.emoji,
        role: agent.role,
        description: agent.description,
      });
      links.push({
        source: `dept:${agent.department}`,
        target: agent.name,
      });
    }

    const extPositions = calculateExternalPositions(
      0, 0, 200, EXTERNAL_SERVICES, OPENCLAW_NODE
    );

    for (const service of EXTERNAL_SERVICES) {
      const pos = extPositions.get(service.id);
      if (!pos) continue;
      nodes.push({
        id: service.id,
        type: 'external',
        department: 'operations' as Department,
        label: service.name,
        emoji: service.icon,
        color: service.color,
        category: service.category,
        fx: pos.x,
        fy: pos.y,
      });
    }

    const clawPos = extPositions.get(OPENCLAW_NODE.id);
    if (clawPos) {
      nodes.push({
        id: OPENCLAW_NODE.id,
        type: 'orchestrator',
        department: 'operations' as Department,
        label: OPENCLAW_NODE.name,
        emoji: OPENCLAW_NODE.icon,
        color: OPENCLAW_NODE.color,
        fx: clawPos.x,
        fy: clawPos.y,
      });
    }

    return { nodes, links };
  }, []);
}
