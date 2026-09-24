// Copies chosen playtest screenshots into docs/progress/ with a milestone/round prefix and appends
// captions to docs/progress/PROGRESS.md, so the build's evolution is tracked in the repo.
//
//   node tools/save-progress.mjs <runDir> <label> "<file>=<caption>" ["<file>=<caption>" ...]
//   e.g. node tools/save-progress.mjs test-results/m1-r2 m1-r2 "03-herding.png=River and path visible"

import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [runDir, label, ...pairs] = process.argv.slice(2);
if (!runDir || !label || pairs.length === 0) {
  console.error('usage: node tools/save-progress.mjs <runDir> <label> "<file>=<caption>" ...');
  process.exit(1);
}
const outDir = resolve('docs/progress');
mkdirSync(outDir, { recursive: true });
const log = join(outDir, 'PROGRESS.md');
if (!existsSync(log)) {
  writeFileSync(log, '# Woolgather progress screenshots\n\nCaptured from the player camera by the Playwright self-test after each milestone round.\n');
}
const date = new Date().toISOString().slice(0, 10);
let md = `\n## ${label} (${date})\n\n`;
for (const pair of pairs) {
  const eq = pair.indexOf('=');
  const file = eq >= 0 ? pair.slice(0, eq) : pair;
  const caption = eq >= 0 ? pair.slice(eq + 1) : '';
  const name = `${label}-${basename(file).replace(/^\d+-/, '')}`;
  copyFileSync(join(runDir, file), join(outDir, name));
  md += `![${caption || name}](${name})\n*${caption}*\n\n`;
  console.log(`saved ${name}`);
}
appendFileSync(log, md);
