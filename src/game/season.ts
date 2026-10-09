import { Rng } from './math';
import { NO_PERKS, type FlockSpec, type Perks, type Rules, type Weather } from './rules';
import type { Sim } from './sim';

// The season: nine evenings on one hill farm from midsummer to the first snow. Each evening adds
// one new thing to herd around, in one of three places, and has a ribbon: an optional challenge.

export interface Evening {
  id: string;
  num: number;
  title: string;
  /** "Midsummer", "First snow": shown on the season map and the intro card. */
  when: string;
  place: string;
  story: string;
  /** The one new thing this evening asks of you (title and how to handle it). */
  newThing?: { title: string; text: string; tip: string };
  ribbon: { title: string; check: (sim: Sim) => boolean };
  rules: Omit<Rules, 'id' | 'perks'>;
}

const everyHome = (s: Sim) => s.folded === s.total;

export const SEASON: Evening[] = [
  {
    id: 'long-light',
    num: 1,
    title: 'Long Light',
    when: 'Midsummer',
    place: 'Hollow Valley',
    story: 'The longest evening of the year. Two small flocks are up by the rocks and the knoll: bring them in before the light goes.',
    newThing: { tip: 'Get behind the sheep and they trot on ahead · hold C to creep', title: 'Herding', text: 'Sheep move away from Pip. Get behind them and they trot on ahead. Hold C to creep up without scaring them.' },
    ribbon: { title: 'Quiet dog: win without barking', check: (s) => s.barks === 0 },
    rules: {
      levelId: 'hollow',
      objective: 'gather',
      dayLength: 110,
      target: 7,
      wolfStart: 0.12,
      maxWolves: 1,
      wolfRespawn: [20, 28],
      wolfSpeedScale: 1,
      flock: [
        { at: 'rocks', ewes: 4 },
        { at: 'knoll', ewes: 4 },
      ],
      weather: 'clear',
      season: 'summer',
      tutorial: true,
      seed: 101,
    },
  },
  {
    id: 'far-bank',
    num: 2,
    title: 'The Far Bank',
    when: 'Midsummer',
    place: 'Hollow Valley',
    story: 'Half the flock has wandered over the stream. Sheep will not swim: bring them back over the bridge or through the shallow ford.',
    newThing: { tip: 'Sheep will not swim: drive them straight at the bridge or the ford · hold Z or X to run round a flock', title: 'Crossings', text: 'Drive the flock straight at the bridge or the ford and it files across. Pip can wade anywhere; the sheep cannot. To get behind a flock without pushing it, hold Z or X: Pip runs round it.' },
    ribbon: { title: 'Daylight to spare: win with a minute left', check: (s) => s.timeLeft >= 60 },
    rules: {
      levelId: 'hollow',
      objective: 'gather',
      dayLength: 140,
      target: 9,
      wolfStart: 0.2,
      maxWolves: 2,
      wolfRespawn: [16, 22],
      wolfSpeedScale: 1,
      flock: [
        { at: 'hillside', ewes: 5 },
        { at: 'farbank-south', ewes: 3 },
        { at: 'meadow', ewes: 3 },
      ],
      weather: 'clear',
      season: 'summer',
      seed: 202,
    },
  },
  {
    id: 'lambing',
    num: 3,
    title: 'Lambing Time',
    when: 'Early summer',
    place: 'Loch Ailsa',
    story: 'The ewes have lambed by the loch. The lambs stay at their mothers\' heels, and the wolves know a lamb is easy prey.',
    newThing: { tip: 'Keep each lamb with its mother · a lost lamb is bleating somewhere on the hill', title: 'Lambs', text: 'Lambs follow their mothers. If a lamb is left behind its mother turns back for it, so keep each pair together. One lamb is lost on the hill: find it and it will follow Pip.' },
    ribbon: { title: 'Find the lost lamb and bring it home', check: (s) => s.sheep.some((q) => q.kind === 'lamb' && q.motherId < 0 && q.state === 'folded') },
    rules: {
      levelId: 'loch',
      objective: 'gather',
      dayLength: 160,
      target: 13,
      wolfStart: 0.2,
      maxWolves: 2,
      wolfRespawn: [14, 20],
      wolfSpeedScale: 1,
      flock: [
        { at: 'north-hill', ewes: 3, lambs: 3 },
        { at: 'promontory', ewes: 3, lambs: 3 },
        { at: 'shore', ewes: 2, lambs: 2 },
      ],
      lostLamb: [72, -58],
      weather: 'clear',
      season: 'summer',
      seed: 303,
    },
  },
  {
    id: 'angus',
    num: 4,
    title: 'Old Angus',
    when: 'High summer',
    place: 'Crannach Corrie',
    story: 'Old Angus has taken the ewes up to the high corrie under the crags. He does not care for collies, and where he goes, the flock goes.',
    newThing: { tip: 'Angus stands his ground: stand still near him or bark (Space) until he gives way', title: 'The ram', text: 'Angus will not be pushed by a running dog: crowd him and he butts Pip away. Stand still near him (or creep) to stare him down, or bark at him. Once he gives way he moves off and the ewes follow him. Wolves keep clear of his horns.' },
    ribbon: { title: 'Bring Angus home', check: (s) => s.sheep.some((q) => q.kind === 'ram' && q.state === 'folded') },
    rules: {
      levelId: 'corrie',
      objective: 'gather',
      dayLength: 185,
      target: 10,
      wolfStart: 0.18,
      maxWolves: 2,
      pack: 'gentle',
      wolfRespawn: [14, 20],
      wolfSpeedScale: 1.02,
      flock: [
        { at: 'tarnside', ewes: 4, ram: true },
        { at: 'east-shelf', ewes: 4 },
        { at: 'screes', ewes: 3 },
      ],
      weather: 'clear',
      season: 'heather',
      seed: 404,
    },
  },
  {
    id: 'show',
    num: 5,
    title: 'The Glenbrae Trial',
    when: 'Late summer',
    place: 'Glenbrae Show Field',
    story: 'The village show, and the whole glen is watching. Five ewes, three pairs of gates and a pen, and the judges count every gate you miss.',
    newThing: {
      tip: 'Fetch the ewes down through the fetch gates · the flag marker shows the next gate',
      title: 'The trial',
      text: 'Fetch the five ewes down through the fetch gates, drive them right through the drive gates, then across through the cross gates, and pen them. A missed gate costs 15 points, a ewe left out of the pen 12, and a slow round a little. No wolves today: just you, the ewes and the clock.',
    },
    ribbon: { title: 'A clean round: every gate, every ewe', check: (s) => s.trialScore() >= 90 },
    rules: {
      levelId: 'show',
      objective: 'trial',
      dayLength: 120,
      target: 5,
      wolfStart: null,
      maxWolves: 0,
      wolfRespawn: [30, 30],
      wolfSpeedScale: 1,
      flock: [{ at: 'lift', ewes: 5 }],
      weather: 'clear',
      season: 'heather',
      seed: 909,
    },
  },
  {
    id: 'night-watch',
    num: 6,
    title: 'Night Watch',
    when: 'Late summer',
    place: 'Loch Ailsa',
    story: 'The pack is hungry and the fold wall is down. Keep the flock together by the loch and keep the wolves off them until the sun comes up.',
    newThing: { tip: 'Turn back every ewe that wanders off and chase off every wolf until the sun comes up', title: 'Until dawn', text: 'No fold tonight: the flock grazes where it is. Ewes wander off into the dark, wolves come from every side, and something in the bracken may scatter them. Keep them together until dawn.' },
    ribbon: { title: 'Not a single sheep lost', check: (s) => s.lost === 0 },
    rules: {
      levelId: 'loch',
      objective: 'watch',
      dayLength: 240,
      target: 11,
      wolfStart: 0.03,
      maxWolves: 7,
      pack: 'full',
      wolfRespawn: [4, 7],
      wolfSpeedScale: 1.12,
      flock: [{ at: 'promontory', ewes: 9, lambs: 3 }],
      dogStart: [-8, 36],
      weather: 'clear',
      season: 'heather',
      seed: 505,
    },
  },
  {
    id: 'mist',
    num: 7,
    title: 'Mist on the Moor',
    when: 'Autumn',
    place: 'The High Pass',
    story: 'The flock is up at the west end of the pass and the mist has come down. You will hear them before you see them.',
    newThing: { tip: 'You can only see a little way: listen for bleating · the map shows where Pip saw them', title: 'Mist', text: 'You can only see a little way. The map only shows sheep Pip has seen lately; listen for bleating. A black sheep is in the flock: it is flighty and bolts when scared.' },
    ribbon: { title: 'Bring the black sheep home', check: (s) => s.sheep.some((q) => q.kind === 'black' && q.state === 'folded') },
    rules: {
      levelId: 'pass',
      objective: 'gather',
      dayLength: 330,
      target: 11,
      wolfStart: 0.2,
      maxWolves: 2,
      wolfRespawn: [14, 20],
      wolfSpeedScale: 1,
      flock: [
        { at: 'west-fold', ewes: 5, black: 1 },
        { at: 'west-moor', ewes: 4 },
        { at: 'crags', ewes: 3 },
      ],
      weather: 'fog',
      season: 'autumn',
      seed: 606,
    },
  },
  {
    id: 'storm',
    num: 8,
    title: 'The Storm',
    when: 'Autumn',
    place: 'Hollow Valley',
    story: 'A storm is coming up the valley. Thunder scatters the flock, and when the stream rises the ford will be gone.',
    newThing: { tip: 'Thunder scatters the flock · the ford will flood halfway through: use the bridge', title: 'Thunder and flood', text: 'Each thunderclap sends the sheep bolting: gather them again. Halfway through the evening the stream floods and the ford closes; only the bridge is left.' },
    ribbon: { title: 'Every sheep home', check: everyHome },
    rules: {
      levelId: 'hollow',
      objective: 'gather',
      dayLength: 240,
      target: 11,
      wolfStart: 0.2,
      maxWolves: 3,
      pack: 'full',
      wolfRespawn: [12, 18],
      wolfSpeedScale: 1,
      flock: [
        { at: 'farbank-north', ewes: 4 },
        { at: 'farbank-south', ewes: 4 },
        { at: 'grove', ewes: 3 },
        { at: 'knoll', ewes: 3 },
      ],
      weather: 'storm',
      season: 'autumn',
      floodAt: 0.38,
      thunder: [22, 36],
      seed: 707,
    },
  },
  {
    id: 'gather',
    num: 9,
    title: 'The Gathering',
    when: 'Late autumn',
    place: 'The High Pass',
    story: "Every flock on the hill comes down to the farm for the winter, the whole length of the pass. Old Fly, Pip's mother, comes out to help one last time.",
    newThing: { tip: 'F sends Fly to lie down where Pip stands · F again calls her back', title: 'Old Fly', text: 'Press F: Fly lies down where Pip stands and holds that spot, and the sheep keep off it. Press F again to call her back to heel. Lay her across a gap or beside a crossing and the flock cannot break that way while Pip fetches the next one.' },
    ribbon: { title: 'Not one lost on the way down', check: (s) => s.lost === 0 },
    rules: {
      levelId: 'pass',
      objective: 'gather',
      dayLength: 480,
      target: 18,
      wolfStart: 0.2,
      maxWolves: 3,
      pack: 'gentle',
      wolfRespawn: [12, 18],
      wolfSpeedScale: 1,
      flock: [
        { at: 'west-fold', ewes: 5 },
        { at: 'west-moor', ewes: 5 },
        { at: 'crags', ewes: 4 },
        { at: 'midglen', ewes: 4 },
        { at: 'east-moor', ewes: 4 },
      ],
      weather: 'clear',
      season: 'autumn',
      fly: true,
      seed: 1010,
    },
  },
  {
    id: 'first-snow',
    num: 10,
    title: 'First Snow',
    when: 'Winter',
    place: 'The High Pass',
    story: 'The first snow is falling and the wolves are hungrier than ever. Bring the whole flock, Angus and all, down the pass to the winter fold.',
    newThing: { tip: 'A long drove over two burns: Angus leads, the black sheep bolts, the pack is hungry', title: 'Everything at once', text: 'Angus, the black sheep, a long drove over two burns, and the biggest pack of the year.' },
    ribbon: { title: 'Angus and the black sheep both home', check: (s) => s.sheep.filter((q) => (q.kind === 'ram' || q.kind === 'black') && q.state === 'folded').length >= 2 },
    rules: {
      levelId: 'pass',
      objective: 'gather',
      dayLength: 440,
      target: 12,
      wolfStart: 0.16,
      maxWolves: 3,
      pack: 'full',
      wolfRespawn: [12, 16],
      wolfSpeedScale: 1.08,
      flock: [
        { at: 'west-fold', ewes: 5, ram: true },
        { at: 'west-moor', ewes: 4, black: 1 },
        { at: 'crags', ewes: 3 },
        { at: 'midglen', ewes: 2 },
      ],
      weather: 'snow',
      season: 'winter',
      seed: 808,
    },
  },
];

