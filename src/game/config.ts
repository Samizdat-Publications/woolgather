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
    dayLength: 450,
    targetMissing: 3,
    wolfStart: 0.36,
    maxWolves: 2,
    wolfRespawn: [16, 22],
    wolfSpeedScale: 1,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'A short evening and a hungry pack.',
    dayLength: 330,
    targetMissing: 2,
    wolfStart: 0.25,
    maxWolves: 3,
    wolfRespawn: [11, 16],
    wolfSpeedScale: 1.1,
  },
};

export const DOG = {
  radius: 0.55,
  walkSpeed: 7.6,
  sprintSpeed: 12.5,
  creepSpeed: 3.0,
  accel: 46,
  waterSpeedScale: 0.55,
  staminaMax: 100,
  staminaDrain: 24,
  staminaRegen: 17,
  staminaRegenDelay: 0.7,
  barkCooldown: 1.3,
  barkRadius: 15,
  barkWolfRadius: 19,
  wolfScareTouch: 2.6,
};

export const SHEEP = {
  // Matches the drawn (1.42x) woolly body, so sheep never merge into one lump on screen.
  radius: 0.8,
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
  separationRadius: 2.5,
  cohesion: 1.1,
  cohesionAlert: 2.1,
  alignment: 0.9,
  separation: 3.2,
  obstacleLook: 3.2,
  waterAvoid: 4.5,
};

export const WOLF = {
  radius: 0.7,
  stalkSpeed: 4.6,
  chargeSpeed: 10.5,
  dragSpeed: 3.5,
  fleeSpeed: 12.5,
  chargeRange: 10,
  dogWaryRadius: 11,
  grabRange: 1.5,
  /** Metres past the valley boundary at which a dragged sheep counts as lost. */
  lostDepth: 5,
};

export const CAMERA = {
  fov: 40,
  offset: { x: 0, y: 34, z: 25.5 },
  lookAhead: 0.4,
  followRate: 4.5,
};
