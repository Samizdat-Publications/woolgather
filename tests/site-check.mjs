// Checks the built public site (site-dist/, from `npm run site`) in headless Chrome: screenshots of the
// landing page at desktop and phone sizes, through the scrubbed evening and every section; the herding
// toy driven by the pointer; the game at /play/ reaching its title. Logs console errors and failed
// requests. Output: test-results/site-check/ (gitignored).
//
//   node tests/site-check.mjs [--url https://woolgather.pages.dev]   (default: a local preview of site-dist)

import { chromium } from 'playwright-core';
import { preview } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const out = path.join(root, 'test-results/site-check');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let server = null;
let base = urlArg;
if (!base) {
  server = await preview({ root, logLevel: 'warn', build: { outDir: 'site-dist' }, preview: { port: 4890, strictPort: false } });
  base = server.resolvedUrls.local[0];
}
base = base.replace(/\/?$/, '/');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(viewport, name) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name} console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${name} ${r.status()} ${r.url()}`));
  page.on('requestfailed', (r) => !/\.mp4/.test(r.url()) && problems.push(`${name} failed ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(base, { waitUntil: 'load' });
  await sleep(1500);
  return page;
}
const shot = (page, file) => page.screenshot({ path: path.join(out, file) });
async function scrollToY(page, y) {
  await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y);
  await sleep(700);
}
async function scrollToEl(page, sel, block = 'start') {
  await page.evaluate(([s, b]) => document.querySelector(s).scrollIntoView({ block: b, behavior: 'instant' }), [sel, block]);
  await sleep(900);
}