export interface Charm {
  id: string;
  title: string;
  text: string;
  /** Total stars needed to unlock it. */
  stars: number;
  perks: Partial<Perks>;
  /** A charm that adds something to do, not a number: Fly the old dog, or the outrun. */
  verb?: 'fly' | 'outrun' | 'bell';
}

export const CHARMS: Charm[] = [
  { id: 'swift', title: 'Swift Paws', text: 'Pip runs 8% faster.', stars: 2, perks: { speed: 1.08 } },
  { id: 'wind', title: 'Second Wind', text: 'Sprinting tires Pip 30% less.', stars: 5, perks: { staminaDrain: 0.7 } },
  { id: 'gruff', title: 'Gruff Bark', text: 'Barks carry 30% further and come back sooner.', stars: 9, perks: { barkRadius: 1.3, barkCooldown: 0.85 } },
  { id: 'outrun', title: 'The Outrun', text: 'Hold Z and X together: Pip runs wide round to the far side of the nearest loose flock.', stars: 7, perks: {}, verb: 'outrun' },
  { id: 'eye', title: 'Steady Eye', text: 'Rams give way faster; creeping is calmer still.', stars: 13, perks: { eye: 1.7, creep: 0.8 } },
  { id: 'bell', title: 'The Bell-wether', text: 'The oldest ewe of the biggest flock wears a bell: her flock keeps close round her, you hear her through mist and dark, and she is always on the map.', stars: 22, perks: {}, verb: 'bell' },
  { id: 'fly', title: 'Old Fly', text: "Pip's mother comes along. Press F: she lies down where Pip stands and holds it (sheep keep off, wolves stay away). F again calls her back.", stars: 16, perks: {}, verb: 'fly' },
];

