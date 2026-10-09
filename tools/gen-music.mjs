// Recorded score: generates the music beds in public/audio/music/ with the ElevenLabs Music API,
// post-processes each one (trimmed, loudness normalised, stereo MP3, seamless loop points found by
// analysis and crossfaded) and writes public/audio/music/music.json, which src/audio/score.ts reads.
//
//   node tools/gen-music.mjs                    generate every track whose .mp3 is missing
//   node tools/gen-music.mjs --force            regenerate everything (or the --only selection)
//   node tools/gen-music.mjs --only dusk,win    limit to some tracks
//   node tools/gen-music.mjs --reprocess        rebuild outputs from the cached raw downloads only
//   node tools/gen-music.mjs --check            no generation: re-check the outputs and rewrite music.json
//   node tools/gen-music.mjs --status           print the account's credit status and exit
//   node tools/gen-music.mjs --budget 300       hard cap on seconds of generated audio in one run
//   node tools/gen-music.mjs --raw-dir <dir>    where raw API downloads are cached (default: OS temp)
//
// The API key comes from ELEVENLABS_API_KEY (environment, else .env.local at the repo root). It is
// never printed or written anywhere. Raw downloads are always cached (outside the repo), so a failed
// processing step never costs a second generation.

import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'audio', 'music');
const META = join(OUT, 'music.json');
const API = 'https://api.elevenlabs.io/v1/music';
const MODEL = 'music_v2_5';
const SR = 44100;
const PEAK_CEILING = -1;
/** Most peak reduction (dB) the limiter may apply; past that the gain itself is lowered. */
const MAX_LIMIT = 4;
const KBPS = 128;
/** Loops: seconds of the tail crossfaded with the audio leading into the loop start. */
const XFADE = 1.5;
/** Loops: seconds of wrapped audio stored after the loop end, so MP3 padding never lands in the loop. */
const PAD = 0.5;
/** Song loops (title): seconds of silence between the last chord and the restart. */
const SONG_GAP = 0.8;

// ---------------------------------------------------------------------------------------------
// The track list
// ---------------------------------------------------------------------------------------------

const NO = 'Instrumental only, no vocals, no singing, no synths, no electric instruments, no drum kit.';
const LOOPABLE = 'Steady from the first bar to the last: no intro, no build-up, no breakdown, no ending, no fade-out. Background music for a video game, made to loop.';

export const TRACKS = [
  {
    name: 'evening',
    kind: 'loop',
    ms: 80000,
    lufs: -20,
    key: 'D major',
    bpm: 84,
    prompt:
      'Warm acoustic Scottish folk, D major, 84 BPM, a gentle lilting 3/4 waltz with steady forward motion. ' +
      'A fiddle and a low whistle share a simple, singable pastoral melody over softly fingerpicked and strummed ' +
      'acoustic guitar, a light bodhran pulse played with brushes and a little upright bass. Golden-hour evening ' +
      'on a Highland hill farm: calm, hopeful, unhurried but always moving. Intimate close-mic\'d folk session ' +
      `in a warm wooden room, natural reverb. ${LOOPABLE} ${NO}`,
  },
  {
    name: 'dusk',
    kind: 'loop',
    ms: 60000,
    lufs: -20,
    key: 'B minor',
    bpm: 72,
    prompt:
      'Sparse, slow Scottish folk air, B minor, 72 BPM, a gentle 3/4. A lone low whistle plays a slow, wistful ' +
      'melody over a soft sustained drone on D and A (shruti box) and a few sparse plucked notes of acoustic ' +
      'guitar, with a quiet fiddle answering now and then. Violet dusk falling over a Highland glen, the moon ' +
      'coming up, lonely and hushed with a hint of unease, never scary. No drums, no percussion. Close-mic\'d, ' +
      `intimate, soft natural reverb. ${LOOPABLE} ${NO}`,
  },
  {
    name: 'title',
    kind: 'song',
    ms: 50000,
    lufs: -20,
    key: 'D major',
    bpm: 88,
    prompt:
      'Warm acoustic Scottish folk theme for the title screen of a cosy video game about a sheepdog, D major, ' +
      '88 BPM, a lilting 3/4 waltz. A fiddle states a simple, singable pastoral melody, then a low whistle joins ' +
      'in harmony, over strummed acoustic guitar, a light bodhran, upright bass and a soft harmonium underneath. ' +
      'Fuller and more heartfelt than background music: a golden-hour Highland glen, hopeful and welcoming. ' +
      'Close-mic\'d folk ensemble in a warm wooden room. It ends on a warm, resolved D major chord that rings out. ' +
      NO,
  },
  {
    name: 'win',
    kind: 'oneshot',
    ms: 8000,
    lufs: -18,
    key: 'D major',
    bpm: 84,
    prompt:
      'A short, warm resolving phrase of Scottish folk music in D major, 84 BPM: a fiddle and a low whistle play ' +
      'a gentle rising cadence over strummed acoustic guitar and end on a sustained, warm D major chord that rings ' +
      'out. Homecoming, contented, a job well done at sunset. Close-mic\'d acoustic folk. ' +
      NO,
  },
];

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const optValue = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const FORCE = has('--force');
const REPROCESS = has('--reprocess');
const CHECK_ONLY = has('--check');
const STATUS = has('--status');
const RAW_DIR = resolve(optValue('--raw-dir') ?? join(tmpdir(), 'woolgather-music-raw'));
const BUDGET_S = Math.min(300, Number(optValue('--budget') ?? 300));
const ONLY = new Set((optValue('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean));

function die(msg) {
  console.error(`gen-music: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const sleep = (t) => new Promise((r) => setTimeout(r, t));
const dbToLin = (db) => Math.pow(10, db / 20);
const linToDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const S = (sec) => Math.round(sec * SR);

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return null;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*?)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

/** Run ffmpeg with optional stdin; resolves with stdout (Buffer) and stderr (string). */
function ff(args, input) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', rej);
    p.on('close', (code) => {
      if (code !== 0) rej(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`));
      else res({ stdout: Buffer.concat(out), stderr: err });
    });
    p.stdin.on('error', () => {});
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

const RAW_IN = ['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0'];

/** Decode audio (Buffer) or a file (path) to stereo 44.1 kHz float PCM: { L, R }. */
async function decode(src, highpass = false) {
  const input = typeof src === 'string' ? ['-i', src] : ['-i', 'pipe:0'];
  const filter = highpass ? ['-af', 'highpass=f=28'] : [];
  const { stdout } = await ff(
    ['-hide_banner', '-loglevel', 'error', ...input, ...filter, '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1'],
    typeof src === 'string' ? undefined : src,
  );
  const n = Math.floor(stdout.length / 8);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = stdout.readFloatLE(i * 8);
    R[i] = stdout.readFloatLE(i * 8 + 4);
  }
  return { L, R };
}

