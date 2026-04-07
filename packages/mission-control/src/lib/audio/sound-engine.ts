import { Howl, Howler } from 'howler';

export type SoundEventType =
  | 'pr_merged'
  | 'deploy_complete'
  | 'agent_error'
  | 'strategist_directive'
  | 'budget_alert';

interface SoundConfig {
  src: string;
  baseVolume: number;
}

const SOUND_MAP: Record<SoundEventType, SoundConfig> = {
  pr_merged:             { src: '/audio/chime.ogg', baseVolume: 0.6 },
  deploy_complete:       { src: '/audio/whoosh.ogg', baseVolume: 0.5 },
  agent_error:           { src: '/audio/pulse.ogg', baseVolume: 0.4 },
  strategist_directive:  { src: '/audio/bass.ogg', baseVolume: 0.35 },
  budget_alert:          { src: '/audio/alert.ogg', baseVolume: 0.3 },
};

const EVENT_TYPE_MAPPING: Record<string, SoundEventType> = {
  'pr.merged': 'pr_merged',
  'deploy.completed': 'deploy_complete',
  'alert.triggered': 'agent_error',
  'strategist:directive': 'strategist_directive',
};

const lastPlayed = new Map<SoundEventType, number>();
const DEBOUNCE_MS = 200;

export class SoundEngine {
  private enabled = false;
  private masterVolume = 0.7;
  private ambient: Howl | null = null;
  private sounds = new Map<SoundEventType, Howl>();
  private activityScore = 0;
  private disableTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    for (const [type, config] of Object.entries(SOUND_MAP)) {
      this.sounds.set(type as SoundEventType, new Howl({
        src: [config.src],
        volume: config.baseVolume,
        preload: true,
        onloaderror: () => { /* gracefully ignore missing/empty audio files */ },
      }));
    }

    this.ambient = new Howl({
      src: ['/audio/drone.ogg'],
      loop: true,
      volume: 0,
      preload: true,
      onloaderror: () => { /* gracefully ignore missing/empty audio files */ },
    });
  }

  async enable() {
    if (this.enabled) return;

    // Clear any pending disable timer
    if (this.disableTimer) {
      clearTimeout(this.disableTimer);
      this.disableTimer = null;
    }

    if (Howler.ctx?.state === 'suspended') {
      try { await Howler.ctx.resume(); } catch { /* ignore */ }
    }

    this.enabled = true;
    this.ambient?.play();
    this.ambient?.fade(0, this.getAmbientVolume(), 2000);
  }

  disable() {
    this.enabled = false;
    if (this.disableTimer) {
      clearTimeout(this.disableTimer);
      this.disableTimer = null;
    }
    const vol = this.getAmbientVolume();
    this.ambient?.fade(vol, 0, 1000);
    this.disableTimer = setTimeout(() => {
      this.ambient?.pause();
      this.disableTimer = null;
    }, 1000);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setMasterVolume(vol: number) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    Howler.volume(this.masterVolume);
    if (this.ambient?.playing()) {
      this.ambient.volume(this.getAmbientVolume());
    }
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setActivityScore(score: number) {
    this.activityScore = Math.max(0, Math.min(1, score));
    if (this.enabled && this.ambient?.playing()) {
      this.ambient.volume(this.getAmbientVolume());
    }
  }

  playEvent(type: SoundEventType) {
    if (!this.enabled) return;

    const now = Date.now();
    const last = lastPlayed.get(type) || 0;
    if (now - last < DEBOUNCE_MS) return;
    lastPlayed.set(type, now);

    const sound = this.sounds.get(type);
    const config = SOUND_MAP[type];
    if (sound && config) {
      sound.volume(config.baseVolume * this.masterVolume);
      sound.play();
    }
  }

  handleHiveEvent(eventType: string) {
    const soundType = EVENT_TYPE_MAPPING[eventType];
    if (soundType) this.playEvent(soundType);
  }

  handleVisibilityChange(hidden: boolean) {
    if (!this.enabled) return;
    Howler.mute(hidden);
  }

  private getAmbientVolume(): number {
    return (0.15 + this.activityScore * 0.35) * this.masterVolume;
  }

  destroy() {
    if (this.disableTimer) {
      clearTimeout(this.disableTimer);
      this.disableTimer = null;
    }
    this.enabled = false;
    this.ambient?.unload();
    this.ambient = null;
    this.sounds.forEach(s => s.unload());
    this.sounds.clear();
  }
}
