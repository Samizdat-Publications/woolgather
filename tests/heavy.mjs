// Perf look: the heaviest meshes per evening (triangles drawn), via __WG.heavy().
//   node tests/heavy.mjs --dist <build> angus mist ...
import { chromium } from 'playwright-core';
import { serveDir } from './serve.mjs';

const args = process.argv.slice(2);
const di = args.indexOf('--dist');
const dist = di >= 0 ? args.splice(di, 2)[1] : 'dist';
const served = await serveDir(dist);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${served.url}?test=1&seed=11&quality=high&nocutaway`);
await page.waitForFunction(() => !!window.__WG, null, { timeout: 120000 });
await page.evaluate(() => window.__WG.progress('all'));
for (const id of args) {
  await page.evaluate((e) => window.__WG.evening(e, true), id);
  await page.waitForTimeout(1500);
  const h = await page.evaluate(() => window.__WG.heavy());
  console.log(`== ${id}: ${Math.round(h.total / 1000)}k tris, ${h.meshCount} meshes`);
  for (const t of h.top.slice(0, 10)) console.log(`  ${Math.round(t.tris / 1000)}k ${t.name} x${t.count}${t.shadow ? ' shadow' : ''}`);
}
await browser.close();
served.close();
