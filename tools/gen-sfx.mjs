// Recorded sound library: generates the creature sounds and ambience loops in public/audio/ with
// the ElevenLabs Sound Effects API, post-processes each one (mono, silence trimmed, loudness
// normalised, short fades on one-shots, seamless crossfaded loops) and writes
// public/audio/manifest.json plus docs/audio/SFX.md.
//
//   node tools/gen-sfx.mjs                      generate every sound whose .mp3 is missing
//   node tools/gen-sfx.mjs --force              regenerate everything (or the --only selection)
//   node tools/gen-sfx.mjs --only bark,rain     limit to groups, loops or single files (bark_2)
//   node tools/gen-sfx.mjs --raw-dir <dir>      keep the raw API downloads there and reuse them
//   node tools/gen-sfx.mjs --reprocess --raw-dir <dir>   rebuild outputs from cached raw files only
//   node tools/gen-sfx.mjs --check              no generation: re-check outputs, rewrite manifest and doc
//   node tools/gen-sfx.mjs --max-calls 45       hard cap on API requests in one run (retries count)
//
// The API key comes from ELEVENLABS_API_KEY (environment, else .env.local at the repo root). It is
// never printed or written anywhere.

import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'audio');
const MANIFEST = join(OUT, 'manifest.json');
const DOC = join(ROOT, 'docs', 'audio', 'SFX.md');
const API = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL = 'eleven_text_to_sound_v2';
const SR = 44100;
const CREDIT = 'Generated with the ElevenLabs Sound Effects API for this project';

// Loudness targets (integrated LUFS) and the true-peak ceiling.
const ONESHOT_LUFS = -16;
const LOOP_LUFS = -24;
const PEAK_CEILING = -1;
/** Most peak reduction (dB) the limiter may apply to reach the loudness target. */
const MAX_LIMIT = 6;
const ONESHOT_KBPS = 96;
const LOOP_KBPS = 80;
/** Loops: seconds of the tail crossfaded into the head. */
const LOOP_XFADE = 1.0;
/** Loops: seconds of wrapped audio stored on each side of the loop so MP3 priming never lands in it. */
const LOOP_PAD = 0.3;

// ---------------------------------------------------------------------------------------------
// The sound list
// ---------------------------------------------------------------------------------------------

const DRY = 'close microphone, outdoors, isolated, no music, no human voices, no background noise';

