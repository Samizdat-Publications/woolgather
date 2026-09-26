// Film mode: records the finished game as smooth 60 fps footage for the landing page and the README.
//
//   node tests/film.mjs --shoot hero|day|wolves|night [--width 1920 --height 1080] [--nobuild]
//
// hero   : the title shot of the valley at 96 moments from golden hour to night (no HUD), saved as
//          frames for the landing page's scroll-scrubbed opening
// day    : the herding bot plays a whole Standard evening to the end, HUD on
// wolves : a wolf stalks the flock Pip is working, charges, snatches a sheep, and Pip sprints in and
//          barks it free (scripted from the moment of the snatch)
// night  : the last seconds before nightfall with the flock still out, then the results card
//
// The page's clock is virtual: an init script replaces requestAnimationFrame and performance.now, and
// this script advances the game one 1/60 s frame at a time, capturing each frame over CDP into ffmpeg
// (x264, CRF 14). A 1080p capture runs well below real time, but the game never sees that, so the
// footage is a smooth 60 fps. Every notable game event is saved with its frame time in film.json
// (marks), and tests/make-media.mjs cuts the clips at those marks, so a new recording re-cuts itself.
//
// Runs against the production build (vite build, then vite preview); --nobuild reuses dist/.
// Output: test-results/film-<shoot>/ (gitignored).

import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { HerdBot } from './bot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const shoot = opt('shoot', 'day');
const width = Number(opt('width', 1920));
const height = Number(opt('height', 1080));
const outDir = path.resolve(root, `test-results/film-${shoot}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const FPS = 60;
const t0 = Date.now();
const log = (...a) => console.log(`[film ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

if (!flag('nobuild')) await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4800 + Math.floor(Math.random() * 90), strictPort: false }, logLevel: 'warn' });
const baseUrl = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// Virtual clock: until __film.begin() the page runs normally; after it, requestAnimationFrame
// callbacks only run when the script calls __film.step(), and performance.now() only moves then.
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

await page.goto(`${baseUrl}?test=1&seed=11&diff=standard&quality=high`);
await page.waitForFunction(() => !!window.__WG, null, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
log('title reached at', `${width}x${height}`);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await page.evaluate(() => window.__film.begin());
const state = () => page.evaluate(() => window.__WG.state());

// ---------------------------------------------------------------- hero: frames, not a film
if (shoot === 'hero') {
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const N = Number(opt('frames', 96));
  for (let i = 0; i < N; i++) {
    await page.evaluate((t) => window.__WG.titleMood(t), i / (N - 1));
    // two game frames per step: the camera drifts slowly across the valley as the light goes
    for (let k = 0; k < 2; k++) await page.evaluate(() => window.__film.step());
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    fs.writeFileSync(path.join(outDir, `e${String(i).padStart(2, '0')}.jpg`), Buffer.from(data, 'base64'));
  }
  fs.writeFileSync(path.join(outDir, 'film.json'), JSON.stringify({ shoot, frames: N, width, height }, null, 1));
  log(`hero: ${N} frames, errors ${errors.length}`, errors.slice(0, 3));
  await browser.close();
  await server.close();
  process.exit(errors.length ? 1 : 0);
}

// ---------------------------------------------------------------- films
const enc = spawn(
  ffmpeg,
  ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, 'film.mp4')],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const marks = [];
let frameN = 0;
const realStart = Date.now();
let lastJpeg = null;

/** One game frame: advance the virtual clock 1/60 s, render, capture, and record the events it raised. */
async function frame() {
  const evs = await page.evaluate(() => {
    window.__film.step();
    return window.__WG.drain();
  });
  for (const e of evs) marks.push({ label: e.type, info: e, frame: frameN, t: +(frameN / FPS).toFixed(3) });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
  lastJpeg = Buffer.from(data, 'base64');
  if (!enc.stdin.write(lastJpeg)) await new Promise((r) => enc.stdin.once('drain', r));
  frameN++;
  // CSS animations (HUD pulses, fades) run on real time: slow them to the capture rate.
  if (frameN % 60 === 0) {
    const rate = frameN / FPS / Math.max(0.001, (Date.now() - realStart) / 1000);
    await cdp.send('Animation.setPlaybackRate', { playbackRate: Math.min(1, rate) });
    if (frameN % 1800 === 0) log(`filmed ${frameN} frames (${(frameN / FPS).toFixed(0)} s), ${(rate * FPS).toFixed(1)} frames per real second`);
  }
}
const mark = (label, info) => marks.push({ label, info, frame: Math.max(0, frameN - 1), t: +(Math.max(0, frameN - 1) / FPS).toFixed(3) });
async function frames(seconds) {
  const n = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < n; i++) await frame();
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

