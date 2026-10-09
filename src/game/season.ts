import { NO_PERKS, type Perks, type Rules } from './rules';
import type { Sim } from './sim';

// The season: eight evenings on one hill farm from midsummer to the first snow. Each evening adds
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
    story: 'The longest evening of the year. Two small flocks are out by the farm: bring them in before the light goes.',
    newThing: { tip: 'Get behind the sheep and they trot on ahead · hold C to creep', title: 'Herding', text: 'Sheep move away from Pip. Get behind them and they trot on ahead. Hold C to creep up without scaring them.' },
    ribbon: { title: 'Quiet dog: win without barking', check: (s) => s.barks === 0 },
    rules: {
      levelId: 'hollow',
      objective: 'gather',
      dayLength: 270,
      target: 6,
      wolfStart: 0.62,
      maxWolves: 1,
      wolfRespawn: [30, 40],
      wolfSpeedScale: 0.85,
      flock: [
        { at: 'meadow', ewes: 4 },
        { at: 'farm', ewes: 4 },
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
    newThing: { tip: 'Sheep will not swim: drive them straight at the bridge or the ford', title: 'Crossings', text: 'Drive the flock straight at the bridge or the ford and it files across. Pip can wade anywhere; the sheep cannot.' },
    ribbon: { title: 'Daylight to spare: win with a minute left', check: (s) => s.timeLeft >= 60 },
    rules: {
      levelId: 'hollow',
      objective: 'gather',
      dayLength: 330,
      target: 8,
      wolfStart: 0.45,
      maxWolves: 1,
      wolfRespawn: [22, 30],
      wolfSpeedScale: 0.9,
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
      dayLength: 380,
      target: 11,
      wolfStart: 0.4,
      maxWolves: 2,
      wolfRespawn: [18, 24],
      wolfSpeedScale: 0.95,
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
    place: 'Hollow Valley',
    story: 'Old Angus the ram is out with the ewes, and he does not care for collies. Where he goes, the flock goes.',
    newThing: { tip: 'Angus stands his ground: stand still near him or bark (Space) until he gives way', title: 'The ram', text: 'Angus will not be pushed by a running dog: crowd him and he butts Pip away. Stand still near him (or creep) to stare him down, or bark at him. Once he gives way he moves off and the ewes follow him. Wolves keep clear of his horns.' },
    ribbon: { title: 'Bring Angus home', check: (s) => s.sheep.some((q) => q.kind === 'ram' && q.state === 'folded') },
    rules: {
      levelId: 'hollow',
      objective: 'gather',
      dayLength: 380,
      target: 9,
      wolfStart: 0.35,
      maxWolves: 2,
      wolfRespawn: [16, 22],
      wolfSpeedScale: 1,
      flock: [
        { at: 'meadow', ewes: 4, ram: true },
        { at: 'grove', ewes: 4 },
        { at: 'rocks', ewes: 3 },
      ],
      weather: 'clear',
      season: 'heather',
      seed: 404,
    },
  },
  {
    id: 'night-watch',
    num: 5,
    title: 'Night Watch',
    when: 'Late summer',
    place: 'Loch Ailsa',
    story: 'The pack is hungry and the fold wall is down. Keep the flock together by the loch and keep the wolves off them until the sun comes up.',
    newThing: { tip: 'Keep the flock bunched and chase off every wolf until the sun comes up', title: 'Until dawn', text: 'No fold tonight: the flock grazes where it is. Wolves come from every side. Keep the sheep bunched and chase off every wolf until dawn.' },
    ribbon: { title: 'Not a single sheep lost', check: (s) => s.lost === 0 },
    rules: {
      levelId: 'loch',
      objective: 'watch',
      dayLength: 240,
      target: 9,
      wolfStart: 0.03,
      maxWolves: 3,
      wolfRespawn: [9, 13],
      wolfSpeedScale: 1,
      flock: [{ at: 'promontory', ewes: 9, lambs: 3 }],
      dogStart: [-8, 36],
      weather: 'clear',
      season: 'heather',
      seed: 505,
    },
  },
  {
    id: 'mist',
    num: 6,
    title: 'Mist on the Moor',
    when: 'Autumn',
    place: 'The High Pass',
    story: 'The flock is up at the west end of the pass and the mist has come down. You will hear them before you see them.',
    newThing: { tip: 'You can only see a little way: listen for bleating · the map shows where Pip saw them', title: 'Mist', text: 'You can only see a little way. The map only shows sheep Pip has seen lately; listen for bleating. A black sheep is in the flock: it is flighty and bolts when scared.' },
    ribbon: { title: 'Bring the black sheep home', check: (s) => s.sheep.some((q) => q.kind === 'black' && q.state === 'folded') },
    rules: {
      levelId: 'pass',
      objective: 'gather',
      dayLength: 440,
      target: 10,
      wolfStart: 0.4,
      maxWolves: 2,
      wolfRespawn: [16, 22],
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
    num: 7,
    title: 'The Storm',
    when: 'Autumn',
    place: 'Hollow Valley',
    story: 'A storm is coming up the valley. Thunder scatters the flock, and when the stream rises the ford will be gone.',
    newThing: { tip: 'Thunder scatters the flock · the ford will flood halfway through: use the bridge', title: 'Thunder and flood', text: 'Each thunderclap sends the sheep bolting: gather them again. Halfway through the evening the stream floods and the ford closes; only the bridge is left.' },
    ribbon: { title: 'Every sheep home', check: everyHome },
    rules: {
      levelId: 'hollow',
      objective: 'gather',
      dayLength: 390,
      target: 10,
      wolfStart: 0.42,
      maxWolves: 2,
      wolfRespawn: [16, 22],
      wolfSpeedScale: 1,
      flock: [
        { at: 'farbank-north', ewes: 4 },
        { at: 'farbank-south', ewes: 4 },
        { at: 'grove', ewes: 3 },
        { at: 'knoll', ewes: 3 },
      ],
      weather: 'storm',
      season: 'autumn',
      floodAt: 0.45,
      thunder: [22, 36],
      seed: 707,
    },
  },
  {
    id: 'first-snow',
    num: 8,
    title: 'First Snow',
    when: 'Winter',
    place: 'The High Pass',
    story: 'The first snow is falling and the wolves are hungrier than ever. Bring the whole flock, Angus and all, down the pass to the winter fold.',
    newThing: { tip: 'A long drove over two burns: Angus leads, the black sheep bolts, the pack is hungry', title: 'Everything at once', text: 'Angus, the black sheep, a long drove over two burns, and the biggest pack of the year.' },
    ribbon: { title: 'Angus and the black sheep both home', check: (s) => s.sheep.filter((q) => (q.kind === 'ram' || q.kind === 'black') && q.state === 'folded').length >= 2 },
    rules: {
      levelId: 'pass',
      objective: 'gather',
      dayLength: 470,
      target: 12,
      wolfStart: 0.3,
      maxWolves: 3,
      wolfRespawn: [12, 16],
      wolfSpeedScale: 1.06,
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
}

export const CHARMS: Charm[] = [
  { id: 'swift', title: 'Swift Paws', text: 'Pip runs 8% faster.', stars: 2, perks: { speed: 1.08 } },
  { id: 'wind', title: 'Second Wind', text: 'Sprinting tires Pip 30% less.', stars: 5, perks: { staminaDrain: 0.7 } },
  { id: 'gruff', title: 'Gruff Bark', text: 'Barks carry 30% further and come back sooner.', stars: 9, perks: { barkRadius: 1.3, barkCooldown: 0.85 } },
  { id: 'eye', title: 'Steady Eye', text: 'Rams give way faster; creeping is calmer still.', stars: 13, perks: { eye: 1.7, creep: 0.8 } },
];

/** Two charms may be worn once this many stars are earned. */
export const SECOND_CHARM_STARS = 12;

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

export interface Progress {
  evenings: Record<string, { stars: number; ribbon: boolean; best?: number }>;
  charms: string[];
  /** The last evening played (the season map opens on it). */
  last?: string;
}

const KEY = 'woolgather.season.v1';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (p && typeof p === 'object' && p.evenings) return { evenings: p.evenings, charms: Array.isArray(p.charms) ? p.charms : [], last: p.last };
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

export function totalStars(p: Progress) {
  return Object.values(p.evenings).reduce((a, e) => a + e.stars, 0);
}
export function totalRibbons(p: Progress) {
  return Object.values(p.evenings).filter((e) => e.ribbon).length;
}

/** An evening is open once the one before it has been won (the first is always open). */
export function unlocked(p: Progress, i: number) {
  return i === 0 || (p.evenings[SEASON[i - 1].id]?.stars ?? 0) > 0;
}
