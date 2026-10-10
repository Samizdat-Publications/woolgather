import type { Season } from '../world/terraingen';
import { DIFFICULTIES, type Difficulty } from './config';

// What one evening asks of the player: the place, the flock, the wolves, the weather, the goal.
// The season's evenings and the classic free-play evening are both written as rules.

/**
 * gather: bring the flock into the fold before nightfall. watch: keep the flock alive until dawn.
 * trial: a sheepdog trial: drive the flock through each gate in order, then pen it; judged on points.
 */
export type Objective = 'gather' | 'watch' | 'trial';
export type Weather = 'clear' | 'fog' | 'storm' | 'snow';

export interface FlockSpec {
  /** A sheepGroups id from the level file. */
  at: string;
  ewes: number;
  /** Lambs, each following one of this group's ewes. */
  lambs?: number;
  ram?: boolean;
  black?: number;
}

/** Pip's charms (perks): multipliers on his abilities. */
export interface Perks {
  speed: number;
  staminaDrain: number;
  barkRadius: number;
  barkCooldown: number;
  /** How fast the ram gives way to Pip's stare. */
  eye: number;
  /** Creeping flight-zone radius. */
  creep: number;
}

export const NO_PERKS: Perks = { speed: 1, staminaDrain: 1, barkRadius: 1, barkCooldown: 1, eye: 1, creep: 1 };

export interface Rules {
  id: string;
  levelId: string;
  objective: Objective;
  /** Real seconds from the start to nightfall (or to dawn on a watch). */
  dayLength: number;
  /** Sheep needed home (gather), or sheep that must survive (watch). */
  target: number;
  /** Day progress (0..1) at which wolves start hunting; null for none. */
  wolfStart: number | null;
  maxWolves: number;
  wolfRespawn: [number, number];
  wolfSpeedScale: number;
  flock: FlockSpec[];
  /** A lamb lost somewhere on the hill: find it and it follows Pip. */
  lostLamb?: [number, number];
  weather: Weather;
  season: Season;
  /** Day progress at which the fords flood (storms). */
  floodAt?: number;
  /** Seconds between thunderclaps (storms). */
  thunder?: [number, number];
  /** First-evening tutorial tips. */
  tutorial?: boolean;
  perks?: Perks;
  /** Where Pip starts, if not the level's usual spot. */
  dogStart?: [number, number];
  /** Fixed seed for the flock's placement (evenings look the same each time you play them). */
  seed?: number;
  /**
   * Wolves hunt in pairs: a second wolf that comes out while one stalks Pip's flock circles round
   * to the far side while the first shows itself and feints. 'gentle' gives the player more time.
   */
  pack?: 'gentle' | 'full';
  /** Fly, the old dog, comes along (a charm; never at the trial, where one dog runs). */
  fly?: boolean;
  /** Pip can run an outrun to the far side of a flock (a charm). */
  outrun?: boolean;
  /** One ewe wears a bell: her flock keeps close round her (a charm). */
  bell?: boolean;
  /** Trial judged strictly (Wolf Moon's championship course): missed gates and a slow round cost more. */
  strict?: boolean;
  /** Share of the evening's wolves (after the first) that come as each kind; the rest are ordinary wolves. */
  kinds?: { grey?: number; young?: number };
  /**
   * How many times a wolf that was chased off comes back (from another den, after a short while):
   * young wolves `young` times, every other wolf `other` times.
   */
  returns?: { young: number; other: number };
  /**
   * How bold the wolves are, 0..1 (the setting raises it): a bolder wolf drags faster and does not
   * slow down for a far-off Pip, strikes at a sheep closer to him, and waits less before a charge.
   */
  bold?: number;
}

/** The classic 1.0 evening in Hollow Valley at one of the three difficulties. */
export function classicRules(d: Difficulty): Rules {
  const p = DIFFICULTIES[d];
  const counts: Record<Difficulty, [number, number, number, number]> = {
    gentle: [3, 3, 2, 2],
    standard: [3, 3, 4, 2],
    hard: [4, 4, 5, 3],
  };
  const [meadow, grove, hillside, rocks] = counts[d];
  const total = meadow + grove + hillside + rocks;
  return {
    id: `classic-${d}`,
    levelId: 'hollow',
    objective: 'gather',
    dayLength: p.dayLength,
    target: total - p.targetMissing,
    wolfStart: p.wolfStart,
    maxWolves: p.maxWolves,
    wolfRespawn: p.wolfRespawn,
    wolfSpeedScale: p.wolfSpeedScale,
    flock: [
      { at: 'meadow', ewes: meadow },
      { at: 'grove', ewes: grove },
      { at: 'hillside', ewes: hillside },
      { at: 'rocks', ewes: rocks },
    ],
    weather: 'clear',
    season: 'summer',
  };
}

/** How many animals the flock spec makes (lambs, ram, black sheep and a lost lamb included). */
export function flockSize(r: Rules) {
  let n = 0;
  for (const g of r.flock) n += g.ewes + (g.lambs ?? 0) + (g.ram ? 1 : 0) + (g.black ?? 0);
  return n + (r.lostLamb ? 1 : 0);
}
