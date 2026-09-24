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
  { t: 0.0, elev: 24, azim: 245, keyColor: '#ffd9a6', keyIntensity: 3.0, hemiSky: '#efd9b8', hemiGround: '#7b8850', hemiIntensity: 1.35, fog: '#f0d6a8', fogNear: 80, fogFar: 260, skyTop: '#7ea6d0', skyHorizon: '#f8d49a', sunGlow: '#fff0c8', exposure: 1.0, night: 0 },
  { t: 0.25, elev: 15, azim: 252, keyColor: '#ffc486', keyIntensity: 2.9, hemiSky: '#f0caa0', hemiGround: '#737b48', hemiIntensity: 1.35, fog: '#f2c48e', fogNear: 78, fogFar: 250, skyTop: '#6f8cc4', skyHorizon: '#fbb878', sunGlow: '#ffd08a', exposure: 1.02, night: 0 },
  { t: 0.45, elev: 7, azim: 259, keyColor: '#ffa066', keyIntensity: 2.5, hemiSky: '#e8b0a0', hemiGround: '#6a6a4e', hemiIntensity: 1.4, fog: '#e8a07e', fogNear: 72, fogFar: 240, skyTop: '#5a66a8', skyHorizon: '#f79a6a', sunGlow: '#ffa868', exposure: 1.05, night: 0.1 },
  { t: 0.6, elev: 2, azim: 264, keyColor: '#ff7f5e', keyIntensity: 1.5, hemiSky: '#c9a2c0', hemiGround: '#5c5c6c', hemiIntensity: 1.4, fog: '#b7879c', fogNear: 64, fogFar: 228, skyTop: '#3f4488', skyHorizon: '#e27e72', sunGlow: '#ff7860', exposure: 1.1, night: 0.3 },
  // Sun and moon swap while the key light is almost off, so shadows never visibly swing.
  { t: 0.66, elev: 0, azim: 266, keyColor: '#d08080', keyIntensity: 0.04, hemiSky: '#a092c2', hemiGround: '#52566c', hemiIntensity: 1.38, fog: '#80709a', fogNear: 62, fogFar: 222, skyTop: '#30357a', skyHorizon: '#a86a86', sunGlow: '#d07070', exposure: 1.14, night: 0.45 },
  { t: SUN_MOON_SWAP, elev: 38, azim: 115, keyColor: '#a8b8ff', keyIntensity: 0.04, hemiSky: '#9c94c4', hemiGround: '#50546c', hemiIntensity: 1.38, fog: '#7c6e98', fogNear: 62, fogFar: 222, skyTop: '#2e3478', skyHorizon: '#a26a88', sunGlow: '#b08090', exposure: 1.14, night: 0.47 },
  { t: 0.74, elev: 38, azim: 115, keyColor: '#aebcff', keyIntensity: 0.85, hemiSky: '#8f96d2', hemiGround: '#4a5274', hemiIntensity: 1.38, fog: '#515890', fogNear: 58, fogFar: 215, skyTop: '#222860', skyHorizon: '#5b5290', sunGlow: '#9080b0', exposure: 1.15, night: 0.65 },
  { t: 0.86, elev: 40, azim: 118, keyColor: '#acbcff', keyIntensity: 1.1, hemiSky: '#7f8acc', hemiGround: '#414b6c', hemiIntensity: 1.36, fog: '#3c4280', fogNear: 55, fogFar: 205, skyTop: '#151b4a', skyHorizon: '#3e3c74', sunGlow: '#8090d0', exposure: 1.15, night: 0.85 },
  { t: 1.0, elev: 42, azim: 120, keyColor: '#b0c0ff', keyIntensity: 1.25, hemiSky: '#7482c8', hemiGround: '#3a4262', hemiIntensity: 1.3, fog: '#2c3268', fogNear: 52, fogFar: 200, skyTop: '#0c1034', skyHorizon: '#2a2c5c', sunGlow: '#6878c0', exposure: 1.15, night: 1 },
];

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
