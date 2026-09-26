// Cuts the filmed runs (tests/film.mjs) into the landing page's media and the README's GIFs.
//
//   node tests/film.mjs --shoot hero
//   node tests/film.mjs --shoot day --nobuild
//   node tests/film.mjs --shoot night --nobuild
//   node tests/make-media.mjs
//
// The stalk and snatch clips come from the day run when its evening had them (the filmed evening did:
// a wolf stalked the flock and the bot sprinted in to break up a snatch), so every clip sits on one
// evening's clock; `--shoot wolves` films a staged snatch to fall back on.
//
// Writes site/media/ (the evening scrub frames, MP4 clips with posters, the whole evening,
// chapters.json, the greybox-to-finished stills, milestone stills, the share image) and docs/media/
// (README GIFs). Every clip is placed by an event mark in the run's film.json, so a new recording
// re-cuts itself.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'site/media');
const gifs = path.join(root, 'docs/media');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(gifs, { recursive: true });
const ff = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(2);
const x264 = (crf) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
const r1 = (t) => Math.round(t * 10) / 10;

// Standard's evening (src/game/config.ts): six minutes, wolves from a third of the way in. The rose
// light holds until 40 s before nightfall, then the violet twilight.
const DAY = 360;
const WOLVES = 0.33 * DAY;
const lightAt = (t) => (t < WOLVES ? 'gold' : t < DAY - 40 ? 'rose' : t < DAY - 1 ? 'dusk' : 'night');

function run(name) {
  const dir = path.join(root, `test-results/film-${name}`);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8'));
  const dur = meta.frames / meta.fps;
  /** Film time of the n-th mark with this label, optionally after film time `after`. */
  const at = (label, { after = 0, nth = 0, last = false } = {}) => {
    const ms = meta.marks.filter((m) => m.label === label && m.t >= after);
    const m = last ? ms[ms.length - 1] : ms[nth];
    if (!m) throw new Error(`film-${name}: no mark ${label} after ${after}`);
    return m.t;
  };
  const has = (label) => meta.marks.some((m) => m.label === label);
  // The day clock (the game's own elapsed seconds) at a moment of the film, from the nearest game
  // event (events carry the clock); it stops when the day ends.
  const timed = meta.marks.filter((m) => typeof m.info?.t === 'number');
  const clock = (filmT) => {
    if (!timed.length) return null;
    let best = timed[0];
    for (const m of timed) if (Math.abs(m.t - filmT) < Math.abs(best.t - filmT)) best = m;
    const t = best.info.t + (filmT - best.t);
    return meta.elapsed != null ? Math.min(t, meta.elapsed) : t;
  };
  return { name, file: path.join(dir, 'film.mp4'), meta, dur, at, has, clock };
}

const day = run('day');
const night = run('night');
const wolves = fs.existsSync(path.join(root, 'test-results/film-wolves/film.json')) ? run('wolves') : null;
const need = (r, what) => {
  if (!r) throw new Error(`no ${what} run`);
  return r;
};

// ---------------------------------------------------------------- the evening, frame by frame
// The page scrubs these with the scroll position: the valley from golden hour to night.
{
  const src = path.join(root, 'test-results/film-hero');
  const dir = path.join(out, 'evening');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(src).filter((f) => /^e\d+\.jpg$/.test(f)).sort();
  for (const f of files) ff(['-i', path.join(src, f), '-vf', 'scale=1280:-2:flags=lanczos', '-q:v', '6', path.join(dir, f)]);
  const total = files.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  fs.writeFileSync(path.join(out, 'evening.json'), JSON.stringify({ frames: files.length }));
  console.log(`evening scrub: ${files.length} frames, ${(total / 1e6).toFixed(1)} MB`);
}

