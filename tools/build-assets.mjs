// npm run assets: regenerate every model from blender_scripts/ with a headless Blender.
// Blender is found via BLENDER_PATH, then PATH, then the default Windows install location.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function findBlender() {
  if (process.env.BLENDER_PATH && existsSync(process.env.BLENDER_PATH)) return process.env.BLENDER_PATH;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0];
  const base = 'C:\\Program Files\\Blender Foundation';
  if (existsSync(base)) {
    const versions = readdirSync(base).filter((d) => d.startsWith('Blender')).sort().reverse();
    for (const v of versions) {
      const exe = join(base, v, 'blender.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

const blender = findBlender();
if (!blender) {
  console.error('Blender not found. Install Blender 5.x or set BLENDER_PATH.');
  process.exit(1);
}
const extra = process.argv.includes('--preview') ? ['--', '--preview'] : [];
console.log(`Using ${blender}`);
const r = spawnSync(blender, ['--background', '--factory-startup', '--python', join('blender_scripts', 'build_all.py'), ...extra], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