/** The verb charms a set of worn charms brings (Fly, the outrun). */
export function verbsFor(ids: string[]) {
  const v = new Set(ids.map((id) => CHARMS.find((c) => c.id === id)?.verb).filter(Boolean));
  return { fly: v.has('fly'), outrun: v.has('outrun'), bell: v.has('bell') };
}

/** Two charms may be worn once this many stars are earned. */
export const SECOND_CHARM_STARS = 12;
/** And three once this many (Wolf Moon stars count). */
export const THIRD_CHARM_STARS = 30;

export function perksFor(ids: string[]): Perks {
  const p = { ...NO_PERKS };
  for (const id of ids) {
    const c = CHARMS.find((q) => q.id === id);
    if (!c) continue;
    for (const [k, v] of Object.entries(c.perks)) p[k as keyof Perks] *= v as number;
  }
  return p;
}

// ---------------------------------------------------------------- progress (saved in the browser)

/** best: most sheep home; time: fastest win in seconds (gather); score: best trial points. */
export interface EveningRecord {
  stars: number;
  ribbon: boolean;
  best?: number;
  time?: number;
  score?: number;
}

export interface Progress {
  /** Each evening's record; `moon` is its Wolf Moon record, kept apart. */
  evenings: Record<string, EveningRecord & { moon?: EveningRecord }>;
  charms: string[];
  /** The last evening played (the season map opens on it). */
  last?: string;
  /** Pip's coat (an id from COATS). */
  coat?: string;
}