// ---------------------------------------------------------------- clips
// name, [run, start (s)], duration (s), poster offset (s from start). A run without the event skips
// the clip (with a note) instead of failing the cut.
const CLIP_DEFS = [
  { name: 'drive', pick: () => [day, day.at('start') + 4, 7], poster: 3.5 },
  { name: 'home', pick: () => [day, day.at('folded') - 3.2, 6.5], poster: 3.6 },
  // the sun going down: from the day run if the bot was still out when it set, else the wolves run
  { name: 'sunset', pick: () => (day.has('dusk') ? [day, day.at('dusk') - 3, 8] : [need(wolves, 'wolves'), wolves.at('dusk') - 3, 8]), poster: 5 },
  { name: 'stalk', pick: () => (day.has('stalkNear') ? [day, day.at('stalkNear') + 0.5, 7] : [need(wolves, 'wolves'), wolves.at('stalkSeen') + 0.5, 7]), poster: 3.5 },
  {
    name: 'snatch',
    pick: () =>
      day.has('grab') && day.has('rescued')
        ? [day, day.at('grab') - 0.5, Math.min(13, day.at('rescued', { after: day.at('grab') }) - day.at('grab') + 3)]
        : [need(wolves, 'wolves'), wolves.at('snatch') - 2.5, Math.min(13, wolves.at('freed') - wolves.at('snatch') + 5)],
    poster: 2.5,
  },
  { name: 'bridge', pick: () => [day, day.at('bridge') - 2.5, 7.5], poster: 3.5 },
  { name: 'win', pick: () => [day, day.at('outcome') - 2.5, 9], poster: 7.5 },
  { name: 'nightfall', pick: () => [night, night.at('nightfall') - 9, 14], poster: 12 },
];
const CLIPS = [];
for (const d of CLIP_DEFS) {
  try {
    const [r, start, dur] = d.pick();
    CLIPS.push({ name: d.name, r, start, dur, poster: d.poster });
  } catch (e) {
    console.log(`skip clip ${d.name}: ${e.message}`);
  }
}
for (const c of CLIPS) {
  c.start = Math.max(0, Math.min(c.start, c.r.dur - c.dur));
  const file = path.join(out, `${c.name}.mp4`);
  ff(['-ss', c.start.toFixed(3), '-t', String(c.dur), '-i', c.r.file, '-vf', 'scale=1280:-2:flags=lanczos', ...x264(24), file]);
  ff(['-ss', (c.start + Math.min(c.poster, c.dur - 0.2)).toFixed(3), '-i', c.r.file, '-frames:v', '1', '-vf', 'scale=1280:-2:flags=lanczos', '-q:v', '4', path.join(out, `${c.name}.jpg`)]);
  console.log(`clip ${c.name} (${c.r.name}): ${c.start.toFixed(1)} s +${c.dur.toFixed(1)}, ${mb(file)} MB`);
}

