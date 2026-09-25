import * as THREE from 'three';
import { clamp } from '../game/math';

// Lighting keyframes from golden hour (t=0) to night (t=1). Everything the sky, fog and lights
// need is interpolated from here so the whole scene shifts mood together.

export interface Mood {
  t: number;
  /** Elevation/azimuth of the key light in degrees (sun, then moon after the crossover). */
  elev: number;
  azim: number;
  keyColor: string;
  keyIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
  fogNear: number;
  fogFar: number;
  skyTop: string;
  skyHorizon: string;
  sunGlow: string;
  exposure: number;
  /** 0..1 how much night-only things (stars, lanterns, fireflies, wolf eyes) show. */
  night: number;
  /** How dark the key light's shadows are (0 none .. 1 black). */
  shadow: number;
  /** Tint multiplied into the terrain's own colours (warms the grass at sunset, cools it at night). */
  ground: string;
}

// The whole arc plays out inside a normal run: warm gold from the first frame, the sun sets as
// the wolves come out, a long rose afterglow, then a deep rose-violet dusk over the last minute or
// so. Night proper (moonlight) falls at nightfall itself, the moment the day ends, so the picture
// never shows night while the clock still says there is time.
export const SUN_MOON_SWAP = 0.905;
const KEYS: Mood[] = [
  // A strong warm key against a lower, cool sky fill: lit grass reads green-gold, shadows cool, and
  // the ground has real contrast instead of an even olive wash.
  { t: 0.0, elev: 22, azim: 245, keyColor: '#ffc88a', keyIntensity: 3.5, hemiSky: '#b9cce8', hemiGround: '#7d8c52', hemiIntensity: 1.05, fog: '#efd9b0', fogNear: 80, fogFar: 260, skyTop: '#7ea6d0', skyHorizon: '#f8d49a', sunGlow: '#fff0c8', exposure: 1.0, night: 0, shadow: 0.6, ground: '#fffaf0' },
  { t: 0.25, elev: 15, azim: 252, keyColor: '#ffc486', keyIntensity: 3.5, hemiSky: '#b6c4e6', hemiGround: '#74814c', hemiIntensity: 1.05, fog: '#f2cc98', fogNear: 78, fogFar: 250, skyTop: '#6f8cc4', skyHorizon: '#fbb878', sunGlow: '#ffd08a', exposure: 1.02, night: 0, shadow: 0.58, ground: '#fff6ea' },
  // Sunset, when the wolves come out: a low coral-pink sun under a rose sky with a lavender fill;
  // sage grass turns gold under it rather than brown.
  { t: 0.45, elev: 10, azim: 259, keyColor: '#ffae96', keyIntensity: 3.6, hemiSky: '#b8a8e0', hemiGround: '#6a6060', hemiIntensity: 1.1, fog: '#e79a8c', fogNear: 72, fogFar: 240, skyTop: '#565c9e', skyHorizon: '#ff8a66', sunGlow: '#ff9460', exposure: 1.14, night: 0.1, shadow: 0.5, ground: '#fff2e6' },
  { t: 0.6, elev: 6, azim: 264, keyColor: '#ffa092', keyIntensity: 2.8, hemiSky: '#ae9ad8', hemiGround: '#5c5c6c', hemiIntensity: 1.2, fog: '#c890a4', fogNear: 66, fogFar: 232, skyTop: '#474a90', skyHorizon: '#f07c72', sunGlow: '#ff7860', exposure: 1.12, night: 0.2, shadow: 0.45, ground: '#fff0ea' },
  // Dusk, the last minute or so: the sun on the horizon, a dim rose key, a strong lilac fill, the
  // longest (but light) shadows of the evening.
  { t: 0.74, elev: 2, azim: 267, keyColor: '#e88aa4', keyIntensity: 1.7, hemiSky: '#9c88cc', hemiGround: '#544e66', hemiIntensity: 1.45, fog: '#9a7aa4', fogNear: 62, fogFar: 224, skyTop: '#343a80', skyHorizon: '#c46e86', sunGlow: '#e0708a', exposure: 1.12, night: 0.32, shadow: 0.35, ground: '#faeef6' },
  { t: 0.86, elev: 0, azim: 268, keyColor: '#b880b4', keyIntensity: 1.2, hemiSky: '#8a7cc4', hemiGround: '#4c4a64', hemiIntensity: 1.7, fog: '#7c6a9c', fogNear: 60, fogFar: 220, skyTop: '#282e70', skyHorizon: '#90608a', sunGlow: '#b0708e', exposure: 1.1, night: 0.48, shadow: 0.3, ground: '#f2ecfa' },
  // Nightfall: sun and moon swap while the key light is almost off, so shadows never swing.
  { t: 0.9, elev: 0, azim: 268, keyColor: '#9080b8', keyIntensity: 0.04, hemiSky: '#7c74b8', hemiGround: '#4a4a62', hemiIntensity: 1.5, fog: '#5c5a8c', fogNear: 58, fogFar: 214, skyTop: '#1c2258', skyHorizon: '#5a4a80', sunGlow: '#8a7ab0', exposure: 1.08, night: 0.6, shadow: 0.35, ground: '#eeeefc' },
  // Moonlight: a strong cool-white key over a dim blue-violet fill: bright moonlit tops and dark
  // shadows.
  { t: SUN_MOON_SWAP, elev: 40, azim: 118, keyColor: '#ccd4f4', keyIntensity: 0.04, hemiSky: '#7a72b8', hemiGround: '#484a60', hemiIntensity: 1.1, fog: '#565888', fogNear: 58, fogFar: 212, skyTop: '#1a2056', skyHorizon: '#524880', sunGlow: '#8a80b8', exposure: 1.06, night: 0.62, shadow: 0.35, ground: '#ececfc' },
  { t: 1.0, elev: 42, azim: 120, keyColor: '#d0dcff', keyIntensity: 1.9, hemiSky: '#7066b2', hemiGround: '#3e445a', hemiIntensity: 0.5, fog: '#2e3264', fogNear: 52, fogFar: 200, skyTop: '#0c1034', skyHorizon: '#2a2c5c', sunGlow: '#6878c0', exposure: 1.0, night: 1, shadow: 0.5, ground: '#e4e4ff' },
];

