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

// The whole arc plays out inside a normal run: warm gold from the first frame, sunset by the
// middle of the day, moonlit dusk for the last third. Night is stylised moonlight, bright enough
// to herd by, tinted blue-violet rather than dark.
export const SUN_MOON_SWAP = 0.665;
const KEYS: Mood[] = [
  // A strong warm key against a lower, cool sky fill: lit grass reads green-gold, shadows cool, and
  // the ground has real contrast instead of an even olive wash.
  { t: 0.0, elev: 22, azim: 245, keyColor: '#ffc88a', keyIntensity: 3.5, hemiSky: '#b9cce8', hemiGround: '#7d8c52', hemiIntensity: 1.05, fog: '#efd9b0', fogNear: 80, fogFar: 260, skyTop: '#7ea6d0', skyHorizon: '#f8d49a', sunGlow: '#fff0c8', exposure: 1.0, night: 0 , shadow: 0.6, ground: '#fffaf0' },
  { t: 0.25, elev: 15, azim: 252, keyColor: '#ffc486', keyIntensity: 3.5, hemiSky: '#b6c4e6', hemiGround: '#74814c', hemiIntensity: 1.05, fog: '#f2cc98', fogNear: 78, fogFar: 250, skyTop: '#6f8cc4', skyHorizon: '#fbb878', sunGlow: '#ffd08a', exposure: 1.02, night: 0 , shadow: 0.58, ground: '#fff6ea' },
  // Sunset, when the wolves come out: a low golden-peach sun under a rose sky with a lavender fill.
  // The sun sits a little higher than a real sunset (at 5 degrees it barely lit flat ground), and
  // the key stays golden rather than coral, so lit grass turns gold instead of brown; the rose is
  // carried by the sky, haze, water and the grade's violet shadows and peach highlights.
  { t: 0.45, elev: 10, azim: 259, keyColor: '#ffbe98', keyIntensity: 3.6, hemiSky: '#b8a8e0', hemiGround: '#6a6060', hemiIntensity: 1.1, fog: '#e79a8c', fogNear: 72, fogFar: 240, skyTop: '#565c9e', skyHorizon: '#ff8a66', sunGlow: '#ff9460', exposure: 1.14, night: 0.1 , shadow: 0.5, ground: '#fff2e6' },
  { t: 0.6, elev: 5, azim: 264, keyColor: '#ffb09c', keyIntensity: 2.4, hemiSky: '#aa9cd8', hemiGround: '#5c5c6c', hemiIntensity: 1.2, fog: '#b08aa4', fogNear: 64, fogFar: 228, skyTop: '#3f4488', skyHorizon: '#e27e72', sunGlow: '#ff7860', exposure: 1.1, night: 0.3 , shadow: 0.45, ground: '#fff0ea' },
  // Sun and moon swap while the key light is almost off, so shadows never visibly swing.
  { t: 0.66, elev: 0, azim: 266, keyColor: '#d08080', keyIntensity: 0.04, hemiSky: '#a092c2', hemiGround: '#52566c', hemiIntensity: 1.1, fog: '#80709a', fogNear: 62, fogFar: 222, skyTop: '#30357a', skyHorizon: '#a86a86', sunGlow: '#d07070', exposure: 1.14, night: 0.45 , shadow: 0.4, ground: '#f8f0f4' },
  // Moonlight: a strong cool-white key over a dim blue-violet fill, so the night has bright
  // moonlit tops and truly dark shadows instead of one even wash.
  { t: SUN_MOON_SWAP, elev: 38, azim: 115, keyColor: '#ccd4f4', keyIntensity: 0.04, hemiSky: '#9c96c4', hemiGround: '#52566a', hemiIntensity: 1.0, fog: '#7c6e98', fogNear: 62, fogFar: 222, skyTop: '#2e3478', skyHorizon: '#a26a88', sunGlow: '#b08090', exposure: 1.14, night: 0.47 , shadow: 0.4, ground: '#f0f0fa' },
  { t: 0.74, elev: 38, azim: 115, keyColor: '#ccd6ff', keyIntensity: 1.4, hemiSky: '#8a8cc4', hemiGround: '#4d5268', hemiIntensity: 0.75, fog: '#555888', fogNear: 58, fogFar: 215, skyTop: '#222860', skyHorizon: '#5b5290', sunGlow: '#9080b0', exposure: 1.06, night: 0.65 , shadow: 0.45, ground: '#eaeafc' },
  { t: 0.86, elev: 40, azim: 118, keyColor: '#d0d8ff', keyIntensity: 1.7, hemiSky: '#7478b8', hemiGround: '#454b62', hemiIntensity: 0.6, fog: '#40447a', fogNear: 55, fogFar: 205, skyTop: '#151b4a', skyHorizon: '#3e3c74', sunGlow: '#8090d0', exposure: 1.02, night: 0.85 , shadow: 0.5, ground: '#e6e6fe' },
  { t: 1.0, elev: 42, azim: 120, keyColor: '#d0dcff', keyIntensity: 1.9, hemiSky: '#7066b2', hemiGround: '#3e445a', hemiIntensity: 0.5, fog: '#2e3264', fogNear: 52, fogFar: 200, skyTop: '#0c1034', skyHorizon: '#2a2c5c', sunGlow: '#6878c0', exposure: 1.0, night: 1 , shadow: 0.5, ground: '#e4e4ff' },
];

/** Mood position where the sun is setting: wolves always arrive at this moment. */
const SUNSET = 0.45;
/** Mood at the end of the golden hour, just before the sun drops. */
const GOLDEN = 0.3;
/** Share of the day the sun takes to drop from gold to sunset, ending as the wolves come out. */
const DROP = 0.035;

/**
 * Map day progress to mood progress, whatever the difficulty's wolf start time is: golden light
 * until the wolves are due, a quick visible drop into sunset as they come out, a long afterglow,
 * moonrise with about a quarter of the evening left, then full night at nightfall.
 */
export function moodTime(t: number, wolfStart: number) {
  t = clamp(t, 0, 1);
  const drop = Math.max(0.01, wolfStart - DROP);
  if (t < drop) return (t / drop) * GOLDEN;
  if (t < wolfStart) return GOLDEN + ((t - drop) / (wolfStart - drop)) * (SUNSET - GOLDEN);
  const u = (t - wolfStart) / (1 - wolfStart);
  if (u < 0.55) return SUNSET + (u / 0.55) * (0.6 - SUNSET);
  if (u < 0.75) return 0.6 + ((u - 0.55) / 0.2) * (0.72 - 0.6);
  return 0.72 + ((u - 0.75) / 0.25) * (1 - 0.72);
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