function interleave({ L, R }) {
  const b = Buffer.alloc(L.length * 8);
  for (let i = 0; i < L.length; i++) {
    b.writeFloatLE(L[i], i * 8);
    b.writeFloatLE(R[i], i * 8 + 4);
  }
  return b;
}

const slice = (x, a, b) => ({ L: x.L.slice(a, b), R: x.R.slice(a, b) });
const lengthOf = (x) => x.L.length;

function concat(...parts) {
  const n = parts.reduce((s, p) => s + lengthOf(p), 0);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    L.set(p.L, o);
    R.set(p.R, o);
    o += lengthOf(p);
  }
  return { L, R };
}

function mono(x) {
  const m = new Float32Array(x.L.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (x.L[i] + x.R[i]);
  return m;
}

/** EBU R128 integrated loudness and true peak of stereo PCM. */
async function loudness(x) {
  const { stderr } = await ff(['-hide_banner', '-nostats', ...RAW_IN, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], interleave(x));
  const j = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  const o = JSON.parse(j);
  return { i: parseFloat(o.input_i), tp: parseFloat(o.input_tp), lra: parseFloat(o.input_lra) };
}

async function encode(x, file) {
  await ff(
    ['-hide_banner', '-loglevel', 'error', '-y', ...RAW_IN, '-c:a', 'libmp3lame', '-b:a', `${KBPS}k`, '-ar', String(SR), '-ac', '2',
      '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', file],
    interleave(x),
  );
}

async function volumeDetect(file) {
  const { stderr } = await ff(['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = parseFloat((stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)/) ?? [])[1]);
  const max = parseFloat((stderr.match(/max_volume:\s*(-?[\d.]+|-inf)/) ?? [])[1]);
  return { mean, max };
}

function rmsDb(x, a = 0, b = x.length) {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return linToDb(Math.sqrt(s / Math.max(1, b - a)));
}

/**
 * Where the runtime (src/audio/score.ts) will think the content starts: the first sample of channel 0
 * over 0.3% of the peak of the first 0.4 s, searched within 0.1 s. Stored as `lead` so the game can
 * tell decoder priming apart from the music's own first moments.
 */
function contentStart(d, maxSeconds = 0.1) {
  const scan = Math.min(d.length, S(maxSeconds + 0.3));
  let peak = 0;
  for (let i = 0; i < scan; i++) peak = Math.max(peak, Math.abs(d[i]));
  const thr = Math.max(1e-5, peak * 0.003);
  const limit = Math.min(d.length, S(maxSeconds));
  let i = 0;
  while (i < limit && Math.abs(d[i]) < thr) i++;
  return i >= limit ? 0 : i / SR;
}

// ---------------------------------------------------------------------------------------------
// Analysis: FFT features (chroma, onset strength, level), key and tempo
// ---------------------------------------------------------------------------------------------

const N_FFT = 4096;
const HOP = 512;

function makeFft(n) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };
}

/** Per-frame features on the mono mix: unit chroma vectors, onset strength and level (dB). */
function features(m) {
  const fft = makeFft(N_FFT);
  const win = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const nF = Math.max(1, Math.floor((m.length - N_FFT) / HOP) + 1);
  const chroma = Array.from({ length: nF }, () => new Float64Array(12));
  const rawChroma = new Float64Array(12);
  const onset = new Float64Array(nF);
  const level = new Float64Array(nF);
  const nBins = N_FFT / 2;
  const pc = new Int8Array(nBins).fill(-1);
  for (let k = 1; k < nBins; k++) {
    const f = (k * SR) / N_FFT;
    if (f < 60 || f > 4200) continue;
    pc[k] = (((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12);
  }
  const fluxTop = Math.floor((8000 * N_FFT) / SR);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  let prev = new Float64Array(fluxTop);
  let cur = new Float64Array(fluxTop);
  for (let f = 0; f < nF; f++) {
    const o = f * HOP;
    let e = 0;
    for (let i = 0; i < N_FFT; i++) {
      const v = m[o + i] ?? 0;
      re[i] = v * win[i];
      im[i] = 0;
      if (i >= (N_FFT - HOP) / 2 && i < (N_FFT + HOP) / 2) e += v * v;
    }
    level[f] = linToDb(Math.sqrt(e / HOP));
    fft(re, im);
    const c = chroma[f];
    let flux = 0;
    for (let k = 1; k < nBins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (pc[k] >= 0) c[pc[k]] += mag;
      if (k < fluxTop) {
        cur[k] = Math.log1p(10 * mag);
        const d = cur[k] - prev[k];
        if (d > 0) flux += d;
      }
    }
    [prev, cur] = [cur, prev];
    onset[f] = flux;
    for (let j = 0; j < 12; j++) rawChroma[j] += c[j];
    let norm = 0;
    for (let j = 0; j < 12; j++) {
      c[j] = Math.log1p(c[j]);
      norm += c[j] * c[j];
    }
    norm = Math.sqrt(norm);
    if (norm > 1e-9) for (let j = 0; j < 12; j++) c[j] /= norm;
  }
  // Onset strength relative to its local mean (0.5 s), so loud and quiet passages weigh alike.
  const half = Math.round((0.25 * SR) / HOP);
  const os = new Float64Array(nF);
  let run = 0;
  for (let i = 0; i < Math.min(nF, half); i++) run += onset[i];
  for (let f = 0; f < nF; f++) {
    if (f + half < nF) run += onset[f + half];
    if (f - half - 1 >= 0) run -= onset[f - half - 1];
    const cnt = Math.min(nF - 1, f + half) - Math.max(0, f - half) + 1;
    os[f] = Math.max(0, onset[f] - run / cnt);
  }
  return { chroma, onset: os, level, rawChroma, nF };
}

const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb || 1);
}

/** Krumhansl-Schmuckler key estimate: `root` is the tonic's pitch class (C = 0), `mode` major or minor. */
function estimateKey(rawChroma) {
  const scores = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p) => Array.from({ length: 12 }, (_, i) => p[(i - t + 12) % 12]);
    scores.push({ name: `${NOTE[t]} major`, r: pearson(rawChroma, rot(MAJ)), root: t, mode: 'major' });
    scores.push({ name: `${NOTE[t]} minor`, r: pearson(rawChroma, rot(MIN)), root: t, mode: 'minor' });
  }
  scores.sort((p, q) => q.r - p.r);
  const pcs = Array.from(rawChroma);
  const tot = pcs.reduce((s, v) => s + v, 0) || 1;
  return { best: scores[0], second: scores[1], dMaj: scores.find((s) => s.name === 'D major').r, bMin: scores.find((s) => s.name === 'B minor').r, profile: pcs.map((v) => v / tot) };
}

