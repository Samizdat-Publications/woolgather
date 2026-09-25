// Web Audio plumbing: one context, three buses (effects, music, ambience) into a master gain and
// a gentle limiter, a shared reverb, and cached noise buffers. Every sound in the game is
// synthesised from oscillators and noise here; there are no audio files.

export interface AudioSettings {
  volume: number;
  music: number;
  sfx: number;
  muted: boolean;
}

const STORE_KEY = 'woolgather.audio';

function loadSettings(): AudioSettings {
  const def: AudioSettings = { volume: 0.8, music: 0.6, sfx: 0.9, muted: false };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch {
    // Storage can be blocked (private windows, previews): defaults are fine.
  }
  return def;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  amb!: GainNode;
  /** Send into the shared reverb (a synthesised valley echo). */
  reverb!: GainNode;
  white!: AudioBuffer;
  pink!: AudioBuffer;
  settings = loadSettings();
  private listeners: (() => void)[] = [];

  /** Browsers only allow audio after a user gesture: call from the first key press or click. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.build(this.ctx);
      for (const f of this.listeners) f();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Run `f` once the context exists (immediately if it already does). */
  onReady(f: () => void) {
    if (this.ctx) f();
    else this.listeners.push(f);
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  private build(ctx: AudioContext) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    for (const b of [this.sfx, this.music, this.amb]) b.connect(this.master);

    this.white = this.noiseBuffer(ctx, 2, false);
    this.pink = this.noiseBuffer(ctx, 4, true);

    // Reverb: exponentially decaying stereo noise as the impulse response (a wide, soft valley).
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1);
      }
    }
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    conv.connect(wet);
    wet.connect(this.master);
    this.reverb = ctx.createGain();
    this.reverb.connect(conv);
    this.apply();
  }

  private noiseBuffer(ctx: AudioContext, seconds: number, pink: boolean) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Paul Kellet's economy pink filter.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (pink) {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else {
        d[i] = w;
      }
    }
    return buf;
  }

  /** Push the volume settings to the buses (smoothly) and remember them. */
  apply() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    } catch {
      // Not persisted: fine.
    }
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.volume, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(s.music * 0.8, t, 0.05);
    this.amb.gain.setTargetAtTime(0.9, t, 0.05);
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.apply();
    return this.settings.muted;
  }

  /** A looping noise source (white or pink), started now. */
  noise(pink = false, loop = true) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = pink ? this.pink : this.white;
    src.loop = loop;
    if (loop) src.loopStart = Math.random() * 0.5;
    return src;
  }
}

/** Attack-decay envelope on a gain param: 0 -> peak over `a`, then down to silence over `d`. */
export function envAD(p: AudioParam, t: number, peak: number, a: number, d: number) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/** Midi note number to frequency. */
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
