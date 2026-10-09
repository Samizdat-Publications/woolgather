// One critic round after a capture: contact sheets, publish to docs/critic/<label>/, a lighter mp4
// for Gemini, the Gemini video and stills critics, and the scoreboard. The two Claude critics (blind
// subagents reading the sheets and the stills) are run by the session afterwards.
//
//   node tests/critic/round.mjs --label r01-season --blurb "<store blurb>" [--media "<what the video shows>"]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const label = opt('label');
const blurb = opt('blurb', 'Woolgather. You are Pip, a border collie. Herd the flock home before nightfall.');
const media = opt('media', 'Below is a video of someone playing it.');
if (!label) throw new Error('--label is required');
const cap = path.join(root, 'test-results', 'critic', label);
const doc = path.join(root, 'docs', 'critic', label);

const run = (what, cmd, cmdArgs) => {
  const t0 = Date.now();
  console.log(`[round] ${what}...`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' });
  console.log(`[round] ${what}: exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return r.status === 0;
};

run('contact sheets', process.execPath, ['tests/critic/sheets.mjs', '--dir', cap]);
run('publish', process.execPath, ['tests/critic/publish.mjs', '--label', label]);
// Gemini samples video at about one frame a second: a 960 px copy uploads much faster.
const small = path.join(cap, 'video-960.mp4');
if (!fs.existsSync(small)) run('small video', ffmpeg, ['-y', '-loglevel', 'error', '-i', path.join(cap, 'video.mp4'), '-vf', 'scale=960:-2', '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-an', small]);
run('gemini video', process.execPath, ['tests/critic/gemini.mjs', '--video', small, '--out', doc, '--blurb', blurb, '--media', media]);
run('gemini stills', process.execPath, ['tests/critic/gemini.mjs', '--images', path.join(doc, 'stills'), '--out', doc, '--blurb', blurb]);
run('scoreboard', process.execPath, ['tests/critic/report.mjs']);
const sheets = fs.existsSync(path.join(doc, 'sheets')) ? fs.readdirSync(path.join(doc, 'sheets')).filter((f) => f.endsWith('.jpg')) : [];
const stills = fs.existsSync(path.join(doc, 'stills')) ? fs.readdirSync(path.join(doc, 'stills')).filter((f) => f.endsWith('.jpg')) : [];
console.log(`[round] for the Claude critics: ${sheets.length} sheets, ${stills.length} stills in ${doc}`);
