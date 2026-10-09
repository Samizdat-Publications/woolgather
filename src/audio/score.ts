import type { AudioEngine } from './engine';

// The recorded score: warm acoustic folk beds generated with the ElevenLabs Music API by
// tools/gen-music.mjs (see docs/audio/MUSIC.md), in public/audio/music/ with music.json beside them.
//
//   title    the theme, for the title screen and menus (plays through, rings out, starts again)
//   evening  the herding bed for the golden hour and the sunset (seamless loop)
//   dusk     the same world slower and sparser, in the minor, for dusk, night and the night watch
//   win      a short resolving phrase for the results card after a win (one-shot)
//
// Beds loop into `engine.music` and crossfade as the scene and the light change. Music (music.ts)
// owns a Score: once `ready`, it mutes its own synthesised tune and keeps only its tension layer on
// top. Nothing here throws: a missing or undecodable file just leaves that track out (a missing bed is
// stood in for by another), and with no beds at all `ready` stays false and the synth plays as before.

export type ScoreScene = 'title' | 'playing' | 'paused' | 'ended';

export interface ScoreState {
  scene: ScoreScene;
  /** Mood progress, 0 golden hour .. 1 night. */
  mood: number;
  /** 0..1, how close a wolf is to the flock or to Pip. */
  tension: number;
  /** The night watch (night to dawn): the dusk bed throughout. */
  watch: boolean;
}

type BedName = 'title' | 'evening' | 'dusk';

/** public/audio/music/music.json, as written by tools/gen-music.mjs. */
interface TrackInfo {
  file: string;
  kind?: 'loop' | 'song' | 'oneshot';
  loop?: boolean;
  /** Loop region (s) from the start of the content. */
  loopStart?: number;
  loopEnd?: number;
  /** Where the content start is detected in the encoded PCM (s), to measure decoder priming against. */
  lead?: number;
  /** Detected key: tonic pitch class (C = 0) and mode. */
  root?: number;
  mode?: 'major' | 'minor';
}

interface Bed {
  name: BedName;
  buffer: AudioBuffer;
  /** Content start in the buffer (s): past any decoder priming. */
  top: number;
  loopStart: number;
  loopEnd: number;
  info: TrackInfo;
  /** This bed's fader into the score bus. */
  fader: GainNode | null;
  src: AudioBufferSourceNode | null;
  /** Gain the fader is heading for, and from when (the fade-in after a switch may start later). */
  target: number;
  settleAt: number;
  /** Context time the target last went to 0 (a silent source is stopped after a while). */
  zeroSince: number;
}

const BASE = `${import.meta.env.BASE_URL}audio/music/`;
const ORDER: BedName[] = ['title', 'evening', 'dusk'];

// Levels (linear, into engine.music). The files sit at -20 LUFS (the win phrase at -18), louder than
// the synthesised tune they replace, so the beds are set back; these are the knobs to tune by ear.
const BED_LEVEL = 0.55;
const TITLE_LEVEL = 0.6;
/** Extra fade under the pause menu (audio.ts already ducks the whole music bus there). */
const PAUSE_LEVEL = 0.6;
/** How far the bed steps back as the wolves close in, to let the synth tension layer through. */
const TENSION_DUCK = 0.3;
/** After a loss the evening's bed plays on under the results (audio.ts ducks it further). */
const LOSS_LEVEL = 0.8;
/** The win phrase, relative to the music volume setting (it bypasses the results-card duck). */
const WIN_LEVEL = 0.6;
/** Seconds after the outcome before the win phrase (the gate clank and the synth sting go first). */
const WIN_DELAY = 0.8;
/** Mood at which the evening bed hands over to the dusk bed, and back (hysteresis). */
const DUSK_ON = 0.6;
const DUSK_OFF = 0.5;
/** A bed that has been silent this long has its source stopped (it restarts from the top). */
const STOP_AFTER = 5;

/**
 * Where the content starts in a decoded buffer: some browsers leave MP3 priming at the head, others
 * trim it. Same rule as tools/gen-music.mjs uses to write `lead` (and as samples.ts uses).
 */
function contentStart(buf: AudioBuffer, maxSeconds: number): number {
  const d = buf.getChannelData(0);
  const scan = Math.min(d.length, Math.floor(buf.sampleRate * (maxSeconds + 0.3)));
  let peak = 0;
  for (let i = 0; i < scan; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
  }
  const thr = Math.max(1e-5, peak * 0.003);
  const limit = Math.min(d.length, Math.floor(buf.sampleRate * maxSeconds));
  let i = 0;
  while (i < limit && Math.abs(d[i]) < thr) i++;
  return i >= limit ? 0 : i / buf.sampleRate;
}

/** Pitch classes of a key's natural scale. */
function scale(root: number, mode: 'major' | 'minor'): number[] {
  const steps = mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return steps.map((s) => (s + root) % 12);
}

