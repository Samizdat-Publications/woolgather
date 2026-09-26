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
// the wolves come out, a long rose afterglow, then a moonlit rose-violet twilight over the last 75
// seconds: the sun gone below the hills, the western sky still glowing, a rising moon lighting the
// valley. Full night falls at nightfall itself, the moment the day ends.
export const SUN_MOON_SWAP = 0.632;
const KEYS: Mood[] = [
  // A strong warm key against a lower, cool sky fill: lit grass reads green-gold, shadows cool, and
  // the ground has real contrast instead of an even olive wash.
  { t: 0.0, elev: 22, azim: 245, keyColor: '#ffd296', keyIntensity: 5.2, hemiSky: '#9ab4f0', hemiGround: '#8a9468', hemiIntensity: 0.8, fog: '#efd9b0', fogNear: 80, fogFar: 260, skyTop: '#7ea6d0', skyHorizon: '#f8d49a', sunGlow: '#fff0c8', exposure: 1.12, night: 0, shadow: 0.6, ground: '#fffaf0' },
  { t: 0.25, elev: 15, azim: 252, keyColor: '#ffca88', keyIntensity: 5.2, hemiSky: '#98b0ee', hemiGround: '#86905e', hemiIntensity: 0.8, fog: '#f2cc98', fogNear: 78, fogFar: 250, skyTop: '#6f8cc4', skyHorizon: '#fbb878', sunGlow: '#ffd08a', exposure: 1.12, night: 0, shadow: 0.58, ground: '#fff6ea' },
  // Sunset, when the wolves come out: a low pink-coral sun under a rose sky with a lavender fill;
  // the grass turns gold under it and the pink falls on the fleece, stone and water.
  { t: 0.45, elev: 10, azim: 259, keyColor: '#ffa98e', keyIntensity: 4.0, hemiSky: '#9a90dc', hemiGround: '#76785e', hemiIntensity: 1.6, fog: '#e79a8c', fogNear: 72, fogFar: 240, skyTop: '#565c9e', skyHorizon: '#ff8f8a', sunGlow: '#ff9460', exposure: 1.14, night: 0.1, shadow: 0.5, ground: '#fff2e6' },
  { t: 0.6, elev: 6, azim: 264, keyColor: '#ff9ea0', keyIntensity: 3.4, hemiSky: '#9688d8', hemiGround: '#727260', hemiIntensity: 1.6, fog: '#c890a4', fogNear: 66, fogFar: 232, skyTop: '#474a90', skyHorizon: '#e87c96', sunGlow: '#ff7860', exposure: 1.12, night: 0.2, shadow: 0.5, ground: '#fff0ea' },
  // The sun drops below the hills as the violet twilight begins; while sun and moon swap the key
  // light is low and its shadows faint (so they never visibly swing), and the sky fill carries the
  // light, so the valley keeps darkening steadily instead of dipping and brightening again.
  { t: 0.628, elev: 2, azim: 267, keyColor: '#e890a8', keyIntensity: 0.6, hemiSky: '#9488cc', hemiGround: '#6a6478', hemiIntensity: 2.4, fog: '#a07aa0', fogNear: 62, fogFar: 224, skyTop: '#383c84', skyHorizon: '#d0708a', sunGlow: '#e8788e', exposure: 1.12, night: 0.28, shadow: 0.15, ground: '#faeef6' },
  // Twilight: the western sky still glows rose (haze, glow, water) while a cool moon rises in the
  // east as the key light: silver on the tops of things, soft shadows, lilac fill. Full night
  // falls at nightfall.
  { t: SUN_MOON_SWAP, elev: 30, azim: 112, keyColor: '#c8d2f4', keyIntensity: 0.6, hemiSky: '#9088c8', hemiGround: '#6a6478', hemiIntensity: 2.3, fog: '#9a78a0', fogNear: 62, fogFar: 222, skyTop: '#343a80', skyHorizon: '#c86e8a', sunGlow: '#e0708a', exposure: 1.1, night: 0.3, shadow: 0.15, ground: '#f6eef8' },
  { t: 0.7, elev: 32, azim: 114, keyColor: '#c8c0f4', keyIntensity: 1.4, hemiSky: '#8a86c4', hemiGround: '#62607a', hemiIntensity: 1.6, fog: '#8a70a0', fogNear: 60, fogFar: 220, skyTop: '#2c3276', skyHorizon: '#b06a8c', sunGlow: '#c8708e', exposure: 1.06, night: 0.38, shadow: 0.4, ground: '#f0eefa' },
  { t: 0.8, elev: 36, azim: 116, keyColor: '#c4c0f6', keyIntensity: 1.5, hemiSky: '#8676c0', hemiGround: '#5a5a74', hemiIntensity: 1.45, fog: '#6c6294', fogNear: 58, fogFar: 214, skyTop: '#222866', skyHorizon: '#8a6292', sunGlow: '#a07098', exposure: 1.08, night: 0.5, shadow: 0.42, ground: '#eceafc' },
  { t: 0.88, elev: 38, azim: 118, keyColor: '#c0c0f8', keyIntensity: 2.2, hemiSky: '#7466b4', hemiGround: '#54566e', hemiIntensity: 0.85, fog: '#4c4c80', fogNear: 70, fogFar: 245, skyTop: '#181e52', skyHorizon: '#5c5088', sunGlow: '#8878b0', exposure: 1.08, night: 0.62, shadow: 0.68, ground: '#e8e8fe' },
  // Night, at nightfall itself: a strong cool-white moon over a dim blue-violet fill.
  { t: 1.0, elev: 42, azim: 120, keyColor: '#bcc2ff', keyIntensity: 2.6, hemiSky: '#5a4a9c', hemiGround: '#4a4f66', hemiIntensity: 0.5, fog: '#2e3264', fogNear: 72, fogFar: 250, skyTop: '#0c1034', skyHorizon: '#2a2c5c', sunGlow: '#6878c0', exposure: 1.06, night: 1, shadow: 0.85, ground: '#e4e4ff' },
];


