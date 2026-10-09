// Contact sheets ("filmstrips") from a critic capture's periodic frames.
//
//   node tests/critic/sheets.mjs --dir test-results/critic/<label> [--cols 4 --rows 3]
//        [--tile 480x270] [--maxkb 400]
//
// Reads <dir>/frames/f<NNNNN>_<mm>m<ss>s.jpg in time order and lays them out left to right, then top
// to bottom, each tile labelled with its game time (mm:ss, the capture's virtual clock, which is also
// the video's timestamp). Writes <dir>/sheets/sheet-01.jpg ... and <dir>/sheets/index.md.
// Uses ffmpeg-static: scale + drawtext per tile, xstack into the grid, pad the last sheet.

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
const dirArg = opt('dir', null);
if (!dirArg) {
  console.error('usage: node tests/critic/sheets.mjs --dir test-results/critic/<label> [--cols 4 --rows 3]');
  process.exit(2);
}
const dir = path.resolve(root, dirArg);
const cols = Number(opt('cols', 4));
const rows = Number(opt('rows', 3));
const [TW, TH] = opt('tile', '480x270').split('x').map(Number);
const maxBytes = Number(opt('maxkb', 400)) * 1024;
const perSheet = cols * rows;

const framesDir = path.join(dir, 'frames');
const outDir = path.join(dir, 'sheets');
const files = fs
  .readdirSync(framesDir)
  .filter((f) => /^f\d+_\d+m\d+s\.jpg$/.test(f))
  .sort();
if (!files.length) {
  console.error(`no periodic frames in ${framesDir}`);
  process.exit(1);
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Each frame's time: frames/index.json has it exactly; the file name has it to the second.
let index = {};
try {
  for (const e of JSON.parse(fs.readFileSync(path.join(framesDir, 'index.json'), 'utf8'))) index[e.file] = e;
} catch {
  index = {};
}
const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const mmss = (s) => `${pad(s / 60)}:${pad(s % 60)}`;
const timeOf = (f) => {
  if (index[f]) return index[f].video_t;
  const m = f.match(/_(\d+)m(\d+)s\.jpg$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

// drawtext needs a font file. Inside a quoted filter value only ':' needs a backslash.
const fontCandidates = [
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];
const font = fontCandidates.find((f) => fs.existsSync(f));
if (!font) console.warn('warning: no font file found for drawtext, tiles will not be labelled');
const q = (s) => `'${String(s).replace(/\\/g, '/').replace(/'/g, '').replace(/:/g, '\\:')}'`;
const label = (text) =>
  font
    ? `,drawtext=fontfile=${q(font)}:text=${q(text)}:x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=6`
    : '';

const sheets = [];
for (let s = 0; s * perSheet < files.length; s++) {
  const chunk = files.slice(s * perSheet, (s + 1) * perSheet);
  const inputs = chunk.flatMap((f) => ['-i', path.join(framesDir, f)]);
  const parts = chunk.map((f, i) => `[${i}:v]scale=${TW}:${TH}${label(mmss(timeOf(f)))}[t${i}]`);
  const W = cols * TW;
  const H = rows * TH;
  if (chunk.length === 1) {
    parts.push(`[t0]pad=${W}:${H}:0:0:color=0x15121a[out]`);
  } else {
    const layout = chunk.map((_, i) => `${(i % cols) * TW}_${Math.floor(i / cols) * TH}`).join('|');
    const tiles = chunk.map((_, i) => `[t${i}]`).join('');
    parts.push(`${tiles}xstack=inputs=${chunk.length}:layout=${layout}:fill=0x15121a,pad=${W}:${H}:0:0:color=0x15121a[out]`);
  }
  const name = `sheet-${String(s + 1).padStart(2, '0')}.jpg`;
  const out = path.join(outDir, name);
  // JPEG quality about 85, raised step by step until the sheet fits under --maxkb.
  let qv = 3;
  for (;;) {
    const r = spawnSync(
      ffmpeg,
      ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', '-update', '1', '-q:v', String(qv), out],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      console.error(`ffmpeg failed on ${name}:\n${r.stderr}`);
      process.exit(1);
    }
    const size = fs.statSync(out).size;
    if (size <= maxBytes || qv >= 12) {
      sheets.push({ name, from: timeOf(chunk[0]), to: timeOf(chunk[chunk.length - 1]), count: chunk.length, kb: Math.round(size / 1024), qv });
      break;
    }
    qv++;
  }
}

const every = files.length > 1 ? timeOf(files[1]) - timeOf(files[0]) : 0;
const md = [
  '# Contact sheets',
  '',
  `${files.length} frames, one every ${every} s of game time, ${perSheet} to a sheet (${cols} x ${rows}), read left to right, then top to bottom. Each tile shows its game time (mm:ss), which is also the video's timestamp.`,
  '',
  '| Sheet | Game time | Frames |',
  '| --- | --- | --- |',
  ...sheets.map((x) => `| ${x.name} | ${mmss(x.from)} to ${mmss(x.to)} | ${x.count} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'index.md'), md);
for (const x of sheets) console.log(`${x.name}  ${mmss(x.from)} to ${mmss(x.to)}  ${x.count} tiles  ${x.kb} KB (q:v ${x.qv})`);
console.log(`${sheets.length} sheets in ${outDir}`);
