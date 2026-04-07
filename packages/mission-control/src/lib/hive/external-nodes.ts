/**
 * External service nodes + OpenClaw orchestrator definitions.
 * These nodes sit on a fixed outer ring around the agent cluster.
 */

export interface ExternalServiceNode {
  id: string;
  name: string;
  icon: string;
  color: string;
  category: 'code' | 'social' | 'comms' | 'data' | 'orchestrator';
}

export const EXTERNAL_SERVICES: ExternalServiceNode[] = [
  { id: 'ext:github',  name: 'GitHub',    icon: '🐙', color: '#8b5cf6', category: 'code' },
  { id: 'ext:twitter',  name: 'Twitter/X', icon: '🐦', color: '#1d9bf0', category: 'social' },
  { id: 'ext:slack',    name: 'Slack',     icon: '💬', color: '#e01e5a', category: 'comms' },
  { id: 'ext:web',      name: 'Web',       icon: '🌐', color: '#6b7280', category: 'data' },
  { id: 'ext:figma',    name: 'Figma',     icon: '🎨', color: '#a259ff', category: 'code' },
  { id: 'ext:llm',      name: 'LLM API',   icon: '🧠', color: '#f59e0b', category: 'data' },
];

export const OPENCLAW_NODE: ExternalServiceNode = {
  id: 'ext:openclaw',
  name: 'OpenClaw',
  icon: '🦞',
  color: '#ef4444',
  category: 'orchestrator',
};

/**
 * Calculate fixed positions for external service nodes on an outer ring.
 * External services occupy 300° of the circle (top-start, clockwise),
 * leaving a 60° gap at bottom for the OpenClaw orchestrator node.
 */
export function calculateExternalPositions(
  centerX: number,
  centerY: number,
  innerRadius: number,
  services: ExternalServiceNode[],
  openClaw: ExternalServiceNode,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const outerRadius = innerRadius * 1.8;
  const serviceCount = services.length;

  // Start from top (270°), go clockwise, leave bottom gap for OpenClaw
  const arcStart = -Math.PI / 2;
  const arcSpan = Math.PI * 2 * (300 / 360);

  for (let i = 0; i < serviceCount; i++) {
    const service = services[i];
    if (!service) continue;
    const angle = arcStart + (i / Math.max(serviceCount - 1, 1)) * arcSpan;
    positions.set(service.id, {
      x: centerX + Math.cos(angle) * outerRadius,
      y: centerY + Math.sin(angle) * outerRadius,
    });
  }

  // OpenClaw: fixed at bottom, slightly further out
  const openClawRadius = innerRadius * 2.0;
  positions.set(openClaw.id, {
    x: centerX,
    y: centerY + openClawRadius,
  });

  return positions;
}

/** Look up an external service config by node id */
export function getExternalService(id: string): ExternalServiceNode | undefined {
  if (id === OPENCLAW_NODE.id) return OPENCLAW_NODE;
  return EXTERNAL_SERVICES.find((s) => s.id === id);
}
