import * as THREE from 'three';
import type { Level } from '../game/level';
import { Rng } from '../game/math';
import { Noise2 } from '../game/noise';
import type { Terrain } from './terrain';
import type { GeneratedTerrain, Season } from './terraingen';

// A living grass field: tens of thousands of small instanced tufts, coloured from the ground under
// them, swaying in gusts that roll across the valley, and parted by Pip, the sheep and the wolves as
// they move through it. Laid out in square tiles so the camera only draws the few it can see.

const TILE = 24;
const DEEP = new THREE.Color(0.82, 0.95, 0.8);
const SEED = new THREE.Color('#d8c88a');
const BLADES = 7;
const MAX_PUSH = 24;

/** Shared by every tile: time, wind and the animals pushing the grass aside. */
const U = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3(0.85, 0.35, 1) },
  uPush: { value: Array.from({ length: MAX_PUSH }, () => new THREE.Vector4(1e5, 1e5, 0, 0)) },
  uPushN: { value: 0 },
  uTipK: { value: 1.42 },
};

/** One tuft: a fan of thin tapered blades; `aH` is 0 at the root and 1 at each tip. */
function tuftGeometry() {
  const pos: number[] = [];
  const h: number[] = [];
  const rng = new Rng(5);
  for (let b = 0; b < BLADES; b++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 0.22);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const len = rng.range(0.5, 0.95);
    const w = rng.range(0.07, 0.11);
    const lean = rng.range(0.05, 0.22);
    const ta = rng.range(0, Math.PI * 2);
    const px = Math.cos(ta) * w;
    const pz = Math.sin(ta) * w;
    // A tip leaning outwards from the tuft's centre.
    const tx = x + Math.cos(a) * lean;
    const tz = z + Math.sin(a) * lean;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, tx, len, tz);
    h.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  // Lit like the ground under it: every normal points up.
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