export class Score {
  /** Every bed and the win phrase have been tried (loaded or given up on). */
  settled = false;
  /**
   * Semitones to move the synth tension layer (built on D, E and A) so it sits inside the key of every
   * bed. 0 for the score as generated (D major and D minor beds).
   */
  tensionShift = 0;
  private bus: GainNode | null = null;
  private winOut: GainNode | null = null;
  private beds = new Map<BedName, Bed>();
  private win: { buffer: AudioBuffer; top: number } | null = null;
  private winSrc: { src: AudioBufferSourceNode; gain: GainNode; at: number; ends: number } | null = null;
  private current: BedName | null = null;
  private dusk = false;
  private ending: 'win' | 'lose' | null = null;
  private musicSetting = -1;

  constructor(private e: AudioEngine) {
    e.onReady(() => void this.load());
  }

  /** At least one bed can play: Music then hands the melody over. */
  get ready(): boolean {
    return this.beds.size > 0;
  }

  /** A fresh evening: forget the last one's ending and its dusk. */
  newDay() {
    this.ending = null;
    this.dusk = false;
    this.cancelWin(0.3);
  }

  /**
   * The evening's result. On a win the bed fades and the recorded phrase plays just after the gate (the
   * synth sting is skipped); returns true if it will. On a loss the bed plays on, a little lower.
   */
  outcome(win: boolean): boolean {
    this.ending = win ? 'win' : 'lose';
    const ctx = this.e.ctx;
    if (!win || !ctx || !this.win || !this.winOut) return false;
    this.cancelWin(0.05);
    const at = ctx.currentTime + WIN_DELAY;
    const src = ctx.createBufferSource();
    src.buffer = this.win.buffer;
    const gain = ctx.createGain();
    gain.gain.value = WIN_LEVEL;
    src.connect(gain);
    gain.connect(this.winOut);
    src.start(at, this.win.top);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
    this.winSrc = { src, gain, at, ends: at + this.win.buffer.duration - this.win.top };
    return true;
  }

  update(s: ScoreState) {
    const ctx = this.e.ctx;
    if (!ctx || !this.bus || !this.winOut) return;
    const t = ctx.currentTime;
    // The win phrase skips the results card's duck but still follows the music volume.
    const setting = this.e.settings.music;
    if (setting !== this.musicSetting) {
      this.musicSetting = setting;
      this.winOut.gain.setTargetAtTime(setting * 0.8, t, 0.05);
    }
    if (s.scene !== 'ended') {
      if (this.ending) this.ending = null;
      this.cancelWin(0.4);
    }
    if (s.watch || s.mood >= DUSK_ON) this.dusk = true;
    else if (s.mood < DUSK_OFF) this.dusk = false;
    const gameplay: BedName = this.dusk ? 'dusk' : 'evening';

    let want: BedName | null;
    let level: number;
    if (s.scene === 'title') {
      want = 'title';
      level = TITLE_LEVEL;
    } else if (s.scene === 'ended') {
      if (this.ending === 'win') {
        // The bed gives way to the win phrase; the theme comes back softly as the phrase rings out.
        const after = !this.winSrc || t > this.winSrc.ends - 1.5;
        want = after ? 'title' : this.current;
        level = after ? TITLE_LEVEL * 0.8 : 0;
      } else {
        want = this.current ?? gameplay;
        level = BED_LEVEL * LOSS_LEVEL;
      }
    } else {
      want = gameplay;
      level = BED_LEVEL * (1 - TENSION_DUCK * Math.max(0, Math.min(1, s.tension))) * (s.scene === 'paused' ? PAUSE_LEVEL : 1);
    }
    this.drive(this.standIn(want), level, t, s.scene === 'paused' ? 0.15 : 0.6);
  }

  /** The bed to play for `want`, or the nearest one that loaded. */
  private standIn(want: BedName | null): BedName | null {
    if (!want) return null;
    const order: Record<BedName, BedName[]> = {
      title: ['title', 'evening', 'dusk'],
      evening: ['evening', 'title', 'dusk'],
      dusk: ['dusk', 'evening', 'title'],
    };
    return order[want].find((n) => this.beds.has(n)) ?? null;
  }

