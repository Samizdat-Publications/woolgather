// Recorded samples: the creature sounds and ambience loops in public/audio/, generated with the
// ElevenLabs Sound Effects API by tools/gen-sfx.mjs (see docs/audio/SFX.md). A SampleBank reads the
// manifest, decodes every file once, and plays them into any node, usually one of the AudioEngine's
// buses (`engine.sfx`, `engine.amb`, or `engine.reverb` as an extra send). It never throws: a file
// that fails to load is skipped and listed in `missing`, so callers can fall back to synthesis.
//
//   const bank = new SampleBank(engine.ctx!);
//   void bank.load();
//   bank.play('bleat_ewe', engine.sfx, { gain: 0.6, pan: -0.3 });
//   const rain = bank.loop('rain', engine.amb, 0);
//   rain?.setGain(0.5, 2);

/** public/audio/manifest.json, as written by tools/gen-sfx.mjs. */
interface SampleManifest {
  /** One-shot groups: each lists its variants. */
  sounds?: Record<string, string[]>;
  /** Loop names (the file is `<name>.mp3` unless loopInfo says otherwise). */
  loops?: string[];
  /**
   * Each loop file holds `pad` seconds of wrapped audio before and after a loop body `seconds` long,
   * so MP3 encoder priming and padding never fall inside the loop.
   */
  loopInfo?: Record<string, { file?: string; seconds?: number; pad?: number }>;
}

export interface SamplePlayOptions {
  /** Linear gain (default 1). */
  gain?: number;
  /** Stereo position from -1 (left) to 1 (right). */
  pan?: number;
  /** Playback rate. Omitted, each play gets a small random detune (+-4%). */
  rate?: number;
  /** Seconds from now before the sound starts (default 0). */
  delay?: number;
}

export interface SampleLoop {
  /** Glide the loop's gain to `g`. `time` is the smoothing time constant in seconds (default 0.3). */
  setGain(g: number, time?: number): void;
  /** Fade out quickly and stop. Calling it again does nothing. */
  stop(): void;
}

interface Clip {
  buffer: AudioBuffer;
  /** Where the sound itself starts in the buffer (s), past any decoder priming. */
  offset: number;
}

interface LoopClip {
  buffer: AudioBuffer;
  start: number;
  end: number;
}

const DEFAULT_BASE = `${import.meta.env.BASE_URL}audio/`;
const DETUNE = 0.04;
const DECODE_CONCURRENCY = 6;

/**
 * Seconds to the first sample that belongs to the sound. Some browsers leave the MP3 decoder's
 * priming (a few dozen ms of silence) at the head of the buffer, others trim it: this finds the real
 * start either way. Searches at most `maxSeconds`; 0 if nothing stands out.
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

/** The loop body inside a padded loop file; the whole buffer if the manifest gives no layout. */
function loopRegion(buffer: AudioBuffer, info?: { seconds?: number; pad?: number }): LoopClip {
  const seconds = info?.seconds ?? 0;
  const pad = info?.pad ?? 0;
  if (seconds > 0 && pad > 0) {
    // The pad is wrapped audio, so a start found a few ms early or late still loops seamlessly.
    const start = contentStart(buffer, 0.1) + pad;
    const end = start + seconds;
    if (end <= buffer.duration) return { buffer, start, end };
  }
  return { buffer, start: 0, end: buffer.duration };
}

async function runLimited(jobs: (() => Promise<void>)[], n: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
}

export class SampleBank {
  /** Files (or `manifest.json`) that could not be fetched or decoded. */
  readonly missing: string[] = [];
  private readonly ctx: AudioContext;
  private readonly base: string;
  private readonly groups = new Map<string, Clip[]>();
  private readonly loops = new Map<string, LoopClip>();
  private readonly lastPick = new Map<string, number>();
  private loading: Promise<void> | null = null;
  private loaded = false;