/** One-shot groups. `check` is the accepted length range (s) after trimming; `single` keeps only the loudest burst. */
const GROUPS = [
  {
    group: 'bleat_ewe',
    check: [0.35, 2.0],
    alt: 'Sheep bleat, one single baa from an adult ewe, clean close recording, isolated, no other sounds',
    variants: [
      { dur: 1.0, prompt: `A single adult ewe bleating once, a short mid-pitched "baa", field recording on a Scottish hillside, one call only, no other animals, ${DRY}` },
      { dur: 1.5, prompt: `One long wavering bleat from an adult sheep, "baaaa" with a tremble in it, one call only, no other sheep, ${DRY}` },
      { dur: 0.9, prompt: `One low, throaty bleat from a mature ewe, a short grumbling "meh", one call only, ${DRY}` },
      { dur: 1.2, prompt: `A single nervous sheep bleat, slightly higher pitched and urgent, one call only, field recording, ${DRY}` },
    ],
  },
  {
    group: 'bleat_lamb',
    check: [0.3, 1.8],
    alt: 'Lamb bleat, one high thin baa from a young lamb, clean close recording, isolated, no other sounds',
    variants: [
      { dur: 0.9, prompt: `A young lamb bleating once, a high thin "maa", one call only, no other animals, ${DRY}` },
      { dur: 1.0, prompt: `A tiny newborn lamb calling for its mother, one short high-pitched quavering bleat, ${DRY}` },
      { dur: 1.2, prompt: `A single plaintive bleat from a small lamb, high and thin with a little crack in it, ${DRY}` },
    ],
  },
  {
    group: 'bleat_ram',
    check: [0.4, 2.0],
    alt: 'Ram sheep bleat, one deep low gruff baa, clean close recording, isolated, no other sounds',
    variants: [
      { dur: 1.4, prompt: `A big horned ram giving one deep, gruff, guttural "baa", low-pitched and rough, one call only, ${DRY}` },
      { dur: 1.2, prompt: `One short deep grumbling bleat from a large ram sheep, low and hoarse, one call only, ${DRY}` },
    ],
  },
  {
    group: 'bark',
    check: [0.12, 0.9],
    single: true,
    alt: 'Dog bark, one single short bark from a border collie, bright and alert, clean close recording, isolated',
    variants: [
      { dur: 0.8, prompt: `One single sharp bark from a medium-size border collie dog, energetic and alert, not aggressive, one bark only, ${DRY}` },
      { dur: 0.8, prompt: `A border collie barks once, a bright quick "woof" to move sheep, eager and keen, one bark only, ${DRY}` },
      { dur: 0.8, prompt: `A single short excited bark from a working sheepdog, mid-pitched and crisp, not growling, one bark only, ${DRY}` },
    ],
  },
  {
    group: 'howl',
    check: [1.5, 4.6],
    alt: 'Wolf howl, one lone wolf, distant, long rising and falling howl with a soft echo, no other sounds',
    variants: [
      { dur: 4.0, prompt: 'A single lone wolf howl rising and falling, heard from a distance across open hills at dusk, natural valley echo, one howl only, no other animals, no music, no human voices, no wind' },
      { dur: 4.0, prompt: 'One long mournful wolf howl far away across a highland glen at nightfall, soft distant echo, a single wolf, no other animals, no music, no human voices, no wind' },
    ],
  },
  {
    group: 'growl',
    check: [0.4, 2.0],
    alt: 'Wolf growl, low rumbling snarl, close recording, isolated, no barking, no other sounds',
    variants: [
      { dur: 1.2, prompt: `A wolf's menacing growl with teeth bared, a rough throaty snarl with a rattle in the mid-range, not just a low rumble, no barking, ${DRY}` },
      { dur: 1.5, prompt: `A wolf baring its teeth with a deep throaty growl that rises into a brief snarl, no barking, ${DRY}` },
    ],
  },
  {
    group: 'yelp',
    check: [0.25, 2.0],
    alt: 'Wolf yelp, a few short high yelps of a canine running away, outdoors, no other sounds',
    variants: [
      { dur: 1.5, prompt: 'A wolf yelping in surprise as it turns and runs away, two or three short high yelps fading off, outdoors, no music, no human voices, no background noise' },
    ],
  },
  {
    group: 'thunder',
    check: [2.5, 7.0],
    alt: 'Thunder, a loud thunderclap and long rumble outdoors, no rain, no other sounds',
    variants: [
      { dur: 6.0, prompt: 'A close lightning strike: one sharp, loud crack of thunder followed by a long deep rolling rumble echoing across mountains, outdoors, no rain, no music, no voices' },
      { dur: 5.0, prompt: 'A distant thunder rumble rolling low and soft across far-off hills, no sharp crack, no rain, no music, no voices' },
    ],
  },
  {
    group: 'gate',
    check: [0.6, 2.6],
    alt: 'Wooden gate closing, creaking hinge then a metal latch clack, close recording, no other sounds',
    variants: [
      { dur: 2.0, prompt: 'A heavy old wooden farm gate swinging shut on creaky iron hinges and closing with a solid iron latch clack, close microphone, outdoors, no music, no voices, no background noise' },
    ],
  },
  {
    group: 'splash',
    check: [0.2, 2.0],
    alt: 'Water splash, a quick splash in a shallow stream, close recording, no other sounds',
    variants: [
      { dur: 1.5, prompt: 'A dog bounding into a shallow rocky stream, a quick lively splash of paws in water, close microphone, outdoors, no barking, no music, no voices' },
      { dur: 1.0, prompt: 'A small single splash in a shallow stream, like a paw or a stone dropping into clear water, close microphone, outdoors, no music, no voices, no background noise' },
    ],
  },
  {
    group: 'stamp',
    check: [0.08, 1.0],
    single: true,
    alt: 'Hoof stamp, one dull thud of a hoof on grass and earth, close recording, isolated',
    variants: [
      { dur: 0.7, prompt: 'A ram stamping one front hoof hard on soft turf, a single dull thud, close microphone, outdoors, isolated, no animal calls, no music, no voices' },
    ],
  },
  {
    group: 'butt',
    check: [0.2, 1.6],
    alt: 'Dull heavy body impact thud with a short animal grunt, close recording, isolated',
    variants: [
      { dur: 1.2, prompt: 'A ram head-butting: one solid hollow knock of horns against a body, a dull thud with a woody crack on top, then a short animal grunt, close microphone, outdoors, no music, no human voices' },
    ],
  },
  {
    group: 'whoosh_birds',
    check: [1.2, 3.6],
    alt: 'A flock of birds flying past overhead, wings whooshing, outdoors, no other sounds',
    variants: [
      { dur: 3.0, prompt: 'A flock of starlings swooping low overhead and past, the soft rushing whoosh of hundreds of wings, a few chirps, outdoors, no music, no voices, no wind noise' },
    ],
  },
  {
    group: 'flutter',
    check: [0.4, 2.2],
    alt: 'Small birds taking off, quick wing flutter, close recording, isolated',
    variants: [
      { dur: 1.5, prompt: 'A small flock of sparrows bursting up out of long grass, a quick crisp flurry of fluttering wings, close microphone, outdoors, isolated, no birdsong, no music, no voices, no background noise' },
    ],
  },
];

