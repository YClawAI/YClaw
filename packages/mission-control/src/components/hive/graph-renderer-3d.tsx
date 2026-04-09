'use client';

import { useRef, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { createAgentMesh, updateAgentMesh } from './three-node-factory';
import type { AgentRealtimeStatus } from './hive-types';

interface GraphRenderer3DProps {
  graphData: { nodes: any[]; links: any[] };
  agentStatusRef: React.MutableRefObject<Map<string, AgentRealtimeStatus>>;
  width: number;
  height: number;
  onNodeClick?: (node: any) => void;
}

export function GraphRenderer3D({ graphData, agentStatusRef, width, height, onNodeClick }: GraphRenderer3DProps) {
    const fgRef = useRef<any>(null);
    const meshCache = useRef(new Map<string, THREE.Mesh>());
    const lastInteraction = useRef(0);

    // Auto-orbit camera when idle + update mesh states
    useEffect(() => {
      const interval = setInterval(() => {
        if (!fgRef.current) return;

        // Update mesh states from agentStatusRef
        const now = performance.now();
        meshCache.current.forEach((mesh, id) => {
          const status = agentStatusRef.current.get(id);
          updateAgentMesh(mesh, status, now);
        });

        if (Date.now() - lastInteraction.current < 10_000) return;

        const fg = fgRef.current;
        const camera = fg.camera();
        if (!camera) return;

        const angle = Date.now() * 0.0001;
        const radius = camera.position.length();
        camera.position.x = Math.cos(angle) * radius;
        camera.position.z = Math.sin(angle) * radius;
        camera.lookAt(0, 0, 0);
      }, 16);

      return () => clearInterval(interval);
    }, [agentStatusRef]);

    const handleNodeClick = useCallback((node: any) => {
      lastInteraction.current = Date.now();
      onNodeClick?.(node);
    }, [onNodeClick]);

    const handleBackgroundClick = useCallback(() => {
      lastInteraction.current = Date.now();
    }, []);

    const nodeThreeObject = useCallback((node: any) => {
      if (node.id.startsWith('dept:')) {
        const geo = new THREE.SphereGeometry(0.5);
        const mat = new THREE.MeshBasicMaterial({ visible: false });
        return new THREE.Mesh(geo, mat);
      }

      // External/orchestrator nodes: simple spheres with node color
      if (node.id.startsWith('ext:')) {
        const color = node.color ? parseInt(node.color.replace('#', ''), 16) : 0x6b7280;
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.4,
          transparent: true,
          opacity: 0.8,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), mat);
        mesh.scale.setScalar(3);
        return mesh;
      }

      let mesh = meshCache.current.get(node.id);
      if (!mesh) {
        mesh = createAgentMesh(node.id, node.department);
        meshCache.current.set(node.id, mesh);
      }

      const status = agentStatusRef.current.get(node.id);
      updateAgentMesh(mesh, status, performance.now());

      return mesh;
    }, [agentStatusRef]);

    // Cleanup meshes on unmount
    useEffect(() => {
      const cache = meshCache.current;
      return () => {
        cache.forEach(mesh => {
          mesh.geometry?.dispose();
          (mesh.material as THREE.Material)?.dispose();
        });
        cache.clear();
      };
    }, []);

    return (
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={height}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        backgroundColor="#030712"
        linkDirectionalParticles={4}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={(link: any) => link.color || '#60a5fa'}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        enableNavigationControls={true}
        controlType="orbit"
      />
    );
}