/** Mood position where the sun is setting: wolves always arrive at this moment. */
const SUNSET = 0.45;
/** Mood at the end of the golden hour, just before the sun drops. */
const GOLDEN = 0.3;
/** Share of the day the sun takes to drop from gold to sunset, ending as the wolves come out. */
const DROP = 0.035;
/** Seconds before nightfall when the deep dusk begins, and when night itself starts falling. */
const DUSK_SECONDS = 75;
const NIGHTFALL_SECONDS = 3;

/**
 * Map day progress to mood progress, whatever the difficulty's wolf start time and day length:
 * golden light until the wolves are due, a quick visible drop into sunset as they come out, a
 * long rose afterglow, a deep rose-violet dusk for the last 75 seconds, and night proper only in
 * the final seconds, at nightfall.
 */
export function moodTime(t: number, wolfStart: number, dayLength = 300) {
  t = clamp(t, 0, 1);
  const drop = Math.max(0.01, wolfStart - DROP);
  if (t < drop) return (t / drop) * GOLDEN;
  if (t < wolfStart) return GOLDEN + ((t - drop) / (wolfStart - drop)) * (SUNSET - GOLDEN);
  const dusk = Math.max(wolfStart + 0.05, 1 - DUSK_SECONDS / dayLength);
  const night = Math.max(dusk + 0.005, 1 - NIGHTFALL_SECONDS / dayLength);
  if (t < dusk) return SUNSET + ((t - wolfStart) / (dusk - wolfStart)) * (0.62 - SUNSET);
  if (t < night) return 0.62 + ((t - dusk) / (night - dusk)) * (0.88 - 0.62);
  return 0.88 + ((t - night) / (1 - night)) * (1 - 0.88);
}

const ca = new THREE.Color();
const cb = new THREE.Color();

function mixColor(a: string, b: string, k: number, out: THREE.Color) {
  ca.set(a);
  cb.set(b);
  return out.copy(ca).lerp(cb, k);
}

export interface MoodValues {
  /** Mood progress this was sampled at (0 golden hour .. 1 night). */
  t: number;
  keyDir: THREE.Vector3;
  keyColor: THREE.Color;
  keyIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  sunGlow: THREE.Color;
  sunDir: THREE.Vector3;
  exposure: number;
  night: number;
  shadow: number;
  ground: THREE.Color;
}

export function createMoodValues(): MoodValues {
  return {
    t: 0,
    keyDir: new THREE.Vector3(),
    keyColor: new THREE.Color(),
    keyIntensity: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    fog: new THREE.Color(),
    fogNear: 60,
    fogFar: 200,
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    sunGlow: new THREE.Color(),
    sunDir: new THREE.Vector3(),
    exposure: 1,
    night: 0,
    shadow: 0.6,
    ground: new THREE.Color(1, 1, 1),
  };
}

function dirFrom(elevDeg: number, azimDeg: number, out: THREE.Vector3) {
  // Azimuth measured clockwise from north (-Z). 270 = due west.
  const e = THREE.MathUtils.degToRad(elevDeg);
  const a = THREE.MathUtils.degToRad(azimDeg);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

/** Fill `out` with the mood at day progress t (0..1). */
export function sampleMood(t: number, out: MoodValues) {
  t = clamp(t, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
  const s = k * k * (3 - 2 * k);
  const m = (x: number, y: number) => x + (y - x) * s;
  out.t = t;
  dirFrom(m(a.elev, b.elev), m(a.azim, b.azim), out.keyDir);
  // The sun keeps sinking for the sky even after the moon takes over the key light.
  const sunSide = t < SUN_MOON_SWAP;
  const sunElev = sunSide ? m(a.elev, b.elev) : -8 * clamp((t - SUN_MOON_SWAP) / (1 - SUN_MOON_SWAP), 0, 1);
  dirFrom(sunElev, sunSide ? m(a.azim, b.azim) : 266, out.sunDir);
  mixColor(a.keyColor, b.keyColor, s, out.keyColor);
  out.keyIntensity = m(a.keyIntensity, b.keyIntensity);
  mixColor(a.hemiSky, b.hemiSky, s, out.hemiSky);
  mixColor(a.hemiGround, b.hemiGround, s, out.hemiGround);
  out.hemiIntensity = m(a.hemiIntensity, b.hemiIntensity);
  mixColor(a.fog, b.fog, s, out.fog);
  out.fogNear = m(a.fogNear, b.fogNear);
  out.fogFar = m(a.fogFar, b.fogFar);
  mixColor(a.skyTop, b.skyTop, s, out.skyTop);
  mixColor(a.skyHorizon, b.skyHorizon, s, out.skyHorizon);
  mixColor(a.sunGlow, b.sunGlow, s, out.sunGlow);
  out.exposure = m(a.exposure, b.exposure);
  out.night = m(a.night, b.night);
  out.shadow = m(a.shadow, b.shadow);
  mixColor(a.ground, b.ground, s, out.ground);
  return out;
}