  /** Point the faders at `name` (at `level`) and everything else at silence. */
  private drive(name: BedName | null, level: number, t: number, levelTime: number) {
    if (name !== this.current) {
      const prev = this.current ? this.beds.get(this.current) : undefined;
      // Evening and dusk are in different modes of D (major, minor): let one mostly go before the other
      // comes in, so their thirds do not rub. Other changes overlap more.
      const keyChange = (prev?.name === 'evening' && name === 'dusk') || (prev?.name === 'dusk' && name === 'evening');
      const outTime = keyChange ? 1.1 : 0.7;
      const delay = !prev ? 0 : keyChange ? 1.4 : 0.5;
      const inTime = keyChange ? 1.4 : 0.8;
      for (const bed of this.beds.values()) {
        if (bed.name === name || bed.target === 0 || !bed.fader) continue;
        bed.fader.gain.cancelScheduledValues(t);
        bed.fader.gain.setTargetAtTime(0, t, outTime);
        bed.target = 0;
        bed.zeroSince = t;
      }
      this.current = name;
      const next = name ? this.beds.get(name) : undefined;
      if (next) {
        this.ensurePlaying(next, t);
        next.fader!.gain.cancelScheduledValues(t);
        next.fader!.gain.setTargetAtTime(level, t + delay, inTime);
        next.target = level;
        next.settleAt = t + delay + inTime;
      }
    } else if (name) {
      const bed = this.beds.get(name)!;
      // Level changes (tension, pause) glide; a pending fade-in is left to finish first.
      if (t >= bed.settleAt && Math.abs(level - bed.target) > 0.005) {
        if (bed.target === 0 && level > 0 && !bed.src) this.ensurePlaying(bed, t);
        bed.fader!.gain.cancelScheduledValues(t);
        bed.fader!.gain.setTargetAtTime(level, t, levelTime);
        if (level === 0) bed.zeroSince = t;
        bed.target = level;
      }
    }
    // Stop the sources of beds that have been silent a while; they start from the top next time.
    for (const bed of this.beds.values()) {
      if (bed.src && bed.target === 0 && t - bed.zeroSince > STOP_AFTER) {
        bed.src.stop();
        bed.src = null;
      }
    }
  }

  private ensurePlaying(bed: Bed, t: number) {
    const ctx = this.e.ctx!;
    if (!bed.fader) {
      bed.fader = ctx.createGain();
      bed.fader.gain.value = 0;
      bed.fader.connect(this.bus!);
    }
    if (bed.src) return;
    bed.fader.gain.cancelScheduledValues(t);
    bed.fader.gain.setValueAtTime(0, t);
    const src = ctx.createBufferSource();
    src.buffer = bed.buffer;
    src.loop = true;
    src.loopStart = bed.loopStart;
    src.loopEnd = bed.loopEnd;
    src.connect(bed.fader);
    // From the top: the intro before the loop region is heard once, as the bed comes in.
    src.start(t, bed.top);
    src.onended = () => src.disconnect();
    bed.src = src;
  }

  private cancelWin(fade: number) {
    const w = this.winSrc;
    const ctx = this.e.ctx;
    if (!w || !ctx) return;
    this.winSrc = null;
    const t = ctx.currentTime;
    w.gain.gain.cancelScheduledValues(t);
    w.gain.gain.setTargetAtTime(0, t, fade);
    try {
      w.src.stop(Math.max(t, w.at) + fade * 6);
    } catch {
      // Already stopped.
    }
  }

  private async load() {
    try {
      const ctx = this.e.ctx!;
      this.bus = ctx.createGain();
      this.bus.connect(this.e.music);
      this.winOut = ctx.createGain();
      this.winOut.gain.value = 0;
      this.winOut.connect(this.e.master);
      const res = await fetch(`${BASE}music.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tracks = ((await res.json()) as { tracks?: Record<string, TrackInfo> }).tracks ?? {};
      // The theme first (the title screen is waiting for it), then the evening, the dusk, the win.
      for (const name of [...ORDER, 'win']) {
        const info = tracks[name];
        if (!info?.file) continue;
        const buffer = await this.fetchDecode(info.file);
        if (!buffer) continue;
        // Decoder priming: how far the content sits from where the encoder put it.
        const top = Math.max(0, contentStart(buffer, 0.1) - (info.lead ?? 0));
        if (name === 'win') {
          this.win = { buffer, top };
          continue;
        }
        const span = (info.loopEnd ?? 0) - (info.loopStart ?? 0);
        const loopStart = top + (info.loopStart ?? 0);
        const ok = info.loop !== false && span > 1 && loopStart + span <= buffer.duration + 0.01;
        this.beds.set(name as BedName, {
          name: name as BedName,
          buffer,
          top,
          loopStart: ok ? loopStart : top,
          loopEnd: ok ? Math.min(buffer.duration, loopStart + span) : buffer.duration,
          info,
          fader: null,
          src: null,
          target: 0,
          settleAt: 0,
          zeroSince: 0,
        });
        this.tensionShift = this.fitTension();
      }
    } catch {
      // No manifest (or no Web Audio): the synthesised score carries on alone.
    }
    this.settled = true;
  }

  /** Smallest shift that puts D, E and A (the tension layer) inside every loaded bed's key. */
  private fitTension(): number {
    const keys = [...this.beds.values()].filter((b) => b.info.root !== undefined).map((b) => scale(b.info.root!, b.info.mode ?? 'major'));
    if (!keys.length) return 0;
    for (const s of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, 6]) {
      const pcs = [2, 4, 9].map((p) => (((p + s) % 12) + 12) % 12);
      if (keys.every((k) => pcs.every((p) => k.includes(p)))) return s;
    }
    return 0;
  }

  private async fetchDecode(file: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(BASE + file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await this.e.ctx!.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}