/** Pip's coats: the black and white he is born with, and more won with ribbons and Wolf Moon stars. */
export const COATS: { id: string; title: string; color: string; ribbons?: number; moon?: number }[] = [
  { id: 'black', title: 'Black and white', color: '#2a2e3c' },
  { id: 'red', title: 'Red and white', color: '#7c3c22', ribbons: 3 },
  { id: 'merle', title: 'Blue merle', color: '#6e7888', ribbons: 6 },
  { id: 'sable', title: 'Sable', color: '#9a6a34', moon: 6 },
  { id: 'slate', title: 'Moonlit slate', color: '#3e4658', moon: 15 },
];
export function coatOpen(p: Progress, id: string) {
  const c = COATS.find((q) => q.id === id);
  return !!c && totalRibbons(p) >= (c.ribbons ?? 0) && moonStars(p) >= (c.moon ?? 0);
}

const KEY = 'woolgather.season.v1';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (p && typeof p === 'object' && p.evenings) return { evenings: p.evenings, charms: Array.isArray(p.charms) ? p.charms : [], last: p.last, coat: typeof p.coat === 'string' ? p.coat : undefined };
    }
  } catch {
    // Storage blocked or corrupt: a fresh season.
  }
  return { evenings: {}, charms: [] };
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Not remembered: fine.
  }
}

