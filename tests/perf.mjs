// Frame-time test: plays a day in a headless browser (real GPU) and measures frame times at each
// phase of the evening, standing and running, with the renderer's draw calls and triangles.
//
//   node tests/perf.mjs [--url http://localhost:4317/] [--width 1920] [--height 1080] [--dpr 1]
//                       [--quality auto|high|medium|low] [--out test-results/perf.json]
//
// Point it at the production preview (npm run build && npm run preview) for real numbers.

import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const BASE = opt('url', 'http://localhost:4317/');
const W = Number(opt('width', '1920'));
const H = Number(opt('height', '1080'));
const DPR = Number(opt('dpr', '1'));
const QUALITY = opt('quality', '');
const OUT = resolve(opt('out', 'test-results/perf.json'));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const q = QUALITY ? `&quality=${QUALITY}` : '';
await page.goto(`${BASE}?test=1&seed=11&diff=standard${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__WG, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__WG.classic('standard'));
await page.waitForTimeout(1500);

/** Record requestAnimationFrame deltas for `ms` milliseconds in the page. */
async function measure(ms) {
  return page.evaluate(
    (dur) =>
      new Promise((done) => {
        const d = [];
        let last = performance.now();
        const start = last;
        const step = (t) => {
          d.push(t - last);
          last = t;
          if (t - start < dur) requestAnimationFrame(step);
          else done(d);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

const stats = (d) => {
  const s = [...d].sort((a, b) => a - b);
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { frames: d.length, avg: +avg.toFixed(2), p50: +pct(0.5).toFixed(2), p95: +pct(0.95).toFixed(2), p99: +pct(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2), fps: +(1000 / avg).toFixed(1) };
};

const gpuOk = await page.evaluate(() => window.__WG.gpuStart());

// --analyze: where does the GPU time go? The heaviest meshes, then the frame's GPU time with one
// costly feature switched off at a time, at the sunset (wolves out, the busiest phase).
if (args.includes('--analyze')) {
  await page.evaluate(() => window.__WG.jumpTo(0.5));
  await page.waitForTimeout(1500);
  const heavy = await page.evaluate(() => window.__WG.heavy());
  console.log(`scene triangles (instances included): ${(heavy.total / 1000).toFixed(0)}k, casting shadows: ${(heavy.shadowTris / 1000).toFixed(0)}k`);
  for (const h of heavy.top) console.log(`  ${(h.tris / 1000).toFixed(1).padStart(7)}k  x${String(h.count).padEnd(5)} ${h.shadow ? 'shadow' : '      '} ${h.transparent ? 'transp' : '      '}  ${h.name}`);
  const gpu = async () => {
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__WG.gpuTime());
    await page.waitForTimeout(2000);
    return page.evaluate(() => window.__WG.gpuTime());
  };
  const base = await gpu();
  console.log(`baseline gpu ${base.avg.toFixed(2)} ms`);
  for (const what of ['shadows', 'bloom', 'msaa']) {
    await page.evaluate((w) => window.__WG.toggle(w, false), what);
    const off = await gpu();
    await page.evaluate((w) => window.__WG.toggle(w, true), what);
    console.log(`  without ${what.padEnd(8)} gpu ${off.avg.toFixed(2)} ms (saves ${(base.avg - off.avg).toFixed(2)})`);
  }
  await browser.close();
  process.exit(0);
}

const rows = [];
for (const t of [0.1, 0.5, 0.8, 0.97]) {
  await page.evaluate((x) => window.__WG.jumpTo(x), t);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__WG.gpuTime());
  const idle = stats(await measure(3000));
  const gpuIdle = await page.evaluate(() => window.__WG.gpuTime());
  const info = await page.evaluate(() => window.__WG.perf());
  // Running: hold right and sprint, so the camera moves, dust flies and the flock reacts.
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ShiftLeft');
  const run = stats(await measure(2500));
  const gpuRun = await page.evaluate(() => window.__WG.gpuTime());
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyA');
  rows.push({ t, idle, run, info, gpuIdle, gpuRun });
  const g = (x) => (x ? `gpu ${x.avg.toFixed(2)} ms (p95 ${x.p95.toFixed(2)})` : 'gpu n/a');
  console.log(`t=${t}  idle ${idle.avg} ms (p95 ${idle.p95}, max ${idle.max}, ${idle.fps} fps) ${g(gpuIdle)}  run ${run.avg} ms (p95 ${run.p95}, max ${run.max}) ${g(gpuRun)}  calls ${info.calls} tris ${(info.triangles / 1000).toFixed(0)}k programs ${info.programs}`);
}
const quality = await page.evaluate(() => (window.__WG.quality ? window.__WG.quality() : null));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ url: BASE, W, H, DPR, quality, rows, errors }, null, 2));
if (!gpuOk) console.log('perf: no GPU timer in this browser');
console.log(`perf: ${W}x${H} dpr ${DPR}${quality ? ` quality ${JSON.stringify(quality)}` : ''}; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