/** Seamless ambience loops. */
const LOOPS = [
  { name: 'wind', dur: 11, prompt: 'A soft breeze rustling through long moorland grass and heather, a gentle airy hiss and whisper of grass blades, steady and calm, no low rumble, no microphone wind noise, no gusts, no birds, no music, no voices, seamless ambience', alt: 'Soft steady breeze in tall grass, airy rustling hiss, calm moorland ambience, no rumble, no other sounds' },
  { name: 'rain', dur: 11, prompt: 'Steady moderate rain falling on grass and a few leaves in the countryside, soft and even, not heavy, no thunder, no wind, no music, no voices, seamless ambience', alt: 'Light steady rain on grass and leaves, even and calm, no thunder, no other sounds' },
  { name: 'stream', dur: 11, prompt: 'A small highland burn babbling and trickling over stones, gentle clear running water, close-up, steady, no birds, no music, no voices, seamless ambience', alt: 'Small brook babbling over stones, gentle running water, steady, no other sounds' },
  { name: 'night', dur: 11, prompt: 'A quiet summer night in a meadow: faint distant crickets chirping softly, very calm, no birds, no wind, no music, no voices, seamless ambience', alt: 'Crickets chirping softly at night in a field, calm and quiet, no other sounds' },
  { name: 'dawn', dur: 11, prompt: 'A gentle dawn chorus in the countryside: songbirds singing softly in the distance, blackbirds and robins, calm and airy, no music, no voices, seamless ambience', alt: 'Songbirds singing at dawn in the countryside, gentle and distant, no other sounds' },
  { name: 'loch', dur: 11, prompt: 'Gentle small waves lapping softly on a stony lake shore, calm water, slow rhythm, no wind, no birds, no music, no voices, seamless ambience', alt: 'Calm lake water lapping on pebbles at the shore, slow and gentle, no other sounds' },
];

function buildItems() {
  const items = [];
  for (const g of GROUPS) {
    g.variants.forEach((v, i) => {
      items.push({
        kind: 'one', group: g.group, file: `${g.group}_${i + 1}.mp3`, prompt: v.prompt, alt: g.alt,
        dur: v.dur, influence: 0.55, check: g.check, single: !!g.single,
      });
    });
  }
  for (const l of LOOPS) {
    items.push({ kind: 'loop', group: l.name, file: `${l.name}.mp3`, prompt: l.prompt, alt: l.alt, dur: l.dur, influence: 0.4 });
  }
  return items;
}

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
const RAW_DIR = optValue('--raw-dir') ? resolve(optValue('--raw-dir')) : null;
const MAX_CALLS = Number(optValue('--max-calls') ?? 45);
const ONLY = new Set();
argv.forEach((a, i) => {
  if (a === '--only' && argv[i + 1]) for (const s of argv[i + 1].split(',')) if (s.trim()) ONLY.add(s.trim().replace(/\.mp3$/, ''));
});
if (REPROCESS && !RAW_DIR) die('--reprocess needs --raw-dir <dir> (the cached raw downloads)');