  /** `base` defaults to the app's `audio/` folder under Vite's BASE_URL. */
  constructor(ctx: AudioContext, base: string = DEFAULT_BASE) {
    this.ctx = ctx;
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  /** True once load() has finished and at least one sound decoded. */
  get ready(): boolean {
    return this.loaded && (this.groups.size > 0 || this.loops.size > 0);
  }

  /**
   * Fetch the manifest and decode every file. Never throws: missing or undecodable files are skipped
   * and reported in `missing`. Safe to call more than once (later calls share the first load).
   */
  load(): Promise<void> {
    this.loading ??= this.loadAll();
    return this.loading;
  }

  /** True if a one-shot group or a loop of this name is loaded. */
  has(group: string): boolean {
    return (this.groups.get(group)?.length ?? 0) > 0 || this.loops.has(group);
  }

  /**
   * Play a random variant of a one-shot group (never the same variant twice in a row) into `dest`.
   * Returns the source node, or null if the group is not loaded.
   */
  play(group: string, dest: AudioNode, opts: SamplePlayOptions = {}): AudioBufferSourceNode | null {
    const clips = this.groups.get(group);
    if (!clips || clips.length === 0) return null;
    const n = clips.length;
    const prev = this.lastPick.get(group);
    let pick: number;
    if (n > 1 && prev !== undefined && prev < n) {
      pick = Math.floor(Math.random() * (n - 1));
      if (pick >= prev) pick++;
    } else {
      pick = Math.floor(Math.random() * n);
    }
    this.lastPick.set(group, pick);
    const clip = clips[pick];

    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.playbackRate.value = opts.rate ?? 1 + (Math.random() * 2 - 1) * DETUNE;
    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 1;
    src.connect(gain);
    let panner: StereoPannerNode | null = null;
    if (opts.pan !== undefined) {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(panner);
      panner.connect(dest);
    } else {
      gain.connect(dest);
    }
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    src.start(ctx.currentTime + Math.max(0, opts.delay ?? 0), clip.offset);
    return src;
  }

  /**
   * Start a looping sound into `dest`, fading in to `gain`. Returns a handle that glides the gain
   * and stops the loop, or null if the loop is not loaded.
   */
  loop(name: string, dest: AudioNode, gain = 1): SampleLoop | null {
    const clip = this.loops.get(name);
    if (!clip) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    src.loopStart = clip.start;
    src.loopEnd = clip.end;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    src.connect(amp);
    amp.connect(dest);
    const t = ctx.currentTime;
    amp.gain.setTargetAtTime(Math.max(0, gain), t, 0.3);
    // Start somewhere inside the loop, so the ambience does not open on the same moment every time.
    src.start(t, clip.start + Math.random() * (clip.end - clip.start));
    src.onended = () => {
      src.disconnect();
      amp.disconnect();
    };
    let stopped = false;
    return {
      setGain(g: number, time = 0.3) {
        if (stopped) return;
        const now = ctx.currentTime;
        amp.gain.cancelScheduledValues(now);
        amp.gain.setTargetAtTime(Math.max(0, g), now, Math.max(0.005, time));
      },
      stop() {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        amp.gain.cancelScheduledValues(now);
        amp.gain.setTargetAtTime(0, now, 0.08);
        src.stop(now + 0.5);
      },
    };
  }

  private async loadAll(): Promise<void> {
    let manifest: SampleManifest;
    try {
      const res = await fetch(`${this.base}manifest.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = (await res.json()) as SampleManifest;
    } catch {
      this.missing.push('manifest.json');
      this.loaded = true;
      return;
    }

    const jobs: (() => Promise<void>)[] = [];
    for (const [group, files] of Object.entries(manifest.sounds ?? {})) {
      // Slots keep the manifest's variant order whatever order the files finish decoding in.
      const slots: (Clip | null)[] = files.map(() => null);
      files.forEach((file, i) => {
        jobs.push(async () => {
          const buffer = await this.fetchDecode(file);
          if (!buffer) return;
          slots[i] = { buffer, offset: contentStart(buffer, 0.06) };
          this.groups.set(group, slots.filter((c): c is Clip => c !== null));
        });
      });
    }
    for (const name of manifest.loops ?? []) {
      const info = manifest.loopInfo?.[name];
      const file = info?.file ?? `${name}.mp3`;
      jobs.push(async () => {
        const buffer = await this.fetchDecode(file);
        if (buffer) this.loops.set(name, loopRegion(buffer, info));
      });
    }
    await runLimited(jobs, DECODE_CONCURRENCY);
    this.loaded = true;
  }

  private async fetchDecode(file: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(this.base + file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      this.missing.push(file);
      return null;
    }
  }
}
