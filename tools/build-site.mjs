#!/usr/bin/env node
/**
 * Builds the public site into site-dist/:
 *
 *   site-dist/          the landing page (site/), its media in site-dist/media/
 *   site-dist/play/     the game, built with base /play/
 *   functions/          (deployed alongside) byte ranges for the videos, for Safari
 *
 *   node tools/build-site.mjs            build
 *   node tools/build-site.mjs --deploy   build, then deploy to Cloudflare Pages (project woolgather)
 *
 * The page's media comes from tests/film.mjs and tests/make-media.mjs (see the README).
 */
import { build } from 'vite';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'site-dist');
fs.rmSync(out, { recursive: true, force: true });

await build({ root, base: '/play/', logLevel: 'warn', build: { outDir: path.join(out, 'play'), emptyOutDir: true } });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });

// The landing page uses the game's own fonts, straight from the npm packages (no runtime font service).
const fonts = path.join(out, 'fonts');
fs.mkdirSync(fonts, { recursive: true });
const fraunces = path.join(root, 'node_modules/@fontsource-variable/fraunces/files');
const nunito = path.join(root, 'node_modules/@fontsource-variable/nunito/files');
fs.copyFileSync(path.join(fraunces, 'fraunces-latin-soft-normal.woff2'), path.join(fonts, 'fraunces-soft.woff2'));
fs.copyFileSync(path.join(fraunces, 'fraunces-latin-soft-italic.woff2'), path.join(fonts, 'fraunces-soft-italic.woff2'));
fs.copyFileSync(path.join(nunito, 'nunito-latin-wght-normal.woff2'), path.join(fonts, 'nunito.woff2'));
fs.copyFileSync(path.join(nunito, 'nunito-latin-wght-italic.woff2'), path.join(fonts, 'nunito-italic.woff2'));

// Long cache for media and fonts, a day for the game's files (the models keep their names between
// builds), and the pages themselves revalidate (Cloudflare Pages _headers file).
fs.writeFileSync(
  path.join(out, '_headers'),
  ['/media/*', '  Cache-Control: public, max-age=604800', '/fonts/*', '  Cache-Control: public, max-age=31536000, immutable', '/play/assets/*', '  Cache-Control: public, max-age=86400', ''].join('\n'),
);

// Only the videos go through the byte-range function (functions/media/[[path]].js): Pages serves static
// files whole, which Safari will not play video from. Everything else stays a plain static file.
const videos = fs.readdirSync(path.join(out, 'media')).filter((f) => f.endsWith('.mp4')).map((f) => `/media/${f}`);
fs.writeFileSync(path.join(out, '_routes.json'), JSON.stringify({ version: 1, include: videos, exclude: [] }, null, 1));
// ...and the function needs each video's size (the asset store streams files without one)
const sizes = Object.fromEntries(videos.map((v) => [v, fs.statSync(path.join(out, v)).size]));
fs.writeFileSync(path.join(root, 'functions/media/sizes.json'), `${JSON.stringify(sizes, null, 1)}
`);

const files = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
const bytes = files.reduce((s, d) => s + fs.statSync(path.join(d.parentPath, d.name)).size, 0);
console.log(`site-dist: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
// Cloudflare Pages refuses files over 25 MiB and projects over 20,000 files.
for (const d of files) {
  const f = path.join(d.parentPath, d.name);
  if (fs.statSync(f).size > 25 * 1024 * 1024) throw new Error(`${f} is over the 25 MiB Cloudflare Pages limit`);
}

if (process.argv.includes('--deploy')) {
  execSync('npx --yes wrangler@4 pages deploy site-dist --project-name woolgather --branch main --commit-dirty=true', { cwd: root, stdio: 'inherit' });
}
