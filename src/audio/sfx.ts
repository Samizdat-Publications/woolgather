import { envAD, mtof, type AudioEngine } from './engine';

// Sound effects, each one a small synthesiser patch built on demand and left to the garbage
// collector once its envelope ends. Positions come in as a pan (-1 left .. 1 right) and a level
// (distance falloff) worked out by the caller from the camera.

export interface Where {
  pan: number;
  level: number;
}

const HERE: Where = { pan: 0, level: 1 };

export class Sfx {
  /** Sounds started so far (for the self-test). */
  played = 0;

  constructor(private e: AudioEngine) {}

  private get ctx() {
    return this.e.ctx;
  }

  /** Output chain for one sound: panner -> level -> effects bus, plus a reverb send. */
  private out(w: Where, gain: number, wet = 0.15) {
    const ctx = this.ctx!;
    this.played++;
    const g = ctx.createGain();
    g.gain.value = gain * w.level;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, w.pan));
    g.connect(p);
    p.connect(this.e.sfx);
    if (wet > 0) {
      const s = ctx.createGain();
      s.gain.value = wet;
      p.connect(s);
      s.connect(this.e.reverb);
    }
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode | null) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (dest) o.connect(dest);
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7) {
    const b = this.ctx!.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private noiseBurst(t: number, dur: number, dest: AudioNode, pink = false) {
    const n = this.e.noise(pink, false);
    n.connect(dest);
    n.start(t, Math.random() * 1.2, dur + 0.05);
    return n;
  }

  /** Pip's bark: a falling saw through a throaty formant, with a breathy noise attack. */
  bark(w: Where = HERE) {
    if (!this.ctx) return;
    const t = this.e.now;
    const pitch = 1 + (Math.random() - 0.5) * 0.12;
    for (const [dt, amp] of [
      [0, 1],
      [0.16, 0.7],
    ] as const) {
      const out = this.out(w, 0.55 * amp, 0.18);
      const env = this.ctx.createGain();
      envAD(env.gain, t + dt, 1, 0.008, 0.14);
      const f1 = this.filter('bandpass', 950, 2.4);
      const f2 = this.filter('lowpass', 2600, 0.7);
      env.connect(f1);
      f1.connect(f2);
      f2.connect(out);
      const o = this.osc('sawtooth', 430 * pitch, t + dt, 0.2, env);
      o.frequency.exponentialRampToValueAtTime(200 * pitch, t + dt + 0.15);
      const nEnv = this.ctx.createGain();
      envAD(nEnv.gain, t + dt, 0.35, 0.004, 0.06);
      const nf = this.filter('bandpass', 1800, 1.2);
      nEnv.connect(nf);
      nf.connect(out);
      this.noiseBurst(t + dt, 0.1, nEnv);
    }
  }

  /** A sheep's "maa": a buzzy saw with the characteristic wobble, through two vowel formants. */
  bleat(w: Where, urgent = false, voice = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.e.now;
    const base = (urgent ? 420 : 310) * (0.85 + voice * 0.3);
    const dur = urgent ? 0.42 : 0.62;
    const out = this.out(w, urgent ? 0.3 : 0.2, 0.2);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(1, t + 0.04);
    env.gain.setValueAtTime(1, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // The bleat's tremble: amplitude and pitch wobble together at ~7 Hz.
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = urgent ? 9 : 6.5;
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 0.3;
    lfo.connect(lfoAmp);
    lfoAmp.connect(trem.gain);
    const vib = ctx.createGain();
    vib.gain.value = base * 0.035;
    lfo.connect(vib);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 0.75, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(base * 0.93, t + dur);
    vib.connect(o.frequency);
    o.connect(trem);
    trem.connect(env);
    const fa = this.filter('bandpass', 780, 4);
    const fb = this.filter('bandpass', 1500, 5);
    const lp = this.filter('lowpass', 3200);
    env.connect(fa);
    env.connect(fb);
    const mix = ctx.createGain();
    mix.gain.value = 1.6;
    fa.connect(mix);
    fb.connect(mix);
    mix.connect(lp);
    lp.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Soft paw fall: a thump of low noise; hollow knock on the bridge boards; a slosh in water. */
  step(w: Where, surface: 'grass' | 'wood' | 'water', heavy = 1) {
    if (!this.ctx) return;
    const t = this.e.now;
    const out = this.out(w, 0.12 * heavy, surface === 'wood' ? 0.1 : 0);
    const env = this.ctx.createGain();
    if (surface === 'water') {
      envAD(env.gain, t, 0.9, 0.01, 0.12);
      const f = this.filter('bandpass', 1400 + Math.random() * 600, 0.9);
      env.connect(f);
      f.connect(out);
      this.noiseBurst(t, 0.16, env);
      return;
    }
    envAD(env.gain, t, 1, 0.003, surface === 'wood' ? 0.07 : 0.045);
    const f = this.filter('lowpass', surface === 'wood' ? 900 : 520 + Math.random() * 180, 0.8);
    env.connect(f);
    f.connect(out);
    this.noiseBurst(t, 0.09, env, true);
    if (surface === 'wood') {
      const k = this.ctx.createGain();
      envAD(k.gain, t, 0.5, 0.002, 0.09);
      k.connect(out);
      this.osc('triangle', 180 + Math.random() * 40, t, 0.12, k);
    }
  }

  /** Splash: a hiss that falls in pitch, and a few water droplet blips. */
  splash(w: Where, big = true) {
    if (!this.ctx) return;
    const t = this.e.now;
    const out = this.out(w, big ? 0.35 : 0.2, 0.12);
    const env = this.ctx.createGain();
    envAD(env.gain, t, 1, 0.01, big ? 0.35 : 0.2);
    const f = this.filter('bandpass', 2400, 0.8);
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    env.connect(f);
    f.connect(out);
    this.noiseBurst(t, 0.4, env);
    for (let i = 0; i < (big ? 4 : 2); i++) {
      const dt = 0.03 + Math.random() * 0.22;
      const g = this.ctx.createGain();
      envAD(g.gain, t + dt, 0.25, 0.003, 0.06);
      g.connect(out);
      const o = this.osc('sine', 900 + Math.random() * 700, t + dt, 0.08, g);
      o.frequency.exponentialRampToValueAtTime(350 + Math.random() * 200, t + dt + 0.06);
    }
  }

  /** A wolf howl: a rising, wavering glide with a long tail into the valley reverb. */
  howl(w: Where, harmony = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const voices = harmony ? [1, 1.335] : [1];
    voices.forEach((ratio, vi) => {
      const t = this.e.now + vi * 0.45;
      const base = (250 + Math.random() * 30) * ratio;
      const dur = 2.6;
      const out = this.out(w, 0.22 / voices.length, 0.7);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(1, t + 0.5);
      env.gain.setValueAtTime(1, t + dur - 0.7);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = this.filter('bandpass', 850, 1.1);
      env.connect(f);
      f.connect(out);
      // Vibrato that grows as the howl holds its top note.
      const vib = ctx.createGain();
      vib.gain.setValueAtTime(0, t);
      vib.gain.linearRampToValueAtTime(base * 0.025, t + 1.2);
      this.osc('sine', 5.2, t, dur, vib);
      for (const [type, detune, amp] of [
        ['sine', 0, 1],
        ['triangle', 7, 0.5],
      ] as const) {
        const g = ctx.createGain();
        g.gain.value = amp;
        g.connect(env);
        const o = this.osc(type, base, t, dur, g);
        o.detune.value = detune;
        o.frequency.exponentialRampToValueAtTime(base * 1.9, t + 0.6);
        o.frequency.setValueAtTime(base * 1.9, t + 1.4);
        o.frequency.exponentialRampToValueAtTime(base * 1.45, t + dur);
        vib.connect(o.frequency);
      }
    });
  }

  /** Low growl as a wolf charges: a rough low saw, chopped by a fast flutter. */
  growl(w: Where) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.e.now;
    const out = this.out(w, 0.32, 0.1);
    const env = ctx.createGain();
    envAD(env.gain, t, 1, 0.06, 0.7);
    const flutter = ctx.createGain();
    flutter.gain.value = 0.5;
    const lfo = this.osc('square', 23, t, 0.9, null);
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 0.5;
    lfo.connect(lfoAmp);
    lfoAmp.connect(flutter.gain);
    const lp = this.filter('lowpass', 520, 1.5);
    flutter.connect(env);
    env.connect(lp);
    lp.connect(out);
    const o = this.osc('sawtooth', 82, t, 0.9, flutter);
    o.frequency.linearRampToValueAtTime(70, t + 0.8);
    this.noiseBurst(t, 0.8, flutter, true);
  }

  /** The wolf's yelp as Pip sends it running. */
  yelp(w: Where) {
    if (!this.ctx) return;
    const t = this.e.now;
    for (const dt of [0, 0.17]) {
      const out = this.out(w, 0.26, 0.25);
      const env = this.ctx.createGain();
      envAD(env.gain, t + dt, 1, 0.01, 0.13);
      const f = this.filter('bandpass', 1300, 1.5);
      env.connect(f);
      f.connect(out);
      const o = this.osc('sawtooth', 1150, t + dt, 0.16, env);
      o.frequency.exponentialRampToValueAtTime(560, t + dt + 0.14);
    }
  }

  /** The bell-wether's bell: a small, dull sheep bell, two hollow knocks. */
  bell(w: Where) {
    if (!this.ctx) return;
    const t = this.e.now;
    for (const [i, f] of [[0, 1180], [0.13, 1060]] as const) {
      const out = this.out(w, 0.12, 0.25);
      for (const [ratio, amp, dec] of [
        [1, 1, 0.28],
        [2.4, 0.4, 0.12],
        [3.9, 0.2, 0.07],
      ] as const) {
        const g = this.ctx.createGain();
        envAD(g.gain, t + i, amp, 0.002, dec);
        g.connect(out);
        this.osc('triangle', f * ratio, t + i, dec + 0.05, g);
      }
    }
  }

  /** A sheep safely home: a soft glockenspiel note that climbs the scale as the fold fills. */
  chime(step: number, big = false) {
    if (!this.ctx) return;
    const t = this.e.now;
    // D major pentatonic, alternating between two octaves as the count climbs.
    const scale = [0, 2, 4, 7, 9];
    const n = 74 + scale[step % 5] + 12 * (Math.floor(step / 5) % 2);
    const notes = big ? [n, n + 4, n + 7] : [n];
    notes.forEach((m, i) => {
      const f = mtof(m);
      const out = this.out(HERE, big ? 0.16 : 0.2, 0.3);
      for (const [ratio, amp, dec] of [
        [1, 1, 1.1],
        [2.76, 0.35, 0.5],
        [5.4, 0.15, 0.25],
      ] as const) {
        const g = this.ctx!.createGain();
        envAD(g.gain, t + i * 0.07, amp, 0.004, dec);
        g.connect(out);
        this.osc('sine', f * ratio, t + i * 0.07, dec + 0.05, g);
      }
    });
  }

  /** The fold gate swinging shut: a wooden thud, an iron latch and a little ring. */
  gate() {
    if (!this.ctx) return;
    const t = this.e.now;
    const out = this.out(HERE, 0.5, 0.25);
    const thud = this.ctx.createGain();
    envAD(thud.gain, t, 1, 0.005, 0.3);
    thud.connect(out);
    const o = this.osc('sine', 110, t, 0.35, thud);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.25);
    for (const [f, amp, dec] of [
      [523, 0.2, 0.5],
      [1309, 0.12, 0.35],
      [2154, 0.08, 0.25],
      [3390, 0.05, 0.18],
    ] as const) {
      const g = this.ctx.createGain();
      envAD(g.gain, t + 0.05, amp, 0.002, dec);
      g.connect(out);
      this.osc('sine', f, t + 0.05, dec + 0.05, g);
    }
    const click = this.ctx.createGain();
    envAD(click.gain, t + 0.05, 0.4, 0.001, 0.02);
    const hp = this.filter('highpass', 3000);
    click.connect(hp);
    hp.connect(out);
    this.noiseBurst(t + 0.05, 0.04, click);
  }

  /** Short melodic stingers: rescue (bright), loss (falling minor), win and lose endings. */
  sting(kind: 'rescue' | 'lost' | 'win' | 'lose') {
    if (!this.ctx) return;
    const t = this.e.now;
    const seq: [number, number, number][] =
      kind === 'rescue'
        ? [
            [74, 0, 0.18],
            [78, 0.07, 0.18],
            [81, 0.14, 0.18],
            [86, 0.21, 0.45],
          ]
        : kind === 'lost'
          ? [
              [69, 0, 0.35],
              [65, 0.28, 0.7],
            ]
          : kind === 'win'
            ? [
                [74, 0, 0.2],
                [76, 0.12, 0.2],
                [78, 0.24, 0.2],
                [81, 0.36, 0.25],
                [86, 0.52, 1.2],
                [78, 0.52, 1.2],
                [81, 0.52, 1.2],
              ]
            : [
                [69, 0, 0.5],
                [67, 0.35, 0.5],
                [65, 0.7, 0.5],
                [62, 1.05, 1.4],
              ];
    for (const [m, dt, dur] of seq) {
      const out = this.out(HERE, kind === 'lost' || kind === 'lose' ? 0.18 : 0.15, 0.35);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t + dt);
      env.gain.linearRampToValueAtTime(1, t + dt + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dt + dur);
      const lp = this.filter('lowpass', kind === 'lose' || kind === 'lost' ? 1400 : 3000);
      env.connect(lp);
      lp.connect(out);
      this.osc('triangle', mtof(m), t + dt, dur + 0.05, env);
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.3;
      g2.connect(env);
      this.osc('sine', mtof(m + 12), t + dt, dur + 0.05, g2);
    }
  }

  /** Menu tick. */
  click() {
    if (!this.ctx) return;
    const t = this.e.now;
    const out = this.out(HERE, 0.12, 0);
    const env = this.ctx.createGain();
    envAD(env.gain, t, 1, 0.002, 0.04);
    env.connect(out);
    this.osc('sine', 1180, t, 0.06, env);
  }
}