/** Tempo from the onset envelope's autocorrelation, with a mild preference for 70-110 BPM. */
function estimateTempo(onset) {
  const fps = SR / HOP;
  let best = { bpm: 0, v: -Infinity };
  for (let bpm = 50; bpm <= 200; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    const l0 = Math.floor(lag);
    const fr = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < onset.length; i++) s += onset[i] * (onset[i + l0] * (1 - fr) + onset[i + l0 + 1] * fr);
    const w = Math.exp(-0.5 * (Math.log2(bpm / 90) / 0.9) ** 2);
    if (s * w > best.v) best = { bpm, v: s * w };
  }
  return best.bpm;
}

/** Moving average over +-h frames. */
function smooth(x, h) {
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(x.length - 1, i + h); j++) {
      s += x[j];
      n++;
    }
    y[i] = s / n;
  }
  return y;
}

function median(arr) {
  const s = Array.from(arr).filter(Number.isFinite).sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : -Infinity;
}

// ---------------------------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------------------------

/** Cut leading silence (to a 10 ms fade-in) and trailing silence (to a 60 ms tail). */
function trim(x) {
  const m = mono(x);
  let peak = 0;
  for (const v of m) peak = Math.max(peak, Math.abs(v));
  const w = S(0.01);
  const thrIn = peak * dbToLin(-45);
  const thrOut = peak * dbToLin(-55);
  const blockRms = (k) => {
    let s = 0;
    for (let i = k * w; i < Math.min(m.length, (k + 1) * w); i++) s += m[i] * m[i];
    return Math.sqrt(s / w);
  };
  const nb = Math.floor(m.length / w);
  let a = 0;
  while (a < nb && blockRms(a) < thrIn) a++;
  let b = nb - 1;
  while (b > a && blockRms(b) < thrOut) b--;
  const y = slice(x, Math.max(0, a * w - S(0.01)), Math.min(m.length, (b + 1) * w + S(0.06)));
  fade(y, 0, S(0.01), true);
  return { y, cutHead: (a * w) / SR, cutTail: (m.length - (b + 1) * w) / SR };
}

/** Linear fade in (`up`) or out over [a, a + n). */
function fade(x, a, n, up) {
  for (let i = 0; i < n; i++) {
    const g = up ? i / n : 1 - i / n;
    x.L[a + i] *= g;
    x.R[a + i] *= g;
  }
}

/**
 * A loop's level should not drift: the model likes to build a track up (the first evening bed rose
 * about 6 dB from start to end), and a loop of a crescendo drops back at every seam. This fits a line to
 * the level (dB) of the steady part and applies the opposite slow gain ramp (at most MAX_TREND dB each
 * way), adjusting `feat.level` to match, so the arrangement still builds but the loudness stays even.
 */