function die(msg) {
  console.error(`gen-sfx: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (v) => Math.round((SR * v) / 1000);
const dbToLin = (db) => Math.pow(10, db / 20);
const linToDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

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
    p.stdin.on('error', () => {}); // ffmpeg may close stdin early; the exit code tells the story
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

const RAW_IN = ['-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0'];

/**
 * Decode any audio (Buffer) or file (string path) to mono 44.1 kHz float PCM. Raw takes get a 35 Hz
 * high-pass (DC and infrasonic rumble only: it spends headroom nobody hears).
 */
async function decode(src, highpass = false) {
  const input = typeof src === 'string' ? ['-i', src] : ['-i', 'pipe:0'];
  const filter = highpass ? ['-af', 'highpass=f=35'] : [];
  const { stdout } = await ff(
    ['-hide_banner', '-loglevel', 'error', ...input, ...filter, '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'],
    typeof src === 'string' ? undefined : src,
  );
  const n = Math.floor(stdout.length / 4);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = stdout.readFloatLE(i * 4);
  return pcm;
}

function pcmBuffer(pcm) {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

/** EBU R128 integrated loudness and true peak (loudnorm's measurement pass). */
async function loudness(pcm) {
  // Integrated loudness needs at least one 400 ms block: measure short clips padded with silence.
  let m = pcm;
  if (pcm.length < ms(500)) {
    m = new Float32Array(ms(500));
    m.set(pcm);
  }
  const { stderr } = await ff(['-hide_banner', '-nostats', ...RAW_IN, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], pcmBuffer(m));
  const j = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  const o = JSON.parse(j);
  return { i: parseFloat(o.input_i), tp: parseFloat(o.input_tp) };
}

async function encode(pcm, file, kbps) {
  await ff(
    ['-hide_banner', '-loglevel', 'error', '-y', ...RAW_IN, '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-ar', String(SR), '-ac', '1',
      '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', file],
    pcmBuffer(pcm),
  );
}

async function volumeDetect(file, filter = '') {
  const { stderr } = await ff(['-hide_banner', '-nostats', '-i', file, '-af', `${filter}volumedetect`, '-f', 'null', '-']);
  const mean = parseFloat((stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)/) ?? [])[1]);
  const max = parseFloat((stderr.match(/max_volume:\s*(-?[\d.]+|-inf)/) ?? [])[1]);
  return { mean, max };
}

/** RMS per window of `win` samples. */
function envelope(x, win) {
  const n = Math.ceil(x.length / win);
  const e = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = k * win;
    const b = Math.min(x.length, a + win);
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    e[k] = Math.sqrt(s / Math.max(1, b - a));
  }
  return e;
}

function maxOf(a) {
  let m = 0;
  for (const v of a) if (v > m) m = v;
  return m;
}

function rmsDb(x) {
  let s = 0;
  for (const v of x) s += v * v;
  return linToDb(Math.sqrt(s / Math.max(1, x.length)));
}

/** Separate sound events: 10 ms windows within 24 dB of the loudest, merged across gaps under 120 ms. */
function bursts(x) {
  const win = ms(10);
  const env = envelope(x, win);
  const peak = maxOf(env);
  if (peak <= 0) return [];
  const thr = peak * dbToLin(-24);
  const segs = [];
  let cur = null;
  for (let i = 0; i < env.length; i++) {
    if (env[i] <= thr) continue;
    if (cur && i - cur.b < 12) {
      cur.b = i + 1;
      cur.max = Math.max(cur.max, env[i]);
    } else {
      cur = { a: i, b: i + 1, max: env[i] };
      segs.push(cur);
    }
  }
  return segs.map((s) => ({ a: s.a * win, b: Math.min(x.length, s.b * win), max: s.max }));
}

// ---------------------------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------------------------

/** One-shot: optionally keep only the loudest burst, trim silence, 5 ms fade in, 30 ms fade out. */
function processOneShot(raw, item) {
  let x = raw;
  const segs = bursts(x);
  let cut = false;
  if (item.single && segs.length > 1) {
    let k = 0;
    segs.forEach((s, i) => {
      if (s.max > segs[k].max) k = i;
    });
    const s = segs[k];
    const next = segs[k + 1];
    const a = Math.max(0, s.a - ms(20));
    const b = Math.min(x.length, next ? next.a - ms(20) : s.b + ms(400));
    x = x.slice(a, b);
    cut = true;
  }
  const win = ms(5);
  const env = envelope(x, win);
  const peak = maxOf(env);
  const first = env.findIndex((v) => v > peak * dbToLin(-40));
  const last = env.findLastIndex((v) => v > peak * dbToLin(-50));
  const a = Math.max(0, Math.max(0, first) * win - ms(5));
  const b = Math.min(x.length, (Math.max(first, last) + 1) * win + ms(40));
  const y = x.slice(a, b);
  const fi = Math.min(ms(5), y.length >> 2);
  const fo = Math.min(ms(30), y.length >> 2);
  for (let i = 0; i < fi; i++) y[i] *= i / fi;
  for (let i = 0; i < fo; i++) y[y.length - 1 - i] *= i / fo;
  return { pcm: y, bursts: segs.length, cut };
}

/**
 * Loop: drop any fade at either end, then crossfade the last LOOP_XFADE seconds into the first
 * (equal power), so the result repeats with no seam. Returns the loop body (no padding).
 */
function processLoop(raw) {
  const win = ms(50);
  const env = envelope(raw, win);
  const sorted = Array.from(env).sort((p, q) => p - q);
  const thr = sorted[sorted.length >> 1] * dbToLin(-14);
  const maxTrim = Math.round(1.0 / 0.05);
  let a = 0;
  while (a < env.length && a < maxTrim && env[a] < thr) a++;
  let b = env.length;
  while (b > a && env.length - b < maxTrim && env[b - 1] < thr) b--;
  const y = raw.subarray(a * win, Math.min(raw.length, b * win));
  const L = y.length;
  const C = Math.min(Math.round(SR * LOOP_XFADE), Math.floor(L * 0.15));
  const N = L - C;
  const out = new Float32Array(N);
  out.set(y.subarray(C, L - C), 0);
  for (let i = 0; i < C; i++) {
    const t = ((i + 0.5) / C) * (Math.PI / 2);
    out[L - 2 * C + i] = y[L - C + i] * Math.cos(t) + y[i] * Math.sin(t);
  }
  return { pcm: out, trimmed: (a * win + (raw.length - Math.min(raw.length, b * win))) / SR };
}

/** The stored loop file: the body with LOOP_PAD seconds of wrapped audio on each side. */
function padLoop(body) {
  const P = Math.min(Math.round(SR * LOOP_PAD), body.length >> 2);
  const N = body.length;
  const out = new Float32Array(N + 2 * P);
  out.set(body.subarray(N - P), 0);
  out.set(body, P);
  out.set(body.subarray(0, P), P + N);
  return { pcm: out, pad: P / SR };
}

/**
 * Gain (dB) to reach `target` LUFS. Peaks that would then pass the ceiling are left to `limit`,
 * but never more than MAX_LIMIT dB of it: past that the gain itself is lowered.
 */
function gainFor(meas, pcm, target) {
  const peak = linToDb(maxOf(pcm.map(Math.abs)));
  const tp = Number.isFinite(meas.tp) ? Math.max(meas.tp, peak) : peak;
  let g = Number.isFinite(meas.i) && meas.i > -70 ? target - meas.i : -3 - peak;
  const over = tp + g - PEAK_CEILING;
  if (over > MAX_LIMIT) g -= over - MAX_LIMIT;
  return g;
}

/**
 * Peak limiter: a per-sample gain curve that holds every sample under the ceiling, min-filtered over
 * +-6 ms and smoothed, so it ducks around a peak instead of clipping it. With `circular` the curve
 * wraps round the ends, so a loop's gain is the same either side of its seam.
 */
function limit(x, ceilingDb, circular) {
  const c = dbToLin(ceilingDb - 0.5);
  const B = 88; // 2 ms blocks
  const nb = Math.ceil(x.length / B);
  const bmin = new Float32Array(nb);
  let any = false;
  for (let k = 0; k < nb; k++) {
    let m = 1;
    for (let i = k * B; i < Math.min(x.length, (k + 1) * B); i++) {
      const a = Math.abs(x[i]);
      if (a > c) m = Math.min(m, c / a);
    }
    bmin[k] = m;
    if (m < 1) any = true;
  }
  if (!any) return 0;
  const at = (k) => (circular ? bmin[((k % nb) + nb) % nb] : bmin[Math.max(0, Math.min(nb - 1, k))]);
  const held = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    let m = 1;
    for (let j = -3; j <= 3; j++) m = Math.min(m, at(k + j));
    held[k] = m;
  }
  const hat = (k) => (circular ? held[((k % nb) + nb) % nb] : held[Math.max(0, Math.min(nb - 1, k))]);
  const smooth = new Float32Array(nb);
  for (let k = 0; k < nb; k++) smooth[k] = (hat(k - 1) + hat(k) + hat(k + 1)) / 3;
  const sat = (k) => (circular ? smooth[((k % nb) + nb) % nb] : smooth[Math.max(0, Math.min(nb - 1, k))]);
  let deepest = 1;
  for (let i = 0; i < x.length; i++) {
    // Interpolate between block centres.
    const f = (i - B / 2) / B;
    const k = Math.floor(f);
    const t = f - k;
    const g = sat(k) * (1 - t) + sat(k + 1) * t;
    x[i] *= g;
    if (g < deepest) deepest = g;
  }
  // Belt and braces: anything still over (the smoothing can lift a lone peak) is scaled down.
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > c) x[i] = Math.sign(x[i]) * c;
  return -linToDb(deepest);
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

let KEY = null;
let calls = 0;
const headerNotes = new Map();

function noteHeaders(h) {
  for (const [k, v] of h) {
    if (/cost|credit|character|request-id|concurren/i.test(k)) {
      if (!headerNotes.has(k)) headerNotes.set(k, []);
      headerNotes.get(k).push(v);
    }
  }
}

async function generate(text, seconds, influence, loop) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (calls >= MAX_CALLS) throw new Error(`API call budget of ${MAX_CALLS} reached`);
    calls++;
    const body = { text, duration_seconds: seconds, prompt_influence: influence, model_id: MODEL };
    if (loop) body.loop = true;
    let res;
    try {
      res = await fetch(`${API}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt === 0) {
        console.warn(`  network error (${e.message}), retrying in 5 s`);
        await sleep(5000);
        continue;
      }
      throw e;
    }
    noteHeaders(res.headers);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const msg = (await res.text()).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const ra = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? Math.min(30, ra) * 1000 : res.status === 429 ? 10000 : 5000;
      console.warn(`  HTTP ${res.status}, retrying in ${wait / 1000} s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  throw new Error('retry failed');
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

function rawPath(item, alt) {
  return RAW_DIR ? join(RAW_DIR, item.file.replace(/\.mp3$/, alt ? '.alt.raw.mp3' : '.raw.mp3')) : null;
}

async function getRaw(item, alt) {
  const p = rawPath(item, alt);
  const cached = p && existsSync(p);
  if (REPROCESS) {
    if (!cached) return null;
    return readFileSync(p);
  }
  if (cached && !FORCE) return readFileSync(p);
  const buf = await generate(alt ? item.alt : item.prompt, item.dur, item.influence, item.kind === 'loop');
  if (p) writeFileSync(p, buf);
  return buf;
}

async function attempt(item, alt) {
  const raw = await getRaw(item, alt);
  if (!raw) return null;
  const pcm = await decode(raw, true);
  const rawSec = pcm.length / SR;
  const reasons = [];
  if (item.kind === 'loop') {
    const r = processLoop(pcm);
    const level = rmsDb(r.pcm);
    const len = r.pcm.length / SR;
    if (len < item.dur * 0.6) reasons.push(`loop only ${fmt(len, 2)} s`);
    // Soft ambience can come back very quiet but intact (a gentle breeze measured -52 dB); only a
    // take far under that is treated as empty.
    if (!(level > -58)) reasons.push(`near silent (${fmt(level)} dB)`);
    return { ok: !reasons.length, reasons, pcm: r.pcm, rawSec, level, extra: `loop ${fmt(len, 2)} s, ends trimmed ${fmt(r.trimmed, 2)} s` };
  }
  const r = processOneShot(pcm, item);
  const len = r.pcm.length / SR;
  const level = rmsDb(r.pcm);
  if (len < item.check[0] || len > item.check[1]) reasons.push(`length ${fmt(len, 2)} s outside ${item.check[0]}-${item.check[1]} s`);
  if (!(level > -40)) reasons.push(`near silent (${fmt(level)} dB)`);
  return { ok: !reasons.length, reasons, pcm: r.pcm, rawSec, level, bursts: r.bursts, extra: `trimmed ${fmt(len, 2)} s, ${r.bursts} burst(s)${r.cut ? ', kept the loudest' : ''}` };
}

const results = new Map();

async function processItem(item) {
  const tag = item.file.replace(/\.mp3$/, '');
  let used = await attempt(item, false);
  if (!used) {
    console.log(`${tag}: no cached raw, skipped`);
    return;
  }
  let usedAlt = false;
  if (!used.ok) {
    console.log(`${tag}: first take failed (${used.reasons.join('; ')}), trying the reworded prompt`);
    try {
      const second = await attempt(item, true);
      if (second) {
        // Keep whichever take passes; if neither does, keep the one with fewer problems (the second on a tie).
        if (second.ok || second.reasons.length <= used.reasons.length) {
          used = second;
          usedAlt = true;
        }
      }
    } catch (e) {
      console.warn(`${tag}: retry failed: ${e.message}`);
    }
  } else if (FORCE && !REPROCESS) {
    const stale = rawPath(item, true);
    if (stale && existsSync(stale)) rmSync(stale);
  }

  const out = join(OUT, item.file);
  const loop = item.kind === 'loop';
  const meas = await loudness(used.pcm);
  const g = gainFor(meas, used.pcm, loop ? LOOP_LUFS : ONESHOT_LUFS);
  const k = dbToLin(g);
  for (let i = 0; i < used.pcm.length; i++) used.pcm[i] *= k;
  const lim = limit(used.pcm, PEAK_CEILING, loop);
  const after = await loudness(used.pcm);
  const note = `${fmt(meas.i)} LUFS, gain ${g >= 0 ? '+' : ''}${fmt(g)} dB, limiter ${fmt(lim)} dB, now ${fmt(after.i)} LUFS${usedAlt ? ' [alt prompt]' : ''}${used.ok ? '' : ' [DOUBTFUL]'}`;
  if (loop) {
    const padded = padLoop(used.pcm);
    await encode(padded.pcm, out, LOOP_KBPS);
    results.set(item.file, { alt: usedAlt, ok: used.ok, reasons: used.reasons, loop: { seconds: +(used.pcm.length / SR).toFixed(5), pad: +padded.pad.toFixed(5) } });
  } else {
    await encode(used.pcm, out, ONESHOT_KBPS);
    results.set(item.file, { alt: usedAlt, ok: used.ok, reasons: used.reasons });
  }
  console.log(`${tag}: raw ${fmt(used.rawSec, 2)} s, ${used.extra}, ${note}`);
}

async function pool(list, n, fn) {
  let next = 0;
  const failures = [];
  const worker = async () => {
    while (next < list.length) {
      const it = list[next++];
      try {
        await fn(it);
      } catch (e) {
        failures.push(it.file);
        console.error(`${it.file}: FAILED: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return failures;
}

