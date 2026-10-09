// Gemini critic: shows the "random gamer" persona (tests/critic/persona.md) a capture of the game
// and asks for a review. The critic sees only the footage and the store blurb.
//
//   video:  node tests/critic/gemini.mjs --video <mp4> --out <dir> --blurb "<store blurb>"
//                [--media "<what the video shows>"] [--model <name>] [--name gemini]
//   images: node tests/critic/gemini.mjs --images <dir | a.jpg,b.jpg,...> --out <dir> --blurb "..."
//                [--media "..."] [--model <name>] [--name gemini-stills]
//   prompt: node tests/critic/gemini.mjs --print-prompt --blurb "<store blurb>" [--media "<...>"]
//                prints the filled-in persona prompt (also what the Claude critics are given)
//
// Video mode uploads the mp4 through the Files API (resumable upload), waits until the file is
// ACTIVE, asks generateContent for JSON and deletes the upload afterwards. Output: <out>/gemini.json.
// Images mode sends JPEGs inline (base64 inline_data parts, each kept under about 1.5 MB, re-encoded
// smaller with ffmpeg when needed) with MEDIA set to "Below are screenshots from the game, in order:
// <names>". A directory is read in capture order when a meta.json beside it lists the stills,
// otherwise by name (contact sheets sort by time). Output: <out>/gemini-stills.json.
// Each reply is saved parsed (<name>.json: the persona's JSON plus critic, model, timing) and whole
// (<name>-raw.json), with any em dash in the critic's prose turned into a spaced hyphen (house rule).
//
// Key: GEMINI_API_KEY from the environment, else from .env.local at the repo root (KEY=VALUE lines;
// .env.* is gitignored). It is sent in the x-goog-api-key header, never in a URL, and is redacted
// from error messages. Without a key the critic is skipped: <out>/<name>-skipped.json, exit code 0.
//
// Model: --model, else GEMINI_MODEL (env or .env.local), each tried alone; otherwise gemini-3.8-flash,
// falling back to gemini-flash-latest and then gemini-3.1-pro-preview when a model is unknown (404,
// 400) or rate limited (429). The reply records the model that answered and every failed attempt.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://generativelanguage.googleapis.com';
const FALLBACK = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-pro-preview'];
const MAX_IMAGE = 1.5 * 1024 * 1024;

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
const log = (...a) => console.log('[gemini]', ...a);

const videoArg = opt('video', null);
const imagesArg = opt('images', null);
const outArg = opt('out', null);
const blurb = opt('blurb', null);
const printOnly = flag('print-prompt');
if (!blurb || (!printOnly && (!outArg || !!videoArg === !!imagesArg))) {
  console.error('usage: node tests/critic/gemini.mjs --video <mp4> --out <dir> --blurb "<store blurb>" [--media "<description>"]');
  console.error('       node tests/critic/gemini.mjs --images <dir | a.jpg,b.jpg> --out <dir> --blurb "<store blurb>" [--media "<description>"]');
  console.error('       node tests/critic/gemini.mjs --print-prompt --blurb "<store blurb>" [--media "<description>"]');
  process.exit(2);
}
const mode = imagesArg ? 'images' : 'video';
const outDir = path.resolve(root, outArg ?? '.');
const name = opt('name', mode === 'images' ? 'gemini-stills' : 'gemini');

/** The images, in order: a comma list as given, or a directory (capture order if meta.json knows it). */
function listImages(arg) {
  if (arg.includes(',') || /\.jpe?g$/i.test(arg)) return arg.split(',').map((f) => path.resolve(root, f.trim())).filter(Boolean);
  const dir = path.resolve(root, arg);
  const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '..', 'meta.json'), 'utf8'));
    const order = (meta.stills ?? []).map((s) => path.basename(s.file));
    const rank = (f) => (order.includes(f) ? order.indexOf(f) : order.length);
    files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  } catch {
    // no meta.json: name order (contact sheets are named in time order)
  }
  return files.map((f) => path.join(dir, f));
}
const images = imagesArg ? listImages(imagesArg) : [];
const video = videoArg ? path.resolve(root, videoArg) : null;

