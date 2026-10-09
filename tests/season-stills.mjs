// One still per season evening for the landing page (site/media/season/<id>.jpg): each evening is
// started, the clock set to a telling moment, Pip set down beside a flock, and after a few seconds
// of play the herding camera is captured without the HUD.
//
//   node tests/season-stills.mjs --dist <build> [--out site/media/season]

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { serveDir } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = opt('out', 'site/media/season');
fs.mkdirSync(out, { recursive: true });
const served = await serveDir(opt('dist', 'dist'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${served.url}?test=1&seed=11&quality=high&nocutaway`);
await page.waitForFunction(() => !!window.__WG, null, { timeout: 120000 });
await page.evaluate(() => window.__WG.progress('all'));
// [evening, day clock, which grazing spot]
const SHOTS = [
  ['long-light', 0.08, 0],
  ['far-bank', 0.35, 7],
  ['lambing', 0.15, 1],
  ['angus', 0.42, 0],
  ['show', 0.25, 0],
  ['night-watch', 0.45, -1],
  ['mist', 0.3, 2],
  ['storm', 0.4, 3],
  ['gather', 0.3, 2],
  ['first-snow', 0.35, 1],
];
for (const [id, t, spot] of SHOTS) {
  await page.evaluate((e) => window.__WG.evening(e, true), id);
  await page.waitForTimeout(600);
  await page.evaluate((k) => window.__WG.jumpTo(k), t);
  const pos = await page.evaluate((i) => {
    const s = window.__WG.state();
    if (i < 0) {
      const free = s.sheep.filter((q) => q.state !== 'folded' && q.state !== 'hidden');
      const c = free.reduce((a, q) => ({ x: a.x + q.x / free.length, z: a.z + q.z / free.length }), { x: 0, z: 0 });
      return [c.x, c.z];
    }
    const g = window.__WG.level.sheepGroups;
    return g[Math.min(i, g.length - 1)].center;
  }, spot);
  await page.evaluate(([x, z]) => window.__WG.teleportDog(x + 10, z + 8), pos);
  await page.evaluate(() => {
    const h = document.querySelector('.hud');
    if (h) h.style.visibility = 'hidden';
  });
  await page.waitForTimeout(3500);
  const raw = path.join(out, `${id}.png`);
  await page.screenshot({ path: raw });
  spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'scale=960:-2', '-q:v', '4', path.join(out, `${id}.jpg`)]);
  fs.rmSync(raw);
  console.log(`still ${id}`);
}
await page.evaluate(() => {
  const h = document.querySelector('.hud');
  if (h) h.style.visibility = '';
});
await browser.close();
served.close();
