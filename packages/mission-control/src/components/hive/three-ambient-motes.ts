import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const MOTE_COUNT = 30;
const DRIFT_SPEED = 0.0003;
const MOTE_SIZE = 0.8;
const MOTE_OPACITY = 0.12;

export class AmbientMotes3D {
  private points: THREE.Points;
  private positions: Float32Array;
  private noise = createNoise2D();
  private offsets: Float32Array;

  constructor(scene: THREE.Scene, bounds: number = 200) {
    this.positions = new Float32Array(MOTE_COUNT * 3);
    this.offsets = new Float32Array(MOTE_COUNT);

    for (let i = 0; i < MOTE_COUNT; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * bounds;
      this.positions[i * 3 + 1] = (Math.random() - 0.5) * bounds;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * bounds * 0.5;
      this.offsets[i] = Math.random() * 1000;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x8b9dc3,
      size: MOTE_SIZE,
      transparent: true,
      opacity: MOTE_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);
  }

  update(time: number) {
    for (let i = 0; i < MOTE_COUNT; i++) {
      const offset = this.offsets[i]!;
      const t = time * DRIFT_SPEED;

      this.positions[i * 3] += this.noise(t + offset, 0) * 0.15;
      this.positions[i * 3 + 1] += this.noise(0, t + offset) * 0.15;
      this.positions[i * 3 + 2] += this.noise(t + offset, t) * 0.08;
    }

    (this.points.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
