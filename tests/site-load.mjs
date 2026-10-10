// How long the landing page takes to load on a slow phone connection, and what it fetches.
//
//   node tests/site-load.mjs [--dir site-dist] [--kbps 800] [--width 390 --height 844] [--url https://...]
//
// Serves the built site (or opens --url), throttles Chrome's network through CDP (download and
// upload in kilobits a second, 150 ms latency), and reports the time to the load event, the bytes
// and requests fetched by then, and what was fetched after it while the page sat still for 5 s.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const dir = path.resolve(root, opt('dir', 'site-dist'));
const kbps = Number(opt('kbps', 800));
const W = Number(opt('width', 390));
const H = Number(opt('height', 844));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

let server = null;
let url = opt('url', null);
if (!url) {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (kbps * 1024) / 8, uploadThroughput: (kbps * 1024) / 8 });
const got = [];
page.on('requestfinished', async (r) => {
  const sz = (await r.sizes().catch(() => null))?.responseBodySize ?? 0;
  got.push({ t: Date.now(), sz, url: r.url().replace(/^https?:\/\/[^/]+/, '') });
});
const t0 = Date.now();
let loadT = null;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 240000 });
  loadT = Date.now();
} catch (e) {
  console.log('goto:', String(e.message).split('\n')[0]);
}
const atLoad = got.filter((g) => loadT && g.t <= loadT);
await page.waitForTimeout(5000);
const after = got.filter((g) => !loadT || g.t > loadT);
const kb = (a) => (a.reduce((s, g) => s + g.sz, 0) / 1024).toFixed(0);
console.log(`${url} at ${W}x${H}, ${kbps} kbit/s`);
console.log(`load event: ${loadT ? ((loadT - t0) / 1000).toFixed(1) + ' s' : 'not reached'}; ${atLoad.length} requests, ${kb(atLoad)} KB by then`);
console.log(`then, idle 5 s: ${after.length} more requests, ${kb(after)} KB`);
const big = [...atLoad].sort((a, b) => b.sz - a.sz).slice(0, 8);
for (const g of big) console.log(`  ${(g.sz / 1024).toFixed(0).padStart(5)} KB  ${g.url}`);
await browser.close();
server?.close();