const MAX_TREND = 4;
function flattenTrend(x, feat) {
  const fps = SR / HOP;
  const lv = smooth(feat.level.map((v) => Math.max(-100, v)), Math.round(2 * fps));
  const med = median(lv);
  let n = 0;
  let st = 0;
  let sl = 0;
  let stt = 0;
  let stl = 0;
  for (let f = 0; f < lv.length; f++) {
    if (lv[f] < med - 12) continue;
    const t = f / fps;
    n++;
    st += t;
    sl += lv[f];
    stt += t * t;
    stl += t * lv[f];
  }
  if (n < 10) return 0;
  const slope = (n * stl - st * sl) / (n * stt - st * st || 1);
  const dur = lv.length / fps;
  const mid = st / n;
  const span = slope * dur;
  // Small slopes are noise (a sparse air swells and fades phrase by phrase): leave them alone.
  if (Math.abs(span) < 3) return 0;
  const gainDb = (t) => Math.max(-MAX_TREND, Math.min(MAX_TREND, -slope * (t - mid)));
  for (let i = 0; i < lengthOf(x); i++) {
    const g = dbToLin(gainDb(i / SR));
    x.L[i] *= g;
    x.R[i] *= g;
  }
  for (let f = 0; f < feat.level.length; f++) feat.level[f] += gainDb((f * HOP + N_FFT / 2) / SR);
  return span;
}

/**
 * Seamless loop: picks a loop start A (in the first seconds) and end B (in the last seconds) whose
 * surroundings match best (harmony from chroma, rhythm from onset strength, over 3 s before and 1.5 s
 * after each point), aligns them to the sample by waveform correlation, then crossfades the last
 * XFADE seconds before B with the audio leading into A. The file keeps the intro before A (heard once,
 * when the bed starts) and PAD seconds of what follows A after B.
 */