// ---------------------------------------------------------------------------------------------
// Checks, manifest and doc
// ---------------------------------------------------------------------------------------------

function readOldManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return {};
  }
}

/** Correlation of the stored lead-in pad with the end of the loop body: near 1 means the wrap lines up. */
function wrapCorrelation(pcm, info) {
  const P = Math.round(info.pad * SR);
  const N = Math.round(info.seconds * SR);
  if (pcm.length < N + 2 * P - 4000) return NaN;
  // Find the start of the padded content the way samples.ts does (skip decoder priming, if any).
  let off = 0;
  const peak = maxOf(pcm.subarray(0, Math.min(pcm.length, ms(400))).map(Math.abs));
  while (off < ms(100) && Math.abs(pcm[off]) < Math.max(1e-5, peak * 0.003)) off++;
  const a = pcm.subarray(off, off + P);
  const b = pcm.subarray(off + N, off + N + P);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb || 1);
}

async function checkAll(items, old) {
  const rows = [];
  for (const it of items) {
    const p = join(OUT, it.file);
    if (!existsSync(p)) continue;
    const pcm = await decode(p);
    const vol = await volumeDetect(p);
    // Laptop speakers roll off under ~150-200 Hz: a file with little above 300 Hz may vanish on them.
    const upper = await volumeDetect(p, 'highpass=f=300,highpass=f=300,');
    vol.above300 = upper.mean - vol.mean;
    const sec = pcm.length / SR;
    const flags = [];
    if (!(vol.mean > -40)) flags.push('quiet');
    if (vol.above300 < -12 && !/thunder|stamp/.test(it.group)) flags.push(`bass-heavy (above 300 Hz ${fmt(vol.above300)} dB)`);
    const r = results.get(it.file);
    if (r && !r.ok) flags.push(...r.reasons);
    let loopInfo = null;
    if (it.kind === 'loop') {
      loopInfo = r?.loop ?? old.loopInfo?.[it.group] ?? null;
      if (loopInfo) {
        const c = wrapCorrelation(pcm, loopInfo);
        if (!(c > 0.8)) flags.push(`wrap correlation ${fmt(c, 2)}`);
        rows.push({ it, sec, vol, size: statSync(p).size, flags, loopInfo, corr: c });
        continue;
      }
      flags.push('no loop info');
    } else if (sec < it.check[0] - 0.02 || sec > it.check[1] + 0.06) flags.push('length');
    rows.push({ it, sec, vol, size: statSync(p).size, flags, loopInfo });
  }
  return rows;
}

