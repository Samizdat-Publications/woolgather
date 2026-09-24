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
for (const t of TIMES) {
  await page.evaluate((x) => window.__WG.jumpTo(x), t);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `t${String(t).replace('.', '_')}.png`) });
}
console.log(`lookdev: ${TIMES.length} shots -> ${OUT}; errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