/** The season's own evenings (today's evening keeps its best apart and earns no charms). */
const seasonRecords = (p: Progress) => Object.entries(p.evenings).filter(([id]) => !id.startsWith('daily-')).map(([, e]) => e);
/** Every star earned, Wolf Moon stars included (charms are bought with these). */
export function totalStars(p: Progress) {
  return seasonRecords(p).reduce((a, e) => a + e.stars + (e.moon?.stars ?? 0), 0);
}
export function moonStars(p: Progress) {
  return seasonRecords(p).reduce((a, e) => a + (e.moon?.stars ?? 0), 0);
}

// ---------------------------------------------------------------- Wolf Moon

/** An evening's Wolf Moon opens once it has three stars (the season's own evenings only). */
export function moonOpen(p: Progress, ev: Evening) {
  return !ev.id.startsWith('daily') && SEASON.includes(ev) && (p.evenings[ev.id]?.stars ?? 0) >= 3;
}

/**
 * The Wolf Moon: the same evening, harder. A shorter evening, the wolves out sooner, one more of
 * them, hunting as a full pack, and one more sheep needed. The trial becomes a championship course
 * (less time, judged strictly); the night watch a longer night.
 */
export function moonRules<R extends Omit<Rules, 'id' | 'perks'>>(r: R): R {
  const total = r.flock.reduce((a, g) => a + g.ewes + (g.lambs ?? 0) + (g.ram ? 1 : 0) + (g.black ?? 0), 0) + (r.lostLamb ? 1 : 0);
  if (r.objective === 'trial') return { ...r, dayLength: Math.round(r.dayLength * 0.8), strict: true };
  if (r.objective === 'watch') return { ...r, dayLength: Math.round(r.dayLength * 1.25), maxWolves: r.maxWolves + 1, wolfRespawn: [r.wolfRespawn[0] * 0.8, r.wolfRespawn[1] * 0.8], pack: 'full', target: Math.min(total - 1, r.target + 1) };
  return {
    ...r,
    dayLength: Math.round(r.dayLength * 0.82),
    wolfStart: r.wolfStart === null ? null : r.wolfStart * 0.6,
    maxWolves: r.maxWolves + 1,
    wolfRespawn: [r.wolfRespawn[0] * 0.6, r.wolfRespawn[1] * 0.6],
    wolfSpeedScale: r.wolfSpeedScale * 1.1,
    pack: 'full',
    // One more sheep needed, but never the whole flock: a single loss must not end the evening.
    target: Math.max(r.target, Math.min(total - 1, r.target + 1)),
  };
}
export function totalRibbons(p: Progress) {
  return seasonRecords(p).filter((e) => e.ribbon).length;
}

/** An evening is open once the one before it has been won (the first is always open). */
export function unlocked(p: Progress, i: number) {
  return i === 0 || (p.evenings[SEASON[i - 1].id]?.stars ?? 0) > 0;
}

// ---------------------------------------------------------------- today's evening