try {
  if (shoot === 'day') {
    // The bot plays the whole evening; it decides every three frames (20 times a game second).
    await page.keyboard.press('Enter');
    await frames(1);
    mark('start');
    const level = await page.evaluate(() => window.__WG.level);
    const bridge = { x: level.bridge.center?.[0] ?? level.bridge.x ?? 0, z: level.bridge.center?.[1] ?? level.bridge.z ?? 0 };
    const bot = new HerdBot(page);
    let onBridge = false;
    let stalkSeen = false;
    const limit = Number(opt('minutes', 8)) * 60 * FPS;
    while (frameN < limit) {
      const st = await state();
      if (st.mode === 'ended') break;
      await bot.step(st, 3 / FPS);
      // Marks the events do not carry: the flock on the bridge, a wolf stalking in view.
      const near = st.sheep.filter((s) => s.state !== 'folded' && s.state !== 'lost' && dist(s, bridge) < 7).length;
      if (!onBridge && near >= 2 && dist(st.dog, bridge) < 16) {
        onBridge = true;
        mark('bridge');
      } else if (onBridge && near === 0) onBridge = false;
      if (!stalkSeen && st.wolves?.some((w) => w.state === 'stalk' && dist(w, st.dog) < 34)) {
        stalkSeen = true;
        mark('stalkNear');
      }
      for (let i = 0; i < 3; i++) await frame();
    }
    await bot.release();
    const st = await state();
    mark('outcome', st.outcome);
    // The gate swings shut, the card comes in and Pip trots to the fold.
    await frames(6.5);
  } else if (shoot === 'wolves') {
    // Start where the wolves are about to come out, Pip on the far side of a flock from the trees.
    await page.keyboard.press('Enter');
    await frames(1);
    await page.evaluate(() => window.__WG.jumpTo(0.325));
    const st0 = await state();
    const flocks = st0.sheep.filter((s) => s.state !== 'folded');
    const c = flocks.reduce((a, s) => ({ x: a.x + s.x / flocks.length, z: a.z + s.z / flocks.length }), { x: 0, z: 0 });
    // the group nearest the middle of the valley
    const g = flocks.slice().sort((a, b) => dist(a, c) - dist(b, c))[0];
    await page.evaluate(([x, z]) => window.__WG.teleportDog(x, z), [g.x + 14, g.z + 10]);
    mark('start');
    let phase = 'wait';
    let grabbed = null;
    const limit = Number(opt('minutes', 4)) * 60 * FPS;
    const keysDown = new Set();
    const setKeys = async (want) => {
      for (const k of [...keysDown]) if (!want.has(k)) { await page.keyboard.up(k); keysDown.delete(k); }
      for (const k of want) if (!keysDown.has(k)) { await page.keyboard.down(k); keysDown.add(k); }
    };
    while (frameN < limit) {
      const st = await state();
      if (phase === 'wait') {
        if (st.wolves?.some((w) => w.state === 'stalk')) {
          phase = 'stalk';
          mark('stalkSeen');
        }
      }
      const drag = st.wolves?.find((w) => w.state === 'drag');
      if ((phase === 'wait' || phase === 'stalk') && drag) {
        phase = 'chase';
        grabbed = drag;
        mark('snatch');
        // a beat for the alert to land before Pip reacts
        await frames(1.2);
        continue;
      }
      if (phase === 'chase') {
        const w = st.wolves?.find((o) => o.state === 'drag');
        if (!w) {
          await setKeys(new Set());
          phase = 'done';
          mark('freed');
          await frames(4);
          break;
        }
        // Sprint straight at the wolf and bark once in range.
        const dx = w.x - st.dog.x;
        const dz = w.z - st.dog.z;
        const want = new Set(['ShiftLeft']);
        if (dx > 1.5) want.add('KeyD');
        if (dx < -1.5) want.add('KeyA');
        if (dz > 1.5) want.add('KeyS');
        if (dz < -1.5) want.add('KeyW');
        await setKeys(want);
        if (Math.hypot(dx, dz) < 15) await page.keyboard.press('Space');
      }
      for (let i = 0; i < 3; i++) await frame();
    }
    await setKeys(new Set());
    if (!grabbed) log('warn: no snatch within the time limit');
  } else if (shoot === 'night') {
    // The last seconds of the day by the fold, the flock still out on the hills.
    await page.keyboard.press('Enter');
    await frames(1);
    await page.evaluate(() => window.__WG.jumpTo(0.93));
    const level = await page.evaluate(() => window.__WG.level);
    const f = level.fold;
    const fx = (f.center?.[0] ?? 60) - (f.halfW ?? 9) - 12;
    const fz = f.center?.[1] ?? 42;
    await page.evaluate(([x, z]) => window.__WG.teleportDog(x, z), [fx, fz]);
    mark('start');
    const limit = 60 * FPS;
    while (frameN < limit) {
      for (let i = 0; i < 6; i++) await frame();
      const st = await state();
      if (st.mode === 'ended') break;
    }
    mark('nightfall');
    await frames(5.5);
  }
  if (lastJpeg) fs.writeFileSync(path.join(outDir, 'last.jpg'), lastJpeg);
} finally {
  enc.stdin.end();
  await new Promise((r) => enc.on('close', r));
  const st = await state().catch(() => null);
  fs.writeFileSync(
    path.join(outDir, 'film.json'),
    JSON.stringify({ shoot, fps: FPS, frames: frameN, width, height, mode: st?.mode, outcome: st?.outcome, folded: st?.folded, lost: st?.lost, total: st?.total, elapsed: st?.elapsed, marks }, null, 1),
  );
  log(`film.mp4: ${frameN} frames (${(frameN / FPS).toFixed(1)} s), ${marks.length} marks, mode ${st?.mode}, errors ${errors.length}`, errors.slice(0, 3));
  await browser.close();
  await server.close();
}