function writeManifest(items, rows, old) {
  const present = new Set(rows.map((r) => r.it.file));
  const sounds = {};
  for (const it of items) {
    if (it.kind !== 'one' || !present.has(it.file)) continue;
    (sounds[it.group] ??= []).push(it.file);
  }
  const loops = [];
  const loopInfo = {};
  for (const r of rows) {
    if (r.it.kind !== 'loop' || !r.loopInfo) continue;
    loops.push(r.it.group);
    loopInfo[r.it.group] = { file: r.it.file, seconds: r.loopInfo.seconds, pad: r.loopInfo.pad };
  }
  const oldAlt = new Set(old.altPrompt ?? []);
  for (const [file, r] of results) {
    if (r.alt) oldAlt.add(file);
    else oldAlt.delete(file);
  }
  const altPrompt = [...oldAlt].filter((f) => present.has(f)).sort();
  const manifest = { version: 1, sounds, loops, loopInfo, altPrompt };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function writeDoc(rows, manifest) {
  const alt = new Set(manifest.altPrompt);
  const esc = (s) => s.replace(/\|/g, '\\|');
  const total = readdirSync(OUT).reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
  const lines = [];
  lines.push('# Recorded sound effects');
  lines.push('');
  lines.push('The creature sounds and ambience loops in `public/audio/` were generated with the ElevenLabs Sound');
  lines.push(`Effects API (model \`${MODEL}\`) for this project and post-processed by \`tools/gen-sfx.mjs\`.`);
  lines.push("The music score is recorded too (see `MUSIC.md`); the UI chimes, footsteps and the music's tension layer are still synthesised in `src/audio/`.");
  lines.push('');
  lines.push(`Credit: ${CREDIT}. Usage rights follow the ElevenLabs terms of the account that generated them.`);
  lines.push('');
  lines.push('## Processing');
  lines.push('');
  lines.push('- Raw API output is MP3 44.1 kHz; every take is decoded to mono 44.1 kHz with ffmpeg (`ffmpeg-static`) through');
  lines.push('  a 35 Hz high-pass (DC and infrasonic rumble only).');
  lines.push('- Loudness: normalised to a target in LUFS (EBU R128 integrated, measured with ffmpeg `loudnorm`). Peaks');
  lines.push(`  that would pass ${PEAK_CEILING} dBFS are held down by a soft limiter (at most ${MAX_LIMIT} dB of reduction; past that the`);
  lines.push('  gain is lowered instead, so a file can land under its target).');
  lines.push('- One-shots: leading and trailing silence trimmed (40 dB and 50 dB under the peak), 5 ms fade in and');
  lines.push(`  30 ms fade out, ${ONESHOT_LUFS} LUFS, MP3 ${ONESHOT_KBPS} kbps mono.`);
  lines.push('  `bark` and `stamp` keep only the loudest burst if the take holds more than one.');
  lines.push(`- Loops: requested with the API's \`loop\` option, any fade at either end dropped, then the last ${LOOP_XFADE} s`);
  lines.push('  crossfaded (equal power) into the head so the body repeats with no seam, normalised to');
  lines.push(`  ${LOOP_LUFS} LUFS (the limiter wraps round the seam), MP3 ${LOOP_KBPS} kbps mono, no fades.`);
  lines.push(`- MP3 adds encoder priming and padding at the ends, which would put a gap in a loop. So each loop file`);
  lines.push(`  stores ${LOOP_PAD} s of wrapped audio before and after the loop body, and \`manifest.json\` gives the body`);
  lines.push('  length (`loopInfo.<name>.seconds`) and the pad (`pad`). `SampleBank` finds the start of the content in');
  lines.push('  the decoded buffer and sets `loopStart`/`loopEnd` round the body, so the loop is gapless in every browser.');
  lines.push('- Every take is checked by the numbers (length within the expected range, not near silent); a failed take is');
  lines.push('  regenerated once with a reworded prompt (marked "alt" below; listed in `manifest.json` as `altPrompt`).');
  lines.push('');
  lines.push('  Checked in headless Chrome on 2026-10-09: `decodeAudioData` trims the priming, and at every loop seam');
  lines.push('  the sample jump is no bigger than an ordinary sample-to-sample step.');
  lines.push('');
  lines.push('## Using them in the game');
  lines.push('');
  lines.push('`src/audio/samples.ts` exports `SampleBank`, built on the AudioContext that `AudioEngine.unlock()` creates:');
  lines.push('');
  lines.push('```ts');
  lines.push('const bank = new SampleBank(engine.ctx!);');
  lines.push('await bank.load(); // never throws: failed files are skipped and listed in bank.missing');
  lines.push("bank.play('bleat_ewe', engine.sfx, { gain: 0.7, pan: -0.4 }); // random variant, never the same twice running");
  lines.push("const rain = bank.loop('rain', engine.amb, 0);                // fades in to the given gain");
  lines.push('rain?.setGain(0.5, 2); // glide (time constant in seconds); rain?.stop() fades out and stops');
  lines.push('```');
  lines.push('');
  lines.push('`play` adds a random +-4% detune unless `rate` is given, and takes `delay` in seconds. One-shots sit at');
  lines.push(`${ONESHOT_LUFS} LUFS and loops at ${LOOP_LUFS} LUFS, so set gains against the synthesised mix by ear.`);
  lines.push('');
  lines.push(`One-shot groups: ${[...new Set(rows.filter((x) => x.it.kind === 'one').map((x) => `\`${x.it.group}\``))].join(', ')}.`);
  lines.push(`Loops: ${rows.filter((x) => x.it.kind === 'loop').map((x) => `\`${x.it.group}\``).join(', ')}.`);
  lines.push('');
  lines.push('## Regenerating');
  lines.push('');
  lines.push('```');
  lines.push('node tools/gen-sfx.mjs                     # generate whatever is missing');
  lines.push('node tools/gen-sfx.mjs --force             # regenerate everything');
  lines.push('node tools/gen-sfx.mjs --force --only bark # one group, loop or file (bark_2); comma-separated list');
  lines.push('node tools/gen-sfx.mjs --check             # no API calls: re-check files, rewrite manifest and this doc');
  lines.push('```');
  lines.push('');
  lines.push('Needs `ELEVENLABS_API_KEY` in `.env.local` (git-ignored) or the environment. `--raw-dir <dir>` keeps the raw');
  lines.push('downloads outside the repo so `--reprocess --raw-dir <dir>` can redo the processing without new API calls.');
  lines.push('`--max-calls N` caps the requests in one run (default 45, retries included). The script rewrites this file.');
  lines.push('');
  lines.push('## One-shots');
  lines.push('');
  lines.push('| Group | File | Prompt | Requested | Duration | Mean / peak | Credit |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows.filter((x) => x.it.kind === 'one')) {
    const a = alt.has(r.it.file);
    lines.push(`| ${r.it.group} | ${r.it.file} | ${esc(a ? r.it.alt : r.it.prompt)}${a ? ' (alt)' : ''} | ${r.it.dur} s | ${r.sec.toFixed(2)} s | ${fmt(r.vol.mean)} / ${fmt(r.vol.max)} dB | ${CREDIT} |`);
  }
  lines.push('');
  lines.push('## Loops');
  lines.push('');
  lines.push('| Loop | File | Prompt | Requested | Loop length | Mean / peak | Credit |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows.filter((x) => x.it.kind === 'loop')) {
    const a = alt.has(r.it.file);
    const len = r.loopInfo ? `${r.loopInfo.seconds.toFixed(2)} s` : `${r.sec.toFixed(2)} s`;
    lines.push(`| ${r.it.group} | ${r.it.file} | ${esc(a ? r.it.alt : r.it.prompt)}${a ? ' (alt)' : ''} | ${r.it.dur} s | ${len} | ${fmt(r.vol.mean)} / ${fmt(r.vol.max)} dB | ${CREDIT} |`);
  }
  lines.push('');
  lines.push(`Total size of \`public/audio/\`: ${(total / 1024).toFixed(0)} KB.`);
  lines.push('');
  mkdirSync(dirname(DOC), { recursive: true });
  writeFileSync(DOC, lines.join('\n'));
  return total;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const items = buildItems();
  const known = new Set(items.flatMap((it) => [it.group, it.file.replace(/\.mp3$/, '')]));
  for (const n of ONLY) if (!known.has(n)) die(`unknown sound "${n}"`);
  const selected = items.filter((it) => !ONLY.size || ONLY.has(it.group) || ONLY.has(it.file.replace(/\.mp3$/, '')));
  mkdirSync(OUT, { recursive: true });
  if (RAW_DIR) mkdirSync(RAW_DIR, { recursive: true });
  const old = readOldManifest();

  let before = null;
  if (!CHECK_ONLY) {
    const todo = selected.filter((it) => FORCE || REPROCESS || !existsSync(join(OUT, it.file)));
    const needsApi = !REPROCESS && todo.some((it) => FORCE || !(RAW_DIR && existsSync(rawPath(it, false))));
    if (needsApi) {
      KEY = loadKey();
      if (!KEY) die('ELEVENLABS_API_KEY not found in the environment or .env.local');
      before = await subscription();
    }
    console.log(`${todo.length} sound(s) to make${needsApi ? `, API budget ${MAX_CALLS} calls` : ', no API calls'}`);
    const failures = await pool(todo, 2, processItem);
    if (failures.length) console.error(`failed: ${failures.join(', ')}`);
  }

  const rows = await checkAll(items, old);
  const manifest = writeManifest(items, rows, old);
  const total = writeDoc(rows, manifest);

  console.log('');
  console.log('file                      dur(s)  mean   peak   KB   notes');
  for (const r of rows) {
    const note = [r.it.kind === 'loop' && r.loopInfo ? `loop ${r.loopInfo.seconds.toFixed(2)} s, wrap corr ${fmt(r.corr, 3)}` : '', ...r.flags].filter(Boolean).join('; ');
    console.log(`${r.it.file.padEnd(25)} ${r.sec.toFixed(2).padStart(6)} ${fmt(r.vol.mean).padStart(6)} ${fmt(r.vol.max).padStart(6)} ${(r.size / 1024).toFixed(0).padStart(4)}   ${note}`);
  }
  const missing = items.filter((it) => !existsSync(join(OUT, it.file))).map((it) => it.file);
  if (missing.length) console.log(`missing: ${missing.join(', ')}`);
  console.log(`total public/audio: ${(total / 1024).toFixed(0)} KB, API calls this run: ${calls}`);
  for (const [k, v] of headerNotes) {
    const nums = v.map(Number).filter(Number.isFinite);
    console.log(`header ${k}: ${nums.length === v.length ? `sum ${nums.reduce((s, x) => s + x, 0)} over ${v.length} responses` : v.slice(0, 3).join(', ')}`);
  }
  if (before) {
    const after = await subscription();
    if (after) console.log(`credits used this run: ${after.used - before.used} (account ${after.used} / ${after.limit}, tier ${after.tier})`);
  }
}

main().catch((e) => die(e.stack ?? String(e)));
