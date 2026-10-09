import type { Level } from '../game/level';
import type { Rules } from '../game/rules';
import type { Sim, SimEvent } from '../game/sim';
import { Ambience } from './ambience';
import { AudioEngine } from './engine';
import { Music } from './music';
import { SampleBank, type SampleLoop } from './samples';
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
  /** Recorded sounds (ElevenLabs), used in place of the synthesised ones once loaded. */
  private samples: SampleBank | null = null;
  private loops: Record<string, SampleLoop | null> = {};
  /** A send for distant sounds: dry into the effects bus, wet into the valley reverb. */
  private far: GainNode | null = null;
  private rules: Rules | null = null;

  constructor(private level: Level) {
    // Browsers keep audio locked until the player presses something.
    const unlock = () => this.engine.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    this.engine.onReady(() => {
      const ctx = this.engine.ctx!;
      this.far = ctx.createGain();
      this.far.connect(this.engine.sfx);
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      this.far.connect(wet);
      wet.connect(this.engine.reverb);
      this.samples = new SampleBank(ctx);
      void this.samples.load().then(() => {
        for (const name of ['wind', 'rain', 'stream', 'night', 'dawn', 'loch']) this.loops[name] = this.samples!.loop(name, this.engine.amb, 0);
      });
    });
  }

  /** Play a recorded sound if there is one (returns false to fall back to the synthesised one). */
  private rec(group: string, w: Where, gain = 1, far = false, rate?: number) {
    const s = this.samples;
    if (!s?.ready || !s.has(group) || !this.far) return false;
    s.play(group, far ? this.far : this.engine.sfx, { gain: gain * w.level, pan: w.pan * 0.85, rate });
    return true;
  }

  /** Pan and distance level for a sound at (x, z), heard from Pip. */
  where(x: number, z: number, min = 0): Where {
    const d = Math.hypot(x - this.lx, z - this.lz);
    return {
      pan: Math.max(-1, Math.min(1, (x - this.lx) / 28)),
      level: Math.max(min, 1 / (1 + Math.max(0, d - 8) / 22)),
    };
  }

  setLevel(level: Level) {
    this.level = level;
  }

  newDay(seed: number, rules?: Rules) {
    this.music.restart(seed);
    this.rules = rules ?? null;
  }

  toggleMute() {
    this.engine.unlock();
    return this.engine.toggleMute();
  }

  /** For the self-test: is the context running, and how many sounds have played. */
  debug() {
    return { state: this.engine.ctx?.state ?? 'none', played: this.sfx.played, muted: this.engine.settings.muted, samples: !!this.samples?.ready, missing: this.samples?.missing.length ?? -1 };
  }

  onEvents(events: SimEvent[], sim: Sim) {
    const now = this.engine.now;
    for (const e of events) {
      switch (e.type) {
        case 'bark':
          if (!this.rec('bark', { pan: 0, level: 1 }, 0.85)) this.sfx.bark();
          break;
        case 'bleat': {
          // In mist, distant bleats carry (that is how the flock is found).
          const w = this.where(e.x, e.z, this.rules?.weather === 'fog' ? 0.22 : 0);
          // A flock bleats a lot: keep only near voices and never two on top of each other.
          if (w.level < (this.rules?.weather === 'fog' ? 0.2 : 0.3) || now - this.lastBleat < 0.35) break;
          this.lastBleat = now;
          const group = e.kind === 'lamb' ? 'bleat_lamb' : e.kind === 'ram' ? 'bleat_ram' : 'bleat_ewe';
          if (!this.rec(group, w, e.urgent ? 0.9 : 0.65, w.level < 0.5, e.kind === 'black' ? 0.92 : undefined)) this.sfx.bleat(w, e.urgent, ((e.id * 0.618) % 1 + 1) % 1);
          break;
        }
        case 'butt':
          if (!e.wolf) this.rec('butt', { pan: 0, level: 1 }, 1);
          else this.rec('butt', this.where(e.x, e.z, 0.4), 0.8);
          break;
        case 'stamp':
          this.rec('stamp', this.where(e.x, e.z, 0.3), 0.9);
          break;
        case 'ramYield':
          this.rec('bleat_ram', this.where(e.x, e.z, 0.4), 0.8);
          break;
        case 'lambFound':
          this.rec('bleat_lamb', this.where(e.x, e.z, 0.6), 1);
          this.sfx.chime(2, true);
          break;
        case 'thunder': {
          const w = this.where(e.x, e.z, 0.6);
          this.rec('thunder', { pan: w.pan, level: 1 }, 1, true);
          break;
        }
        case 'flood':
          this.rec('splash', { pan: 0, level: 0.7 }, 0.8, true, 0.7);
          break;
        case 'dawn':
          this.sfx.sting('rescue');
          break;
        case 'spook':
          this.rec('flutter', this.where(e.x, e.z, 0.4), 0.9);
          break;
        case 'scatter':
          // Something heavy through the bracken: a crash of wings and hooves, then the flock cries out.
          this.rec('flutter', this.where(e.x, e.z, 0.3), 0.7, true);
          this.rec('stamp', this.where(e.x, e.z, 0.3), 0.8, true, 0.6);
          window.setTimeout(() => this.rec('bleat_ewe', this.where(e.x, e.z, 0.2), 1.1, true), 250);
          break;
        case 'folded':
          this.sfx.chime(e.count - 1);
          break;
        case 'targetMet':
          this.sfx.chime(0, true);
          break;
        case 'dusk':
          // The pack greets the sunset from the far side of the valley.
          if (!this.rec('howl', { pan: this.lx > 0 ? -0.6 : 0.6, level: 0.8 }, 0.9, true)) this.sfx.howl({ pan: this.lx > 0 ? -0.6 : 0.6, level: 0.8 }, true);
          break;
        case 'wolfSpawn':
          if (!this.rec('howl', this.where(e.x, e.z, 0.45), 0.8, true)) this.sfx.howl(this.where(e.x, e.z, 0.45));
          break;
        case 'pack':
          // The bait calls; a beat later its mate answers from the far side.
          if (!this.rec('howl', this.where(e.x, e.z, 0.5), 0.85, true)) this.sfx.howl(this.where(e.x, e.z, 0.5), true);
          window.setTimeout(() => {
            if (!this.rec('howl', this.where(e.fx, e.fz, 0.4), 0.7, true, 0.92)) this.sfx.howl(this.where(e.fx, e.fz, 0.4));
          }, 900);
          break;
        case 'growl': {
          // The flanker in position: low, from its side, never too quiet to hear.
          const w = this.where(e.x, e.z, 0.45);
          if (!this.rec('growl', w, 0.75, false, 0.8)) this.sfx.growl(w);
          break;
        }
        case 'bell':
          if (this.where(e.x, e.z).level > 0.12) this.sfx.bell(this.where(e.x, e.z, 0.35));
          break;
        case 'fly':
          // Pip's mother answers with a short, deeper bark.
          if (!this.rec('bark', this.where(e.x, e.z, 0.5), 0.7, false, 0.82)) this.sfx.bark(this.where(e.x, e.z, 0.5));
          break;
        case 'feint':
          if (this.where(e.x, e.z).level > 0.3 && !this.rec('growl', this.where(e.x, e.z), 0.6, false, 1.1)) this.sfx.growl(this.where(e.x, e.z));
          break;
        case 'charge':
          if (this.where(e.x, e.z).level > 0.35 && !this.rec('growl', this.where(e.x, e.z), 0.9)) this.sfx.growl(this.where(e.x, e.z));
          break;
        case 'grab': {
          const w = this.where(e.x, e.z, 0.4);
          if (!this.rec('growl', w, 1)) this.sfx.growl(w);
          if (!this.rec('bleat_ewe', this.where(e.x, e.z, 0.5), 1, false, 1.15)) this.sfx.bleat(this.where(e.x, e.z, 0.5), true, 0.9);
          break;
        }
        case 'rescued':
          if (!this.rec('yelp', this.where(e.x, e.z, 0.6), 0.9)) this.sfx.yelp(this.where(e.x, e.z, 0.6));
          this.sfx.sting('rescue');
          break;
        case 'wolfScared':
          if (!this.rec('yelp', this.where(e.x, e.z, 0.3), 0.7)) this.sfx.yelp(this.where(e.x, e.z, 0.3));
          break;
        case 'lost':
          this.sfx.sting('lost');
          break;
        case 'splash':
          if (!this.rec('splash', this.where(e.x, e.z), e.big ? 0.9 : 0.6)) this.sfx.splash(this.where(e.x, e.z), e.big);
          break;
      }
    }
    void sim;
  }

  /** The day's result: the gate clanks shut on a win before the fanfare. */
  outcome(win: boolean) {
    // The recorded score has its own win phrase; the synth sting only plays without it.
    const phrase = this.music.outcome(win);
    if (win) {
      if (!this.rec('gate', { pan: 0, level: 1 }, 0.9)) this.sfx.gate();
      if (!phrase) window.setTimeout(() => this.sfx.sting('win'), 350);
    } else {
      this.sfx.sting('lose');
    }
  }

  update(dt: number, sim: Sim | null, mood: number, night: number, mode: AudioMode, tension: number, wx: { rain: number; mist: number; snow: number } = { rain: 0, mist: 0, snow: 0 }) {
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
    const q = sim ? this.level.streamQuery(this.lx, this.lz) : { d: 60, cx: 0, half: 0 };
    const streamDist = Math.max(0, Math.min(200, q.d - q.half));
    const recorded = !!this.samples?.ready;
    this.amb.update(dt, {
      night,
      streamDist,
      streamPan: (q.cx - this.lx) / 20,
      active: mode !== 'paused',
      synth: recorded ? 0.2 : 1,
    });
    if (recorded) {
      // Recorded beds: wind (stronger in storms and mist), rain, the stream and the loch by
      // distance, crickets by night, and birdsong in the golden hour and at dawn.
      const menu = mode === 'paused' ? 0.55 : 1;
      const near = (d: number, r: number) => Math.max(0, 1 - d / r) ** 2;
      const loch = this.level.lochs.length ? Math.max(0, this.level.lochQuery(this.lx, this.lz).d) : 999;
      const watch = this.rules?.objective === 'watch';
      const birds = sim ? (watch ? Math.max(0, (sim.t - 0.7) / 0.3) : Math.max(0, 1 - mood / 0.35)) : 0.6 * Math.max(0, 1 - mood / 0.4);
      const set = (name: string, g: number) => this.loops[name]?.setGain(Math.max(0, g) * menu, 0.8);
      set('wind', 0.35 + 0.5 * wx.rain + 0.35 * wx.mist + 0.15 * wx.snow + 0.1 * night);
      set('rain', 0.9 * wx.rain);
      set('stream', 0.8 * near(streamDist, 40) * (1 + wx.rain));
      set('loch', 0.7 * near(loch, 30));
      set('night', 0.55 * Math.max(0, (night - 0.25) / 0.5) * (1 - wx.rain) * (1 - wx.snow));
      set('dawn', 0.4 * Math.min(1, birds) * (1 - wx.rain) * (1 - wx.snow * 0.8));
    }
    this.music.update({ mood, tension, playing, mode, watch: this.rules?.objective === 'watch' });
    // Menus sit the score back a little; the end card lets the stinger speak.
    const t = ctx.currentTime;
    const duck = mode === 'paused' ? 0.45 : mode === 'ended' ? 0.35 : 1;
    this.engine.music.gain.setTargetAtTime(this.engine.settings.music * 0.8 * duck, t, 0.3);
  }
}