/** Where today's evening may be: the place, its flocks, and the weather that suits it. */
const DAILY_PLACES: { levelId: string; place: string; groups: string[]; weather: Weather[]; extra: number }[] = [
  { levelId: 'hollow', place: 'Hollow Valley', groups: ['meadow', 'grove', 'hillside', 'rocks', 'farm', 'knoll', 'farbank-north', 'farbank-south'], weather: ['clear', 'clear', 'storm'], extra: 0 },
  { levelId: 'loch', place: 'Loch Ailsa', groups: ['north-hill', 'promontory', 'shore', 'east-shore', 'rocks'], weather: ['clear', 'clear', 'fog'], extra: 20 },
  { levelId: 'corrie', place: 'Crannach Corrie', groups: ['upper-west', 'tarnside', 'east-shelf', 'screes'], weather: ['clear', 'fog'], extra: 30 },
  { levelId: 'pass', place: 'The High Pass', groups: ['west-moor', 'crags', 'midglen', 'east-moor'], weather: ['clear', 'fog'], extra: 90 },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Today's date as a key (local time): the same evening for everyone on the same day. */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Today's evening: made from the date, so it is the same all day and new tomorrow. A place, the
 * real season (spring brings lambs, winter snow), the weather, two or three flocks, sometimes a ram
 * or a black sheep, and a ribbon.
 */
export function dailyEvening(date = new Date()): Evening {
  const key = dayKey(date);
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rng = new Rng(h >>> 0);
  const where = rng.pick(DAILY_PLACES);
  const m = date.getMonth();
  const season: Rules['season'] = m === 11 || m <= 1 ? 'winter' : m === 8 ? 'heather' : m >= 9 ? 'autumn' : 'summer';
  const weather: Weather = season === 'winter' ? 'snow' : rng.pick(where.weather);
  const spring = m >= 2 && m <= 5;
  const groups = [...where.groups];
  const n = where.levelId === 'pass' ? 2 : rng.int(2, 3);
  const flock: FlockSpec[] = [];
  for (let i = 0; i < n; i++) {
    const at = groups.splice(rng.int(0, groups.length - 1), 1)[0];
    flock.push({ at, ewes: rng.int(3, 5) });
  }
  if (spring || rng.next() < 0.3) flock[0].lambs = rng.int(2, 3);
  if (rng.next() < 0.3) flock[rng.int(0, n - 1)].ram = true;
  if (rng.next() < 0.35) flock[rng.int(0, n - 1)].black = 1;
  const total = flock.reduce((a, g) => a + g.ewes + (g.lambs ?? 0) + (g.ram ? 1 : 0) + (g.black ?? 0), 0);
  const ribbons = [
    { title: 'Not a single sheep lost', check: (s: Sim) => s.lost === 0 },
    { title: 'Every sheep home', check: everyHome },
    { title: 'Quiet dog: win without barking', check: (s: Sim) => s.barks === 0 },
  ];
  const sky = weather === 'storm' ? 'A storm is coming in over the hill.' : weather === 'fog' ? 'The mist is down: listen for them.' : weather === 'snow' ? 'Snow on the hill tonight.' : 'A clear evening.';
  const extras = [flock.some((g) => g.lambs) ? 'lambs at heel' : '', flock.some((g) => g.ram) ? 'a ram' : '', flock.some((g) => g.black) ? 'a black sheep' : ''].filter(Boolean);
  return {
    id: `daily-${key}`,
    num: 0,
    title: `${WEEKDAYS[date.getDay()]}'s Evening`,
    when: `${date.getDate()} ${MONTHS[m]}`,
    place: where.place,
    story: `${sky} ${n === 2 ? 'Two' : 'Three'} flocks are out${extras.length ? `, with ${extras.join(' and ')}` : ''}. A new evening every day: come back tomorrow for another.`,
    ribbon: rng.pick(ribbons),
    rules: {
      levelId: where.levelId,
      objective: 'gather',
      dayLength: Math.round(140 + 55 * n + where.extra * 0.6 + (weather === 'fog' || weather === 'snow' ? 40 : 0)),
      target: Math.round(total * 0.82),
      wolfStart: rng.range(0.16, 0.22),
      maxWolves: n,
      pack: n >= 3 ? 'gentle' : undefined,
      wolfRespawn: [14, 22],
      wolfSpeedScale: 1,
      flock,
      weather,
      season,
      ...(weather === 'storm' ? { floodAt: 0.4, thunder: [24, 38] as [number, number] } : {}),
      seed: (h >>> 0) % 100000,
    },
  };
}