/** Mood position where the sun is setting: wolves always arrive at this moment. */
const SUNSET = 0.45;
/** Mood at the end of the golden hour, just before the sun drops. */
const GOLDEN = 0.3;
/** Seconds the sun takes to drop behind the western ridge, around the moment the wolves come
 * out (the red notch on the sun bar): a visible event, not a slow drift. */
const TURN_BEFORE = 5;
const TURN_AFTER = 10;
/** Seconds before nightfall when the violet twilight begins, and when night itself starts falling:
 * the rose holds for most of the wolves' time. */
const DUSK_SECONDS = 40;
const NIGHTFALL_SECONDS = 3;

/**
 * Map day progress to mood progress, whatever the difficulty's wolf start time and day length:
 * golden light until the wolves are due, the sun dropping behind the ridge as they come out, a
 * long rose sunset, a violet twilight for the last 40 seconds, and night proper only in the final
 * seconds, at nightfall.
 */
export function moodTime(t: number, wolfStart: number, dayLength = 300) {
  t = clamp(t, 0, 1);
  const drop = Math.max(0.01, wolfStart - TURN_BEFORE / dayLength);
  const rose = wolfStart + TURN_AFTER / dayLength;
  if (t < drop) return (t / drop) * GOLDEN;
  if (t < rose) {
    const k = (t - drop) / (rose - drop);
    return GOLDEN + k * k * (3 - 2 * k) * (SUNSET - GOLDEN);
  }
  const dusk = Math.max(rose + 0.05, 1 - DUSK_SECONDS / dayLength);
  const night = Math.max(dusk + 0.005, 1 - NIGHTFALL_SECONDS / dayLength);
  if (t < dusk) return SUNSET + ((t - rose) / (dusk - rose)) * (0.62 - SUNSET);
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