// ---------------------------------------------------------------- the whole evening, uncut
// Cloudflare Pages takes files up to 25 MiB: 960 wide at 30 fps with a bitrate cap keeps the whole day
// under it (the clips above stay at 60 fps).
{
  const file = path.join(out, 'evening.mp4');
  const kbps = Math.min(1600, Math.floor((23.5 * 8 * 1024) / day.dur));
  ff(['-i', day.file, '-vf', 'fps=30,scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', file]);
  const posterT = day.has('dusk') ? day.at('dusk') + 6 : day.dur * 0.4;
  ff(['-ss', posterT.toFixed(3), '-i', day.file, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', path.join(out, 'evening-run.jpg')]);
  console.log(`whole evening: ${day.dur.toFixed(0)} s at ${kbps} kbit/s cap, ${mb(file)} MB`);
}

// ---------------------------------------------------------------- chapters for the evening recorder
{
  const m = day.meta.marks;
  const timed = m.find((x) => typeof x.info?.t === 'number');
  const start = timed ? Math.max(0, timed.t - timed.info.t) : day.at('start');
  const first = (label) => m.find((x) => x.label === label);
  const events = [];
  const add = (mark, kind, label) => mark && events.push({ t: r1(mark.t), kind, label });
  events.push({ t: r1(day.at('start')), kind: 'start', label: 'Golden hour: the flock is scattered' });
  add(first('bridge'), 'herd', 'Over the bridge');
  add(first('folded'), 'home', 'The first sheep is home');
  add(first('dusk'), 'danger', 'The sun sets and the wolves come out');
  add(first('stalkNear'), 'danger', 'A wolf stalks the flock');
  add(first('grab'), 'danger', 'Snatch!');
  add(first('rescued'), 'save', 'Rescued from the jaws');
  const o = day.meta.outcome;
  // the target met a moment before the end is the end
  if (first('targetMet') && day.at('outcome') - first('targetMet').t > 2) add(first('targetMet'), 'home', 'Target met');
  const endLabel = o?.kind === 'lose' ? 'The day is lost' : o?.reason === 'latched' ? 'The gate is latched' : o?.reason === 'nightfall' ? 'Night falls with the target met' : 'Every sheep is home';
  const end = day.at('outcome');
  events.push({ t: r1(end), kind: 'end', label: endLabel });
  events.sort((a, b) => a.t - b.t);
  const dusk = day.has('dusk') ? day.at('dusk') : null;
  const bands = [];
  if (dusk != null && dusk < end) {
    bands.push({ light: 'gold', from: r1(start), to: r1(dusk) });
    bands.push({ light: 'rose', from: r1(dusk), to: r1(end) });
  } else bands.push({ light: 'gold', from: r1(start), to: r1(end) });
  bands.push({ light: 'end', from: r1(end), to: r1(day.dur) });
  const count = (label) => m.filter((x) => x.label === label).length;
  // each clip's moment on the evening's own clock, and the light it falls in
  const clips = {};
  const lights = {};
  for (const c of CLIPS) {
    const t = c.r.clock(c.start + c.poster);
    if (t == null) continue;
    clips[c.name] = Math.max(0, Math.round(t));
    lights[c.name] = lightAt(t);
  }
  const daySeconds = day.meta.elapsed ?? end - start;
  const data = {
    duration: r1(day.dur),
    start: r1(start),
    available: CLIPS.map((c) => c.name),
    clips,
    lights,
    bands,
    events,
    stats: {
      dayLength: DAY,
      daySeconds: Math.round(daySeconds),
      total: day.meta.total ?? 12,
      folded: day.meta.folded,
      lost: day.meta.lost,
      barks: count('bark'),
      rescues: count('rescued'),
    },
  };
  fs.writeFileSync(path.join(out, 'chapters.json'), JSON.stringify(data, null, 1));
  console.log('chapters:', events.length, 'events', data.stats, clips, lights);
}

// ---------------------------------------------------------------- greybox to finished, on the same beats
// The playtest script takes its shots at the same moments in every milestone, so these line up.
{
  const beats = {
    herding: ['docs/progress/m1-greybox-final-herding.png', 'test-results/m5-close/04-herding.png'],
    latch: ['docs/progress/m1-greybox-final-latch-prompt.png', 'test-results/m5-close/13-latch-prompt.png'],
    night: ['docs/progress/m1-greybox-final-late-night.png', 'test-results/m5-close/17-late-night.png'],
  };
  for (const [b, [grey, final]] of Object.entries(beats)) {
    for (const [s, src] of [
      ['grey', grey],
      ['final', final],
    ]) {
      const f = path.join(root, src);
      if (!fs.existsSync(f)) {
        console.log(`skip evolution ${b}/${s}: no ${src}`);
        continue;
      }
      ff(['-i', f, '-vf', 'scale=1280:-2:flags=lanczos', '-q:v', '4', path.join(out, `evo-${b}-${s}.jpg`)]);
    }
  }
  console.log('evolution stills done');
}

// ---------------------------------------------------------------- one still per milestone
{
  const stills = {
    m1: 'docs/progress/m1-greybox-final-herding.png',
    m2: 'docs/progress/m2-assets-r30-sunset.png',
    m3: 'docs/progress/m3-close-snatch.png',
    m4: 'docs/progress/m4-close-title.png',
    m5: 'docs/progress/m5-close-wolf.png',
  };
  for (const [k, src] of Object.entries(stills)) {
    const f = path.join(root, src);
    if (!fs.existsSync(f)) {
      console.log(`skip milestone still ${k}: no ${src}`);
      continue;
    }
    ff(['-i', f, '-vf', 'scale=640:-2:flags=lanczos', '-q:v', '4', path.join(out, `milestone-${k}.jpg`)]);
  }
}

// ---------------------------------------------------------------- share image: the game's own title
ff(['-i', path.join(root, 'screenshots/01-title.png'), '-vf', 'scale=1200:-2:flags=lanczos,crop=1200:630:0:4', '-q:v', '3', path.join(out, 'og.jpg')]);

// ---------------------------------------------------------------- README GIFs: small, short, one palette each
for (const n of ['drive', 'home', 'sunset', 'stalk', 'snatch', 'win']) {
  const c = CLIPS.find((x) => x.name === n);
  if (!c) continue;
  const dur = Math.min(c.dur, 4.5);
  const start = c.start + Math.max(0, Math.min(c.poster - 2, c.dur - dur));
  const file = path.join(gifs, `${n}.gif`);
  ff(['-ss', start.toFixed(3), '-t', String(dur), '-i', c.r.file, '-vf',
    'fps=12,scale=560:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', file]);
  console.log(`gif ${n}: ${mb(file)} MB`);
}
console.log('done');
