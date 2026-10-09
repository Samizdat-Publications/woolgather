import { envAD, type AudioEngine } from './engine';

// The valley's bed of sound: wind over the hills, the stream near the water, birdsong by day,
// crickets and the odd owl by night. Levels follow the time of day and where Pip is.

export interface AmbienceState {
  /** 0 by day .. 1 at full night. */
  night: number;
  /** Metres from Pip to the stream, and which side of the screen it is on (-1 .. 1). */
  streamDist: number;
  streamPan: number;
  /** Quieter under menus. */
  active: boolean;
  /** How much of the synthesised wind and stream to keep (recorded loops take over when loaded). */
  synth?: number;
}

export class Ambience {
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private streamGain: GainNode | null = null;
  private streamPan: StereoPannerNode | null = null;
  private birdT = 1.5;
  private cricketT = 0;
  private owlT = 18;
  private gustT = 0;
  private gust = 0;

  constructor(private e: AudioEngine) {
    e.onReady(() => this.start());
  }

  private start() {
    const ctx = this.e.ctx!;
    const wind = this.e.noise(true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.9;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.e.amb);
    wind.start();

    const water = this.e.noise(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.45;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 280;
    // A slow wobble in the filter makes it babble instead of hiss.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.37;
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 260;
    lfo.connect(lfoAmp);
    lfoAmp.connect(bp.frequency);
    lfo.start();
    this.streamGain = ctx.createGain();
    this.streamGain.gain.value = 0;
    this.streamPan = ctx.createStereoPanner();
    water.connect(bp);
    bp.connect(hp);
    hp.connect(this.streamGain);
    this.streamGain.connect(this.streamPan);
    this.streamPan.connect(this.e.amb);
    water.start();
  }

  update(dt: number, s: AmbienceState) {
    const ctx = this.e.ctx;
    if (!ctx || !this.windGain || !this.windFilter || !this.streamGain || !this.streamPan) return;
    const t = ctx.currentTime;
    const menu = s.active ? 1 : 0.55;

    // Wind: always there, gusting now and then, a touch stronger after dark.
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 3 + Math.random() * 6;
      this.gust = Math.random();
    }
    const synth = s.synth ?? 1;
    this.windGain.gain.setTargetAtTime((0.1 + 0.08 * this.gust + 0.05 * s.night) * menu * synth, t, 1.2);
    this.windFilter.frequency.setTargetAtTime(320 + 420 * this.gust, t, 1.5);

    const near = Math.max(0, 1 - s.streamDist / 45);
    this.streamGain.gain.setTargetAtTime(0.32 * near * near * menu * synth, t, 0.3);
    this.streamPan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, s.streamPan)), t, 0.3);

    const day = Math.max(0, 1 - s.night * 1.6);
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 1.2 + Math.random() * 3.5;
      if (day > 0.05) this.bird(day * menu);
    }
    const dusk = Math.max(0, Math.min(1, (s.night - 0.2) / 0.4));
    this.cricketT -= dt;
    if (this.cricketT <= 0) {
      this.cricketT = 0.55 + Math.random() * 0.5;
      if (dusk > 0.05) this.cricket(dusk * menu);
    }
    this.owlT -= dt;
    if (this.owlT <= 0) {
      this.owlT = 16 + Math.random() * 18;
      if (s.night > 0.6) this.owl(menu);
    }
  }

  private voice(level: number, pan: number, wet: number) {
    const ctx = this.e.ctx!;
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.e.amb);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      p.connect(w);
      w.connect(this.e.reverb);
    }
    return g;
  }

  /** A songbird phrase: a few quick sine sweeps high up. */
  private bird(level: number) {
    const ctx = this.e.ctx!;
    const t0 = ctx.currentTime + 0.02;
    const out = this.voice(0.05 * level, Math.random() * 1.6 - 0.8, 0.3);
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    let t = t0;
    for (let i = 0; i < n; i++) {
      const dur = 0.05 + Math.random() * 0.07;
      const g = ctx.createGain();
      envAD(g.gain, t, 1, 0.008, dur);
      g.connect(out);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const up = Math.random() < 0.5;
      o.frequency.setValueAtTime(base * (up ? 0.8 : 1.25), t);
      o.frequency.exponentialRampToValueAtTime(base * (up ? 1.3 : 0.75), t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
      t += dur + 0.03 + Math.random() * 0.06;
    }
  }

  /** A cricket chirp: three fast pulses of a high tone. */
  private cricket(level: number) {
    const ctx = this.e.ctx!;
    const t0 = ctx.currentTime + 0.02;
    const pitch = Math.random() < 0.5 ? 4400 : 4950;
    const out = this.voice(0.022 * level, Math.random() * 1.4 - 0.7, 0.1);
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.055;
      const g = ctx.createGain();
      envAD(g.gain, t, 1, 0.005, 0.03);
      g.connect(out);
      const o = ctx.createOscillator();
      o.frequency.value = pitch;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.05);
    }
  }

  /** A tawny owl's two-note hoot, far off in the pines. */
  private owl(level: number) {
    const ctx = this.e.ctx!;
    const t0 = ctx.currentTime + 0.05;
    const out = this.voice(0.06 * level, Math.random() < 0.5 ? -0.6 : 0.6, 0.6);
    for (const [dt, dur, f] of [
      [0, 0.32, 390],
      [0.55, 0.7, 372],
    ] as const) {
      const t = t0 + dt;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(out);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}