function makeLoop(x, feat) {
  const fps = SR / HOP;
  const nF = feat.nF;
  const total = lengthOf(x) / SR;
  // Coarse grid: 4 frames (46 ms).
  const C = 4;
  const nC = Math.floor(nF / C);
  const ch = Array.from({ length: nC }, (_, k) => {
    const v = new Float64Array(12);
    for (let f = k * C; f < (k + 1) * C; f++) for (let j = 0; j < 12; j++) v[j] += feat.chroma[f][j];
    let n = 0;
    for (let j = 0; j < 12; j++) n += v[j] * v[j];
    n = Math.sqrt(n) || 1;
    for (let j = 0; j < 12; j++) v[j] /= n;
    return v;
  });
  const on = Float64Array.from({ length: nC }, (_, k) => {
    let s = 0;
    for (let f = k * C; f < (k + 1) * C; f++) s += feat.onset[f];
    return s;
  });
  const levelF = smooth(feat.level.map((v) => Math.max(-100, v)), Math.round(0.5 * fps));
  const lv = Float64Array.from({ length: nC }, (_, k) => levelF[k * C + (C >> 1)]);
  const med = median(lv);
  const cps = fps / C;
  // Steady region: ignore a soft intro and a ritardando or ring-out at the end.
  let u0 = 0;
  while (u0 < nC && lv[u0] < med - 9) u0++;
  let u1 = nC - 1;
  while (u1 > u0 && lv[u1] < med - 9) u1--;
  u1 -= Math.round(1.0 * cps);

  const W = Math.round(3 * cps);
  const W2 = Math.round(1.5 * cps);
  // Local match of the surroundings of a and b: harmony, rhythm, and level (the crossfade swaps the
  // audio before b for the audio before a, so a quiet intro before a would put a dip in every seam).
  const sim = (a, b, chArr, onArr, lvArr, w, w2) => {
    let cs = 0;
    let ld = 0;
    for (let i = -w; i < w2; i++) {
      const p = chArr[a + i];
      const q = chArr[b + i];
      let d = 0;
      for (let j = 0; j < 12; j++) d += p[j] * q[j];
      cs += d;
      ld += Math.abs(lvArr[a + i] - lvArr[b + i]);
    }
    cs /= w + w2;
    ld /= w + w2;
    const oa = onArr.subarray(a - w, a + w2);
    const ob = onArr.subarray(b - w, b + w2);
    return 0.55 * cs + 0.45 * pearson(oa, ob) - 0.03 * ld;
  };
  const aMin = Math.max(u0 + Math.round(0.5 * cps), W, Math.round((XFADE + 0.2) * cps));
  const aMax = Math.min(aMin + Math.round(14 * cps), nC - W2 - 1);
  const bMax = Math.min(u1, nC - W2 - 1);
  const bMin = Math.max(aMax + 1, bMax - Math.round(16 * cps));
  // Repetition profile: how well the whole steady part matches itself shifted by each loop length.
  // A tune that repeats (bars, phrases, the AABB form) peaks at its period, so a loop that long keeps
  // the phrase and the downbeat in place across the seam, not only the beat.
  const lMin = Math.max(1, bMin - aMax);
  const lMax = bMax - aMin;
  const lagRaw = new Float64Array(nC).fill(-1);
  for (let L = Math.round(3 * cps); L <= lMax; L++) {
    const a0 = u0;
    const a1 = Math.min(u1, nC - 1) - L;
    if (a1 - a0 < Math.round(6 * cps)) continue;
    let cs = 0;
    for (let t = a0; t < a1; t++) {
      const p = ch[t];
      const q = ch[t + L];
      let d = 0;
      for (let j = 0; j < 12; j++) d += p[j] * q[j];
      cs += d;
    }
    cs /= a1 - a0;
    lagRaw[L] = 0.6 * cs + 0.4 * pearson(on.subarray(a0, a1), on.subarray(a0 + L, a1 + L));
  }
  // Two or three periods of the tune are as good a loop as one (a long loop repeats less often), and a
  // long lag leaves too little overlap to measure directly, so it also takes its half's or third's score.
  const lagScore = new Float64Array(nC).fill(-1);
  for (let L = lMin; L <= lMax; L++) {
    let s = lagRaw[L];
    for (const k of [2, 3]) {
      const l = Math.round(L / k);
      if (lagRaw[l] > -0.5) s = Math.max(s, lagRaw[l] - 0.01 * (k - 1));
    }
    lagScore[L] = s;
  }
  let best = { s: -Infinity, a: aMin, b: bMax };
  for (let a = aMin; a <= aMax; a++) {
    for (let b = bMin; b <= bMax; b++) {
      if ((b - a) / cps < total * 0.55 || lagScore[b - a] < -0.5) continue;
      const s = 0.5 * sim(a, b, ch, on, lv, W, W2) + 0.5 * lagScore[b - a] + 0.002 * ((b - a) / cps);
      if (s > best.s) best = { s, a, b };
    }
  }
  // For the log: the strongest repetition lengths (local peaks of the profile).
  const peaks = [];
  for (let L = Math.round(3 * cps) + 1; L < lMax; L++) {
    if (lagRaw[L] > lagRaw[L - 1] && lagRaw[L] >= lagRaw[L + 1] && lagRaw[L] > -0.5) peaks.push({ sec: L / cps, s: lagRaw[L] });
  }
  peaks.sort((p, q) => q.s - p.s);
  if (!Number.isFinite(best.s)) throw new Error('no loop candidates (track too short?)');
  // Refine on the full-resolution frames around the coarse pick.
  const Wf = W * C;
  const W2f = W2 * C;
  let fine = { s: -Infinity, a: best.a * C, b: best.b * C };
  for (let a = best.a * C - 6; a <= best.a * C + 6; a++) {
    for (let b = best.b * C - 6; b <= best.b * C + 6; b++) {
      if (a - Wf < 0 || b + W2f >= nF || a + W2f >= nF) continue;
      const s = 0.5 * sim(a, b, feat.chroma, feat.onset, levelF, Wf, W2f) + 0.5 * lagScore[Math.round((b - a) / C)];
      if (s > fine.s) fine = { s, a, b };
    }
  }
  // Frame index to sample (the frame's centre), then align B to A by waveform correlation (+-6 ms).
  const m = mono(x);
  const Xn = S(XFADE);
  let A = fine.a * HOP + N_FFT / 2;
  let B = fine.b * HOP + N_FFT / 2;
  A = Math.max(A, Xn + 1);
  let bestLag = 0;
  let bestR = -Infinity;
  const span = S(0.25);
  for (let lag = -S(0.006); lag <= S(0.006); lag++) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < span; i++) {
      const p = m[A - span + i];
      const q = m[B + lag - span + i];
      ab += p * q;
      aa += p * p;
      bb += q * q;
    }
    const r = ab / Math.sqrt(aa * bb || 1);
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
    }
  }
  B += bestLag;
  if (B + S(PAD) > lengthOf(x)) B = lengthOf(x) - S(PAD) - 1;
  // Crossfade law that keeps the level steady for the measured correlation r of the two segments.
  const r = Math.max(0, Math.min(1, pearson(m.subarray(B - Xn, B), m.subarray(A - Xn, A))));
  const y = slice(x, 0, B);
  for (let i = 0; i < Xn; i++) {
    const t = (i + 0.5) / Xn;
    const ga = Math.cos((t * Math.PI) / 2);
    const gb = Math.sin((t * Math.PI) / 2);
    const norm = Math.sqrt(ga * ga + gb * gb + 2 * ga * gb * r);
    const o = B - Xn + i;
    const p = A - Xn + i;
    y.L[o] = (x.L[o] * ga + x.L[p] * gb) / norm;
    y.R[o] = (x.R[o] * ga + x.R[p] * gb) / norm;
  }
  const out = concat(y, slice(x, A, A + S(PAD)));
  return {
    pcm: out,
    loopStart: A / SR,
    loopEnd: B / SR,
    score: fine.s,
    lag: lagScore[Math.round((fine.b - fine.a) / C)],
    peaks: peaks.slice(0, 4),
    xfadeR: r,
    alignR: bestR,
    steady: [u0 / cps, u1 / cps],
  };
}

/** Song loop (the title): the piece plays through, its last chord rings out, a breath, and it starts again. */
function makeSongLoop(x, feat) {
  const fps = SR / HOP;
  const lv = smooth(feat.level, Math.round(0.25 * fps));
  const med = median(lv);
  const n = lengthOf(x);
  // Abrupt endings (still loud in the last second) get a longer fade.
  const tail = lv.slice(Math.max(0, lv.length - Math.round(fps)));
  const abrupt = Math.max(...tail) > med - 6;
  const fo = S(abrupt ? 2.5 : 0.4);
  const y = slice(x, 0, n);
  fade(y, n - fo, fo, false);
  const gap = { L: new Float32Array(S(SONG_GAP)), R: new Float32Array(S(SONG_GAP)) };
  const out = concat(y, gap, slice(x, 0, S(PAD)));
  return { pcm: out, loopStart: 0, loopEnd: (n + S(SONG_GAP)) / SR, abrupt };
}

