import { mtof, type AudioEngine } from './engine';

// Procedural folk score in 3/4: a tin-whistle melody over a plucked oom-pah-pah and a bagpipe-like
// drone. Tunes are composed on the fly (AABA phrases from a pentatonic random walk that lands on
// chord tones). The palette follows the evening: bright D major by day, D dorian at sunset, sparse
// D minor by night. A heartbeat and tremolo strings rise with the wolves' threat.

export interface MusicState {
  /** Mood progress, 0 golden hour .. 1 night. */
  mood: number;
  /** 0..1, how close a wolf is to the flock or to Pip. */
  tension: number;
  /** Playing, or under a menu (quieter, no tension layer). */
  playing: boolean;
}

type Chord = number[];
interface Palette {
  name: string;
  scale: number[];
  chords: Chord[];
  /** Chance the whistle plays a given phrase (the rest is accompaniment only). */
  lead: number;
  tempo: number;
}

const C = {
  D: [50, 57, 62, 66],
  G: [43, 50, 55, 59],
  A: [45, 52, 57, 61],
  Bm: [47, 54, 59, 62],
  Dm: [50, 57, 62, 65],
  Cmaj: [48, 55, 60, 64],
  Bb: [46, 53, 58, 62],
  Am: [45, 52, 57, 60],
  F: [41, 48, 53, 57],
};

const DAY: Palette = {
  name: 'day',
  scale: [74, 76, 78, 81, 83, 86, 88],
  chords: [C.D, C.G, C.D, C.A, C.D, C.Bm, C.G, C.A, C.Bm, C.G, C.D, C.A, C.G, C.A, C.D, C.D],
  lead: 0.85,
  tempo: 92,
};
const DUSK: Palette = {
  name: 'dusk',
  scale: [74, 77, 79, 81, 84, 86, 89],
  chords: [C.Dm, C.Cmaj, C.Bb, C.A, C.Dm, C.F, C.Cmaj, C.Am, C.Dm, C.Cmaj, C.Bb, C.Cmaj, C.Dm, C.Am, C.Dm, C.Dm],
  lead: 0.75,
  tempo: 84,
};
const NIGHT: Palette = {
  name: 'night',
  scale: [74, 76, 77, 79, 81, 82, 84],
  chords: [C.Dm, C.Bb, C.F, C.Cmaj, C.Dm, C.Bb, C.Cmaj, C.Dm],
  lead: 0.5,
  tempo: 76,
};

interface Note {
  /** Start, in beats from the start of the phrase. */
  at: number;
  len: number;
  midi: number;
}

const RHYTHMS = [
  [1, 1, 1],
  [2, 1],
  [1, 2],
  [1.5, 0.5, 1],
  [0.5, 0.5, 1, 1],
  [1, 0.5, 0.5, 1],
];

export class Music {
  private palette = DAY;
  private phraseA: Note[] = [];
  private phraseB: Note[] = [];
  private beatTime = 0;
  /** Beat counter since the tune started (3 per bar). */
  private beat = 0;
  private timer = 0;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private tensionGain: GainNode | null = null;
  private stringsGain: GainNode | null = null;
  private leadOn = true;
  private state: MusicState = { mood: 0, tension: 0, playing: false };
  private seed = 1;

  constructor(private e: AudioEngine) {
    e.onReady(() => this.start());
  }

