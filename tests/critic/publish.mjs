// Copies a capture's critic material into docs/critic/<label>/ (committed), small enough for git.
//
//   node tests/critic/publish.mjs --label <name> [--max-width 1280] [--qv 5]
//
// From test-results/critic/<label>/: stills/*.jpg (re-encoded as JPEG, about quality 80, no wider than
// --max-width), sheets/*.jpg and sheets/index.md (as they are), meta.json and marks.json. The video
// stays in test-results (too big for the repo). Critic replies already in the docs folder
// (gemini.json, video-critic.json, ...) are left alone; stills/ and sheets/ are replaced.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const label = opt('label', null);
if (!label) {
  console.error('usage: node tests/critic/publish.mjs --label <name>');
  process.exit(2);
}
const maxW = Number(opt('max-width', 1280));
const qv = opt('qv', '5');
const src = path.join(root, 'test-results', 'critic', label);
const dst = path.join(root, 'docs', 'critic', label);
if (!fs.existsSync(path.join(src, 'meta.json'))) {
  console.error(`no capture at ${src} (run tests/critic/capture.mjs first)`);
  process.exit(1);
}

for (const d of ['stills', 'sheets']) {
  fs.rmSync(path.join(dst, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(dst, d), { recursive: true });
}

for (const f of fs.readdirSync(path.join(src, 'stills')).filter((f) => f.endsWith('.jpg'))) {
  const r = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-i', path.join(src, 'stills', f), '-vf', `scale='min(${maxW},iw)':-2`, '-q:v', qv, '-frames:v', '1', '-update', '1', path.join(dst, 'stills', f)],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    console.error(`ffmpeg failed on ${f}:\n${r.stderr}`);
    process.exit(1);
  }
}
const sheetsDir = path.join(src, 'sheets');
if (fs.existsSync(sheetsDir)) {
  for (const f of fs.readdirSync(sheetsDir).filter((f) => f.endsWith('.jpg') || f.endsWith('.md'))) fs.copyFileSync(path.join(sheetsDir, f), path.join(dst, 'sheets', f));
} else {
  console.warn('no sheets yet: run tests/critic/sheets.mjs first');
}
for (const f of ['meta.json', 'marks.json']) fs.copyFileSync(path.join(src, f), path.join(dst, f));

let total = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else total += fs.statSync(p).size;
  }
};
walk(dst);
console.log(`published ${label} to ${dst}: ${(total / 1048576).toFixed(2)} MB`);
if (total > 8 * 1048576) console.warn('warning: over 8 MB; lower --qv quality (a higher number) or --max-width');