/** One-shot: fade out over the last second if the take stops while still loud. */
function makeOneShot(x, feat) {
  const fps = SR / HOP;
  const lv = smooth(feat.level, Math.round(0.25 * fps));
  const med = median(lv);
  const tail = lv.slice(Math.max(0, lv.length - Math.round(0.5 * fps)));
  const abrupt = Math.max(...tail) > med - 8;
  const y = slice(x, 0, lengthOf(x));
  const fo = Math.min(S(abrupt ? 1.0 : 0.15), lengthOf(y) >> 2);
  fade(y, lengthOf(y) - fo, fo, false);
  return { pcm: y, abrupt };
}

/** Stereo-linked peak limiter: a smoothed gain curve that holds every sample under the ceiling. */
function limit(x, ceilingDb) {
  const c = dbToLin(ceilingDb - 0.3);
  const B = 88;
  const n = lengthOf(x);
  const nb = Math.ceil(n / B);
  const bmin = new Float32Array(nb).fill(1);
  let any = false;
  for (let k = 0; k < nb; k++) {
    for (let i = k * B; i < Math.min(n, (k + 1) * B); i++) {
      const a = Math.max(Math.abs(x.L[i]), Math.abs(x.R[i]));
      if (a > c) {
        bmin[k] = Math.min(bmin[k], c / a);
        any = true;
      }
    }
  }
  if (!any) return 0;
  const at = (arr, k) => arr[Math.max(0, Math.min(nb - 1, k))];
  const held = Float32Array.from({ length: nb }, (_, k) => Math.min(...[-3, -2, -1, 0, 1, 2, 3].map((j) => at(bmin, k + j))));
  const sm = Float32Array.from({ length: nb }, (_, k) => (at(held, k - 1) + at(held, k) + at(held, k + 1)) / 3);
  let deepest = 1;
  for (let i = 0; i < n; i++) {
    const f = (i - B / 2) / B;
    const k = Math.floor(f);
    const t = f - k;
    const g = at(sm, k) * (1 - t) + at(sm, k + 1) * t;
    x.L[i] *= g;
    x.R[i] *= g;
    if (g < deepest) deepest = g;
  }
  for (let i = 0; i < n; i++) {
    if (Math.abs(x.L[i]) > c) x.L[i] = Math.sign(x.L[i]) * c;
    if (Math.abs(x.R[i]) > c) x.R[i] = Math.sign(x.R[i]) * c;
  }
  return -linToDb(deepest);
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

let KEY = null;
let generatedMs = 0;
let calls = 0;
const headerNotes = new Map();

function noteHeaders(h) {
  for (const [k, v] of h) {
    if (/cost|credit|character|song|request-id/i.test(k)) {
      if (!headerNotes.has(k)) headerNotes.set(k, []);
      headerNotes.get(k).push(v);
    }
  }
}

async function generate(track) {
  let format = 'mp3_44100_192';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (generatedMs + track.ms > BUDGET_S * 1000) throw new Error(`budget: ${track.ms / 1000} s more would pass ${BUDGET_S} s (used ${generatedMs / 1000} s)`);
    calls++;
    const body = { prompt: track.prompt, music_length_ms: track.ms, model_id: MODEL, force_instrumental: true };
    let res;
    const t0 = Date.now();
    try {
      res = await fetch(`${API}?output_format=${format}`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });
    } catch (e) {
      // The server may have generated (and charged) before the connection dropped: count it.
      generatedMs += track.ms;
      if (attempt === 0) {
        console.warn(`  network error (${e.message}), retrying in 10 s`);
        await sleep(10000);
        continue;
      }
      throw e;
    }
    noteHeaders(res.headers);
    if (res.ok) {
      generatedMs += track.ms;
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = { format, seconds: (Date.now() - t0) / 1000, headers: Object.fromEntries([...res.headers].filter(([k]) => /song|cost|character|request-id/i.test(k))) };
      return { buf, meta };
    }
    const msg = (await res.text()).slice(0, 400);
    if (res.status >= 400 && res.status < 500 && res.status !== 429 && format !== 'mp3_44100_128' && /format|tier|subscription|plan/i.test(msg)) {
      console.warn(`  HTTP ${res.status} with ${format} (${msg.slice(0, 120)}), falling back to mp3_44100_128`);
      format = 'mp3_44100_128';
      continue;
    }
    if (res.status >= 500) generatedMs += track.ms;
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      console.warn(`  HTTP ${res.status}, retrying in 15 s`);
      await sleep(15000);
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  throw new Error('retries failed');
}

