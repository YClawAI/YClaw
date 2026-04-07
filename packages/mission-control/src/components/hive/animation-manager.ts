/**
 * AnimationManager — Singleton scheduler for Hive animations.
 *
 * - Physics queue: serialized (one at a time) — temporary forces, standup converge, etc.
 * - Overlay map: concurrent — starbursts, ripples, bloom effects run in parallel.
 * - Ambient intensity: lerps to 0.4 during big moments, 1.0 at rest.
 *   Hard 10s timeout prevents stuck suppression.
 */

export type AnimationPriority = 'low' | 'normal' | 'high' | 'critical';

interface PhysicsAnimation {
  id: string;
  priority: AnimationPriority;
  startTime: number;
  duration: number;
  tick: (progress: number) => void;
  onComplete?: () => void;
}

interface OverlayAnimation {
  id: string;
  startTime: number;
  duration: number;
  tick: (progress: number) => void;
}

const PRIORITY_ORDER: Record<AnimationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

const AMBIENT_SUPPRESSED = 0.4;
const AMBIENT_FULL = 1.0;
const AMBIENT_LERP_SPEED = 0.03;
const SUPPRESSION_TIMEOUT_MS = 10_000;

class AnimationManagerImpl {
  private physicsQueue: PhysicsAnimation[] = [];
  private activePhysics: PhysicsAnimation | null = null;
  private overlays = new Map<string, OverlayAnimation>();

  /** Current ambient intensity (0-1). Motes/background use this. */
  ambientIntensity = AMBIENT_FULL;
  private targetIntensity = AMBIENT_FULL;
  private suppressionStart = 0;

  /** Enqueue a physics animation (serialized execution) */
  enqueuePhysics(
    id: string,
    priority: AnimationPriority,
    duration: number,
    tick: (progress: number) => void,
    onComplete?: () => void,
  ) {
    // Deduplicate by id
    this.physicsQueue = this.physicsQueue.filter((a) => a.id !== id);

    this.physicsQueue.push({
      id,
      priority,
      startTime: 0, // set when it becomes active
      duration,
      tick,
      onComplete,
    });

    // Sort by priority (highest first)
    this.physicsQueue.sort(
      (a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority],
    );
  }

  /** Add an overlay animation (runs concurrently) */
  addOverlay(
    id: string,
    duration: number,
    tick: (progress: number) => void,
  ) {
    this.overlays.set(id, {
      id,
      startTime: performance.now(),
      duration,
      tick,
    });
    this.suppressAmbient();
  }

  /** Call every frame from rAF / onRenderFramePost */
  tick() {
    const now = performance.now();

    // ── Physics queue ──
    if (!this.activePhysics && this.physicsQueue.length > 0) {
      this.activePhysics = this.physicsQueue.shift()!;
      this.activePhysics.startTime = now;
      this.suppressAmbient();
    }

    if (this.activePhysics) {
      const elapsed = now - this.activePhysics.startTime;
      const progress = Math.min(elapsed / this.activePhysics.duration, 1);
      this.activePhysics.tick(progress);

      if (progress >= 1) {
        this.activePhysics.onComplete?.();
        this.activePhysics = null;
      }
    }

    // ── Overlays ──
    for (const [id, overlay] of this.overlays) {
      const elapsed = now - overlay.startTime;
      const progress = Math.min(elapsed / overlay.duration, 1);
      overlay.tick(progress);

      if (progress >= 1) {
        this.overlays.delete(id);
      }
    }

    // ── Ambient intensity lerp ──
    const hasAnimations =
      this.activePhysics !== null || this.overlays.size > 0;

    if (hasAnimations) {
      this.targetIntensity = AMBIENT_SUPPRESSED;
    } else {
      this.targetIntensity = AMBIENT_FULL;
    }

    // Hard timeout: don't stay suppressed forever
    if (
      this.targetIntensity < AMBIENT_FULL &&
      now - this.suppressionStart > SUPPRESSION_TIMEOUT_MS
    ) {
      this.targetIntensity = AMBIENT_FULL;
    }

    // Smooth lerp
    this.ambientIntensity +=
      (this.targetIntensity - this.ambientIntensity) * AMBIENT_LERP_SPEED;

    // Snap to target when close enough
    if (Math.abs(this.ambientIntensity - this.targetIntensity) < 0.01) {
      this.ambientIntensity = this.targetIntensity;
    }
  }

  /** Whether any physics or overlay animations are active */
  get isAnimating(): boolean {
    return this.activePhysics !== null || this.overlays.size > 0;
  }

  private suppressAmbient() {
    if (this.targetIntensity === AMBIENT_FULL) {
      this.suppressionStart = performance.now();
    }
    this.targetIntensity = AMBIENT_SUPPRESSED;
  }
}

/** Singleton */
export const animationManager = new AnimationManagerImpl();
