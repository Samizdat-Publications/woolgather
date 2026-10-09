// Critic capture: plays a build of the game on a virtual clock and records what a player would see,
// for critics that only ever get footage (never the code or the design notes).
//
//   node tests/critic/capture.mjs --dist <dir> --label <name> [--scenario classic]
//        [--width 1280 --height 720] [--fps 20] [--minutes 9] [--seed 11] [--diff standard]
//        [--quality high] [--every 2.5] [--crf 24]
//
// --dist     a production build (index.html + assets/, served from the site root). Default: dist/.
// --label    output folder name: test-results/critic/<label>/ (wiped first).
// --scenario a scenario from tests/critic/scenarios.mjs (default classic).
// --fps      virtual frames per game second, which is also the video's frame rate. The game clamps
//            its frame time to 0.05 s, so 20 is the lowest rate at which game time stays real time.
// --minutes  cap on the virtual clock (game time), whatever the scenario does.
// --every    a small periodic frame (640 px wide) is saved every this many game seconds, for the
//            contact sheets (tests/critic/sheets.mjs).
//
// The build is served by a tiny static server on a free port (no Vite, nothing is built). Chrome runs
// headless on the real GPU as in tests/film.mjs, and the page's clock is virtual: an init script
// replaces requestAnimationFrame and performance.now, and every frame() advances it by 1/fps s,
// renders, and captures a JPEG over CDP into ffmpeg (x264). "Game time" in every file name, label
// and mark below is that virtual clock, so it is also the video's timestamp.
//
// Output (test-results/critic/<label>/):
//   video.mp4            the whole capture at --fps
//   stills/<name>.jpg    full-resolution named stills taken by the scenario
//   frames/f<NNNNN>_<mm>m<ss>s.jpg  periodic small frames; frames/index.json lists them
//   marks.json           game events and scenario marks, each with video time and the day clock
//   meta.json            label, scenario, outcome, sheep counts, duration, console errors
//   console.txt          every console message and page error, in order

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { HerdBot } from '../bot.mjs';
import { scenarios } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};

const opts = {
  dist: path.resolve(root, opt('dist', 'dist')),
  label: opt('label', null),
  scenario: opt('scenario', 'classic'),
  width: Number(opt('width', 1280)),
  height: Number(opt('height', 720)),
  fps: Number(opt('fps', 20)),
  minutes: Number(opt('minutes', 9)),
  seed: Number(opt('seed', 11)),
  diff: opt('diff', 'standard'),
  quality: opt('quality', 'high'),
  every: Number(opt('every', 2.5)),
  crf: Number(opt('crf', 24)),
};
if (!opts.label) {
  console.error('usage: node tests/critic/capture.mjs --dist <dir> --label <name> [--scenario classic]');
  process.exit(2);
}
const scenario = scenarios[opts.scenario];
if (typeof scenario !== 'function') {
  console.error(`unknown scenario "${opts.scenario}"; available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(2);
}
if (!fs.existsSync(path.join(opts.dist, 'index.html'))) {
  console.error(`no index.html in ${opts.dist}: build the game first (or pass --dist)`);
  process.exit(2);
}
if (opts.fps < 20) console.warn('warning: below 20 fps the game clamps its frame time, so game time runs slower than the video');

const FPS = opts.fps;
const outDir = path.resolve(root, 'test-results', 'critic', opts.label);
fs.rmSync(outDir, { recursive: true, force: true });
for (const d of ['stills', 'frames']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[capture ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// ---------------------------------------------------------------- static server
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serve(dir) {
  const base = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(base, '.' + rel);
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------- browser and page
const server = await serve(opts.dist);
const baseUrl = `http://127.0.0.1:${server.address().port}/`;
log(`serving ${opts.dist} at ${baseUrl}`);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });

const consoleErrors = [];
const consoleLines = [];
let frameN = 0;
const videoTime = () => +(frameN / FPS).toFixed(3);
page.on('console', (m) => {
  consoleLines.push(`[${videoTime()}s] ${m.type()}: ${m.text()}`);
  if (m.type() === 'error') consoleErrors.push({ t: videoTime(), kind: 'console', text: m.text() });
});
page.on('pageerror', (e) => {
  consoleLines.push(`[${videoTime()}s] pageerror: ${String(e)}`);
  consoleErrors.push({ t: videoTime(), kind: 'pageerror', text: String(e) });
});
page.on('requestfailed', (r) => {
  consoleLines.push(`[${videoTime()}s] requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`);
  consoleErrors.push({ t: videoTime(), kind: 'requestfailed', text: `${r.url()} ${r.failure()?.errorText ?? ''}` });
});
page.on('response', (r) => {
  if (r.status() >= 400) consoleErrors.push({ t: videoTime(), kind: 'http', text: `${r.status()} ${r.url()}` });
});

// Virtual clock (as in tests/film.mjs): until __film.begin() the page runs normally; after it,
// requestAnimationFrame callbacks only run when the script calls __film.step(), and
// performance.now() only moves then.
await page.addInitScript((fps) => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let manual = false;
  let now = 0;
  let queue = [];
  let nextId = 1;
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRaf(cb);
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  const realCancel = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (id) => {
    queue = queue.filter((q) => q.id !== id);
    realCancel(id);
  };
  performance.now = () => (manual ? now : realNow());
  window.__film = {
    begin() {
      now = realNow();
      manual = true;
    },
    step() {
      now += 1000 / fps;
      const run = queue;
      queue = [];
      for (const q of run) q.cb(now);
    },
  };
}, FPS);

const query = new URLSearchParams({ test: '1', seed: String(opts.seed), diff: opts.diff, quality: opts.quality });
await page.goto(`${baseUrl}?${query}`);
await page.waitForFunction(() => !!window.__WG, null, { timeout: 180000 });
// The loading card fades out on real time; let it go before the clock turns virtual.
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 10000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
log(`title reached at ${opts.width}x${opts.height}, ${FPS} fps, scenario ${opts.scenario}`);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await page.evaluate(() => window.__film.begin());

// ---------------------------------------------------------------- encoder and capture
const videoPath = path.join(outDir, 'video.mp4');
const enc = spawn(
  ffmpeg,
  [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf), '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-movflags', '+faststart', videoPath,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
let encDead = false;
enc.on('close', () => (encDead = true));
enc.stdin.on('error', (e) => {
  encDead = true;
  log('encoder pipe error:', e.message);
});

const marks = [];
const framesIndex = [];
const stills = [];
let lastJpeg = null;
let lastState = null;
let nextPeriodic = 0;
const realStart = Date.now();
const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
const mmss = (s) => `${pad(s / 60)}:${pad(s % 60)}`;

async function state() {
  lastState = await page.evaluate(() => window.__WG.state());
  return lastState;
}

/** Advance one virtual frame, capture it into the video and keep the events it raised. */
async function frame() {
  const evs = await page.evaluate(() => {
    window.__film.step();
    return window.__WG.drain();
  });
  const vt = videoTime();
  for (const e of evs) marks.push({ label: e.type, video_t: vt, game_t: e.t ?? null, frame: frameN, info: e });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
  lastJpeg = Buffer.from(data, 'base64');
  if (encDead) throw new Error('the ffmpeg encoder stopped');
  if (!enc.stdin.write(lastJpeg)) await new Promise((r) => enc.stdin.once('drain', r));

  // A small periodic frame for the contact sheets.
  if (vt >= nextPeriodic - 1e-6) {
    const scale = 640 / opts.width;
    const small = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88,
      clip: { x: 0, y: 0, width: opts.width, height: opts.height, scale },
    });
    const i = framesIndex.length;
    const file = `f${pad(i, 5)}_${pad(vt / 60)}m${pad(vt % 60)}s.jpg`;
    fs.writeFileSync(path.join(outDir, 'frames', file), Buffer.from(small.data, 'base64'));
    framesIndex.push({ file, video_t: vt, label: mmss(vt), day_t: lastState ? +lastState.elapsed.toFixed(2) : 0, mode: lastState?.mode ?? 'title' });
    nextPeriodic += opts.every;
  }

  frameN++;
  // CSS animations (HUD pulses, fades) run on real time: slow them to the capture rate.
  if (frameN % FPS === 0) {
    const rate = frameN / FPS / Math.max(0.001, (Date.now() - realStart) / 1000);
    await cdp.send('Animation.setPlaybackRate', { playbackRate: Math.min(1, rate) });
    if (frameN % (FPS * 30) === 0) log(`captured ${frameN} frames (${(frameN / FPS).toFixed(0)} s of game), ${(rate * FPS).toFixed(1)} frames per real second`);
  }
}

