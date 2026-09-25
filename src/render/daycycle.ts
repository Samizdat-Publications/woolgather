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
}

// The whole arc plays out inside a normal run: warm gold from the first frame, sunset by the
// middle of the day, moonlit dusk for the last third. Night is stylised moonlight, bright enough
// to herd by, tinted blue-violet rather than dark.
export const SUN_MOON_SWAP = 0.665;
const KEYS: Mood[] = [
  // Warm key against a cool sky fill: the grass stays green and the light reads as gold, instead
  // of everything turning olive under a warm-on-warm setup.
  { t: 0.0, elev: 24, azim: 245, keyColor: '#ffe0b0', keyIntensity: 3.0, hemiSky: '#cddcef', hemiGround: '#7d8c52', hemiIntensity: 1.3, fog: '#efd9b0', fogNear: 80, fogFar: 260, skyTop: '#7ea6d0', skyHorizon: '#f8d49a', sunGlow: '#fff0c8', exposure: 1.0, night: 0 },
  { t: 0.25, elev: 15, azim: 252, keyColor: '#ffcf96', keyIntensity: 3.0, hemiSky: '#c8d2ea', hemiGround: '#74814c', hemiIntensity: 1.3, fog: '#f2cc98', fogNear: 78, fogFar: 250, skyTop: '#6f8cc4', skyHorizon: '#fbb878', sunGlow: '#ffd08a', exposure: 1.02, night: 0 },
  { t: 0.45, elev: 7, azim: 259, keyColor: '#ffb07c', keyIntensity: 3.1, hemiSky: '#c6bce0', hemiGround: '#6a7056', hemiIntensity: 1.45, fog: '#e6a888', fogNear: 72, fogFar: 240, skyTop: '#5a66a8', skyHorizon: '#f79a6a', sunGlow: '#ffa868', exposure: 1.18, night: 0.1 },
  { t: 0.6, elev: 2, azim: 264, keyColor: '#ff9070', keyIntensity: 2.0, hemiSky: '#b0a6d8', hemiGround: '#5c6070', hemiIntensity: 1.55, fog: '#b08aa4', fogNear: 64, fogFar: 228, skyTop: '#3f4488', skyHorizon: '#e27e72', sunGlow: '#ff7860', exposure: 1.22, night: 0.3 },
  // Sun and moon swap while the key light is almost off, so shadows never visibly swing.
  { t: 0.66, elev: 0, azim: 266, keyColor: '#d08080', keyIntensity: 0.04, hemiSky: '#a092c2', hemiGround: '#52566c', hemiIntensity: 1.38, fog: '#80709a', fogNear: 62, fogFar: 222, skyTop: '#30357a', skyHorizon: '#a86a86', sunGlow: '#d07070', exposure: 1.14, night: 0.45 },
  // Moonlight is kept near-neutral silver; the violet of the dusk comes from the colour grade, so
  // grey rocks no longer turn saturated navy.
  { t: SUN_MOON_SWAP, elev: 38, azim: 115, keyColor: '#c2c8ea', keyIntensity: 0.04, hemiSky: '#a29cc4', hemiGround: '#52566a', hemiIntensity: 1.38, fog: '#7c6e98', fogNear: 62, fogFar: 222, skyTop: '#2e3478', skyHorizon: '#a26a88', sunGlow: '#b08090', exposure: 1.14, night: 0.47 },
  { t: 0.74, elev: 38, azim: 115, keyColor: '#c4cbee', keyIntensity: 0.85, hemiSky: '#9a9cc8', hemiGround: '#4d5268', hemiIntensity: 1.4, fog: '#555888', fogNear: 58, fogFar: 215, skyTop: '#222860', skyHorizon: '#5b5290', sunGlow: '#9080b0', exposure: 1.15, night: 0.65 },
  { t: 0.86, elev: 40, azim: 118, keyColor: '#c2caf0', keyIntensity: 1.1, hemiSky: '#8a90c2', hemiGround: '#454b62', hemiIntensity: 1.38, fog: '#40447a', fogNear: 55, fogFar: 205, skyTop: '#151b4a', skyHorizon: '#3e3c74', sunGlow: '#8090d0', exposure: 1.15, night: 0.85 },
  { t: 1.0, elev: 42, azim: 120, keyColor: '#c0c8f0', keyIntensity: 1.25, hemiSky: '#7e86bc', hemiGround: '#3e445a', hemiIntensity: 1.32, fog: '#2e3264', fogNear: 52, fogFar: 200, skyTop: '#0c1034', skyHorizon: '#2a2c5c', sunGlow: '#6878c0', exposure: 1.15, night: 1 },
];

/**
 * Colour script for the compositor grade: amber afternoon, rose sunset, violet dusk.
 * A soft-light layer warms or cools the light; a `color`-blend layer pulls hue towards violet as
 * night falls (soft-light alone cannot turn green grass violet).
 * [mood t, soft-light colour, opacity, hue colour, opacity]
 */
const GRADE: [number, string, number, string, number][] = [
  [0.0, '#ffb35c', 0.22, '#ff9a6a', 0.0],
  [0.3, '#ffa34f', 0.24, '#ff9a6a', 0.04],
  [0.45, '#ffa08e', 0.22, '#f08aa0', 0.08],
  [0.6, '#d77ab8', 0.28, '#a070c8', 0.2],
  [0.72, '#8f78d8', 0.3, '#7c6ad0', 0.28],
  [1.0, '#6a64cc', 0.32, '#5e5ac6', 0.34],
];

export interface Grade {
  soft: THREE.Color;
  softOpacity: number;
  hue: THREE.Color;
  hueOpacity: number;
}

export function sampleGrade(t: number, out: Grade) {
  t = clamp(t, 0, 1);
  let i = 0;
  while (i < GRADE.length - 2 && t > GRADE[i + 1][0]) i++;
  const a = GRADE[i];
  const b = GRADE[i + 1];
  const k = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  mixColor(a[1], b[1], k, out.soft);
  out.softOpacity = a[2] + (b[2] - a[2]) * k;
  mixColor(a[3], b[3], k, out.hue);
  out.hueOpacity = a[4] + (b[4] - a[4]) * k;
  return out;
}

/** Mood position where the sun is setting: wolves always arrive at this moment. */
const SUNSET = 0.45;

/**
 * Map day progress to mood progress so that sunset lands exactly when the wolves come out,
 * whatever the difficulty's wolf start time is.
 */
export function moodTime(t: number, wolfStart: number) {
  t = clamp(t, 0, 1);
  return t < wolfStart ? (t / wolfStart) * SUNSET : SUNSET + ((t - wolfStart) / (1 - wolfStart)) * (1 - SUNSET);
}

const ca = new THREE.Color();
const cb = new THREE.Color();

function mixColor(a: string, b: string, k: number, out: THREE.Color) {
  ca.set(a);
  cb.set(b);
  return out.copy(ca).lerp(cb, k);
}

export interface MoodValues {
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
}

export function createMoodValues(): MoodValues {
  return {
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
  return out;
}
