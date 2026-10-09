// Season run: HerdBot2 (tests/bot2.mjs) plays the season's evenings and reports how each went.
//
//   node tests/season-run.mjs [--evenings long-light,far-bank,...] [--scale 2] [--port 4790]
//        [--parallel 2] [--seed 11] [--cap 12] [--quality low] [--wait 0.45] [--out season-run]
//        [--nobuild] [--headed] [--skill expert|average] [--dist test-results/bot-dist]
//
// --skill average plays like a person on a first play (see docs/BOT2.md); expert is the default.
// --dist is the build folder (built there unless --nobuild). Give each concurrent run its own,
// or two runs will empty each other's build.
//
// 1. Builds the game into test-results/bot-dist (vite build with its own outDir: dist/ and the dev
//    server are left alone). If the build fails because the source is mid-edit it waits 60 s and
//    tries again, up to 5 times. --nobuild reuses the last test-results/bot-dist.
// 2. Serves that folder with a tiny static server (a random free port unless --port is given) and
//    plays each evening in headless system Chrome on the real GPU: ?test=1&seed=N&quality=low,
//    __WG.progress('all'), __WG.evening(id, true), __WG.setTimeScale(scale), then the bot every
//    ~50 ms of real time until the evening ends (or --cap game minutes).
// 3. Writes test-results/season-run.json (one record per evening) and a trace per evening in
//    test-results/season-run/<id>.json (Pip, the counts and the bot's decision every game second,
//    plus the game's events), and prints a table. --out <name> writes test-results/<name>.json and
//    test-results/<name>/ instead.
//
// --wait 0.45 is a handicap for testing the late evening: Pip sits still until 45% of the day has
// gone, so the wolves, the flood and the latch are met (an expert bot otherwise finishes most
// evenings before the wolves come out). --parallel N plays N evenings at once (one page each).

import { chromium } from 'playwright-core';
import { build } from 'vite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HerdBot2 } from './bot2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const ALL = ['long-light', 'far-bank', 'lambing', 'angus', 'show', 'night-watch', 'mist', 'storm', 'first-snow'];
const evenings = (opt('evenings', ALL.join(',')) || '').split(',').filter(Boolean);
const SCALE = Number(opt('scale', 2));
const PORT = Number(opt('port', 0));
const PAR = Math.max(1, Number(opt('parallel', 1)));
const SEED = Number(opt('seed', 11));
const CAP_MIN = Number(opt('cap', 12));
const QUALITY = opt('quality', 'low');
/** Handicap for testing the late evening: Pip does nothing until this fraction of the day has gone. */
const WAIT = Number(opt('wait', 0));
const OUT_NAME = opt('out', 'season-run');
const SKILL = opt('skill', 'expert');
const distDir = path.resolve(root, opt('dist', path.join('test-results', 'bot-dist')));
const traceDir = path.join(root, 'test-results', OUT_NAME);
const t0 = Date.now();
const log = (...a) => console.log(`[season ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const id of evenings) {
  if (!ALL.includes(id) && !id.startsWith('daily')) {
    console.error(`unknown evening "${id}"; known: ${ALL.join(', ')}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- build
if (!flag('nobuild')) {
  for (let attempt = 1; ; attempt++) {
    try {
      log(`building into ${path.relative(root, distDir)} (attempt ${attempt})`);
      await build({ root, logLevel: 'warn', build: { outDir: distDir, emptyOutDir: true } });
      break;
    } catch (e) {
      log(`build failed: ${String(e?.message ?? e).split('\n')[0]}`);
      if (attempt >= 5) {
        console.error('giving up: the build kept failing');
        process.exit(1);
      }
      log('waiting 60 s for the source to settle');
      await sleep(60000);
    }
  }
}
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`no build at ${distDir}: run without --nobuild first`);
  process.exit(2);
}

