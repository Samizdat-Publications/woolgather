// Side-by-side stills of the evening's light with two URL variants (for example the default dusk
// and ?dusk=b), at the same moments, places and camera, with a wolf nearby to judge its contrast.
//
//   node tests/dusk-compare.mjs [--dist dist] [--out test-results/dusk-compare] [--b "dusk=b"]
//        [--evenings lambing,angus,far-bank] [--times 0.45,0.65,0.85,0.97]
//
// Writes <evening>-<t>-a.jpg and -b.jpg plus sheet-<evening>.jpg (a above b, left to right by time).
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const dir = path.resolve(root, opt('dist', 'dist'));
const out = path.resolve(root, opt('out', 'test-results/dusk-compare'));
const B = opt('b', 'dusk=b');
const EVENINGS = opt('evenings', 'lambing,angus,far-bank').split(',');
const TIMES = opt('times', '0.5,0.65,0.85,0.97').split(',').map(Number);
fs.mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
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
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });

async function shoot(variant, extra) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}?test=1&seed=7&quality=high&nocutaway=1${extra ? `&${extra}` : ''}`);
  await page.waitForFunction(() => !!window.__WG, null, { timeout: 120000 });
  await page.evaluate(() => window.__WG.progress('all'));
  for (const ev of EVENINGS) {
    await page.evaluate((e) => window.__WG.evening(e, true), ev);
    await page.waitForTimeout(600);
    const g = await page.evaluate(() => window.__WG.level.sheepGroups.map((q) => q.center));
    const [x, z] = g[Math.min(1, g.length - 1)];
    for (const t of TIMES) {
      await page.evaluate(() => window.__WG.setTimeScale(0.0001));
      await page.evaluate((v) => window.__WG.jumpTo(v), t);
      await page.evaluate(([x, z]) => window.__WG.teleportDog(x + 9, z + 9), [x, z]);
      await page.evaluate(() => window.__WG.wolf('wolf', 13));
      await page.evaluate(() => {
        const h = document.querySelector('.hud');
        if (h) h.style.visibility = 'hidden';
      });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(out, `${ev}-${t}-${variant}.jpg`), type: 'jpeg', quality: 88 });
    }
  }
  await page.close();
}
await shoot('a', '');
await shoot('b', B);
await browser.close();
server.close();
for (const ev of EVENINGS) {
  const files = [...TIMES.map((t) => `${path.join(out, `${ev}-${t}-a.jpg`)}=${ev} t=${t} A (now)`), ...TIMES.map((t) => `${path.join(out, `${ev}-${t}-b.jpg`)}=${ev} t=${t} B (${B})`)];
  execFileSync('python', [path.join(root, 'tools/contact-sheet.py'), path.join(out, `sheet-${ev}.jpg`), String(TIMES.length), '480', ...files]);
}
console.log(`wrote ${out}`);
