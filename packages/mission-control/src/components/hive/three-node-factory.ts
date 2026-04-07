import * as THREE from 'three';
import type { AgentRealtimeStatus, AgentRunState } from './hive-types';

const DEPT_COLORS: Record<string, number> = {
  executive: 0x89dceb,
  marketing: 0xfab387,
  operations: 0xa6e3a1,
  development: 0x89b4fa,
  finance: 0xcba6f7,
  support: 0xf9e2af,
};

const STATE_EMISSIVE: Record<AgentRunState, { intensity: number; color?: number }> = {
  idle:    { intensity: 0.3 },
  running: { intensity: 0.8 },
  error:   { intensity: 1.0, color: 0xef4444 },
  paused:  { intensity: 0.05 },
};

const sphereGeometry = new THREE.SphereGeometry(1, 24, 24);

export function createAgentMesh(
  agentName: string,
  department: string,
): THREE.Mesh {
  const deptColor = DEPT_COLORS[department] || 0x6b7280;

  const material = new THREE.MeshStandardMaterial({
    color: deptColor,
    emissive: deptColor,
    emissiveIntensity: 0.3,
    metalness: 0.3,
    roughness: 0.6,
    transparent: true,
    opacity: 0.9,
  });

  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.scale.setScalar(5);
  mesh.userData = { agentName, department };

  const label = createTextSprite(agentName);
  label.position.set(0, -8, 0);
  mesh.add(label);

  return mesh;
}

export function updateAgentMesh(
  mesh: THREE.Mesh,
  status: AgentRealtimeStatus | undefined,
  time: number,
) {
  const state = status?.state || 'idle';
  const stateConfig = STATE_EMISSIVE[state];
  const mat = mesh.material as THREE.MeshStandardMaterial;

  mat.emissiveIntensity = stateConfig.intensity;

  if (stateConfig.color) {
    mat.emissive.setHex(stateConfig.color);
  }

  const pulseHz = state === 'running' ? 1.5
    : state === 'error' ? 3.0
    : state === 'paused' ? 0
    : 0.3;

  if (pulseHz > 0) {
    const breathe = 1 + 0.08 * Math.sin(time / 1000 * Math.PI * 2 * pulseHz);
    const baseScale = 5 + Math.min((status?.execCount5m || 0) / 50 * 3, 3);
    mesh.scale.setScalar(baseScale * breathe);
  }

  if (state === 'error') {
    // Use absolute offset, not cumulative increment
    const shakeX = Math.sin(time * 0.03) * 0.3;
    const shakeY = Math.cos(time * 0.037) * 0.3;
    mesh.userData._shakeOffsetX = shakeX;
    mesh.userData._shakeOffsetY = shakeY;
    mesh.position.x = shakeX;
    mesh.position.y = shakeY;
  } else if (mesh.userData._shakeOffsetX) {
    // Reset shake offset when no longer in error state
    mesh.position.x = 0;
    mesh.position.y = 0;
    mesh.userData._shakeOffsetX = 0;
    mesh.userData._shakeOffsetY = 0;
  }

  mat.opacity = state === 'paused' ? 0.4 : 0.9;
}

function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, 256, 64);

  ctx.font = 'bold 28px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e5e7eb';
  ctx.fillText(text.charAt(0).toUpperCase() + text.slice(1), 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(20, 5, 1);
  return sprite;
}