// ---------------------------------------------------------------- static server
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};
function serve(dir, port) {
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
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
const server = await serve(distDir, PORT);
const baseUrl = `http://127.0.0.1:${server.address().port}/`;
log(`serving ${path.relative(root, distDir)} at ${baseUrl}`);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !flag('headed'),
  args: ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
fs.mkdirSync(traceDir, { recursive: true });

// ---------------------------------------------------------------- one evening
async function playEvening(id) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  const elog = (...a) => log(`[${id}]`, ...a);
  const rec = { id, outcome: null, stars: 0, folded: 0, total: 0, target: 0, lost: 0, rescues: 0, grabs: 0, elapsed: 0, errors };
  try {
    await page.goto(`${baseUrl}?test=1&seed=${SEED}&quality=${QUALITY}`);
    await page.waitForFunction(() => !!window.__WG, null, { timeout: 180000 });
    await page.evaluate(() => window.__WG.progress('all'));
    const ok = await page.evaluate((e) => window.__WG.evening(e, true), id);
    if (!ok) throw new Error(`__WG.evening('${id}') returned false`);
    await page.waitForFunction(() => window.__WG.state().mode === 'playing', null, { timeout: 30000 });
    await page.evaluate((k) => window.__WG.setTimeScale(k), SCALE);
    await page.evaluate(() => window.__WG.drain());
    const bot = new HerdBot2(page, (...a) => elog(...a), { skill: SKILL, seed: SEED * 31 + id.length });
    const trace = [];
    const events = [];
    const counts = {};
    let last = null;
    let lastTrace = -1;
    let lastWhy = '';
    let lastFold = -1;
    const realCap = Date.now() + ((CAP_MIN * 60) / SCALE) * 1000 * 2 + 60000;
    let st;
    while (true) {
      const loop = Date.now();
      let evs;
      ({ st, evs } = await page.evaluate(() => ({ st: window.__WG.state(), evs: window.__WG.drain() })));
      for (const e of evs) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        if (e.type !== 'bark' && e.type !== 'stamp') events.push(e);
      }
      if (st.mode === 'ended' || st.outcome) break;
      if (!st.dog) {
        // The evening is still starting.
        await sleep(50);
        continue;
      }
      if (st.elapsed > CAP_MIN * 60 || Date.now() > realCap) {
        rec.outcome = { kind: 'cap', reason: `stopped at ${st.elapsed.toFixed(0)} s` };
        break;
      }
      const dt = last ? Math.max(0.001, Math.min(1, st.elapsed - last.elapsed)) : 0.05 * SCALE;
      st.dayLength = st.t > 0.01 ? st.elapsed / st.t : null;
      let d;
      if (st.t < WAIT) {
        // Handicap: Pip sits still until this much of the evening has gone (wolves, floods).
        d = { why: 'handicap: waiting', cat: 'handicap' };
        bot.tally('handicap', dt);
      } else d = await bot.step(st, dt, evs);
      if (st.elapsed - lastTrace >= 1) {
        lastTrace = st.elapsed;
        const free = st.sheep.filter((s) => !['folded', 'lost', 'grabbed', 'hidden'].includes(s.state));
        trace.push({ t: +st.elapsed.toFixed(1), x: +st.dog.x.toFixed(1), z: +st.dog.z.toFixed(1), folded: st.folded, lost: st.lost, why: d.why, free: free.map((s) => [s.id, +s.x.toFixed(1), +s.z.toFixed(1)]), wolves: st.wolves.map((w) => [w.id, w.state, +w.x.toFixed(0), +w.z.toFixed(0)]) });
      }
      if (d.why !== lastWhy && (d.cat !== 'drive' || !lastWhy.startsWith('drive'))) {
        lastWhy = d.why;
      }
      if (st.folded !== lastFold) {
        if (lastFold >= 0) elog(`t=${st.elapsed.toFixed(0)}s home ${st.folded}/${st.total} lost ${st.lost} (${d.why})`);
        lastFold = st.folded;
      }
      last = st;
      const wait = 50 - (Date.now() - loop);
      if (wait > 0) await sleep(wait);
    }
    await bot.release();
    const evs = await page.evaluate(() => window.__WG.drain());
    for (const e of evs) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type !== 'bark' && e.type !== 'stamp') events.push(e);
    }
    const end = await page.evaluate(() => window.__WG.state());
    rec.outcome = rec.outcome ?? end.outcome;
    rec.stars = end.outcome?.stars ?? 0;
    rec.folded = end.folded;
    rec.total = end.total;
    rec.target = end.target;
    rec.lost = end.lost;
    rec.elapsed = +end.elapsed.toFixed(1);
    rec.dayLength = end.t > 0.01 ? +(end.elapsed / end.t).toFixed(0) : null;
    rec.rescues = counts.rescued ?? 0;
    rec.grabs = counts.grab ?? 0;
    rec.barks = bot.barks;
    rec.events = counts;
    const kind = (k) => end.sheep.filter((s) => s.kind === k).map((s) => s.state);
    rec.animals = {
      ram: kind('ram'),
      black: kind('black'),
      lostLamb: end.sheep.filter((s) => s.kind === 'lamb' && s.motherId < 0).map((s) => s.state),
      lambs: end.sheep.filter((s) => s.kind === 'lamb' && s.motherId >= 0).map((s) => s.state),
    };
    rec.ribbon = ribbon(id, end, bot);
    rec.why = Object.fromEntries(Object.entries(bot.stats).map(([k, v]) => [k, +v.toFixed(1)]).sort((a, b) => b[1] - a[1]));
    rec.stuck = +bot.stuckTotal.toFixed(1);
    // Things the bot gave up on because the game would not let them happen (see docs/BOT2.md).
    rec.stranded = [...bot.stranded].map(([sid, v]) => ({ id: sid, ...v }));
    rec.lambGivenUp = bot.lambGivenUp;
    rec.leftOut = end.sheep.filter((s) => !['folded', 'lost'].includes(s.state)).map((s) => ({ id: s.id, kind: s.kind, state: s.state, x: +s.x.toFixed(1), z: +s.z.toFixed(1) }));
    const nav = bot.nav ? { levelId: end.levelId, minX: bot.nav.minX, minZ: bot.nav.minZ, step: bot.nav.step, nx: bot.nav.nx, nz: bot.nav.nz, cells: bot.nav.cells, fold: bot.nav.fold, crossings: bot.nav.crossings } : null;
    fs.writeFileSync(path.join(traceDir, `${id}.json`), JSON.stringify({ rec, events, trace, nav }));
    await page.screenshot({ path: path.join(traceDir, `${id}-end.png`) }).catch(() => {});
    elog(`done: ${rec.outcome?.kind} (${rec.outcome?.reason}) ${rec.stars} stars, home ${rec.folded}/${rec.total} (need ${rec.target}), lost ${rec.lost}, ${rec.elapsed} s`);
  } catch (e) {
    rec.outcome = { kind: 'error', reason: String(e?.message ?? e).split('\n')[0] };
    elog('error:', rec.outcome.reason);
  }
  await ctx.close().catch(() => {});
  return rec;
}

