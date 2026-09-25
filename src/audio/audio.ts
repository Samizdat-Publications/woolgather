import type { Level } from '../game/level';
import type { Sim, SimEvent } from '../game/sim';
import { Ambience } from './ambience';
import { AudioEngine } from './engine';
import { Music } from './music';
import { Sfx, type Where } from './sfx';

// The game's ears: turns sim events into sounds placed around Pip (the listener), keeps the
// ambience and the score in step with the evening, and owns the volume settings.

export type AudioMode = 'title' | 'playing' | 'paused' | 'ended';

export class GameAudio {
  readonly engine = new AudioEngine();
  readonly sfx = new Sfx(this.engine);
  private amb = new Ambience(this.engine);
  private music = new Music(this.engine);
  private stepDist = 0;
  private lastBleat = 0;
  private lx = 0;
  private lz = 0;

  constructor(private level: Level) {
    // Browsers keep audio locked until the player presses something.
    const unlock = () => this.engine.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  /** Pan and distance level for a sound at (x, z), heard from Pip. */
  where(x: number, z: number, min = 0): Where {
    const d = Math.hypot(x - this.lx, z - this.lz);
    return {
      pan: Math.max(-1, Math.min(1, (x - this.lx) / 28)),
      level: Math.max(min, 1 / (1 + Math.max(0, d - 8) / 22)),
    };
  }

  newDay(seed: number) {
    this.music.restart(seed);
  }

  toggleMute() {
    this.engine.unlock();
    return this.engine.toggleMute();
  }

  /** For the self-test: is the context running, and how many sounds have played. */
  debug() {
    return { state: this.engine.ctx?.state ?? 'none', played: this.sfx.played, muted: this.engine.settings.muted };
  }

  onEvents(events: SimEvent[], sim: Sim) {
    const now = this.engine.now;
    for (const e of events) {
      switch (e.type) {
        case 'bark':
          this.sfx.bark();
          break;
        case 'bleat': {
          const w = this.where(e.x, e.z);
          // A flock bleats a lot: keep only near voices and never two on top of each other.
          if (w.level < 0.3 || now - this.lastBleat < 0.35) break;
          this.lastBleat = now;
          this.sfx.bleat(w, e.urgent, ((e.id * 0.618) % 1 + 1) % 1);
          break;
        }
        case 'folded':
          this.sfx.chime(e.count - 1);
          break;
        case 'targetMet':
          this.sfx.chime(0, true);
          break;
        case 'dusk':
          // The pack greets the sunset from the far side of the valley.
          this.sfx.howl({ pan: this.lx > 0 ? -0.6 : 0.6, level: 0.8 }, true);
          break;
        case 'wolfSpawn':
          this.sfx.howl(this.where(e.x, e.z, 0.45));
          break;
        case 'charge':
          if (this.where(e.x, e.z).level > 0.35) this.sfx.growl(this.where(e.x, e.z));
          break;
        case 'grab':
          this.sfx.growl(this.where(e.x, e.z, 0.4));
          this.sfx.bleat(this.where(e.x, e.z, 0.5), true, 0.9);
          break;
        case 'rescued':
          this.sfx.yelp(this.where(e.x, e.z, 0.6));
          this.sfx.sting('rescue');
          break;
        case 'wolfScared':
          this.sfx.yelp(this.where(e.x, e.z, 0.3));
          break;
        case 'lost':
          this.sfx.sting('lost');
          break;
        case 'splash':
          this.sfx.splash(this.where(e.x, e.z), e.big);
          break;
      }
    }
    void sim;
  }

  /** The day's result: the gate clanks shut on a win before the fanfare. */
  outcome(win: boolean) {
    if (win) {
      this.sfx.gate();
      window.setTimeout(() => this.sfx.sting('win'), 350);
    } else {
      this.sfx.sting('lose');
    }
  }

  update(dt: number, sim: Sim | null, mood: number, night: number, mode: AudioMode, tension: number) {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const playing = mode === 'playing';
    if (sim) {
      const d = sim.dog;
      this.lx = d.x;
      this.lz = d.z;
      // Paw falls: one per ~0.8 m trotting, closer together at a gallop.
      if (playing) {
        this.stepDist += d.speed * dt;
        const stride = d.sprinting ? 1.35 : d.creeping ? 0.55 : 0.85;
        if (this.stepDist > stride) {
          this.stepDist = 0;
          const surface = this.level.onBridge(d.x, d.z) ? 'wood' : d.inWater ? 'water' : 'grass';
          this.sfx.step({ pan: 0, level: 1 }, surface, d.sprinting ? 1.2 : d.creeping ? 0.5 : 0.9);
        }
      }
    }
    const q = sim ? this.level.streamQuery(this.lx, this.lz) : { d: 60, cx: 0 };
    this.amb.update(dt, {
      night,
      streamDist: Math.max(0, q.d - this.level.streamHalf),
      streamPan: (q.cx - this.lx) / 20,
      active: mode !== 'paused',
    });
    this.music.update({ mood, tension, playing });
    // Menus sit the score back a little; the end card lets the stinger speak.
    const t = ctx.currentTime;
    const duck = mode === 'paused' ? 0.45 : mode === 'ended' ? 0.35 : 1;
    this.engine.music.gain.setTargetAtTime(this.engine.settings.music * 0.8 * duck, t, 0.3);
  }
}