const media = opt(
  'media',
  mode === 'images' ? `Below are screenshots from the game, in order: ${images.map((f) => path.basename(f)).join(', ')}.` : 'Below is a video of someone playing it.',
);

/** KEY=VALUE lines; blank lines and # comments ignored; optional quotes stripped. */
function readEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || line.trim().startsWith('#')) continue;
    env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
const envFile = readEnvFile(path.join(root, '.env.local'));
const apiKey = (process.env.GEMINI_API_KEY || envFile.GEMINI_API_KEY || '').trim();
const chosen = opt('model', process.env.GEMINI_MODEL || envFile.GEMINI_MODEL || null);
const models = chosen ? [chosen] : FALLBACK;

const persona = fs.readFileSync(path.join(root, 'tests', 'critic', 'persona.md'), 'utf8');
const prompt = persona.replaceAll('{{BLURB}}', blurb).replaceAll('{{MEDIA}}', media);
if (printOnly) {
  console.log(prompt);
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const source = mode === 'video' ? rel(video) : images.map(rel);
if (!apiKey) {
  const note = `GEMINI_API_KEY not set: the Gemini ${mode === 'video' ? 'video' : 'stills'} critic is skipped`;
  console.log(note);
  fs.writeFileSync(path.join(outDir, `${name}-skipped.json`), JSON.stringify({ critic: name, skipped: true, note, source, when: new Date().toISOString() }, null, 1));
  process.exit(0);
}
for (const f of mode === 'video' ? [video] : images) {
  if (!fs.existsSync(f)) {
    console.error(`missing input ${f}`);
    process.exit(1);
  }
}
if (mode === 'images' && !images.length) {
  console.error(`no .jpg images in ${imagesArg}`);
  process.exit(1);
}

const keyHeader = { 'x-goog-api-key': apiKey };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s).split(apiKey).join('<key>');

/** fetch that throws a readable error (status and body) on a non-2xx reply. */
async function call(what, url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${what}: HTTP ${res.status} ${redact(body).slice(0, 2000)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** Resumable upload to the Files API; resolves once the file is ACTIVE. */
async function uploadVideo(file, timing) {
  const t0 = Date.now();
  const bytes = fs.readFileSync(file);
  log(`uploading ${path.basename(file)} (${(bytes.length / 1048576).toFixed(1)} MB)`);
  const start = await call('upload start', `${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      ...keyHeader,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': 'video/mp4',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `woolgather-${path.basename(path.dirname(file))}` } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('upload start: no X-Goog-Upload-URL in the reply');
  // One request sends every byte and finalizes; fetch sets Content-Length from the buffer.
  const up = await call('upload', uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: bytes,
  });
  let info = (await up.json()).file;
  if (!info?.name || !info?.uri) throw new Error(`upload: unexpected reply ${JSON.stringify(info)}`);
  uploaded = info.name;
  timing.upload_s = +((Date.now() - t0) / 1000).toFixed(1);
  log(`uploaded as ${info.name} in ${timing.upload_s} s, state ${info.state}`);

  const t1 = Date.now();
  while (info.state !== 'ACTIVE') {
    if (info.state === 'FAILED') throw new Error(`file processing failed: ${JSON.stringify(info.error ?? info)}`);
    if (Date.now() - t1 > 5 * 60 * 1000) throw new Error(`file still ${info.state} after 5 minutes`);
    await sleep(5000);
    info = await (await call('file status', `${API}/v1beta/${info.name}`, { headers: keyHeader })).json();
  }
  timing.processing_s = +((Date.now() - t1) / 1000).toFixed(1);
  log(`file active after ${timing.processing_s} s`);
  return { file_data: { mime_type: 'video/mp4', file_uri: info.uri } };
}

/** A JPEG as an inline part, re-encoded smaller (1280 px wide, then lower quality) if it is too big. */
function imagePart(file) {
  let buf = fs.readFileSync(file);
  for (const [w, q] of [[1280, 4], [1280, 8], [960, 8]]) {
    if (buf.length <= MAX_IMAGE) break;
    const r = spawnSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', `scale='min(${w},iw)':-2`, '-q:v', String(q), '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error(`ffmpeg could not shrink ${file}: ${r.stderr}`);
    buf = r.stdout;
  }
  if (buf.length > MAX_IMAGE) log(`warning: ${path.basename(file)} is still ${(buf.length / 1048576).toFixed(1)} MB`);
  return { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } };
}

/** generateContent down the model list; returns the raw reply and the model that answered. */
async function generate(parts, tried) {
  const request = {
    contents: [{ role: 'user', parts: [...parts, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
  };
  const body = JSON.stringify(request);
  if (body.length > 19 * 1024 * 1024) log(`warning: the request is ${(body.length / 1048576).toFixed(1)} MB (the inline limit is about 20 MB)`);
  for (const m of models) {
    // A server error (5xx) is retried on the same model up to three times; an unknown model
    // (404, 400) or a rate limit (429) moves on to the next model in the list.
    for (let attempt = 1; ; attempt++) {
      try {
        log(`asking ${m}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
        const res = await call(`generateContent ${m}`, `${API}/v1beta/models/${m}:generateContent`, {
          method: 'POST',
          headers: { ...keyHeader, 'Content-Type': 'application/json' },
          body,
        });
        return { raw: await res.json(), model: m };
      } catch (e) {
        if (!e.status) throw e;
        tried.push({ model: m, status: e.status, error: e.message.slice(0, 300) });
        if (e.status >= 500 && attempt < 3) {
          log(`${e.message.slice(0, 200)}; retrying in ${attempt * 15} s`);
          await sleep(attempt * 15000);
          continue;
        }
        if ([400, 404, 429].includes(e.status) || e.status >= 500) {
          log(`${m} did not answer (HTTP ${e.status})`);
          break;
        }
        throw e;
      }
    }
  }
  throw new Error(`no model answered: ${tried.map((t) => `${t.model} HTTP ${t.status}`).join(', ')}`);
}