/** The evening's ribbon, judged from the final state (as season.ts does). */
function ribbon(id, st, bot) {
  if (st.outcome?.kind !== 'win') return false;
  const has = (k, pred) => st.sheep.some((s) => s.kind === k && pred(s));
  switch (id) {
    case 'long-light':
      return bot.barks === 0;
    case 'far-bank':
      return st.elapsed <= (st.elapsed / Math.max(st.t, 1e-6)) - 60;
    case 'lambing':
      return has('lamb', (s) => s.motherId < 0 && s.state === 'folded');
    case 'angus':
      return has('ram', (s) => s.state === 'folded');
    case 'night-watch':
      return st.lost === 0;
    case 'mist':
      return has('black', (s) => s.state === 'folded');
    case 'storm':
      return st.folded === st.total;
    case 'first-snow':
      return st.sheep.filter((s) => (s.kind === 'ram' || s.kind === 'black') && s.state === 'folded').length >= 2;
  }
  return false;
}

// ---------------------------------------------------------------- run them all
const results = new Array(evenings.length);
let next = 0;
async function worker() {
  while (next < evenings.length) {
    const i = next++;
    results[i] = await playEvening(evenings[i]);
  }
}
await Promise.all(Array.from({ length: Math.min(PAR, evenings.length) }, () => worker()));
await browser.close();
server.close();

const out = path.join(root, 'test-results', `${OUT_NAME}.json`);
fs.writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), skill: SKILL, scale: SCALE, seed: SEED, quality: QUALITY, wait: WAIT, results }, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(pad('evening', 12), pad('outcome', 18), pad('stars', 6), pad('home', 8), pad('need', 5), pad('lost', 5), pad('resc', 5), pad('time', 9), pad('ribbon', 7), pad('stuck', 6), 'errors');
for (const r of results) {
  const o = r.outcome ? `${r.outcome.kind}/${r.outcome.reason}` : '-';
  console.log(pad(r.id, 12), pad(o.slice(0, 17), 18), pad(r.stars, 6), pad(`${r.folded}/${r.total}`, 8), pad(r.target, 5), pad(r.lost, 5), pad(r.rescues, 5), pad(`${r.elapsed}/${r.dayLength ?? '?'}`, 9), pad(r.ribbon ? 'yes' : 'no', 7), pad(r.stuck ?? '-', 6), r.errors?.length ?? 0, r.stranded?.length ? `stranded: ${r.stranded.map((s) => s.id).join(',')}` : '', r.lambGivenUp ? 'lost lamb stuck at the gate' : '');
}
console.log(`\nwrote ${path.relative(root, out)} and traces in ${path.relative(root, traceDir)}/ (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
