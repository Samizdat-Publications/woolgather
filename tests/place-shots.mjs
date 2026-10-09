// Place shots for the blind place test (docs/RUN2-PLAN.md): for each of the five places, Pip is set
// down beside two of its grazing spots and the herding camera is captured, with the HUD hidden and
// the clock at the same early-evening time, so a blind critic can say whether the places look
// alike. Files are shuffled names (s01.jpg ...) with a key in key.json.
//
//   node tests/place-shots.mjs --dist <build> --out test-results/places-<label>

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { serveDir } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const dist = opt('dist', 'dist');
const out = opt('out', 'test-results/places');
fs.mkdirSync(out, { recursive: true });
const served = await serveDir(dist);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${served.url}?test=1&seed=11&quality=high&nocutaway`);
await page.waitForFunction(() => !!window.__WG, null, { timeout: 120000 });
await page.evaluate(() => window.__WG.progress('all'));
// One evening per place (no mist: fog would hide the place, not tell it apart).
const PLACES = [
  ['hollow', 'far-bank'],
  ['loch', 'lambing'],
  ['corrie', 'angus'],
  ['show', 'show'],
  ['pass', 'first-snow'],
];
const shots = [];
for (const [place, ev] of PLACES) {
  await page.evaluate((e) => window.__WG.evening(e, true), ev);
  await page.waitForTimeout(800);
  const groups = await page.evaluate(() => window.__WG.level.sheepGroups.map((g) => g.center));
  // Two spots: the second and the last grazing spot (the first is often by the fold).
  const picks = [groups[Math.min(1, groups.length - 1)], groups[groups.length - 1]];
  if (picks[0] === picks[1] && groups[0]) picks[1] = groups[0];
  for (let k = 0; k < 2; k++) {
    const [x, z] = picks[k];
    await page.evaluate(() => window.__WG.setTimeScale(0.0001));
    await page.evaluate(() => window.__WG.jumpTo(0.08));
    await page.evaluate(([x, z]) => window.__WG.teleportDog(x + 9, z + 9), [x, z]);
    await page.evaluate(() => {
      const h = document.querySelector('.hud');
      if (h) h.style.visibility = 'hidden';
    });
    await page.waitForTimeout(2500);
    const file = `${place}-${k + 1}.jpg`;
    await page.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 85 });
    shots.push({ place, file });
  }
  await page.evaluate(() => {
    const h = document.querySelector('.hud');
    if (h) h.style.visibility = '';
  });
}
// Shuffle into anonymous names.
const order = shots.map((s, i) => ({ s, r: Math.sin(i * 12.9898 + 4.1) * 43758.5453 % 1 })).sort((a, b) => a.r - b.r);
const key = {};
order.forEach(({ s }, i) => {
  const name = `s${String(i + 1).padStart(2, '0')}.jpg`;
  fs.renameSync(path.join(out, s.file), path.join(out, name));
  key[name] = s.place;
});
fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(key, null, 2));
console.log(`wrote ${shots.length} shots to ${out}`);
await browser.close();
served.close();