/** The project never uses em dashes, so the critic's prose gets a spaced hyphen instead. */
const dashFree = (v) =>
  typeof v === 'string'
    ? v.replace(/\s*\u2014\s*/g, ' - ')
    : Array.isArray(v)
      ? v.map(dashFree)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dashFree(x)]))
        : v;

let uploaded = null;
const timing = {};
const tried = [];
const t0 = Date.now();
try {
  log(`${mode} critic, models: ${models.join(', ')}`);
  const parts = mode === 'video' ? [await uploadVideo(video, timing)] : images.map(imagePart);
  if (mode === 'images') log(`${images.length} images: ${images.map((f) => path.basename(f)).join(', ')}`);

  const t2 = Date.now();
  const answer = await generate(parts, tried);
  const raw = dashFree(answer.raw);
  const model = answer.model;
  timing.generate_s = +((Date.now() - t2) / 1000).toFixed(1);
  timing.total_s = +((Date.now() - t0) / 1000).toFixed(1);
  log(`${model} answered in ${timing.generate_s} s`);
  fs.writeFileSync(path.join(outDir, `${name}-raw.json`), JSON.stringify(raw, null, 1));

  // JSON only was asked for, but strip a markdown fence if one slipped in.
  const cand = raw.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error(`empty reply (finishReason ${cand?.finishReason ?? 'none'}, promptFeedback ${JSON.stringify(raw.promptFeedback ?? null)})`);
  const head = { critic: name, mode, model, models_tried: tried, source, media, when: new Date().toISOString(), timing, usage: raw.usageMetadata ?? null };
  let review;
  try {
    review = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch (e) {
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ ...head, error: `unparseable reply: ${e.message}`, text }, null, 1));
    throw new Error(`the reply was not JSON (saved in ${name}.json): ${e.message}`);
  }
  if (typeof review.scores !== 'object') log('warning: the reply has no "scores" object');
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ ...head, ...review }, null, 1));
  log(`review saved to ${path.join(outDir, `${name}.json`)} (${timing.total_s} s in all)`);
  if (review.one_line_review) log(`"${review.one_line_review}"`);
} catch (e) {
  console.error('[gemini] failed:', redact(e.message ?? e));
  process.exitCode = 1;
} finally {
  if (uploaded) await fetch(`${API}/v1beta/${uploaded}`, { method: 'DELETE', headers: keyHeader }).catch(() => {});
}
