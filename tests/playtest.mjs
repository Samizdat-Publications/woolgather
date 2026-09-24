// Woolgather self-test: plays the game in a headless browser through scripted keyboard input,
// captures screenshots from the player's camera at key moments, and records console output.
//
//   node tests/playtest.mjs [--out dir] [--scale 2] [--seed 7] [--diff standard] [--headed]
//                           [--url http://localhost:5317/] [--skip-win] [--skip-lose]
//
// Needs the dev server running (npm run dev). Uses the system Chrome/Edge via playwright-core,
// so no browser download is required.

import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HerdBot } from './bot.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(opt('out', join('test-results', `run-${stamp}`)));
const SCALE = Number(opt('scale', '2'));
const SEED = opt('seed', '7');
const DIFF = opt('diff', 'standard');
const BASE = opt('url', 'http://localhost:5317/');
const W = Number(opt('width', '1280'));
const H = Number(opt('height', '720'));
mkdirSync(OUT, { recursive: true });

const report = { started: new Date().toISOString(), seed: SEED, diff: DIFF, scale: SCALE, console: [], pageErrors: [], shots: [], runs: [] };
const log = (...a) => console.log(`[playtest ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function launch() {
  const common = { headless: !flag('headed') };
  const gpuArgs = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'];
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ ...common, channel, args: gpuArgs });
    } catch (e) {
      log(`launch ${channel} failed: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('No Chrome or Edge available');
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('console', (m) => {
  const entry = { type: m.type(), text: m.text() };
  report.console.push(entry);
  if (m.type() === 'error' || m.type() === 'warning') log(`console.${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => {
  report.pageErrors.push(String(e));
  log(`PAGE ERROR: ${e}`);
});

const state = () => page.evaluate(() => window.__WG.state());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotN = 0;
async function shot(name, note = '') {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  const st = await state().catch(() => null);
  report.shots.push({ file, note, t: st?.t, mode: st?.mode, folded: st?.folded, fps: st?.fps });
  log(`shot ${file} ${note}`);
}

await page.goto(`${BASE}?test=1&seed=${SEED}&diff=${DIFF}`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__WG, null, { timeout: 30000 });
await sleep(2500);
const gl = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const g = c && (c.getContext('webgl2') || c.getContext('webgl'));
  const ext = g && g.getExtension('WEBGL_debug_renderer_info');
  return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
report.renderer = gl;
log(`renderer: ${gl}`);
await shot('title', 'title screen');

report.assertions = [];
const check = (name, ok, detail = '') => {
  report.assertions.push({ name, ok, detail });
  if (!ok) log(`ASSERTION FAILED: ${name} ${detail}`);
};

// Menu smoke test: How to play from the title, then back.
if (!flag('skip-menus')) {
  const howto = page.locator('[data-act="howto"]').first();
  if (await howto.isVisible()) {
    await howto.click();
    await sleep(400);
    await shot('howto', 'how to play screen');
    check('howto visible', await page.locator('.howto-screen').isVisible());
    await page.locator('[data-act="close-howto"]').click();
    await sleep(300);
    check('title back after howto', await page.locator('.title-screen').isVisible());
  } else {
    check('howto button visible on title', false);
  }
}

if (flag('smoke')) {
  // Quick check: title renders, Enter starts a day, a few seconds of play without errors.
  await page.keyboard.press('Enter');
  await sleep(3000);
  const st = await state();
  check('smoke: playing', st.mode === 'playing', st.mode);
  await shot('smoke', 'a few seconds into a day');
  report.errorCount = report.pageErrors.length + report.console.filter((c) => c.type === 'error').length;
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log(`smoke done: ${report.errorCount} errors, fps ${st.fps}, mode ${st.mode}`);
  await browser.close();
  process.exit(report.errorCount === 0 && st.mode === 'playing' ? 0 : 1);
}

async function playToEnd(runName, { botOn, scale, shotsAt }) {
  const run = { name: runName, events: [], outcome: null };
  report.runs.push(run);
  await page.keyboard.press('Enter');
  await sleep(1200);
  await page.evaluate((k) => window.__WG.setTimeScale(k), scale);
  const bot = new HerdBot(page);
  const fired = new Set();
  let prev = await state();
  check(`${runName}: playing after Enter`, prev.mode === 'playing', prev.mode);
  let pauseTested = !botOn || flag('skip-menus');
  let lastT = Date.now();
  let lastWhy = '';
  const t0 = Date.now();
  while (true) {
    const st = await state();
    if (st.mode === 'ended') {
      run.outcome = st.outcome;
      run.final = { folded: st.folded, lost: st.lost, total: st.total, target: st.target, elapsed: st.elapsed };
      break;
    }
    if (Date.now() - t0 > 20 * 60 * 1000) {
      run.outcome = 'timeout';
      break;
    }
    if (!pauseTested && st.elapsed > 30) {
      pauseTested = true;
      await bot.release();
      await page.keyboard.press('Escape');
      await sleep(400);
      const p1 = await state();
      check('pause with Escape', p1.mode === 'paused', p1.mode);
      await shot('pause', 'pause menu');
      await sleep(600);
      const p2 = await state();
      check('sim frozen while paused', Math.abs(p2.elapsed - p1.elapsed) < 0.01, `${p1.elapsed} -> ${p2.elapsed}`);
      await page.keyboard.press('Escape');
      await sleep(300);
      const p3 = await state();
      check('resume with Escape', p3.mode === 'playing', p3.mode);
      lastT = Date.now();
      continue;
    }
    const now = Date.now();
    const dt = ((now - lastT) / 1000) * scale;
    lastT = now;
    if (botOn) {
      const d = await bot.step(st, dt);
      if (d.why !== lastWhy) {
        run.events.push({ t: +st.elapsed.toFixed(1), why: d.why, folded: st.folded });
        lastWhy = d.why;
      }
    }
    for (const [key, test, note] of shotsAt) {
      if (!fired.has(key) && test(st, prev)) {
        fired.add(key);
        await shot(key, note);
      }
    }
    if (st.folded !== prev.folded || st.lost !== prev.lost) log(`${runName}: t=${st.elapsed.toFixed(0)}s home ${st.folded}/${st.total} lost ${st.lost} fps ${st.fps}`);
    prev = st;
    await sleep(60);
  }
  await bot.release();
  log(`${runName} outcome: ${JSON.stringify(run.outcome)} ${JSON.stringify(run.final ?? {})}`);
  await sleep(1500);
  await shot(`${runName}-end`, `end screen (${run.outcome?.kind ?? run.outcome})`);
  check(`${runName}: end screen visible`, await page.locator('.end-screen').isVisible());
  check(`${runName}: expected outcome ${runName}`, run.outcome?.kind === runName, JSON.stringify(run.outcome));
}

if (!flag('skip-win')) {
  await playToEnd('win', {
    botOn: true,
    scale: SCALE,
    shotsAt: [
      ['start', (s) => s.elapsed > 2, 'first seconds of play'],
      ['herding', (s) => s.sheep.some((q) => q.state === 'flee') && s.elapsed > 10, 'sheep fleeing from the dog'],
      ['first-home', (s, p) => s.folded >= 1 && p.folded === 0, 'first sheep enters the fold'],
      ['bridge', (s) => s.dog && s.dog.x < -30 && s.dog.x > -42 && Math.abs(s.dog.z + 2) < 6, 'dog at the bridge'],
      ['wolf', (s) => s.wolves.length > 0 && s.wolves.some((w) => w.state === 'stalk' || w.state === 'charge'), 'wolf hunting'],
      ['sunset', (s) => s.t > 0.62, 'sunset'],
      ['dusk', (s) => s.t > 0.82, 'dusk'],
    ],
  });
}

if (!flag('skip-lose')) {
  // Lose path: idle the whole day at high speed so night falls with the flock still out.
  // Enter works from both the title and the end screen.
  await playToEnd('lose', {
    botOn: false,
    scale: 40,
    shotsAt: [['night', (s) => s.t > 0.95, 'nightfall, flock still out']],
  });
}

// Latch scenario: meet the target, check the prompt, press Enter, expect a "latched" win.
if (!flag('skip-latch')) {
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__WG.setTimeScale(1));
  await sleep(1000);
  const s0 = await state();
  check('latch: new day started', s0.mode === 'playing', s0.mode);
  await page.evaluate((n) => window.__WG.placeInFold(n), s0.target);
  await sleep(1200);
  const s1 = await state();
  check('latch: target met', s1.folded >= s1.target, `${s1.folded}/${s1.target}`);
  const hint = await page.locator('.hud-prompt').textContent();
  check('latch: prompt mentions Enter', (await page.locator('.hud-prompt').isVisible()) && /Enter/.test(hint ?? ''), hint ?? '');
  await shot('latch-prompt', 'target met: latch prompt and gate beacon');
  await page.keyboard.press('Enter');
  await sleep(800);
  const s2 = await state();
  check('latch: win by latching', s2.outcome?.kind === 'win' && s2.outcome?.reason === 'latched', JSON.stringify(s2.outcome));
  await shot('latch-end', 'win screen after latching the gate');
}

// Late-day look: a fresh day with the clock jumped to dusk and to the edge of night, bot herding.
if (!flag('skip-late')) {
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__WG.setTimeScale(1));
  await sleep(1000);
  const bot = new HerdBot(page);
  for (const [t, name] of [
    [0.86, 'late-dusk'],
    [0.96, 'late-night'],
  ]) {
    await page.evaluate((x) => window.__WG.jumpTo(x), t);
    const until = Date.now() + 5000;
    let lastT = Date.now();
    while (Date.now() < until) {
      const st = await state();
      if (st.mode !== 'playing') break;
      await bot.step(st, ((Date.now() - lastT) / 1000) * 1);
      lastT = Date.now();
      await sleep(60);
    }
    await shot(name, `clock jumped to ${t} of the day`);
  }
  await bot.release();
  if ((await state()).mode === 'playing') {
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.locator('.pause-screen [data-act="title"]').click();
  } else {
    await page.locator('.end-screen [data-act="title"]').click();
  }
  await sleep(400);
  await page.locator('[data-act="play"]').click();
  await sleep(600);
  // End this day quickly so the title-button check below starts from an end screen.
  await page.evaluate(() => window.__WG.setTimeScale(60));
  await page.waitForFunction(() => window.__WG.state().mode === 'ended', null, { timeout: 60000 });
  await page.evaluate(() => window.__WG.setTimeScale(1));
}

// Back to the title from the end screen with the mouse.
if (!flag('skip-menus')) {
  const toTitle = page.locator('.end-screen [data-act="title"]');
  if (await toTitle.isVisible()) {
    await toTitle.click();
    await sleep(500);
    const st = await state();
    check('title button returns to title', st.mode === 'title' && (await page.locator('.title-screen').isVisible()), st.mode);
  }
}

report.finished = new Date().toISOString();
report.errorCount = report.pageErrors.length + report.console.filter((c) => c.type === 'error').length;
const failed = report.assertions.filter((a) => !a.ok);
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
log(`done: ${report.errorCount} errors, ${failed.length}/${report.assertions.length} assertions failed, ${report.shots.length} screenshots -> ${OUT}`);
await browser.close();
