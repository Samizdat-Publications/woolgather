import * as THREE from 'three';
import type { Level } from '../game/level';
import { pointInPolygon, Rng } from '../game/math';
import { createMoodValues, sampleMood, type MoodValues } from '../render/daycycle';
import type { Assets } from './assets';
import type { Terrain } from './terrain';
import type { GeneratedTerrain, Season } from './terraingen';

// The static level: generated ground, water and tracks, plus the Blender props (trees, rocks,
// pens, farmhouse, bridges) placed from the level file, recoloured for the season.

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

/** How much light falls on flat ground: sky fill plus the key light at its elevation. */
function groundLight(m: MoodValues) {
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  // The key light never drops below 26 degrees (see Stage.updateCamera).
  return lum(m.hemiSky) * m.hemiIntensity + lum(m.keyColor) * m.keyIntensity * Math.max(0.44, m.keyDir.y);
}
const GOLDEN_GROUND = groundLight(sampleMood(0, createMoodValues()));
/** Terrain colour tint, shared by the ground and path shaders (set from the mood each frame). */
const GROUND_TINT = { value: new THREE.Color(1, 1, 1) };
/** Trees are drawn larger than their Blender size, in scale with the enlarged animals. */
const TREE_SCALE = 1.35;
/** Direction the hill shading is lit from (the sun, then the moon), level with the horizon. */
const HILL_DIR = { value: new THREE.Vector3(-1, 0, 0) };
const LAVENDER = new THREE.Color('#c8b4e8');
const INDIGO = new THREE.Color('#3a3c8a');

/** Snow on every upward face of the props (0 = none), and the world's up in view space. */
export const SNOW = { value: 0 };
const UP_VIEW = { value: new THREE.Vector3(0, 1, 0) };
/** Wetness: rain darkens and cools the props and ground a little (0 = dry). */
export const WET = { value: 0 };

interface Placement {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  sy?: number;
}

/** Patch a Lambert material so snow settles on its upward faces and rain darkens it. */
function weatherize(m: THREE.Material) {
  if (m.userData.weather) return;
  m.userData.weather = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uSnow = SNOW;
    shader.uniforms.uUpView = UP_VIEW;
    shader.uniforms.uWet = WET;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;\nuniform float uWet;\nuniform vec3 uUpView;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float upness = dot(normal, uUpView);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.3, 0.75, upness));
        diffuseColor.rgb *= 1.0 - 0.22 * uWet;`,
      );
  };
  const base = prevKey ? prevKey() : '';
  m.customProgramCacheKey = () => `${base}|wx`;
  m.needsUpdate = true;
}

/**
 * Turn a (possibly multi-material) prop into one InstancedMesh per material, all sharing the
 * same instance transforms. Hundreds of trees cost a handful of draw calls.
 */
function instance(proto: THREE.Object3D, spots: Placement[], opts: { shadow?: boolean; fade?: boolean } = {}) {
  proto.updateMatrixWorld(true);
  const inv = proto.matrixWorld.clone().invert();
  const group = new THREE.Group();
  group.name = `${proto.name}_instances`;
  const meshes: THREE.InstancedMesh[] = [];
  proto.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone();
    geo.userData.disposable = true;
    geo.applyMatrix4(inv.clone().multiply(m.matrixWorld));
    let mat = m.material as THREE.Material;
    if (opts.fade) mat = fadeMaterial(mat);
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
    im.count = spots.length;
    spots.forEach((s, i) => {
      tmpQ.setFromAxisAngle(UP, s.rot);
      tmpS.set(s.scale, s.scale * (s.sy ?? 1), s.scale);
      tmpP.set(s.x, s.y, s.z);
      im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    });
    im.castShadow = opts.shadow ?? true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    if (opts.fade) {
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, spots.length)).fill(1), 1);
      fade.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('instanceFade', fade);
    }
    meshes.push(im);
    group.add(im);
  });
  return { group, meshes };
}

// Trees between the camera and the action open a soft round window around Pip, the wolves and
// nearby sheep (screen-space cut-outs through alpha-to-coverage on the multisampled target), so
// the rest of the tree stays solid instead of the whole thing turning into a ghost. `vFade` says
// how open a tree is (1 = solid).
const MAX_HOLES = 6;
const HOLES = { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector3()) };
const HOLE_COUNT = { value: 0 };
const BUF_H = { value: 720 };
/** The low (tilted) camera: how far it is tilted (x, 0..1) and within what distance trees vanish (y). */
const NEAR_CUT = { value: new THREE.Vector2(0, 0) };
export function setNearCut(tilt: number, dist: number) {
  NEAR_CUT.value.set(tilt, dist);
}
let holeCountMain = 0;
/** Tree cut-outs follow the main view; switch them off while another camera renders. */
export function treeHoles(on: boolean) {
  HOLE_COUNT.value = on ? holeCountMain : 0;
}
const fadeCache = new Map<THREE.Material, THREE.Material>();
function fadeMaterial(src: THREE.Material) {
  const hit = fadeCache.get(src);
  if (hit) return hit;
  const m = src.clone();
  m.userData = { ...src.userData, base: src.userData.base };
  m.alphaToCoverage = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHoles = HOLES;
    shader.uniforms.uHoleCount = HOLE_COUNT;
    shader.uniforms.uBufH = BUF_H;
    shader.uniforms.uNearCut = NEAR_CUT;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceFade;\nvarying float vFade;\nvarying float vCamDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = instanceFade;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDepth = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFade;
        varying float vCamDepth;
        uniform vec2 uNearCut;
        uniform vec3 uHoles[${MAX_HOLES}];
        uniform int uHoleCount;
        uniform float uBufH;`)
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        float cut = 1.0;
        for (int i = 0; i < ${MAX_HOLES}; i++) {
          if (i >= uHoleCount) break;
          float d = length(gl_FragCoord.xy - uHoles[i].xy);
          cut = min(cut, smoothstep(uHoles[i].z * 0.65, uHoles[i].z, d));
        }
        float fore = mix(0.3, 1.0, smoothstep(0.06, 0.3, gl_FragCoord.y / uBufH));
        gl_FragColor.a = min(mix(cut, 1.0, vFade), fore);
        // The low camera: trees between it and Pip vanish rather than fill the screen.
        gl_FragColor.a = min(gl_FragColor.a, mix(1.0, smoothstep(uNearCut.y * 0.75, uNearCut.y, vCamDepth), uNearCut.x));`,
      );
  };
  m.customProgramCacheKey = () => 'wg-fade-holes';
  fadeCache.set(src, m);
  return m;
}

const NOISE_GLSL = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }`;

