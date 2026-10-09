// Quick look: open the dev server (or --url), run a list of steps, save screenshots, print console
// errors. For development checks, not the self-test.
//
//   node tests/shot.mjs --out test-results/shots "<step>" "<step>" ...
//
// Steps: "wait:<seconds>", "shot:<name>", "key:<Key>", "eval:<js expression>", "fast:<k>" (time scale),
// "play:<seconds>" (wait, then a shot named by the time).

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = opt('out', 'test-results/shots');
const url = opt('url', 'http://localhost:5317/?test=1&seed=11&quality=high');
const width = Number(opt('width', 1280));
const height = Number(opt('height', 720));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  if (m.type() === 'info' && m.text().startsWith('[woolgather]')) console.log(m.text());
});
await page.goto(url);
await page.waitForFunction(() => !!window.__WG, null, { timeout: 120000 });
await page.waitForTimeout(1500);
for (const step of args) {
  const [cmd, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (cmd === 'wait') await page.waitForTimeout(Number(arg) * 1000);
  else if (cmd === 'shot') {
    await page.screenshot({ path: path.join(out, `${arg}.png`) });
    console.log('shot', arg);
  } else if (cmd === 'key') await page.keyboard.press(arg);
  else if (cmd === 'eval') console.log('eval', arg.slice(0, 60), '=>', JSON.stringify(await page.evaluate(arg)).slice(0, 400));
  else if (cmd === 'fast') await page.evaluate((k) => window.__WG.setTimeScale(k), Number(arg));
}
console.log('errors:', errors.length ? errors.slice(0, 12).join('\n  ') : 'none');
await browser.close();
