// Woolgather self-test: plays the game in a headless browser through scripted keyboard input,
// captures screenshots from the player's camera at key moments, and records console output.
//
//   node tests/playtest.mjs [--out dir] [--scale 2] [--seed 7] [--diff standard] [--headed]
//                           [--url http://localhost:5317/] [--skip-win] [--skip-lose]
//                           [--serve <build dir>]
//
// Needs the dev server running (npm run dev), unless --serve names a production build (for example
// one made with `npx vite build --outDir test-results/pt-dist`): then it serves that frozen build
// itself, so the source can change while it runs. The classic evening is played by HerdBot2. Uses the system Chrome/Edge via playwright-core,
// so no browser download is required.

import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HerdBot2 as HerdBot } from './bot2.mjs';
import { serveDir } from './serve.mjs';

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
const SERVE = opt('serve', null);
const served = SERVE ? await serveDir(resolve(SERVE)) : null;
const BASE = served ? served.url : opt('url', 'http://localhost:5317/');
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
const startClassic = () => page.evaluate((d) => window.__WG.classic(d), DIFF);
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
  // Quick check: title renders, a classic day starts, a few seconds of play without errors.
  await startClassic();
  await sleep(3000);
  const st = await state();
  check('smoke: playing', st.mode === 'playing', st.mode);
  await shot('smoke', 'a few seconds into a day');
  report.errorCount = report.pageErrors.length + report.console.filter((c) => c.type === 'error').length;
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log(`smoke done: ${report.errorCount} errors, fps ${st.fps}, mode ${st.mode}`);
  await browser.close();
  served?.close();
  process.exit(report.errorCount === 0 && st.mode === 'playing' ? 0 : 1);
}

async function playToEnd(runName, { botOn, scale, shotsAt }) {
  const run = { name: runName, events: [], outcome: null };
  report.runs.push(run);
  await startClassic();
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
    for (const [key, test, note, slow] of shotsAt) {
      if (!fired.has(key) && test(st, prev)) {
        fired.add(key);
        if (slow) {
          // Real-time for a moment so camera smoothing (in real seconds) catches up at high speed.
          await page.evaluate(() => window.__WG.setTimeScale(1));
          await sleep(1200);
        }
        await shot(key, note);
        if (slow) await page.evaluate((k) => window.__WG.setTimeScale(k), scale);
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
  if (runName === 'win') {
    // Feel: the synthesised sound is running and has been making noise all day.
    const a = await page.evaluate(() => window.__WG.audioState());
    check('audio: context running', a.state === 'running', JSON.stringify(a));
    check('audio: sounds played', a.played > 20, JSON.stringify(a));
  }
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
      [
        'wolf',
        (s) => s.dog && s.wolves.some((w) => (w.state === 'stalk' || w.state === 'charge') && Math.hypot(w.x - s.dog.x, w.z - s.dog.z) < 28),
        'wolf hunting near Pip',
        true,
      ],
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
    shotsAt: [
      ['snatch', (s) => s.sheep.some((q) => q.state === 'grabbed'), 'a wolf drags a sheep away from an idle Pip', true],
      ['night', (s) => s.t > 0.95, 'nightfall, flock still out'],
    ],
  });
}

// Latch scenario: meet the target, check the prompt, press Enter, expect a "latched" win.
if (!flag('skip-latch')) {
  await startClassic();
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
  // The gate swings shut before the card appears; wait for it so the next Enter starts a new day.
  const card = await page.locator('.end-screen').waitFor({ state: 'visible', timeout: 6000 }).then(
    () => true,
    () => false,
  );
  check('latch: end card appears', card);
  await shot('latch-end', 'win screen after latching the gate');
}