// ---------------------------------------------------------------- desktop
{
  const page = await open({ width: 1440, height: 900 }, 'desktop');
  const heroH = await page.evaluate(() => document.querySelector('.dusk').offsetHeight - innerHeight);
  for (const [i, f] of [0, 0.25, 0.45, 0.62, 0.78, 1].entries()) {
    await scrollToY(page, Math.round(heroH * f));
    await sleep(500);
    await shot(page, `d0${i}-evening-${Math.round(f * 100)}.png`);
  }
  await scrollToEl(page, '#herd');
  // Be the dog, like a real one (and the game's bot): gather the furthest straggler back to the flock,
  // otherwise stand behind the flock on the line from the gate and walk it in. Going round the flock,
  // never through it.
  const box = await page.locator('#toy-canvas').boundingBox();
  const at = (x, y) => [box.x + (x / 800) * box.width, box.y + (y / 480) * box.height];
  const gate = { x: 600, y: 240 };
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const toyStart = Date.now();
  let homeAt = [];
  for (let k = 0; k < 400; k++) {
    const st = await page.evaluate(() => document.getElementById('toy-canvas').herdState());
    const loose = st.sheep.filter((s) => !s.home);
    const homeN = st.sheep.length - loose.length;
    if (homeN > homeAt.length) homeAt.push(((Date.now() - toyStart) / 1000).toFixed(1));
    if (!loose.length || Date.now() - toyStart > 90000) break;
    const c = { x: loose.reduce((a, s) => a + s.x, 0) / loose.length, y: loose.reduce((a, s) => a + s.y, 0) / loose.length };
    const far = loose.reduce((a, s) => (d2(s, c) > d2(a, c) ? s : a));
    const unit = (v) => {
      const l = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / l, y: v.y / l };
    };
    let t;
    if (d2(far, c) > 40 + 10 * Math.sqrt(loose.length)) {
      const u = unit({ x: far.x - c.x, y: far.y - c.y });
      t = { x: far.x + u.x * 45, y: far.y + u.y * 45 };
    } else {
      const u = unit({ x: c.x - gate.x, y: c.y - gate.y });
      t = { x: c.x + u.x * (55 + 8 * Math.sqrt(loose.length)), y: c.y + u.y * (55 + 8 * Math.sqrt(loose.length)) };
    }
    // go round the flock: if the way passes close to its middle, detour to the side
    const dog = st.dog;
    const seg = { x: t.x - dog.x, y: t.y - dog.y };
    const len2 = seg.x * seg.x + seg.y * seg.y || 1;
    const k2 = Math.max(0, Math.min(1, ((c.x - dog.x) * seg.x + (c.y - dog.y) * seg.y) / len2));
    const near = { x: dog.x + seg.x * k2, y: dog.y + seg.y * k2 };
    if (d2(near, c) < 80 && d2(dog, t) > 60) {
      const side = unit({ x: near.x - c.x || 1, y: near.y - c.y });
      t = { x: c.x + side.x * 120, y: c.y + side.y * 120 };
    }
    t.x = Math.max(12, Math.min(788, t.x));
    t.y = Math.max(12, Math.min(468, t.y));
    await page.mouse.move(...at(t.x, t.y), { steps: 4 });
    await sleep(120);
    if (k === 40) await shot(page, 'd10-herd-working.png');
  }
  await sleep(1200);
  await shot(page, 'd11-herd-end.png');
  const toyCount = `${await page.locator('#toy-count').textContent()} (home at ${homeAt.join(', ')} s)`;
  await scrollToEl(page, '#evening');
  await shot(page, 'd20-evening-head.png');
  for (const clip of ['drive', 'sunset', 'snatch', 'win']) {
    await scrollToEl(page, `.step[data-clip=${clip}]`, 'center');
    await sleep(1200);
    await shot(page, `d21-step-${clip}.png`);
  }
  const stepTimes = await page.$$eval('.step', (els) => els.map((e) => `${e.dataset.clip}: ${e.querySelector('.light').textContent} / ${e.querySelector('.step-time').textContent}`));
  await scrollToEl(page, '#watch');
  await shot(page, 'd30-watch.png');
  await page.evaluate(() => document.querySelector('.tick:nth-child(5)')?.click());
  await sleep(2500);
  await scrollToEl(page, '.timeline', 'center');
  await shot(page, 'd31-watch-playing.png');
  await scrollToEl(page, '.nightfall', 'center');
  await sleep(1500);
  await shot(page, 'd40-nightfall.png');
  await scrollToEl(page, '#stages');
  await shot(page, 'd50-stages.png');
  await page.locator('.compare-tabs button').nth(2).click();
  await sleep(800);
  await scrollToEl(page, '.compare', 'center');
  await shot(page, 'd51-stages-night.png');
  await scrollToEl(page, '#controls');
  await shot(page, 'd60-controls.png');
  await scrollToEl(page, '#making');
  await shot(page, 'd70-making.png');
  await scrollToEl(page, '.making-grid', 'center');
  await shot(page, 'd71-making-facts.png');
  await scrollToY(page, 1e6);
  await sleep(800);
  await shot(page, 'd80-last.png');
  const tally = await page.locator('#tally').textContent();
  console.log('toy:', toyCount, '\nsteps:', stepTimes, '\ntally:', tally);
  await page.close();
}

// ---------------------------------------------------------------- phone
{
  const page = await open({ width: 390, height: 844 }, 'phone');
  const heroH = await page.evaluate(() => document.querySelector('.dusk').offsetHeight - innerHeight);
  await shot(page, 'p00-evening-0.png');
  await scrollToY(page, heroH);
  await sleep(500);
  await shot(page, 'p01-evening-end.png');
  for (const [i, sel] of ['#herd', '.toy', '#evening', '.step[data-clip=snatch]', '#watch', '#controls', '.read', '#making', '.foot'].entries()) {
    await scrollToEl(page, sel, 'start');
    await shot(page, `p1${i}-${sel.replace(/[^a-z]/g, '')}.png`);
  }
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  if (wide > 390) problems.push(`phone: page is ${wide}px wide (horizontal scroll)`);
  await page.close();
}

// ---------------------------------------------------------------- the game at /play/
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => problems.push(`play pageerror: ${e}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`play console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`play ${r.status()} ${r.url()}`));
  await page.goto(`${base}play/`, { waitUntil: 'load' });
  await page.waitForSelector('.title-screen', { timeout: 60000 }).catch(() => problems.push('play: no title screen within 60 s'));
  await sleep(2500);
  await shot(page, 'g00-play-title.png');
  await page.close();
}

await browser.close();
if (server) await server.close();
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'no problems');
process.exit(problems.length ? 1 : 0);
