// Look-dev helper: freezes a day and captures the player view at several times of day.
//   node tests/lookdev.mjs [--out dir] [--times 0,0.3,0.55,0.7,0.8,0.9,1] [--url ...]

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const OUT = resolve(opt('out', 'test-results/lookdev'));
const TIMES = opt('times', '0,0.3,0.55,0.7,0.8,0.9,1').split(',').map(Number);
const BASE = opt('url', 'http://localhost:5317/');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}?test=1&seed=7`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__WG);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'title.png') });
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
await page.evaluate(() => window.__WG.setTimeScale(0));
const at = opt('at', null);
if (at) {
  const [x, z] = at.split(',').map(Number);
  await page.evaluate(([px, pz]) => window.__WG.teleportDog(px, pz), [x, z]);
}
// --nograde also captures each time with the colour grade pass switched off (tone mapping only),
// to see what the renderer itself produces.
const noGrade = args.includes('--nograde');
const setGrade = (on) => page.evaluate((v) => window.__WG.setGrade(v), on);
for (const t of TIMES) {
  await page.evaluate((x) => window.__WG.jumpTo(x), t);
  await page.waitForTimeout(400);
  const name = `t${String(t).replace('.', '_')}`;
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  if (noGrade) {
    await setGrade(false);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(OUT, `${name}-nograde.png`) });
    await setGrade(true);
  }
}
console.log(`lookdev: ${TIMES.length} shots -> ${OUT}; errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