/** Uniforms every water surface shares (set once per frame from the mood). */
const WATER_U = {
  uTime: { value: 0 },
  uDeep: { value: new THREE.Color('#1c5474') },
  uShallow: { value: new THREE.Color('#3c7c88') },
  uSky: { value: new THREE.Color('#e8d6b0') },
  uFoam: { value: new THREE.Color('#eef6f8') },
  uLight: { value: 1 },
  uTint: { value: new THREE.Color('#ffc88c') },
  uTintAmt: { value: 0.2 },
  uReflect: { value: 0 },
  uSkyRefl: { value: 0 },
  uSkyLight: { value: 0.7 },
  uGlint: { value: 0.2 },
  uRain: { value: 0 },
};

/** Stream surface. `ford` (x, z, radius) is drawn as a wide band of pale shallow water while open. */
function waterMaterial(ford: { x: number; z: number; r: number } | null) {
  return new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...WATER_U,
      uFord: { value: new THREE.Vector3(ford?.x ?? 1e5, ford?.z ?? 1e5, ford?.r ?? 1) },
      uFordOpen: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec2 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uSky, uFoam, uTint;
      uniform float uLight, uTintAmt, uGlint, uReflect, uSkyRefl, uSkyLight, uFordOpen, uRain;
      uniform vec3 uFord;
      varying vec2 vUv;
      varying vec2 vWorld;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        float across = abs(vUv.y - 0.5) * 2.0;
        vec3 col = mix(uDeep, uShallow, smoothstep(0.5, 1.0, across));
        const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
        // The ford: pale turquoise shallows over gravel with ripples running across, while it is
        // open; a flooded ford is deep brown water like the rest.
        float fd = length(vWorld - uFord.xy) / uFord.z;
        float shallow = (1.0 - smoothstep(0.55, 1.45, fd)) * (0.75 + 0.25 * vnoise(vWorld * 0.9)) * uFordOpen;
        float gravel = vnoise(vWorld * 3.1) * 0.6 + vnoise(vWorld * 7.3 + 3.0) * 0.4;
        vec3 bed = mix(vec3(0.16, 0.38, 0.36), vec3(0.34, 0.5, 0.42), gravel);
        float ripple = smoothstep(0.6, 0.95, sin(vWorld.y * 2.6 + vWorld.x * 0.8 - uTime * 2.2) * 0.5 + 0.5);
        col = mix(col, bed + ripple * 0.12, shallow * 0.8);
        // A flooding stream runs peat-brown and fast, with thin foam streaks racing down it (broad
        // pale patches read as cracked concrete).
        // Peat-brown, lighter where the water heaps up over the bed, with foam that tumbles in
        // broken, warped clots of every length (straight even streaks read as lane markings).
        float heap = vnoise(vec2(vUv.x * 1.6 - uTime * 1.8, vUv.y * 4.0));
        col = mix(col, mix(vec3(0.16, 0.1, 0.05), vec3(0.3, 0.21, 0.12), heap), uRain * 0.85);
        vec2 wq = vec2(vUv.x * 2.2 - uTime * 2.4, vUv.y * 7.0);
        wq += vec2(vnoise(wq * 0.7 + 3.1), vnoise(wq * 0.9 + 8.4)) * 1.6;
        float churn = vnoise(wq) * 0.6 + vnoise(wq * vec2(2.3, 1.9) + 5.0) * 0.4;
        float clot = smoothstep(0.62, 0.8, churn) * (0.55 + 0.45 * vnoise(vec2(vUv.x * 0.7 - uTime * 1.1, vUv.y * 2.0)));
        col = mix(col, vec3(0.66, 0.62, 0.54), uRain * 0.5 * clot);
        col = mix(col, uTint * (dot(col, LW) / max(dot(uTint, LW), 0.001)), uTintAmt * (1.0 - 0.6 * uRain));
        float flow = 1.0 + uRain * 1.4;
        float sheen = vnoise(vec2(vUv.x * 1.1 - uTime * 0.18 * flow, vUv.y * 9.0)) * 0.6 + vnoise(vec2(vUv.x * 3.2 - uTime * 0.3 * flow, vUv.y * 17.0) + 3.0) * 0.4;
        float refl = uReflect * (0.5 + 0.5 * smoothstep(0.3, 0.9, across)) * smoothstep(0.45, 0.8, sheen);
        col = mix(col, uTint * 0.95, refl * (1.0 - 0.75 * uRain));
        float streak = smoothstep(0.6, 0.82, vnoise(vec2(vUv.x * 2.4 - uTime * 0.32 * flow, vUv.y * 6.5)));
        col = mix(col, col * 1.3 + vec3(0.025, 0.03, 0.035), streak * (0.4 - 0.15 * uRain) * (1.0 - smoothstep(0.7, 0.95, across)));
        vec2 p = vec2(vUv.x * 3.0 - uTime * 0.55 * flow, vUv.y * 11.0);
        float n = vnoise(p) * 0.6 + vnoise(p * vec2(2.1, 1.7) + 7.0) * 0.4;
        float glint = smoothstep(0.8, 0.9, n) * (1.0 - smoothstep(0.6, 0.9, across)) * 0.7;
        float bankBreak = 0.6 + 0.4 * vnoise(vec2(vUv.x * 2.0 - uTime * 0.8, vUv.y));
        col = mix(col, uFoam, smoothstep(0.93, 0.995, across) * (0.55 + 0.3 * uRain) * mix(1.0, bankBreak, uRain));
        col *= uLight;
        // Rain breaks up the mirror: a churned stream hardly shows the sky.
        float skyRefl = smoothstep(0.62, 0.9, sheen) * (0.7 + 0.3 * smoothstep(0.1, 0.8, across)) * (1.0 - 0.85 * uRain);
        col = mix(col, uSky * uSkyLight, skyRefl * uSkyRefl);
        col += uSky * glint * uGlint;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** A loch: deep water with a shallow shelf at the shore, slow wind ripples and the sky in it. */
function lochMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...WATER_U },
    vertexShader: `
      attribute float aShore;
      attribute float aDepth;
      varying float vShore;
      varying float vDepth;
      varying vec2 vW;
      #include <fog_pars_vertex>
      void main() {
        vShore = aShore;
        vDepth = aDepth;
        vW = (modelMatrix * vec4(position, 1.0)).xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uSky, uFoam, uTint;
      uniform float uLight, uTintAmt, uGlint, uReflect, uSkyRefl, uSkyLight, uRain;
      varying float vShore;
      varying float vDepth;
      varying vec2 vW;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
        vec3 deep = uDeep * 0.85;
        vec3 col = mix(deep, uShallow * 0.82, smoothstep(0.45, 1.0, vShore));
        col = mix(col, uTint * (dot(col, LW) / max(dot(uTint, LW), 0.001)), uTintAmt);
        // Wind on the water: slow sheen and catspaws drifting across, finer ripples in rain.
        vec2 drift = vec2(uTime * 0.6, uTime * 0.25);
        float sheen = vnoise((vW + drift) * 0.05) * 0.6 + vnoise((vW - drift * 0.7) * 0.13) * 0.4;
        col = mix(col, uTint * 0.95, uReflect * smoothstep(0.45, 0.8, sheen));
        float cat = smoothstep(0.6, 0.85, vnoise(vec2((vW.x + uTime * 1.2) * 0.045, vW.y * 0.22)));
        col = mix(col, col * 1.22 + vec3(0.02), cat * 0.32);
        float fine = vnoise(vW * 1.7 + vec2(uTime * 2.0, -uTime * 1.3));
        col *= 1.0 - uRain * 0.12 * fine;
        float n = vnoise(vW * vec2(0.8, 2.4) + vec2(uTime * 0.5, 0.0)) * 0.6 + vnoise(vW * 2.3 + 5.0 - uTime * 0.3) * 0.4;
        float glint = smoothstep(0.8, 0.9, n) * 0.6 * (1.0 - uRain * 0.7);
        // The waterline: a thin, broken line of lapping foam and clear shallows over the stones,
        // following the true depth so the edge sits in the ground instead of cutting it.
        float lap = 0.5 + 0.5 * sin(uTime * 1.3 + vW.x * 0.35 + vW.y * 0.27);
        float line = smoothstep(0.0, 0.03, vDepth) * (1.0 - smoothstep(0.05 + 0.03 * lap, 0.1 + 0.03 * lap, vDepth));
        float brk = smoothstep(0.45, 0.7, vnoise(vW * 1.6 + vec2(uTime * 0.2, 0.0)));
        col = mix(col, uShallow * 1.1, (1.0 - smoothstep(0.03, 0.45, vDepth)) * 0.45);
        col = mix(col, uFoam, line * brk * 0.3);
        col *= uLight;
        col = mix(col, uSky * uSkyLight, smoothstep(0.62, 0.9, sheen) * uSkyRefl * 1.2);
        col += uSky * glint * uGlint;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#7ea6d0') },
      uHorizon: { value: new THREE.Color('#f8d49a') },
      uGlow: { value: new THREE.Color('#fff0c8') },
      uSunDir: { value: new THREE.Vector3(0.5, 0.3, 0.5).normalize() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 uTop, uHorizon, uGlow, uSunDir;
      uniform float uNight, uTime, uCloud;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.05, 0.75, h), 0.8));
        float sun = max(dot(d, normalize(uSunDir)), 0.0);
        col += uGlow * (pow(sun, 8.0) * 0.55 + pow(sun, 200.0) * 1.6) * (1.0 - uNight * 0.8) * (1.0 - uCloud * 0.8);
        vec3 g = floor(d * 180.0);
        float star = step(0.9965, hash(g)) * smoothstep(0.05, 0.4, h);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 1.0) * 40.0);
        col += vec3(0.95, 0.93, 1.0) * star * tw * uNight * (1.0 - uCloud);
        // Overcast: the sky flattens to grey cloud.
        col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.85, uCloud * 0.7);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Season colours for the prop materials (the ground's own come from the terrain generator). */
const SEASON_COLORS: Record<Season, Record<string, string>> = {
  summer: {},
  heather: { heather: '#b26cb0', heather_b: '#9a5aa0' },
  autumn: {
    leaf_oak_a: '#b8722c', leaf_oak_b: '#cc8a36', leaf_birch: '#e0b440', leaf_birch_b: '#cf9a2e',
    grass_blade: '#b0a866', grass_blade_b: '#c4b878', heather: '#ae8068', heather_b: '#9c7262', heather_green: '#7c7648',
    reed: '#a08a50', moss: '#7a7040', 'bush_#5c8a44': '#8c7a3a', bush_dark: '#6e5e30', flower_stem: '#8a8040',
  },
  winter: {
    leaf_oak_a: '#9a8a70', leaf_oak_b: '#a89a80', leaf_birch: '#b8aa88', leaf_birch_b: '#a89878',
    grass_blade: '#a8ac8c', grass_blade_b: '#b8baa0', heather: '#7a6470', heather_b: '#6e5a66', heather_green: '#6a6a54',
    reed: '#b0a07a', moss: '#7a7e66', 'bush_#5c8a44': '#5e6a48', bush_dark: '#4e5a3e', gorse_bloom: '#6a7044',
  },
};

/** Recolour the shared prop materials for a season (reversible: the Blender colour is kept). */
function applySeason(a: Assets, season: Season) {
  const table = SEASON_COLORS[season];
  const seen = new Set<THREE.Material>();
  const visit = (o: THREE.Object3D) =>
    o.traverse((c) => {
      const mats = (c as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        const lm = m as THREE.MeshLambertMaterial;
        if (seen.has(lm) || !lm.color) continue;
        seen.add(lm);
        if (!lm.userData.base) lm.userData.base = lm.color.getHex();
        const want = table[lm.name];
        lm.color.setHex(want ? new THREE.Color(want).getHex() : lm.userData.base);
      }
    });
  for (const o of a.nature.values()) visit(o);
  for (const o of a.structures.values()) visit(o);
  // Faded tree clones copy the colour at clone time: keep them in step.
  for (const [src, clone] of fadeCache) (clone as THREE.MeshLambertMaterial).color?.copy((src as THREE.MeshLambertMaterial).color);
}

export interface WorldHandles {
  root: THREE.Group;
  sky: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  waters: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  lochs: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  /** Gate leaves per pen (swung by the game). */
  gates: { n: THREE.Object3D | null; s: THREE.Object3D | null }[];
  glowMaterials: THREE.MeshLambertMaterial[];
  /** Rock and wall stone: a faint warm self-light at night keeps grey stone from going indigo. */
  stoneMaterials: THREE.MeshLambertMaterial[];
  fadeables: { meshes: THREE.InstancedMesh[]; spots: Placement[]; canopy: number; height: number }[];
  lanternLights: THREE.PointLight[];
  /** The forest ring round the valley (hidden in the wolf-cam close-up, which would sit in it). */
  forest: THREE.Object3D[];
  /** Ground height lookup (for placing screen-space effects). */
  heightAt: (x: number, z: number) => number;
  /** Top of the farmhouse chimney (smoke rises from it), if there is one. */
  chimney: THREE.Vector3 | null;
  /** Ford open (1) or flooded (0) per stream material, eased by the game. */
  fordOpen: number[];
  season: Season;
}

export function buildWorld(level: Level, terrain: Terrain, a: Assets, gen: GeneratedTerrain): WorldHandles {
  const root = new THREE.Group();
  root.name = 'world';
  const L = level.def;
  const rng = new Rng(9001);
  const g = (x: number, z: number) => terrain.ground(x, z);
  const season = gen.season;
  applySeason(a, season);
  SNOW.value = season === 'winter' ? 1 : 0;

  // Ground: smooth shading, a tint from the mood (warm at sunset, cool at night) and hill shading
  // (slopes facing the sun or moon lighter, the far side darker).
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, name: 'terrain' });
  const pathMat = new THREE.MeshLambertMaterial({ vertexColors: true, name: 'path', polygonOffset: true, polygonOffsetFactor: -1 });
  for (const m of [groundMat, pathMat]) {
    const smooth = m === groundMat;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGround = GROUND_TINT;
      shader.uniforms.uHillDir = HILL_DIR;
      shader.uniforms.uWet = WET;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldN;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uGround;\nuniform vec3 uHillDir;\nuniform float uWet;\nvarying vec3 vWorldN;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb *= uGround;
          vec3 hl = normalize(uHillDir * 0.8 + vec3(0.0, 0.6, 0.0));
          float hs = dot(normalize(vWorldN), hl) - hl.y;
          diffuseColor.rgb *= clamp(1.0 + (hs > 0.0 ? 1.0 : 0.06) * hs, 0.97, 1.28);
          diffuseColor.rgb *= 1.0 - 0.25 * uWet;`,
        );
    };
    m.customProgramCacheKey = () => (smooth ? 'wg-ground-smooth' : 'wg-ground');
  }
  const ground = new THREE.Mesh(gen.ground, groundMat);
  ground.name = 'terrain';
  ground.receiveShadow = true;
  gen.ground.userData.disposable = true;
  root.add(ground);
  if (gen.paths) {
    const path = new THREE.Mesh(gen.paths, pathMat);
    path.receiveShadow = true;
    gen.paths.userData.disposable = true;
    root.add(path);
  }

  // Streams (each with the ford that crosses it) and lochs.
  const waters = gen.streams.map((geo, i) => {
    const ford = level.fords.find((f) => level.streamQuery(f.x, f.z).i === i) ?? null;
    const m = new THREE.Mesh(geo, waterMaterial(ford));
    geo.userData.disposable = true;
    m.userData.ford = ford;
    root.add(m);
    return m;
  });
  const lochs = gen.lochs.map((geo) => {
    const m = new THREE.Mesh(geo, lochMaterial());
    geo.userData.disposable = true;
    root.add(m);
    return m;
  });

  // Sky dome follows the camera (positioned each frame).
  const skyProto = a.fx.get('sky_dome')!;
  const skyMesh = (skyProto as THREE.Mesh).isMesh ? (skyProto as THREE.Mesh) : (skyProto.children[0] as THREE.Mesh);
  const sky = new THREE.Mesh(skyMesh.geometry, skyMaterial());
  sky.scale.setScalar(420);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  root.add(sky);

  const fadeables: WorldHandles['fadeables'] = [];

  // Trees from the level, grouped per kind.
  const kinds: Record<string, { proto: string; canopy: number; height: number }> = {
    pine: { proto: 'pine_a', canopy: 1.9, height: 5.6 },
    oak: { proto: 'oak', canopy: 2.6, height: 5.5 },
    birch: { proto: 'birch', canopy: 1.3, height: 5.8 },
  };
  for (const [kind, info] of Object.entries(kinds)) {
    const spots = level.trees.filter((t) => t.kind === kind).map((t) => ({ x: t.x, y: g(t.x, t.z) - 0.1, z: t.z, rot: rng.range(0, Math.PI * 2), scale: t.s * TREE_SCALE }));
    if (!spots.length) continue;
    const inst = instance(a.nature.get(info.proto)!, spots, { fade: true });
    root.add(inst.group);
    fadeables.push({ meshes: inst.meshes, spots, canopy: info.canopy, height: info.height });
  }

  // Forest ring outside the valley edge.
  const forestA: Placement[] = [];
  const forestB: Placement[] = [];
  const forestBirch: Placement[] = [];
  const W = L.world;
  for (let i = 0; i < 12000 && forestA.length + forestB.length + forestBirch.length < 520; i++) {
    const x = rng.range(W.minX + 3, W.maxX - 3);
    const z = rng.range(W.minZ + 3, W.maxZ - 3);
    if (pointInPolygon(x, z, level.boundary)) continue;
    const d = level.boundaryDistance(x, z);
    if (d < 2.2 || d > 36) continue;
    if (level.waterQuery(x, z).edge < 2.5) continue;
    const s: Placement = { x, y: g(x, z) - 0.15, z, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.45) * TREE_SCALE, sy: rng.range(0.9, 1.15) };
    const r = rng.next();
    if (d < 9 && r < 0.14) forestBirch.push(s);
    else if (r < 0.55) forestA.push(s);
    else forestB.push(s);
  }
  const forest: THREE.Object3D[] = [];
  for (const [proto, spots, canopy, height] of [
    ['pine_a', forestA, 1.9, 5.6],
    ['pine_b', forestB, 1.8, 6.6],
    ['birch', forestBirch, 1.3, 5.8],
  ] as const) {
    if (!spots.length) continue;
    const inst = instance(a.nature.get(proto)!, spots, { fade: true });
    root.add(inst.group);
    forest.push(inst.group);
    fadeables.push({ meshes: inst.meshes, spots: spots as Placement[], canopy, height });
  }

  // Bushes and rocks from the level (they have colliders).
  const bushSpots = L.bushes.map(([x, z, s]) => ({ x, y: g(x, z) - 0.05, z, rot: rng.range(0, 6.28), scale: s * 1.05 }));
  if (bushSpots.length) {
    root.add(instance(a.nature.get('bush_a')!, bushSpots.filter((_, i) => i % 2 === 0)).group);
    root.add(instance(a.nature.get('bush_b')!, bushSpots.filter((_, i) => i % 2 === 1)).group);
  }
  const rockKinds = ['rock_a', 'rock_b', 'rock_c'];
  for (let k = 0; k < 3; k++) {
    const spots = L.rocks.filter((_, i) => i % 3 === k).map(([x, z, r]) => ({ x, y: g(x, z) - 0.15 * r, z, rot: rng.range(0, 6.28), scale: r * 0.95 }));
    if (spots.length) root.add(instance(a.nature.get(rockKinds[k])!, spots).group);
  }

  // Landmarks: what makes each place itself from the herding camera (crags, a stell, a jetty...).
  // One instanced set per kind; the stell is three quarters of a ring, left open on one side.
  const byKind = new Map<string, Placement[]>();
  for (const l of L.landmarks ?? []) {
    const rot = ((l.angle ?? 0) * Math.PI) / 180;
    const sc = l.scale ?? 1;
    const [x, z] = l.at;
    const sink = l.kind === 'jetty' ? 0 : l.kind.startsWith('crag') ? 0.25 * sc : 0.05;
    const y = l.kind === 'jetty' ? g(x, z) : g(x, z) - sink;
    if (l.kind === 'stell') {
      for (let k = 0; k < 3; k++) {
        const arr = byKind.get('stell_arc') ?? [];
        arr.push({ x, y, z, rot: rot + (k * Math.PI) / 2, scale: sc });
        byKind.set('stell_arc', arr);
      }
      continue;
    }
    const arr = byKind.get(l.kind) ?? [];
    arr.push({ x, y, z, rot, scale: sc });
    byKind.set(l.kind, arr);
  }
  for (const [kind, spots] of byKind) {
    const proto = a.landmarks.get(kind);
    if (proto) root.add(instance(proto, spots, { shadow: kind !== 'scree' && kind !== 'cotton_grass' }).group);
  }

  // Ground detail: tussocks, flowers, heather, bracken, reeds. No colliders, no shadows (cheap).
  const xs = level.boundary.map((p) => p[0]);
  const zs = level.boundary.map((p) => p[1]);
  const bx0 = Math.min(...xs);
  const bx1 = Math.max(...xs);
  const bz0 = Math.min(...zs);
  const bz1 = Math.max(...zs);
  const area = (bx1 - bx0) * (bz1 - bz0);
  const density = area / (190 * 150);
  const clear = (x: number, z: number, pad: number) => {
    if (!pointInPolygon(x, z, level.boundary)) return false;
    if (level.boundaryDistance(x, z) < 1) return false;
    if (level.waterQuery(x, z).edge < 0.6) return false;
    if (level.penAt(x, z, -1.5)) return false;
    for (const r of level.rects) if (x > r.minX - 2 && x < r.maxX + 2 && z > r.minZ - 2 && z < r.maxZ + 2) return false;
    for (const c of level.circles) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + pad) ** 2) return false;
    return true;
  };
  const onPath = (x: number, z: number) => {
    for (const P of L.paths) {
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, az] = P[i];
        const [bx, bz] = P[i + 1];
        const abx = bx - ax;
        const abz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)));
        if ((x - ax - abx * t) ** 2 + (z - az - abz * t) ** 2 < 1.8 * 1.8) return true;
      }
    }
    return false;
  };
  const scatter = (count: number, test: (x: number, z: number) => boolean, scale: [number, number]) => {
    const out: Placement[] = [];
    const n = Math.round(count * density);
    for (let i = 0; i < n * 6 && out.length < n; i++) {
      const x = rng.range(bx0, bx1);
      const z = rng.range(bz0, bz1);
      if (!test(x, z)) continue;
      out.push({ x, y: g(x, z) - 0.02, z, rot: rng.range(0, 6.28), scale: rng.range(scale[0], scale[1]) });
    }
    return out;
  };
  const add = (proto: string, spots: Placement[], shadow = false) => {
    if (spots.length) root.add(instance(a.nature.get(proto)!, spots, { shadow }).group);
  };
  const grassTest = (x: number, z: number) => clear(x, z, 0.4) && !onPath(x, z);
  const clump = (x: number, z: number) => Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) + Math.sin((x - z) * 0.09) * 0.6;
  const tussock = (x: number, z: number) => grassTest(x, z) && clump(x, z) > -0.15 + rng.next() * 0.5;
  // The grass field (grass.ts) is the sward; a few darker tussocks stay for texture.
  add('grass_a', scatter(220, tussock, [0.9, 1.5]));
  add('grass_b', scatter(220, tussock, [0.9, 1.5]));
  const cov = { flowers: 1, heather: 1, bracken: 1, stones: 1, ...L.cover };
  // A flower-thick place (a machair) has drifts everywhere, not only in the meadow patches.
  const drift = cov.flowers > 2 ? 0.05 : 0.42;
  const meadow = (x: number, z: number) => grassTest(x, z) && level.boundaryDistance(x, z) > 18 && Math.sin(x * 0.11) * Math.cos(z * 0.13) > drift;
  const flowers = (season === 'winter' ? 0 : season === 'autumn' ? 50 : 190) * cov.flowers;
  add('flower_white', scatter(flowers, meadow, [0.9, 1.3]));
  add('flower_yellow', scatter(season === 'heather' ? flowers * 0.6 : flowers, meadow, [0.9, 1.3]));
  const slope = (x: number, z: number) => Math.hypot(g(x + 1, z) - g(x - 1, z), g(x, z + 1) - g(x, z - 1)) / 2;
  const patch2 = (x: number, z: number) => Math.sin(x * 0.07 + 2.1) * Math.cos(z * 0.061 + 0.3) + Math.sin((x + z) * 0.05) * 0.4;
  const scree = (x: number, z: number) => (cov.stones > 1.5 || (level.boundaryDistance(x, z) < 24 && slope(x, z) > 0.2)) && grassTest(x, z) && patch2(x, z) > (cov.stones > 1.5 ? -0.2 : 0.2);
  for (const [k, kind] of ['rock_a', 'rock_b', 'rock_c'].entries()) {
    add(kind, scatter(70 * cov.stones, scree, [0.14, 0.32]).map((p) => ({ ...p, y: p.y - 0.05, rot: p.rot + k })));
  }
  // Highland cover: heather, bracken and gorse in patches on the uplands and along every slope
  // near the rim, where the grass gives way to the hill.
  const patch = (x: number, z: number, k: number) => Math.sin(x * 0.083 + k) * Math.cos(z * 0.097 - k * 0.7) + Math.sin((x + z) * 0.041 + k * 2.1) * 0.5;
  const band = (x: number, z: number) =>
    (L.heather ?? []).some((b) => (b.maxX === undefined || x < b.maxX) && (b.minX === undefined || x > b.minX) && (b.maxZ === undefined || z < b.maxZ) && (b.minZ === undefined || z > b.minZ));
  const upland = (x: number, z: number) => band(x, z) || level.boundaryDistance(x, z) < 18;
  const hill = (x: number, z: number) => upland(x, z) && grassTest(x, z) && patch(x, z, 0.3) > 0.1;
  add('heather', scatter((season === 'heather' ? 640 : 460) * cov.heather, hill, [0.9, 1.6]));
  const fern = (x: number, z: number) => upland(x, z) && grassTest(x, z) && patch(x, z, 2.2) > 0.35;
  add('bracken_a', scatter(170 * cov.bracken, fern, [0.9, 1.4]));
  add('bracken_b', scatter(150 * cov.bracken, fern, [0.9, 1.4]));
  // No gorse where the wolves come out of the trees (its orange flowers beside a wolf read as noise).
  const nearDen = (x: number, z: number) => level.dens.some(([dx, dz]) => (x - dx) ** 2 + (z - dz) ** 2 < 34 * 34);
  const gorseSpot = (x: number, z: number) => level.boundaryDistance(x, z) < 14 && !nearDen(x, z) && grassTest(x, z) && patch(x, z, 4.1) > 0.45;
  add('gorse', scatter(70, gorseSpot, [0.8, 1.3]), true);
  const bank = (x: number, z: number) => {
    const w = level.waterQuery(x, z);
    return w.edge > -0.2 && w.edge < 1.6 && pointInPolygon(x, z, level.boundary) && !level.crossingAt(x, z) && !level.onBridge(x, z);
  };
  add('reeds', scatter(level.lochs.length ? 320 : 170, bank, [0.8, 1.3]));

  // Old field walls: 4 m sections laid end to end along each line, some half fallen.
  const wallSpots: Placement[] = [];
  const brokenSpots: Placement[] = [];
  for (const line of L.fieldWalls) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 4));
      const rot = -Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        (rng.next() < 0.3 ? brokenSpots : wallSpots).push({ x, y: g(x, z) - 0.06, z, rot: rot + rng.range(-0.03, 0.03), scale: 1 });
      }
    }
  }
  if (wallSpots.length) root.add(instance(a.structures.get('field_wall')!, wallSpots).group);
  if (brokenSpots.length) root.add(instance(a.structures.get('field_wall_broken')!, brokenSpots).group);

  // Logs and stumps on the forest floor just outside the valley.
  const floorSpots = (n: number) => scatter(n, (x, z) => !pointInPolygon(x, z, level.boundary) && level.boundaryDistance(x, z) > 2 && level.boundaryDistance(x, z) < 8, [0.9, 1.2]);
  add('log', floorSpots(8), true);
  add('stump', floorSpots(8), true);

  // Buildings and props.
  const place = (name: string, x: number, y: number, z: number, rotY = 0, scale = 1) => {
    const o = a.structures.get(name)!.clone(true);
    o.position.set(x, y, z);
    o.rotation.y = rotY;
    o.scale.setScalar(scale);
    root.add(o);
    return o;
  };
  const gates: WorldHandles['gates'] = [];
  const lamps: THREE.Object3D[] = [];
  level.pens.forEach((p, i) => {
    const fold = place('fold', p.cx, gen.penY[i], p.cz, p.angle, p.scale);
    gates.push({ n: fold.getObjectByName('gate_n') ?? null, s: fold.getObjectByName('gate_s') ?? null });
    for (const side of [-1, 1]) {
      const l = p.toWorld(-9.8 * p.scale, 7.4 * p.scale * side);
      lamps.push(place('lantern', l.x, g(l.x, l.z), l.z, p.angle + (side < 0 ? Math.PI * 0.75 : Math.PI * 0.25)));
    }
  });
  let chimney: THREE.Vector3 | null = null;
  if (L.farmhouse) {
    const fh = place('farmhouse', L.farmhouse.center[0], gen.farmY, L.farmhouse.center[1]);
    fh.updateMatrixWorld(true);
    const box = new THREE.Box3();
    fh.traverse((o) => {
      const m = o as THREE.Mesh;
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      if (m.isMesh && mats.some((mm) => mm.name === 'chimney_stone')) box.expandByObject(m);
    });
    if (!box.isEmpty()) chimney = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  }
  level.bridges.forEach((b, i) => {
    const o = place('bridge', b.x, terrain.bridgeDeck(i) - 0.55, b.z, -Math.atan2(b.uz, b.ux));
    o.scale.set(b.len / 13, 1, b.w / 6.4);
  });
  for (const [x, z, deg] of L.hay) place('hay', x, g(x, z) - 0.05, z, (deg * Math.PI) / 180);
  for (const [x, z, rot] of L.signposts) place('signpost', x, g(x, z), z, rot);
  for (const f of level.fords) {
    const stones = a.structures.get('stepping_stones')!.clone(true);
    const across = level.crossings.find((c) => c.ford === f)!;
    stones.position.set(f.x, terrain.water(f.x, f.z) - 0.02, f.z);
    stones.rotation.y = -Math.atan2(across.uz, across.ux);
    root.add(stones);
  }

  // A trial course: white gate posts with red flags, the handler's post with a crook, bunting
  // strung along the field's edge near the post, and the show marquee.
  if (level.gates.length || level.post) {
    const white = new THREE.MeshLambertMaterial({ name: 'post_white', color: '#ece6d8', flatShading: true });
    const red = new THREE.MeshLambertMaterial({ name: 'flag_red', color: '#c8402e', flatShading: true, side: THREE.DoubleSide });
    const blue = new THREE.MeshLambertMaterial({ name: 'flag_blue', color: '#3a5c9a', flatShading: true, side: THREE.DoubleSide });
    const yellow = new THREE.MeshLambertMaterial({ name: 'flag_yellow', color: '#e8b440', flatShading: true, side: THREE.DoubleSide });
    const wood = a.structures.get('signpost') ? undefined : undefined;
    void wood;
    const postGeo = new THREE.CylinderGeometry(0.26, 0.3, 2.8, 6);
    postGeo.translate(0, 1.4, 0);
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.35, 0, 1.1, 2.0, 0, 0, 1.6, 0], 3));
    flagGeo.computeVertexNormals();
    const course = new THREE.Group();
    for (const gt of level.gates) {
      for (const [x, z] of [
        [gt.ax, gt.az],
        [gt.bx, gt.bz],
      ]) {
        const y = g(x, z);
        const p = new THREE.Mesh(postGeo, white);
        p.position.set(x, y - 0.05, z);
        p.castShadow = true;
        const f = new THREE.Mesh(flagGeo, red);
        f.position.set(x, y, z);
        // Flags point away from the gate's middle.
        f.rotation.y = Math.atan2(-(x - gt.x), -(z - gt.z)) + Math.PI / 2;
        f.castShadow = true;
        course.add(p, f);
      }
      // A hurdle wing outside each post (three rails, red and white), so the gate reads as a
      // gateway from the herding camera, not two sticks.
      const dx = gt.bx - gt.ax;
      const dz = gt.bz - gt.az;
      const l = Math.hypot(dx, dz);
      for (const [ox, oz, sgn] of [
        [gt.ax, gt.az, -1],
        [gt.bx, gt.bz, 1],
      ] as const) {
        const hx = ox + (dx / l) * 1.9 * sgn;
        const hz = oz + (dz / l) * 1.9 * sgn;
        for (let r = 0; r < 3; r++) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 0.14), r % 2 ? white : red);
          rail.geometry.userData.disposable = true;
          rail.position.set(hx, g(hx, hz) + 0.35 + r * 0.38, hz);
          rail.rotation.y = -Math.atan2(dz, dx);
          rail.castShadow = true;
          course.add(rail);
        }
        const end = new THREE.Mesh(postGeo, white);
        end.position.set(ox + (dx / l) * 3.7 * sgn, g(ox + (dx / l) * 3.7 * sgn, oz + (dz / l) * 3.7 * sgn) - 0.05, oz + (dz / l) * 3.7 * sgn);
        end.scale.set(0.6, 0.5, 0.6);
        course.add(end);
      }
    }
    if (level.post) {
      const { x, z } = level.post;
      const y = g(x, z);
      const p = new THREE.Mesh(postGeo, white);
      p.position.set(x, y, z);
      p.scale.set(0.8, 0.75, 0.8);
      const crook = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 5, 10, Math.PI * 1.3), new THREE.MeshLambertMaterial({ name: 'crook', color: '#7a5636', flatShading: true }));
      crook.geometry.userData.disposable = true;
      crook.position.set(x, y + 1.95, z + 0.1);
      course.add(p, crook);
      // The marquee: a striped tent beside the post, and bunting along the fence line.
      const tent = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 6), white);
      body.geometry.userData.disposable = true;
      body.position.y = 1.3;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3, 4, 1), red);
      roof.geometry.userData.disposable = true;
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1.05, 1, 0.72);
      roof.position.y = 4.1;
      body.castShadow = roof.castShadow = true;
      body.receiveShadow = true;
      tent.add(body, roof);
      tent.position.set(x + 34, g(x + 34, z + 14), z + 14);
      course.add(tent);
      level.circles.push({ x: x + 34, z: z + 14, r: 5.2 });
      const flagMats = [red, blue, yellow, white];
      const pennant = new THREE.BufferGeometry();
      pennant.setAttribute('position', new THREE.Float32BufferAttribute([-0.35, 0, 0, 0.35, 0, 0, 0, -0.7, 0], 3));
      pennant.computeVertexNormals();
      for (let i = 0; i < 46; i++) {
        const bx = x - 46 + i * 2;
        const bz = z + 15 + Math.sin(i * 0.5) * 0.4;
        const m = new THREE.Mesh(pennant, flagMats[i % 4]);
        m.position.set(bx, g(bx, bz) + 3.2 - Math.abs(Math.sin((i % 8) * (Math.PI / 8))) * 0.6, bz);
        course.add(m);
      }
      // The crowd: the whole glen turned out, two or three deep behind the bunting, in coats of
      // every colour (a body and a head each, instanced: two draw calls).
      const coats = ['#3a5c9a', '#c8402e', '#5f7a3a', '#e8b440', '#7a4a6a', '#2e3a48', '#b86a3a', '#d8d0c0', '#4a7a8a'].map((c) => new THREE.Color(c));
      const spots: [number, number][] = [];
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 110; i++) {
        const sx = x - 44 + rnd() * 88;
        const sz = z + 17 + rnd() * 3.2;
        if (Math.abs(Math.abs(sx - x) - 12) < 2.6) continue;
        spots.push([sx, sz]);
      }
      const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.8, 2, 6);
      bodyGeo.translate(0, 0.75, 0);
      const headGeo = new THREE.SphereGeometry(0.24, 6, 4);
      headGeo.translate(0, 1.62, 0);
      bodyGeo.userData.disposable = headGeo.userData.disposable = true;
      const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ name: 'crowd_coat', flatShading: true }), spots.length);
      const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ name: 'crowd_face', color: '#e0b494', flatShading: true }), spots.length);
      const m4 = new THREE.Matrix4();
      spots.forEach(([sx, sz], i) => {
        const s = 1.15 + rnd() * 0.3;
        m4.makeScale(s, s, s).setPosition(sx, g(sx, sz) - 0.05, sz);
        bodies.setMatrixAt(i, m4);
        heads.setMatrixAt(i, m4);
        bodies.setColorAt(i, coats[Math.floor(rnd() * coats.length)]);
      });
      bodies.castShadow = heads.castShadow = true;
      course.add(bodies, heads);
    }
    root.add(course);
  }

  // Warm light from the lanterns at each gate once dusk falls, and a soft glow over the fold.
  const lanternLights = lamps.map((l) => {
    const light = new THREE.PointLight(0xffa24a, 0, 20, 2);
    const lampPos = new THREE.Vector3();
    l.updateMatrixWorld(true);
    (l.getObjectByName('lantern_light') ?? l).getWorldPosition(lampPos);
    light.position.copy(lampPos);
    root.add(light);
    return light;
  });
  const fold = level.fold;
  const foldLight = new THREE.PointLight(0xffc98a, 0, 20, 2);
  foldLight.position.set(fold.cx + 1, g(fold.cx, fold.cz) + 7.5, fold.cz);
  foldLight.userData.gain = 1.5;
  root.add(foldLight);
  lanternLights.push(foldLight);

  // Materials that glow at night (windows, lantern glass), stone that must stay grey by moonlight,
  // and snow and rain on everything static.
  const glowMaterials: THREE.MeshLambertMaterial[] = [];
  const stoneMaterials: THREE.MeshLambertMaterial[] = [];
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[] | undefined;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
      if (!mm.isMeshLambertMaterial) continue;
      if (mm !== groundMat && mm !== pathMat && !/^(plank_|post_wood|beam)/.test(mm.name)) weatherize(mm);
      if (!mm.emissive) continue;
      if (mm.emissive.getHex() !== 0 && !stoneMaterials.includes(mm)) {
        if (!glowMaterials.includes(mm)) glowMaterials.push(mm);
      } else if (/^(stone_|drystone_|pillar|chimney_stone|house_plinth)/.test(mm.name) && !stoneMaterials.includes(mm)) {
        mm.emissive.set(0x5a4a38);
        mm.emissiveIntensity = 0;
        stoneMaterials.push(mm);
      }
    }
  });

  return {
    root,
    sky,
    waters,
    lochs,
    gates,
    glowMaterials,
    stoneMaterials,
    fadeables,
    lanternLights,
    forest,
    heightAt: (x: number, z: number) => terrain.height(x, z),
    chimney,
    fordOpen: level.fords.map(() => 1),
    season,
  };
}

