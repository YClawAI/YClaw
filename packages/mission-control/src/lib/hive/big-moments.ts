import type { HiveEvent } from '@/components/hive/hive-types';
import type { ParticleEngine } from './particle-engine';

/** Check incoming event and trigger scene-wide effects if it's a Big Moment */
export function evaluateBigMoment(event: HiveEvent, engine: ParticleEngine): void {
  switch (event.type) {
    case 'pr.merged':
      engine.spawnBigMoment('starburst', event.source, '#a855f7', 1500);
      break;
    case 'deploy.completed':
      engine.spawnBigMoment('ripple', event.source, '#22c55e', 1800);
      break;
    case 'strategist:directive':
    case 'builder:directive':
    case 'reviewer:directive':
    case 'architect:directive':
      engine.spawnBigMoment('goldPulse', event.source, '#fbbf24', 1200);
      break;
    case 'alert.triggered':
      engine.spawnBigMoment('errorFlash', event.source, '#ef4444', 800);
      break;
    case 'openclaw.trigger':
    case 'openclaw.directive':
      engine.spawnBigMoment('openclawPulse', event.source, '#ef4444', 1500);
      break;
    default:
      break;
  }
}
