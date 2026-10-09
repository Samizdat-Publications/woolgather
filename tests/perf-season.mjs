// Frame rate, draw calls and triangles in every evening of the season, on a production build.
//
//   node tests/perf-season.mjs [--dist test-results/critic-dist] [--width 1920 --height 1080] [--quality high]
//
// Serves the build itself (a small static server on a random port), opens each evening, lets it
// settle, then samples the game's own frame-time average and the renderer's counts.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const dist = path.resolve(root, opt('dist', 'test-results/critic-dist'));
const W = Number(opt('width', 1920));
const H = Number(opt('height', 1080));
const quality = opt('quality', 'high');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.join(dist, url === '/' ? 'index.html' : url);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${port}/?test=1&seed=11&quality=${quality}&nocutaway`);
await page.waitForFunction(() => !!window.__WG, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__WG.progress('all'));
const rows = [];
for (const id of ['long-light', 'far-bank', 'lambing', 'angus', 'show', 'night-watch', 'mist', 'storm', 'first-snow']) {
  await page.evaluate((e) => window.__WG.evening(e, true), id);
  await page.waitForTimeout(3500);
  // Walk Pip towards the nearest flock for a moment so the camera moves.
  const fps = await page.evaluate(() => window.__WG.state().fps);
  const p = await page.evaluate(() => window.__WG.perf());
  rows.push({ id, fps, calls: p.calls, triangles: p.triangles, programs: p.programs, tier: (await page.evaluate(() => window.__WG.quality())).tier });
  console.log(`${id.padEnd(12)} ${String(fps).padStart(6)} fps  ${String(p.calls).padStart(4)} calls  ${(p.triangles / 1000).toFixed(0).padStart(5)}k tris  ${p.programs} programs`);
}
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
fs.writeFileSync(path.join(root, 'test-results', `perf-season-${quality}.json`), JSON.stringify({ W, H, quality, rows, errors }, null, 1));
await browser.close();
server.close();