/** Free what this level made (generated ground, cloned prop geometry); shared assets stay. */
export function disposeWorld(w: WorldHandles) {
  w.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry?.userData.disposable) m.geometry.dispose();
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) (m as unknown as THREE.InstancedMesh).dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat && (mat as THREE.ShaderMaterial).isShaderMaterial) mat.dispose();
  });
  w.root.removeFromParent();
}

/** Per-frame world updates: water flow, sky colours, night glow, and fading trees that block the view. */
export function updateWorld(w: WorldHandles, mood: MoodValues, time: number, camera: THREE.Camera, focus: { x: number; z: number }[], dt: number, bufW = 1, bufH = 1, weather: { rain: number; cloud: number } = { rain: 0, cloud: 0 }) {
  let n = 0;
  for (const p of focus) {
    if (n >= MAX_HOLES) break;
    const y = w.heightAt(p.x, p.z) + 1;
    tmpP.set(p.x, y, p.z).project(camera);
    if (tmpP.z > 1 || Math.abs(tmpP.x) > 1.2 || Math.abs(tmpP.y) > 1.2) continue;
    const dist = camera.position.distanceTo(tmpS.set(p.x, y, p.z));
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 34;
    HOLES.value[n].set(((tmpP.x + 1) / 2) * bufW, ((tmpP.y + 1) / 2) * bufH, (3.18 * bufH * 0.5) / (Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.max(10, dist)));
    n++;
  }
  holeCountMain = n;
  HOLE_COUNT.value = n;
  BUF_H.value = bufH;
  UP_VIEW.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  WET.value = weather.rain;
  const wu = WATER_U;
  wu.uTime.value = time;
  wu.uRain.value = weather.rain;
  wu.uSky.value.copy(mood.skyHorizon).lerp(WHITE, 0.35);
  wu.uLight.value = 0.95 * Math.min(1.05, Math.max(0.62, groundLight(mood) / GOLDEN_GROUND));
  const evening = Math.min(1, Math.max(0, (mood.t - 0.3) / 0.15));
  wu.uGlint.value = (0.28 * evening + 0.12 * mood.night) * (1 - weather.cloud * 0.6);
  wu.uSkyRefl.value = (0.1 + 0.22 * evening - 0.1 * mood.night) * (1 - weather.cloud * 0.5);
  wu.uSkyLight.value = 0.75 - 0.4 * mood.night;
  GROUND_TINT.value.copy(mood.ground);
  HILL_DIR.value.set(mood.keyDir.x, 0, mood.keyDir.z).normalize();
  wu.uTint.value.copy(mood.skyHorizon).lerp(LAVENDER, 0.65).lerp(INDIGO, mood.night);
  wu.uReflect.value = 0.16 * evening * (1 - 0.6 * mood.night);
  wu.uTintAmt.value = 0.06 + 0.22 * evening + 0.1 * mood.night;
  // Fords ease shut as they flood.
  for (const m of w.waters) {
    const ford = m.userData.ford as { open: boolean } | null;
    const u = m.material.uniforms.uFordOpen;
    if (ford) u.value += ((ford.open ? 1 : 0) - u.value) * (1 - Math.exp(-0.8 * dt));
  }
  const su = w.sky.material.uniforms;
  su.uTop.value.copy(mood.skyTop);
  su.uHorizon.value.copy(mood.skyHorizon);
  su.uGlow.value.copy(mood.sunGlow);
  su.uSunDir.value.copy(mood.sunDir);
  su.uNight.value = mood.night;
  su.uTime.value = time;
  su.uCloud.value = weather.cloud;
  w.sky.position.copy(camera.position);
  for (const m of w.glowMaterials) m.emissiveIntensity = 0.2 + 3.2 * mood.night;
  // A trace only, and the stone itself darkens with the night: pale boulders under the moon read
  // as sheep lying down.
  for (const m of w.stoneMaterials) {
    m.emissiveIntensity = 0.12 * mood.night;
    if (m.userData.base === undefined) m.userData.base = m.color.getHex();
    m.color.setHex(m.userData.base).multiplyScalar(1 - 0.45 * mood.night);
  }
  for (const l of w.lanternLights) l.intensity = 46 * (l.userData.gain ?? 1) * Math.min(1, Math.max(0, (mood.night - 0.12) / 0.3));

  // Trees standing between the camera and anything that matters open a window.
  const k = 1 - Math.exp(-6 * dt);
  for (const f of w.fadeables) {
    const attr = f.meshes[0].geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute | undefined;
    if (!attr) continue;
    let dirty = false;
    for (let i = 0; i < f.spots.length; i++) {
      const s = f.spots[i];
      const reach = f.height * s.scale * 0.95;
      let hide = false;
      for (const p of focus) {
        const dz = s.z - p.z;
        if (dz < -0.5 || dz > reach + 1.5) continue;
        if (Math.abs(s.x - p.x) < f.canopy * s.scale + 1.2) {
          hide = true;
          break;
        }
      }
      const cur = attr.getX(i);
      const want = hide ? 0 : 1;
      if (Math.abs(cur - want) > 0.005) {
        const next = cur + (want - cur) * k;
        for (const m of f.meshes) (m.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute).setX(i, next);
        dirty = true;
      }
    }
    if (dirty) for (const m of f.meshes) (m.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