  private rand() {
    // Small deterministic LCG so a tune can be replayed from its seed.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private start() {
    const ctx = this.e.ctx!;
    // Drone: open fifth D2 + A2 on two detuned saws, very soft, through a dark filter.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 300;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.e.music);
    for (const [m, det] of [
      [38, -4],
      [45, 3],
      [50, 5],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = det;
      o.connect(this.droneFilter);
      o.start();
    }
    // Tension: tremolo strings (D minor triad) and a heartbeat scheduled with the beat.
    this.stringsGain = ctx.createGain();
    this.stringsGain.gain.value = 0;
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 0.4;
    lfo.connect(lfoAmp);
    lfoAmp.connect(trem.gain);
    lfo.start();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    trem.connect(lp);
    lp.connect(this.stringsGain);
    this.stringsGain.connect(this.e.music);
    for (const m of [62, 65, 69, 74]) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(trem);
        o.start();
      }
    }
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.e.music);

    this.restart(1);
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  /** Begin a fresh tune (a new day). */
  restart(seed: number) {
    this.seed = (seed * 2654435761) >>> 0 || 1;
    this.palette = DAY;
    this.compose();
    this.beat = 0;
    this.beatTime = (this.e.ctx?.currentTime ?? 0) + 0.3;
  }

  update(s: MusicState) {
    this.state = s;
    const ctx = this.e.ctx;
    if (!ctx || !this.droneGain || !this.droneFilter || !this.stringsGain || !this.tensionGain) return;
    const t = ctx.currentTime;
    const tension = s.playing ? s.tension : 0;
    this.droneGain.gain.setTargetAtTime(0.02 + 0.012 * s.mood, t, 0.8);
    this.droneFilter.frequency.setTargetAtTime(340 - 140 * s.mood, t, 1);
    this.stringsGain.gain.setTargetAtTime(0.022 * tension, t, 0.4);
    this.tensionGain.gain.setTargetAtTime(0.9 * tension, t, 0.3);
  }

  dispose() {
    window.clearInterval(this.timer);
  }

  /** Two phrases for the current palette: A (repeated) and B (the bridge). */
  private compose() {
    this.phraseA = this.makePhrase(0);
    this.phraseB = this.makePhrase(4);
  }

  private makePhrase(barOffset: number): Note[] {
    const p = this.palette;
    const notes: Note[] = [];
    let idx = 1 + Math.floor(this.rand() * 3);
    for (let bar = 0; bar < 4; bar++) {
      const chord = p.chords[(barOffset + bar) % p.chords.length];
      const last = bar === 3;
      const rhythm = last ? (this.rand() < 0.5 ? [2, 1] : [3]) : RHYTHMS[Math.floor(this.rand() * RHYTHMS.length)];
      let at = bar * 3;
      rhythm.forEach((len, i) => {
        if (last && i === 1) return; // breathe before the next phrase
        const onBeat = Number.isInteger(at);
        if (i === 0 || (onBeat && this.rand() < 0.5)) {
          // Land on a chord tone.
          const pcs = chord.map((m) => m % 12);
          let best = idx;
          let bd = 99;
          for (let j = 0; j < p.scale.length; j++) {
            if (!pcs.includes(p.scale[j] % 12)) continue;
            const d = Math.abs(j - idx) + this.rand() * 0.5;
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
          idx = best;
        } else {
          const steps = [-2, -1, -1, 1, 1, 2, 0];
          idx = Math.max(0, Math.min(p.scale.length - 1, idx + steps[Math.floor(this.rand() * steps.length)]));
        }
        notes.push({ at, len, midi: p.scale[idx] });
        at += len;
      });
    }
    return notes;
  }

  private paletteFor(mood: number) {
    return mood < 0.42 ? DAY : mood < 0.7 ? DUSK : NIGHT;
  }

  /** Lookahead scheduler: queue every beat that starts in the next 0.25 s. */
  private schedule() {
    const ctx = this.e.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.beatTime < ctx.currentTime - 0.5) this.beatTime = ctx.currentTime + 0.05;
    while (this.beatTime < ctx.currentTime + 0.25) {
      this.playBeat(this.beat, this.beatTime);
      this.beatTime += 60 / this.palette.tempo;
      this.beat++;
    }
  }

  private playBeat(beat: number, t: number) {
    const barInTune = Math.floor(beat / 3) % 16;
    const beatInBar = beat % 3;
    const beatInPhrase = beat % 12;
    // Every 16 bars a new tune is composed; the palette only changes there, so the key never
    // lurches mid-phrase.
    if (beat % 48 === 0 && beat > 0) {
      this.palette = this.paletteFor(this.state.mood);
      this.compose();
    }
    if (beatInPhrase === 0) this.leadOn = this.rand() < this.palette.lead * (this.state.playing ? 1 : 0.8);
    const p = this.palette;
    const chord = p.chords[barInTune % p.chords.length];
    const beatLen = 60 / p.tempo;

    // Accompaniment: bass on the downbeat, the upper chord tones on beats 2 and 3.
    if (beatInBar === 0) {
      this.pluck(chord[0], t, 0.09, beatLen * 2.5);
    } else {
      this.pluck(chord[2], t, 0.045, beatLen * 1.2);
      this.pluck(chord[3], t + 0.012, 0.04, beatLen * 1.2);
    }

    // Melody: AABA over 16 bars.
    if (this.leadOn) {
      const section = Math.floor(barInTune / 4);
      const phrase = section === 2 ? this.phraseB : this.phraseA;
      const local = beat % 12;
      for (const n of phrase) {
        if (n.at >= local && n.at < local + 1) {
          const lift = section === 1 && n.at >= 9 ? 2 : 0; // the second A ends a step higher
          this.whistle(n.midi + (lift && p.scale.includes(n.midi + 2) ? 2 : 0), t + (n.at - local) * beatLen, n.len * beatLen);
        }
      }
    }

    // Heartbeat under the tension layer: lub-dub on beats 1 and 2 (gain set in update()).
    if (this.state.playing && this.state.tension > 0.02 && beatInBar !== 2) this.thump(t, beatInBar === 0 ? 1 : 0.6);
  }

  private pluck(midi: number, t: number, level: number, dur: number) {
    const ctx = this.e.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.3);
    f.connect(g);
    g.connect(this.e.music);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(midi);
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private whistle(midi: number, t: number, dur: number) {
    const ctx = this.e.ctx!;
    const level = this.state.playing ? 0.07 : 0.05;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.04);
    g.gain.setValueAtTime(level * 0.85, t + Math.max(0.05, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    g.connect(this.e.music);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    g.connect(send);
    send.connect(this.e.reverb);
    // Vibrato blooms after the attack, as a player would lean into a held note.
    const vib = ctx.createGain();
    vib.gain.setValueAtTime(0, t);
    vib.gain.linearRampToValueAtTime(dur > 0.5 ? 9 : 3, t + Math.min(0.4, dur));
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    lfo.connect(vib);
    lfo.start(t);
    lfo.stop(t + dur + 0.15);
    for (const [type, ratio, amp] of [
      ['sine', 1, 1],
      ['triangle', 2, 0.12],
    ] as const) {
      const a = ctx.createGain();
      a.gain.value = amp;
      a.connect(g);
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi) * ratio;
      vib.connect(o.detune);
      o.connect(a);
      o.start(t);
      o.stop(t + dur + 0.15);
    }
    // Breath at the start of each note.
    const n = this.e.noise(false, false);
    const nb = ctx.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = mtof(midi) * 2;
    nb.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(level * 0.5, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(nb);
    nb.connect(ng);
    ng.connect(this.e.music);
    n.start(t, Math.random(), 0.2);
  }

  private thump(t: number, amp: number) {
    const ctx = this.e.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2 * amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    g.connect(this.tensionGain!);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.2);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.3);
  }
}