async function frames(seconds) {
  const n = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < n; i++) await frame();
}

function mark(label, info) {
  const f = Math.max(0, frameN - 1);
  marks.push({ label, video_t: +(f / FPS).toFixed(3), game_t: lastState ? +lastState.elapsed.toFixed(2) : null, frame: f, info: info ?? null });
}

/** Save the frame on screen as stills/<name>.jpg (full resolution). */
async function still(name) {
  let file = `${name}.jpg`;
  for (let k = 2; fs.existsSync(path.join(outDir, 'stills', file)); k++) file = `${name}-${k}.jpg`;
  let buf = lastJpeg;
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    buf = Buffer.from(data, 'base64');
  } catch (e) {
    log(`still ${name}: fresh capture failed (${e.message}), using the last video frame`);
  }
  if (!buf) return null;
  fs.writeFileSync(path.join(outDir, 'stills', file), buf);
  const vt = +(Math.max(0, frameN - 1) / FPS).toFixed(3);
  stills.push({ name: file.replace(/\.jpg$/, ''), file: `stills/${file}`, video_t: vt, game_t: lastState ? +lastState.elapsed.toFixed(2) : null });
  mark(`still:${name}`);
  log(`still ${file} at ${mmss(vt)}`);
  return file;
}

const ctx = {
  page,
  cdp,
  opts,
  fps: FPS,
  log,
  bot: new HerdBot(page),
  frame,
  frames,
  still,
  mark,
  state,
  /** Game time so far (the virtual clock, = video time), in seconds. */
  time: () => frameN / FPS,
  /** True once the virtual clock passes --minutes: scenarios should stop. */
  overTime: () => frameN / FPS >= opts.minutes * 60,
  dist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
};

// ---------------------------------------------------------------- run
let failure = null;
try {
  await state();
  await scenario(ctx);
} catch (e) {
  failure = e;
  log('scenario failed:', e?.stack ?? e);
} finally {
  await ctx.bot.release().catch(() => {});
  enc.stdin.end();
  await new Promise((r) => (encDead ? r() : enc.on('close', r)));
  const st = await state().catch(() => lastState);
  const meta = {
    label: opts.label,
    scenario: opts.scenario,
    dist: opts.dist,
    url: `/?${query}`,
    width: opts.width,
    height: opts.height,
    fps: FPS,
    frames: frameN,
    duration_s: +(frameN / FPS).toFixed(2),
    real_s: Math.round((Date.now() - t0) / 1000),
    mode: st?.mode ?? null,
    outcome: st?.outcome ?? (st ? 'unfinished' : null),
    folded: st?.folded ?? null,
    lost: st?.lost ?? null,
    total: st?.total ?? null,
    target: st?.target ?? null,
    day_elapsed_s: st ? +st.elapsed.toFixed(2) : null,
    stills,
    periodic_frames: framesIndex.length,
    console_errors: consoleErrors,
    scenario_error: failure ? String(failure?.stack ?? failure) : null,
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(outDir, 'marks.json'), JSON.stringify(marks, null, 1));
  fs.writeFileSync(path.join(outDir, 'frames', 'index.json'), JSON.stringify(framesIndex, null, 1));
  fs.writeFileSync(path.join(outDir, 'console.txt'), consoleLines.join('\n') + '\n');
  log(
    `done: ${frameN} frames (${meta.duration_s} s), outcome ${JSON.stringify(meta.outcome)}, ` +
      `${meta.folded}/${meta.total} home, ${meta.lost} lost, ${stills.length} stills, ${framesIndex.length} periodic frames, ` +
      `${consoleErrors.length} console errors`,
  );
  for (const e of consoleErrors.slice(0, 10)) log(`  console ${e.kind} at ${e.t}s: ${e.text}`);
  log(`output: ${outDir}`);
  await browser.close().catch(() => {});
  server.close();
}
process.exit(failure ? 1 : 0);