async function subscription() {
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': KEY } });
    if (!r.ok) return null;
    const j = await r.json();
    return { used: j.character_count, limit: j.character_limit, tier: j.tier };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------------------------

const rawPath = (t) => join(RAW_DIR, `${t.name}.raw.mp3`);
const rawMetaPath = (t) => join(RAW_DIR, `${t.name}.raw.json`);

async function getRaw(t) {
  const p = rawPath(t);
  if (existsSync(p) && (!FORCE || REPROCESS)) return readFileSync(p);
  if (REPROCESS) return null;
  console.log(`${t.name}: generating ${t.ms / 1000} s with ${MODEL} ...`);
  const { buf, meta } = await generate(t);
  writeFileSync(p, buf);
  writeFileSync(rawMetaPath(t), JSON.stringify({ ...meta, prompt: t.prompt, ms: t.ms, model: MODEL, at: new Date().toISOString() }, null, 2));
  console.log(`${t.name}: received ${(buf.length / 1024).toFixed(0)} KB in ${fmt(meta.seconds)} s`);
  return buf;
}

async function processTrack(t) {
  const raw = await getRaw(t);
  if (!raw) {
    console.log(`${t.name}: no cached raw, skipped`);
    return null;
  }
  const x0 = await decode(raw, true);
  const rawSec = lengthOf(x0) / SR;
  const { y: x, cutHead, cutTail } = trim(x0);
  const feat = features(mono(x));
  const key = estimateKey(feat.rawChroma);
  const bpm = estimateTempo(feat.onset);
  let res;
  let trend = 0;
  if (t.kind === 'loop') {
    trend = flattenTrend(x, feat);
    res = makeLoop(x, feat);
  }
  else if (t.kind === 'song') res = makeSongLoop(x, feat);
  else res = makeOneShot(x, feat);
  const pcm = res.pcm;
  // Loudness: measured on the part that repeats (the whole take for one-shots).
  const body = t.kind === 'loop' ? slice(pcm, S(res.loopStart), S(res.loopEnd)) : pcm;
  const meas = await loudness(body);
  let g = t.lufs - meas.i;
  const over = meas.tp + g - PEAK_CEILING;
  if (over > MAX_LIMIT) g -= over - MAX_LIMIT;
  const k = dbToLin(g);
  for (let i = 0; i < lengthOf(pcm); i++) {
    pcm.L[i] *= k;
    pcm.R[i] *= k;
  }
  const lim = limit(pcm, PEAK_CEILING);
  const after = await loudness(t.kind === 'loop' ? slice(pcm, S(res.loopStart), S(res.loopEnd)) : pcm);
  const file = `${t.name}.mp3`;
  await encode(pcm, join(OUT, file));
  const entry = {
    file,
    kind: t.kind,
    loop: t.kind !== 'oneshot',
    seconds: +(lengthOf(pcm) / SR).toFixed(4),
    lead: +contentStart(pcm.L).toFixed(5),
    lufs: +after.i.toFixed(1),
    key: key.best.name,
    root: key.best.root,
    mode: key.best.mode,
  };
  // Tempo means little for a few seconds of cadence.
  if (t.kind !== 'oneshot') entry.bpm = bpm;
  if (t.kind !== 'oneshot') {
    entry.loopStart = +res.loopStart.toFixed(5);
    entry.loopEnd = +res.loopEnd.toFixed(5);
  }
  const notes = [
    `raw ${fmt(rawSec, 2)} s (trimmed ${fmt(cutHead, 2)} s head, ${fmt(cutTail, 2)} s tail)`,
    `key ${key.best.name} (r ${fmt(key.best.r, 2)}; next ${key.second.name} ${fmt(key.second.r, 2)}; D major ${fmt(key.dMaj, 2)}, B minor ${fmt(key.bMin, 2)})`,
    t.kind === 'oneshot' ? 'tempo not measured (one-shot)' : `tempo ~${bpm} BPM`,
    `${fmt(meas.i)} LUFS -> ${fmt(after.i)} LUFS (gain ${g >= 0 ? '+' : ''}${fmt(g)} dB, limiter ${fmt(lim)} dB, LRA ${fmt(meas.lra)})`,
  ];
  if (t.kind === 'loop') {
    const beat = 60 / bpm;
    notes.push(trend ? `level trend ${trend > 0 ? '+' : ''}${fmt(trend)} dB over the take, flattened (at most ${MAX_TREND} dB each way)` : 'no level trend to flatten');
    notes.push(`loop ${fmt(res.loopStart, 3)} -> ${fmt(res.loopEnd, 3)} s (${fmt(res.loopEnd - res.loopStart, 2)} s = ${fmt((res.loopEnd - res.loopStart) / beat, 1)} beats), match ${fmt(res.score, 3)}, repetition ${fmt(res.lag, 3)}, xfade r ${fmt(res.xfadeR, 2)}, align r ${fmt(res.alignR, 2)}, steady ${fmt(res.steady[0], 1)}-${fmt(res.steady[1], 1)} s`);
    notes.push(`best repetition lengths: ${res.peaks.map((p) => `${fmt(p.sec, 2)} s (${fmt(p.sec / beat, 1)} beats) ${fmt(p.s, 3)}`).join(', ')}`);
  }
  if (t.kind === 'song') notes.push(`song loop 0 -> ${fmt(res.loopEnd, 2)} s, ${res.abrupt ? 'abrupt ending, faded' : 'natural ending'}`);
  if (t.kind === 'oneshot') notes.push(res.abrupt ? 'abrupt ending, faded' : 'natural ending');
  console.log(`${t.name}:\n  ${notes.join('\n  ')}`);
  return entry;
}

/** Decode an output and check it: length, level and, for loops, that the wrap lines up. */
async function check(name, entry) {
  const p = join(OUT, entry.file);
  const x = await decode(p);
  const vol = await volumeDetect(p);
  const sec = lengthOf(x) / SR;
  const flags = [];
  if (!(vol.mean > -45)) flags.push('quiet');
  if (vol.max > -0.5) flags.push('hot peaks');
  let seam = '';
  if (entry.loop) {
    // Same clamp as the game: decoder smearing can put the detected start a few ms before `lead`.
    const off = contentStart(x.L) - entry.lead;
    const s = Math.max(0, S(off + entry.loopStart));
    const e = s + S(entry.loopEnd - entry.loopStart);
    const P = S(Math.min(PAD, 0.4));
    if (e + P > lengthOf(x)) flags.push('loop end past the file');
    else {
      const corr = pearson(x.L.subarray(e, e + P), x.L.subarray(s, s + P));
      // The seam's crossfade blends the audio before loopEnd into the audio before loopStart, so those
      // two should sit at about the same level (a song loop rings out into silence on purpose).
      const before = rmsDb(x.L, Math.max(0, e - S(2)), e);
      const lead = s >= S(2) ? rmsDb(x.L, s - S(2), s) : NaN;
      // Biggest sample step across the seam against the typical largest step nearby.
      const jump = Math.abs(x.L[e - 1] - x.L[s]);
      let typical = 0;
      for (let i = e - S(0.05); i < e - 1; i++) typical = Math.max(typical, Math.abs(x.L[i + 1] - x.L[i]));
      seam = `wrap corr ${fmt(corr, 3)}, 2 s before end ${fmt(before)} dB / before start ${fmt(lead)} dB, seam step ${fmt(jump, 4)} (nearby max ${fmt(typical, 4)}), decoder offset ${fmt(off * 1000, 1)} ms`;
      if (!(corr > 0.9)) flags.push(`wrap corr ${fmt(corr, 2)}`);
      if (entry.kind === 'loop' && Math.abs(before - lead) > 4) flags.push('level jump at seam');
    }
  }
  return { name, sec, vol, size: statSync(p).size, flags, seam };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function readMeta() {
  try {
    return JSON.parse(readFileSync(META, 'utf8'));
  } catch {
    return { version: 1, tracks: {} };
  }
}

async function main() {
  if (STATUS) {
    KEY = loadKey();
    if (!KEY) die('ELEVENLABS_API_KEY not found in the environment or .env.local');
    const s = await subscription();
    console.log(s ? `tier ${s.tier}, used ${s.used} of ${s.limit} credits (${s.limit - s.used} left)` : 'subscription status unavailable');
    return;
  }
  for (const n of ONLY) if (!TRACKS.some((t) => t.name === n)) die(`unknown track "${n}"`);
  const selected = TRACKS.filter((t) => !ONLY.size || ONLY.has(t.name));
  mkdirSync(OUT, { recursive: true });
  mkdirSync(RAW_DIR, { recursive: true });
  const meta = readMeta();
  meta.tracks ??= {};

  let before = null;
  if (!CHECK_ONLY) {
    const todo = selected.filter((t) => FORCE || REPROCESS || !existsSync(join(OUT, `${t.name}.mp3`)));
    const needsApi = !REPROCESS && todo.some((t) => FORCE || !existsSync(rawPath(t)));
    if (needsApi) {
      KEY = loadKey();
      if (!KEY) die('ELEVENLABS_API_KEY not found in the environment or .env.local');
      before = await subscription();
      if (before) console.log(`credits before: ${before.used} of ${before.limit}`);
    }
    console.log(`${todo.length} track(s) to make${needsApi ? `, budget ${BUDGET_S} s of generated audio` : ', no API calls'}; raw cache ${RAW_DIR}`);
    // One at a time: the generations are long and the budget is checked before each call.
    for (const t of todo) {
      try {
        const entry = await processTrack(t);
        if (entry) meta.tracks[t.name] = entry;
      } catch (e) {
        console.error(`${t.name}: FAILED: ${e.message}`);
      }
    }
  }

  // Keep only tracks whose files exist, in the list's order.
  const tracks = {};
  for (const t of TRACKS) if (meta.tracks[t.name] && existsSync(join(OUT, meta.tracks[t.name].file))) tracks[t.name] = meta.tracks[t.name];
  const out = { version: 1, model: MODEL, generated: meta.generated ?? new Date().toISOString().slice(0, 10), tracks };
  if (!CHECK_ONLY && calls) out.generated = new Date().toISOString().slice(0, 10);
  writeFileSync(META, JSON.stringify(out, null, 2) + '\n');

  console.log('');
  console.log('track      dur(s)  mean   peak    KB   notes');
  for (const [name, entry] of Object.entries(tracks)) {
    const r = await check(name, entry);
    console.log(`${name.padEnd(10)} ${r.sec.toFixed(2).padStart(6)} ${fmt(r.vol.mean).padStart(6)} ${fmt(r.vol.max).padStart(6)} ${(r.size / 1024).toFixed(0).padStart(5)}   ${[entry.loop ? `loop ${entry.loopStart.toFixed(2)}-${entry.loopEnd.toFixed(2)} s` : 'one-shot', `${entry.lufs} LUFS`, entry.key, entry.bpm ? `~${entry.bpm} BPM` : '', r.seam, ...r.flags].filter(Boolean).join('; ')}`);
  }
  const total = readdirSync(OUT).reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
  console.log(`total public/audio/music: ${(total / 1024).toFixed(0)} KB; API calls this run: ${calls}; generated this run: ${generatedMs / 1000} s`);
  for (const [k, v] of headerNotes) {
    const nums = v.map(Number).filter(Number.isFinite);
    console.log(`header ${k}: ${nums.length === v.length ? `sum ${nums.reduce((s, x) => s + x, 0)} over ${v.length} responses` : v.slice(0, 4).join(', ')}`);
  }
  if (before) {
    const after = await subscription();
    if (after) console.log(`credits used this run: ${after.used - before.used} (account ${after.used} / ${after.limit}, tier ${after.tier})`);
  }
}

main().catch((e) => die(e.stack ?? String(e)));