function grassMaterial() {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aH;
        uniform float uTime, uTipK;
        uniform vec3 uWind;
        uniform vec4 uPush[${MAX_PUSH}];
        uniform int uPushN;
        varying float vH;
        varying float vGust;
        float ghash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(ghash(i), ghash(i + vec2(1.0, 0.0)), u.x), mix(ghash(i + vec2(0.0, 1.0)), ghash(i + vec2(1.0, 1.0)), u.x), u.y);
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vH = aH;
        vGust = 0.0;
        #ifdef USE_INSTANCING
        if (aH > 0.0) {
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec2 wd = normalize(uWind.xy);
          // Gusts: broad waves rolling downwind, with a quicker flutter in every blade.
          float gust = gnoise(root.xz * 0.045 - wd * uTime * 0.55) * 0.75 + gnoise(root.xz * 0.11 - wd * uTime * 1.1) * 0.25;
          float flutter = sin(uTime * 5.5 + root.x * 1.7 + root.z * 2.3 + position.x * 9.0) * 0.06;
          vec2 bend = wd * (0.08 + gust * gust * 0.62 * uWind.z) + vec2(flutter, -flutter * 0.6);
          vGust = gust * gust * min(1.5, uWind.z);
          // Animals push the grass aside around them.
          for (int i = 0; i < ${MAX_PUSH}; i++) {
            if (i >= uPushN) break;
            vec2 d = root.xz - uPush[i].xy;
            float dist = length(d);
            float k = 1.0 - smoothstep(uPush[i].z * 0.4, uPush[i].z, dist);
            bend += (d / max(dist, 0.001)) * k * uPush[i].w;
          }
          float bl = length(bend);
          if (bl > 1.15) bend *= 1.15 / bl;
          // The tip moves over and down a little as it bends.
          vec3 wb = vec3(bend.x, -0.45 * dot(bend, bend), bend.y) * aH;
          mat3 im = mat3(instanceMatrix);
          float s2 = dot(im[0], im[0]);
          transformed += transpose(im) * wb / max(s2, 0.0001);
        }
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying float vGust;\nuniform float uTipK;')
      // Both faces of a blade are lit like the ground under it (the usual double-sided flip turned
      // every back face's normal downwards, and half the field went black).
      .replace('#include <normal_fragment_begin>', 'float faceDirection = gl_FrontFacing ? 1.0 : -1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Darker in the root shade, sunlit at the tips.
        diffuseColor.rgb *= mix(0.5, uTipK, vH);
        // A gust shows the pale undersides: waves of light roll across the field with the wind.
        diffuseColor.rgb *= 1.0 + vGust * vH * 0.45;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.05, 0.82), vH * 0.5);`,
      );
  };
  m.customProgramCacheKey = () => 'wg-grass';
  return m;
}

export interface GrassOptions {
  /** Tufts per square metre on open ground. */
  density: number;
}

export class GrassField {
  readonly root = new THREE.Group();
  private tiles: { mesh: THREE.InstancedMesh; full: number }[] = [];
  private fraction = 1;
  private geo = tuftGeometry();
  private mat = grassMaterial();

  constructor(level: Level, terrain: Terrain, gen: GeneratedTerrain, season: Season, opts: GrassOptions) {
    this.root.name = 'grass';
    const def = level.def;
    const rng = new Rng(4242);
    const noise = new Noise2(91);
    const xs = level.boundary.map((p) => p[0]);
    const zs = level.boundary.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs) / TILE) * TILE;
    const z0 = Math.floor(Math.min(...zs) / TILE) * TILE;
    const x1 = Math.max(...xs);
    const z1 = Math.max(...zs);
    const colors = gen.ground.getAttribute('color') as THREE.BufferAttribute;
    const hf = gen.hf;
    const pathNear = (x: number, z: number) => {
      for (const P of def.paths) {
        for (let i = 0; i < P.length - 1; i++) {
          const [ax, az] = P[i];
          const [bx, bz] = P[i + 1];
          const abx = bx - ax;
          const abz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)));
          if ((x - ax - abx * t) ** 2 + (z - az - abz * t) ** 2 < 2.2 * 2.2) return true;
        }
      }
      return false;
    };
    const winter = season === 'winter';
    const autumn = season === 'autumn';
    const c = new THREE.Color();
    const tint = new THREE.Color(winter ? '#c8b98a' : autumn ? '#e8d090' : '#ffffff');
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const density = opts.density * (winter ? 0.16 : 1);
    for (let tz = z0; tz < z1; tz += TILE) {
      for (let tx = x0; tx < x1; tx += TILE) {
        const spots: { x: number; z: number; y: number; r: number; s: number; c: THREE.Color }[] = [];
        const n = Math.round(TILE * TILE * density);
        for (let i = 0; i < n; i++) {
          const x = tx + rng.next() * TILE;
          const z = tz + rng.next() * TILE;
          // Meadow patches: thick in places, thin lawn between.
          const patch = noise.fbm(x / 18, z / 18, 2, 3) * 1.4 + 0.55;
          if (rng.next() > patch) continue;
          if (!level.insideValley(x, z) || level.boundaryDistance(x, z) < 0.8) continue;
          // Thinning out towards the water, so a shore never ends in a hard line of grass.
          const wq = level.waterQuery(x, z).edge;
          if (wq < 0.4 || (wq < 3 && rng.next() > (wq - 0.4) / 2.6) || level.onBridge(x, z, -1)) continue;
          if (level.penAt(x, z, -1.2)) continue;
          if (level.rects.some((r) => x > r.minX - 1.5 && x < r.maxX + 1.5 && z > r.minZ - 1.5 && z < r.maxZ + 3)) continue;
          if (level.circles.some((cc) => (cc.x - x) ** 2 + (cc.z - z) ** 2 < (cc.r + 0.2) ** 2)) continue;
          if (pathNear(x, z)) continue;
          // Not on the sheep trods (a thin line of worn ground).
          const tm = gen.trodMask;
          const tmx = Math.round(x - tm.minX);
          const tmz = Math.round(z - tm.minZ);
          if (tmx >= 0 && tmz >= 0 && tmx < tm.nx && tmz < tm.nz && tm.data[tmz * tm.nx + tmx] && rng.next() < 0.85) continue;
          const ix = Math.round((x - hf.minX) / hf.step);
          const iz = Math.round((z - hf.minZ) / hf.step);
          const ci = Math.max(0, Math.min(hf.nx * hf.nz - 1, iz * hf.nx + ix));
          c.setRGB(colors.getX(ci), colors.getY(ci), colors.getZ(ci));
          // The ground's colour, a shade greener and varied blade to blade.
          c.multiply(tint).multiplyScalar(0.86 + rng.next() * 0.3);
          // Some tufts deeper green, some going to seed.
          const hue = rng.next();
          if (hue < 0.25) c.multiply(DEEP);
          else if (hue > 0.85) c.lerp(SEED, 0.35);
          if (!winter) c.g *= 1.05;
          spots.push({ x, z, y: terrain.ground(x, z) - 0.03, r: rng.next() * Math.PI * 2, s: (0.75 + rng.next() * 0.6) * (winter ? 0.8 : 1), c: c.clone() });
        }
        if (!spots.length) continue;
        const mesh = new THREE.InstancedMesh(this.geo, this.mat, spots.length);
        spots.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp.r);
          s.set(sp.s, sp.s * (0.85 + (i % 7) * 0.05), sp.s);
          p.set(sp.x, sp.y, sp.z);
          mesh.setMatrixAt(i, m.compose(p, q, s));
          mesh.setColorAt(i, sp.c);
        });
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.computeBoundingSphere();
        this.root.add(mesh);
        this.tiles.push({ mesh, full: spots.length });
      }
    }
  }

  /** Draw a fraction of each tile's tufts (graphics tiers). */
  setFraction(f: number) {
    this.fraction = f;
    for (const t of this.tiles) t.mesh.count = Math.floor(t.full * f);
    this.root.visible = f > 0;
  }
  get count() {
    return this.tiles.reduce((a, t) => a + Math.floor(t.full * this.fraction), 0);
  }

  /** Wind and the animals pushing through (x, z, radius, strength), nearest to the camera first. */
  update(time: number, windStrength: number, pushers: { x: number; z: number; r: number; k: number }[]) {
    U.uTime.value = time;
    U.uWind.value.z = windStrength;
    const n = Math.min(MAX_PUSH, pushers.length);
    for (let i = 0; i < n; i++) U.uPush.value[i].set(pushers[i].x, pushers[i].z, pushers[i].r, pushers[i].k);
    U.uPushN.value = n;
  }

  dispose() {
    for (const t of this.tiles) t.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}