// Late-day look: a fresh day with the clock jumped to dusk and to the edge of night, bot herding.
if (!flag('skip-late')) {
  await startClassic();
  await page.evaluate(() => window.__WG.setTimeScale(1));
  await sleep(1000);
  const bot = new HerdBot(page);
  for (const [t, name] of [
    [0.45, 'late-sunset'],
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
  await page.locator('.title-screen [data-act="classic"]').click();
  await sleep(600);
  // End this day quickly so the title-button check below starts from an end screen.
  await page.evaluate(() => window.__WG.setTimeScale(60));
  await page.waitForFunction(() => window.__WG.state().mode === 'ended', null, { timeout: 60000 });
  await page.evaluate(() => window.__WG.setTimeScale(1));
}

// The season: Enter on the title opens the map; every evening loads and plays a few seconds.
if (!flag('skip-season')) {
  const toTitle = page.locator('.end-screen [data-act="title"]');
  // The results card follows the gate a moment after the day ends.
  if ((await state()).mode === 'ended') await toTitle.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  if (await toTitle.isVisible()) await toTitle.click();
  await sleep(500);
  await page.evaluate(() => window.__WG.progress('reset'));
  await page.keyboard.press('Enter');
  await sleep(700);
  check('season: Enter on the title opens the season map', (await state()).screen === 'season', (await state()).screen);
  check('season: evening 2 is locked at first', await page.locator('.ev.locked[data-arg="far-bank"]').isVisible());
  await shot('season-map', 'the season map, fresh');
  await page.evaluate(() => window.__WG.progress('all'));
  await page.locator('.title-screen [data-act="season"]').isVisible();
  await page.evaluate(() => window.__WG.evening('angus', false));
  await sleep(800);
  check('season: evening card opens', (await state()).screen === 'intro');
  const charm = page.locator('.intro-card .charm.pick').first();
  if (await charm.isVisible()) {
    await charm.click();
    await sleep(200);
    check('season: a charm can be worn', await page.locator('.intro-card .charm.pick.on').isVisible());
  } else check('season: charms offered with stars', false);
  await shot('evening-card', 'an evening card with charms');
  for (const id of ['long-light', 'far-bank', 'lambing', 'angus', 'night-watch', 'mist', 'storm', 'gather', 'first-snow']) {
    await page.evaluate((e) => window.__WG.evening(e, true), id);
    await page.evaluate(() => window.__WG.setTimeScale(4));
    await sleep(2500);
    const st = await state();
    check(`season: ${id} plays`, st.mode === 'playing' && st.evening === id && st.total > 0, `${st.mode} ${st.evening} ${st.total}`);
    await shot(`evening-${id}`, `evening ${id} in play`);
  }
  await page.evaluate(() => window.__WG.setTimeScale(1));

  // Landmarks: the corrie has its crag, screes and shieling, and they block the way.
  await page.evaluate(() => window.__WG.evening('angus', true));
  await sleep(800);
  const lm = await page.evaluate(() => (window.__WG.level.landmarks ?? []).length);
  check('landmarks: the corrie has its landmarks', lm >= 5, String(lm));
  await shot('landmarks-corrie', 'Crannach Corrie with its landmarks');

  // Fly, the old dog: F sends her to lie where Pip stands, F again calls her back.
  await page.evaluate(() => window.__WG.charms(['fly']));
  await page.evaluate(() => window.__WG.evening('lambing', true));
  await sleep(800);
  const f0 = (await state()).fly;
  check('fly: comes along when worn', !!f0 && f0.mode === 'heel', JSON.stringify(f0));
  await page.keyboard.press('KeyF');
  await sleep(1500);
  const f1 = (await state()).fly;
  check('fly: F sends her to hold a spot', !!f1 && (f1.mode === 'go' || f1.mode === 'down'), JSON.stringify(f1));
  await shot('fly-down', 'Fly holding a spot');
  await page.keyboard.press('KeyF');
  await sleep(300);
  check('fly: F again calls her back', (await state()).fly?.mode === 'heel');
  await page.evaluate(() => window.__WG.charms([]));
  await page.evaluate(() => window.__WG.evening('show', true));
  await sleep(500);
  check('fly: never at the trial', (await state()).fly === null);

  // Wolf Moon: harder rules, and its record kept apart from the evening's.
  await page.evaluate(() => window.__WG.progress('moon'));
  await page.evaluate(() => window.__WG.evening('storm', true, false));
  await sleep(500);
  const tNormal = (await state()).target;
  await page.evaluate(() => window.__WG.evening('storm', false, true));
  await sleep(400);
  check('wolf moon: the intro card shows the tier switch', await page.locator('.intro-card.moon .tier-switch').isVisible());
  await shot('wolf-moon-card', 'the Wolf Moon intro card');
  await page.evaluate(() => window.__WG.evening('storm', true, true));
  await sleep(500);
  const tMoon = (await state()).target;
  check('wolf moon: one more sheep needed', tMoon === tNormal + 1, `${tMoon} (normal storm ${tNormal})`);
  await page.evaluate(() => window.__WG.evening('long-light', true, true));
  await sleep(500);
  const m0 = await state();
  await page.evaluate((n) => window.__WG.placeInFold(n), m0.target);
  await sleep(800);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__WG.state().screen === 'end', null, { timeout: 15000 }).catch(() => {});
  const rec = (await state()).progress.evenings['long-light'];
  check('wolf moon: a moon win keeps the evening record', rec?.stars === 3 && (rec?.moon?.stars ?? 0) >= 1, JSON.stringify(rec));
  await page.evaluate(() => window.__WG.progress('all'));

  // The season's setting (2.1): chosen on the season map, Hard adds a layer, Easy holds the wolves back.
  await page.evaluate(() => window.__WG.evening('angus', true));
  await sleep(400);
  const totStd = (await state()).total;
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.evaluate(() => window.__WG.evening('angus', false));
  await sleep(400);
  await page.locator('.intro-card [data-act="setting"][data-arg="hard"]').click();
  await sleep(300);
  check('setting: Hard chosen on the evening card', (await state()).setting === 'hard');
  check('setting: the card names the Hard layer', await page.locator('.intro-card .setting-note').isVisible());
  check('setting: the card teaches the old grey', (await page.locator('.intro-card .intro-wolves').textContent())?.includes('old grey'));
  await shot('setting-hard-card', 'Old Angus on Hard: the setting switch, the layer and the wolves');
  await page.evaluate(() => window.__WG.evening('angus', true));
  await sleep(400);
  const totHard = (await state()).total;
  check('setting: Hard adds lambs to Old Angus', totHard > totStd, `${totHard} on Hard, ${totStd} on Standard`);
  await page.evaluate(() => window.__WG.setting('easy'));
  await page.evaluate(() => window.__WG.evening('far-bank', true));
  await sleep(300);
  const wsEasy = (await state()).wolfStart;
  await page.evaluate(() => window.__WG.setting('standard'));
  await page.evaluate(() => window.__WG.evening('far-bank', true));
  await sleep(300);
  const wsStd = (await state()).wolfStart;
  check('setting: Easy brings the wolves out later', wsEasy > wsStd, `${wsEasy} vs ${wsStd}`);
  await page.evaluate(() => window.__WG.evening('long-light', true));
  await sleep(300);
  const ll = await state();
  await page.evaluate(() => window.__WG.setting('hard'));
  await page.evaluate(() => window.__WG.evening('long-light', true));
  await sleep(300);
  const llHard = await state();
  check('setting: the first evening is the same on Hard', ll.target === llHard.target && ll.total === llHard.total && ll.wolfStart === llHard.wolfStart);
  await page.evaluate(() => window.__WG.setting('standard'));

  // The old grey takes two barks; a young wolf bolts at one.
  await page.evaluate(() => window.__WG.evening('storm', true));
  await sleep(600);
  const wolfNear = async (id) => (await state()).wolves.find((w) => w.id === id);
  const gid = await page.evaluate(() => window.__WG.wolf('grey', 8));
  await sleep(200);
  await page.keyboard.press('Space');
  await sleep(250);
  const g1 = await wolfNear(gid);
  check('old grey: one bark only staggers him', !!g1 && g1.state !== 'flee' && g1.grit === 1, JSON.stringify(g1));
  await shot('old-grey', 'the old grey, staggered by a bark');
  await sleep(1400);
  await page.keyboard.press('Space');
  await sleep(250);
  check('old grey: a second bark drives him off', (await wolfNear(gid))?.state === 'flee' || !(await wolfNear(gid)), JSON.stringify(await wolfNear(gid)));
  await sleep(1400);
  const yid = await page.evaluate(() => window.__WG.wolf('young', 12));
  await sleep(200);
  await page.keyboard.press('Space');
  await sleep(250);
  check('young wolf: bolts at one bark', (await wolfNear(yid))?.state === 'flee', JSON.stringify(await wolfNear(yid)));

  // The goose: open once the whole season is won; it herds in Pip's place and honks.
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.locator('.pause-screen [data-act="season"]').click().catch(() => {});
  await page.evaluate(() => window.__WG.evening('long-light', false));
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(500);
  const gooseBtn = page.locator('.season-screen .coat[data-arg="goose"]');
  check('goose: offered once the season is won', (await gooseBtn.isVisible()) && !(await gooseBtn.getAttribute('class'))?.includes('locked'));
  await gooseBtn.click();
  await sleep(300);
  check('goose: chosen in the coat row', (await state()).goose === true);
  await page.evaluate(() => window.__WG.evening('far-bank', true));
  await sleep(1500);
  check('goose: the bark chip says Honk', (await page.locator('.bark-word').textContent()) === 'Honk');
  await page.keyboard.press('Space');
  await sleep(200);
  await shot('goose', 'the goose herding the Far Bank, honking');
  await page.evaluate(() => window.__WG.evening('long-light', false));
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.locator('.season-screen .coat[data-arg="black"]').click();
  await sleep(200);
  check('goose: Pip comes back with his own coat', (await state()).goose === false);

  await page.evaluate(() => window.__WG.classic('standard'));
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.locator('.pause-screen [data-act="title"]').click();
  await sleep(400);
  // End a classic day quickly so the title-button check below starts from an end screen.
  await startClassic();
  await page.evaluate(() => window.__WG.setTimeScale(60));
  await page.waitForFunction(() => window.__WG.state().mode === 'ended', null, { timeout: 60000 });
  await page.evaluate(() => window.__WG.setTimeScale(1));
}

// Back to the title from the end screen with the mouse.
if (!flag('skip-menus')) {
  const toTitle = page.locator('.end-screen [data-act="title"]');
  const shown = await toTitle.waitFor({ state: 'visible', timeout: 6000 }).then(
    () => true,
    () => false,
  );
  check('end card offers the title button', shown);
  if (shown) {
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
served?.close();
