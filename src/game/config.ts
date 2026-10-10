// Tuning lives here so balancing never means hunting through AI code.

export type Difficulty = 'gentle' | 'standard' | 'hard';

export interface DifficultyPreset {
  id: Difficulty;
  label: string;
  blurb: string;
  /** Real seconds from golden hour to nightfall. */
  dayLength: number;
  /** Sheep that must be in the fold. Total flock size comes from the level's sheep groups. */
  targetMissing: number;
  /** Day progress (0..1) at which wolves start hunting. */
  wolfStart: number;
  /** Maximum wolves hunting at once, reached by the end of the day. */
  maxWolves: number;
  /** Seconds before a wolf returns after being chased off. */
  wolfRespawn: [number, number];
  wolfSpeedScale: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  gentle: {
    id: 'gentle',
    label: 'Gentle',
    blurb: 'A long, slow sunset. Few wolves.',
    dayLength: 510,
    targetMissing: 3,
    wolfStart: 0.5,
    maxWolves: 1,
    wolfRespawn: [24, 32],
    wolfSpeedScale: 0.85,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    blurb: 'The way the old shepherds tell it.',
    dayLength: 360,
    targetMissing: 3,
    wolfStart: 0.33,
    maxWolves: 2,
    wolfRespawn: [16, 22],
    wolfSpeedScale: 1,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'A short evening and a hungry pack.',
    // Tuned so even expert herding (the test bot) is still racing the dark with wolves about.
    dayLength: 300,
    targetMissing: 3,
    wolfStart: 0.2,
    maxWolves: 3,
    wolfRespawn: [10, 14],
    wolfSpeedScale: 1.12,
  },
};

export const DOG = {
  radius: 0.8,
  walkSpeed: 7.6,
  sprintSpeed: 12.5,
  creepSpeed: 3.0,
  accel: 46,
  waterSpeedScale: 0.55,
  staminaMax: 100,
  staminaDrain: 17,
  staminaRegen: 21,
  staminaRegenDelay: 0.7,
  barkCooldown: 1.3,
  barkRadius: 15,
  barkWolfRadius: 19,
  wolfScareTouch: 2.6,
};

export const SHEEP = {
  // A little wider than the drawn (1.9x) woolly body, so a bunch keeps gaps you can count by.
  radius: 1.2,
  grazeSpeed: 0.7,
  fleeSpeed: 7.0,
  panicSpeed: 9.0,
  accel: 14,
  /** Flight zone around a walking dog; it shrinks towards `threatRadiusStill` as the dog stops. */
  threatRadius: 12.5,
  threatRadiusStill: 8.5,
  threatRadiusSprint: 15,
  threatRadiusCreep: 5,
  /** After a scare the flock keeps trotting on in the same direction for a moment. */
  trotSpeed: 3.4,
  trotTime: 1.6,
  wolfThreatRadius: 13,
  panicTime: 1.25,
  neighborRadius: 10,
  separationRadius: 3.4,
  cohesion: 1.1,
  cohesionAlert: 2.1,
  alignment: 0.9,
  separation: 3.2,
  obstacleLook: 3.2,
  waterAvoid: 4.5,
};

export const WOLF = {
  radius: 0.9,
  stalkSpeed: 4.6,
  chargeSpeed: 10.5,
  // Slow enough that Pip can reach a snatch from across the valley (sprint 12.5 m/s).
  dragSpeed: 2.7,
  fleeSpeed: 12.5,
  chargeRange: 10,
  /** Wolves that may not strike yet keep this far from their prey (sheep fear wolves within 13 m). */
  lurkRange: 17,
  dogWaryRadius: 11,
  grabRange: 1.5,
  /** Metres past the valley boundary at which a dragged sheep counts as lost. */
  lostDepth: 9,
};

/**
 * Wolves by kind (Woolgather 2.1): the threat grows by what a wolf does, not only by how many.
 * - wolf: the usual grey wolf.
 * - grey: the old grey. Bigger, slower and braver: lets Pip come closer, hears a bark only from
 *   nearer, and one bark only staggers him (grit 2): it takes a second bark while he is still
 *   shaken, or Pip running into him, to drive him off. His drag is slower, so there is time.
 * - young: quick and skittish. Keeps further from Pip and bolts at one bark, but comes back
 *   soon after from another den.
 * Speeds and the wary radius are multipliers on WOLF; hear multiplies the bark's reach on wolves.
 */
export type WolfKind = 'wolf' | 'grey' | 'young';
export const WOLF_KINDS: Record<WolfKind, { radius: number; stalk: number; charge: number; drag: number; wary: number; hear: number; grit: number; touch: number }> = {
  wolf: { radius: WOLF.radius, stalk: 1, charge: 1, drag: 1, wary: 1, hear: 1, grit: 1, touch: 0 },
  grey: { radius: 1.1, stalk: 0.88, charge: 0.92, drag: 0.82, wary: 0.5, hear: 0.68, grit: 2, touch: 0.5 },
  young: { radius: 0.75, stalk: 1.18, charge: 1.1, drag: 1.08, wary: 1.4, hear: 1, grit: 1, touch: 0 },
};
/** The old grey: how long a stagger holds him, and how long he stays shaken before his grit returns. */
export const GREY = { stagger: 1.4, shaken: 7 };

export const CAMERA = {
  // A three-quarter view from well back with a long lens: about 48 degrees down, the same ground
  // in view as a closer, wider camera, but things near the top of the screen are drawn about 0.73
  // the size of things near the bottom (0.57 with a 34 degree lens), and tall props near the
  // camera no longer swell and lean at the edges.
  fov: 20,
  /** The title's low establishing shot keeps a wider lens. */
  titleFov: 34,
  offset: { x: 0, y: 65, z: 57.8 },
  lookAhead: 0.4,
  followRate: 4.5,
};
