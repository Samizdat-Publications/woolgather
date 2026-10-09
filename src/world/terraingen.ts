import * as THREE from 'three';
import type { Level } from '../game/level';
import { polyDistance } from '../game/level';
import { clamp, closestOnSegment, pointInPolygon, smoothstep } from '../game/math';
import { Noise2 } from '../game/noise';

// The ground of a level, built at load time from its level file (a port of the Blender terrain
// script, so any level and any season can be made without a Blender round trip): the heightfield the
// game stands on, the ground mesh with vertex colours, the dirt tracks, the stream ribbons and the
// loch surfaces. Each 2 m grid cell is split along the (ix, iz) -> (ix+1, iz+1) diagonal, the same
// split Terrain.ground() samples, so feet land exactly on the drawn ground.

export type Season = 'summer' | 'heather' | 'autumn' | 'winter';

export interface HeightField {
  nx: number;
  nz: number;
  minX: number;
  minZ: number;
  step: number;
  data: Float32Array;
}

export interface GeneratedTerrain {
  hf: HeightField;
  /** Water surface per stream point: [x, z, y]. */
  streamLevels: [number, number, number][][];
  /** Deck height per bridge (actors stand on it). */
  bridgeDecks: number[];
  /** Ground height under each pen's centre (the fold model sits there). */
  penY: number[];
  farmY: number;
  ground: THREE.BufferGeometry;
  paths: THREE.BufferGeometry | null;
  /** Sheep trods (narrow worn tracks) on a 1 m mask over the world: 1 where a trod runs. */
  trodMask: { minX: number; minZ: number; nx: number; nz: number; data: Uint8Array };
  streams: THREE.BufferGeometry[];
  lochs: THREE.BufferGeometry[];
  season: Season;
}

const STEP = 2;
const BED = 1.6;
const WATER_DEPTH = 0.6;

interface Palette {
  grassA: string;
  grassB: string;
  dry: string;
  lush: string;
  worn: string;
  mud: string;
  straw: string;
  heather: string;
  bed: string;
  foldFloor: string;
  yard: string;
  forest: string;
  forestDeep: string;
  rocky: string;
  shingle: string;
  /** A sheep trod: grass worn thin. */
  trod: string;
  dirt: string;
  dirtEdge: string;
  heatherAmt: number;
  snow: number;
}

const PALETTES: Record<Season, Palette> = {
  // Fresh, light yellow-greens: warm light turns them gold, not olive.
  summer: { grassA: '#8eae5c', grassB: '#a6bd6c', dry: '#c0b87a', lush: '#7aa25a', worn: '#9c9a6a', mud: '#7a6440', straw: '#c8b068', heather: '#86697f', bed: '#7b7560', foldFloor: '#a38e5b', yard: '#9c8a6c', forest: '#4f6a3a', forestDeep: '#3d5430', rocky: '#737a55', shingle: '#8c8670', trod: '#aba476', dirt: '#a8996a', dirtEdge: '#8a7c56', heatherAmt: 0.7, snow: 0 },
  // Late summer: the heather in full bloom, the grass a little drier.
  heather: { grassA: '#93aa5a', grassB: '#a9b96a', dry: '#c4b676', lush: '#7c9e56', worn: '#9c9a6a', mud: '#7a6440', straw: '#c8b068', heather: '#9a5a9c', bed: '#7b7560', foldFloor: '#a38e5b', yard: '#9c8a6c', forest: '#4f6a3a', forestDeep: '#3d5430', rocky: '#737a55', shingle: '#8c8670', trod: '#aba476', dirt: '#a8996a', dirtEdge: '#8a7c56', heatherAmt: 0.9, snow: 0 },
  // Autumn: tawny grass, rust bracken where the heather was, the forest floor brown.
  autumn: { grassA: '#a0a35a', grassB: '#b4b068', dry: '#c8a764', lush: '#879a50', worn: '#9a8e62', mud: '#6e5636', straw: '#c0a060', heather: '#9a5c3e', bed: '#76705a', foldFloor: '#9a8455', yard: '#968466', forest: '#5e5a34', forestDeep: '#4a4228', rocky: '#7a7656', shingle: '#888068', trod: '#a09068', dirt: '#9c8a5e', dirtEdge: '#7e6c48', heatherAmt: 0.75, snow: 0 },
  // First snow: snow on everything level enough to hold it, grass showing through on the steep.
  winter: { grassA: '#8a9a6a', grassB: '#98a574', dry: '#a8a07a', lush: '#7c8c62', worn: '#a4a08a', mud: '#6a5e4a', straw: '#b8a678', heather: '#7a6070', bed: '#6c6a62', foldFloor: '#a0927a', yard: '#b4ad9e', forest: '#56604a', forestDeep: '#454d3c', rocky: '#7c7e72', shingle: '#8e8a80', trod: '#c4c2bc', dirt: '#b8b2a4', dirtEdge: '#9c968a', heatherAmt: 0.5, snow: 1 },
};

const col = (hex: string) => new THREE.Color(hex);

export function generateTerrain(level: Level, season: Season): GeneratedTerrain {
  const def = level.def;
  const rel = def.relief;
  const noise = new Noise2(rel.noiseSeed ?? 7);
  const fbm = (x: number, z: number, o: number, s: number) => noise.fbm(x, z, o, s);
  const bound = level.boundary;

  const base = (x: number, z: number) => {
    let h = fbm(x / 34, z / 34, 3, 1.7) * rel.floor;
    for (const [kx, kz, kh, kr] of rel.knolls) h += kh * Math.exp(-((x - kx) ** 2 + (z - kz) ** 2) / (kr * kr));
    for (const s of rel.slopes) h += smoothstep(s.from, s.to, s.axis === 'x' ? x : z) * s.height;
    if (!pointInPolygon(x, z, bound)) {
      const d = polyDistance(x, z, bound);
      h += smoothstep(0, 28, d) * rel.rim + Math.max(0, d - 28) * 0.08 + fbm(x / 16, z / 16, 2, 9.3) * 1.2 * smoothstep(0, 12, d);
    }
    return h;
  };

  // Levelled pads under the pens and the farmhouse, and the bridge approaches.
  const pads = level.pens.map((p) => ({ pen: p, y: base(p.cx, p.cz) }));
  const fh = def.farmhouse;
  const farmY = fh ? base(fh.center[0], fh.center[1]) : 0;
  const bridgeEnds = level.bridges.map((b) => [
    { x: b.x - b.ux * (b.len / 2), z: b.z - b.uz * (b.len / 2) },
    { x: b.x + b.ux * (b.len / 2), z: b.z + b.uz * (b.len / 2) },
  ]);
  const bridgeY = bridgeEnds.map((ends) => Math.max(...ends.map((e) => base(e.x, e.z))));
  const rectFall = (dx: number, dz: number, fade: number) => 1 - smoothstep(0, fade, Math.hypot(dx, dz));

  const channel = (d: number, half: number) => {
    if (d <= half - 1.2) return BED;
    if (d <= half) return BED - WATER_DEPTH * ((d - (half - 1.2)) / 1.2);
    return (BED - WATER_DEPTH) * (1 - smoothstep(half, half + 5, d));
  };
  const pathDist = (x: number, z: number) => {
    let best = Infinity;
    for (const P of def.paths) {
      for (let i = 0; i < P.length - 1; i++) {
        const c = closestOnSegment(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
        best = Math.min(best, Math.hypot(x - c.x, z - c.z));
      }
    }
    return best;
  };

  const height = (x: number, z: number) => {
    let h = base(x, z);
    for (const { pen, y } of pads) {
      const l = pen.toLocal(x, z);
      const dx = Math.max(-pen.halfW - 4 - l.x, 0, l.x - pen.halfW - 3);
      const dz = Math.max(-pen.halfD - 3 - l.z, 0, l.z - pen.halfD - 3);
      h += (y - h) * rectFall(dx, dz, 7);
    }
    if (fh) {
      const dx = Math.max(fh.center[0] - fh.halfW - 3 - x, 0, x - fh.center[0] - fh.halfW - 3);
      const dz = Math.max(fh.center[1] - fh.halfD - 3 - z, 0, z - fh.center[1] - fh.halfD - 4);
      h += (farmY - h) * rectFall(dx, dz, 7);
    }
    bridgeEnds.forEach((ends, i) => {
      for (const e of ends) h += (bridgeY[i] - h) * (1 - smoothstep(2, 7, Math.hypot(x - e.x, z - e.z)));
    });
    const s = level.streamQuery(x, z);
    if (s.d < s.half + 5) h -= channel(s.d, s.half);
    for (const l of level.lochs) {
      const q = level.lochQuery(x, z);
      if (q.d > 12) continue;
      if (q.d < 0) h = Math.min(h, l.level - 0.35 - 2.4 * smoothstep(0, 14, -q.d));
      else h = Math.max(l.level + 0.12, Math.min(h, l.level + 0.18 + q.d * 0.16 + 2 * smoothstep(4, 12, q.d)));
    }
    h -= 0.07 * (1 - smoothstep(0.8, 1.6, pathDist(x, z)));
    return h;
  };

  // ---------------------------------------------------------------- heightfield
  const w = def.world;
  const nx = Math.round((w.maxX - w.minX) / STEP) + 1;
  const nz = Math.round((w.maxZ - w.minZ) / STEP) + 1;
  const data = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) data[iz * nx + ix] = height(w.minX + ix * STEP, w.minZ + iz * STEP);
  }
  const hf: HeightField = { nx, nz, minX: w.minX, minZ: w.minZ, step: STEP, data };
  const at = (ix: number, iz: number) => data[clamp(iz, 0, nz - 1) * nx + clamp(ix, 0, nx - 1)];

  // ---------------------------------------------------------------- colours
  const P: Palette = season === 'winter' ? PALETTES[season] : { ...PALETTES[season], ...def.ground };
  const C = {
    a: col(P.grassA), b: col(P.grassB), dry: col(P.dry), lush: col(P.lush), worn: col(P.worn), mud: col(P.mud), straw: col(P.straw),
    heather: col(P.heather), bed: col(P.bed), foldFloor: col(P.foldFloor), yard: col(P.yard), forest: col(P.forest), forestDeep: col(P.forestDeep),
    rocky: col(P.rocky), shingle: col(P.shingle), wetMud: col('#4a4232'), snow: col('#eef1f5'), snowShade: col('#dfe5ee'), lochBed: col('#5f6a52'),
  };
  const c = new THREE.Color();
  const heatherAt = (x: number, z: number) => {
    let heat = 0;
    for (const band of def.heather ?? []) {
      let k = 1;
      if (band.maxX !== undefined) k *= smoothstep(band.maxX, band.maxX - 22, x);
      if (band.minX !== undefined) k *= smoothstep(band.minX, band.minX + 22, x);
      if (band.maxZ !== undefined) k *= smoothstep(band.maxZ, band.maxZ - 22, z);
      if (band.minZ !== undefined) k *= smoothstep(band.minZ, band.minZ + 22, z);
      heat = Math.max(heat, k);
    }
    if (pointInPolygon(x, z, bound)) heat = Math.max(heat, 1 - smoothstep(6, 18, polyDistance(x, z, bound)));
    return heat * smoothstep(-0.05, 0.5, fbm(x / 21, z / 21, 2, 4.4));
  };
  const colors = new Float32Array(nx * nz * 3);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = w.minX + ix * STEP;
      const z = w.minZ + iz * STEP;
      const h = at(ix, iz);
      const n = fbm(x / 22, z / 22, 2, 3.3);
      c.copy(C.a).lerp(C.b, clamp(0.5 + n * 0.8, 0, 1));
      c.lerp(C.dry, smoothstep(0.25, 0.7, fbm(x / 45, z / 45, 2, 8.8)));
      c.lerp(C.heather, heatherAt(x, z) * P.heatherAmt);
      // Relief: crests drier and lighter, hollows lusher.
      const curv = h - (at(ix + 2, iz) + at(ix - 2, iz) + at(ix, iz + 2) + at(ix, iz - 2)) / 4;
      c.lerp(C.dry, smoothstep(0.04, 0.35, curv) * 0.35);
      c.lerp(C.lush, smoothstep(0.04, 0.35, -curv) * 0.18);
      const shade = 0.97 + 0.05 * smoothstep(-1, 7, h);
      c.multiplyScalar(shade);
      for (const [rx, rz, rr] of def.rocks) {
        const dr = Math.hypot(x - rx, z - rz);
        if (dr < rr + 1.5) c.lerp(C.rocky, (1 - smoothstep(rr * 0.6, rr + 1.5, dr)) * 0.45);
      }
      const s = level.streamQuery(x, z);
      const half = s.half;
      if (s.d < half + 5) c.lerp(C.lush, 1 - smoothstep(half, half + 5, s.d));
      if (s.d < half + 0.3) c.lerp(C.bed, 1 - smoothstep(half - 0.8, half + 0.3, s.d));
      if (s.d < half + 1.6) c.lerp(C.wetMud, (1 - smoothstep(half + 0.2, half + 1.6, s.d)) * smoothstep(half - 1, half - 0.2, s.d) * 0.75);
      if (level.lochs.length) {
        const q = level.lochQuery(x, z);
        if (q.d < 4) c.lerp(C.shingle, (1 - smoothstep(0.5, 4, q.d)) * 0.45);
        if (q.d < 0) c.lerp(C.lochBed, smoothstep(0, 4, -q.d));
      }
      // A show field is mown: fresher turf in light and dark stripes, the way a trial ground looks.
      if (def.trial && pointInPolygon(x, z, bound)) {
        const k = smoothstep(6, 14, polyDistance(x, z, bound));
        const stripe = Math.cos((x / 9) * Math.PI) > 0 ? 1 : 0;
        c.lerp(C.lush, 0.45 * k);
        c.multiplyScalar(1 + (stripe ? 0.07 : -0.05) * k);
      }
      const pd = pathDist(x, z);
      c.lerp(C.worn, (1 - smoothstep(1, 2.6, pd)) * 0.6);
      for (const pen of level.pens) {
        const l = pen.toLocal(x, z);
        if (Math.abs(l.x) < pen.halfW + 0.5 && Math.abs(l.z) < pen.halfD + 0.5) {
          // Noise no finer than the 2 m grid can carry (finer, it aliased into smeared blotches).
          c.lerp(C.foldFloor, 0.8 + fbm(x / 6, z / 6, 1, 2) * 0.2);
          c.lerp(C.mud, smoothstep(0.1, 0.45, fbm(x / 5.5, z / 5.5, 2, 12.1)) * 0.5);
          c.lerp(C.straw, smoothstep(0.25, 0.55, fbm(x / 4.5, z / 4.5, 1, 31.7)) * 0.45);
          const track = (1 - smoothstep(1.2, 2.6, Math.abs(l.z))) * (1 - smoothstep(6, 10, l.x + pen.halfW));
          c.lerp(C.mud, track * 0.55);
        }
      }
      if (fh) {
        const dx = Math.max(fh.center[0] - fh.halfW - 1.5 - x, 0, x - fh.center[0] - fh.halfW - 1.5);
        const dz = Math.max(fh.center[1] - fh.halfD - 1.5 - z, 0, z - fh.center[1] - fh.halfD - 3.5);
        c.lerp(C.yard, rectFall(dx, dz, 2.5) * 0.85);
      }
      const inside = pointInPolygon(x, z, bound);
      if (!inside) {
        const db = polyDistance(x, z, bound);
        c.lerp(C.forest, smoothstep(0, 6, db));
        c.lerp(C.forestDeep, smoothstep(10, 30, db));
      }
      if (P.snow > 0) {
        // Snow on everything level enough to hold it; less where the ground is steep, thin and
        // trodden on the tracks and in the fold, none in the water.
        const slope = Math.hypot(at(ix + 1, iz) - at(ix - 1, iz), at(ix, iz + 1) - at(ix, iz - 1)) / (4 * STEP) * 2;
        let snow = (0.82 + 0.18 * fbm(x / 9, z / 9, 2, 5.5)) * (1 - smoothstep(0.25, 0.6, slope));
        snow *= 1 - (1 - smoothstep(1, 2.4, pd)) * 0.45;
        if (s.d < half + 0.6) snow *= smoothstep(half - 0.4, half + 0.6, s.d);
        if (level.penAt(x, z, -0.5)) snow *= 0.55;
        c.lerp(inside ? C.snow : C.snowShade, clamp(snow, 0, 1) * P.snow);
      }
      colors[(iz * nx + ix) * 3] = c.r;
      colors[(iz * nx + ix) * 3 + 1] = c.g;
      colors[(iz * nx + ix) * 3 + 2] = c.b;
    }
  }

  // ---------------------------------------------------------------- ground mesh
  const pos = new Float32Array(nx * nz * 3);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      pos[i * 3] = w.minX + ix * STEP;
      pos[i * 3 + 1] = data[i];
      pos[i * 3 + 2] = w.minZ + iz * STEP;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const v00 = iz * nx + ix;
      const v10 = v00 + 1;
      const v01 = v00 + nx;
      const v11 = v01 + 1;
      idx[k++] = v00;
      idx[k++] = v11;
      idx[k++] = v10;
      idx[k++] = v00;
      idx[k++] = v01;
      idx[k++] = v11;
    }
  }
  const ground = new THREE.BufferGeometry();
  ground.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ground.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ground.setIndex(new THREE.BufferAttribute(idx, 1));
  ground.computeVertexNormals();
  ground.computeBoundingSphere();

  // ---------------------------------------------------------------- streams
  const streamLevels: [number, number, number][][] = [];
  const streamGeos: THREE.BufferGeometry[] = [];
  for (const st of level.streams) {
    const pts: [number, number][] = [];
    for (let i = 0; i < st.pts.length - 1; i++) {
      const a = st.pts[i];
      const b = st.pts[i + 1];
      const n = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
    pts.push([st.pts[st.pts.length - 1][0], st.pts[st.pts.length - 1][1]]);
    let levels = pts.map(([x, z]) => base(x, z) - BED + WATER_DEPTH);
    // A stream running into a loch meets it at the loch's level.
    if (level.lochs.length) {
      levels = levels.map((y, i) => {
        const q = level.lochQuery(pts[i][0], pts[i][1]);
        const lk = level.lochs[0].level;
        return q.d < 10 ? y + (lk - y) * (1 - smoothstep(0, 10, q.d)) : y;
      });
    }
    for (let it = 0; it < 6; it++) levels = levels.map((y, i) => (i === 0 || i === levels.length - 1 ? y : (levels[i - 1] + 2 * y + levels[i + 1]) / 4));
    streamLevels.push(pts.map(([x, z], i) => [x, z, levels[i]]));
    const half = st.half + 0.6;
    const vp: number[] = [];
    const uv: number[] = [];
    const ix: number[] = [];
    let dist = 0;
    pts.forEach(([x, z], i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const px = -(b[1] - a[1]) / tl;
      const pz = (b[0] - a[0]) / tl;
      if (i > 0) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      vp.push(x + px * half, levels[i], z + pz * half, x - px * half, levels[i], z - pz * half);
      uv.push(dist / (half * 2), 0, dist / (half * 2), 1);
      if (i > 0) {
        const l0 = (i - 1) * 2;
        const r0 = l0 + 1;
        const l1 = i * 2;
        const r1 = l1 + 1;
        ix.push(l0, r0, r1, l0, r1, l1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ix);
    fixWinding(g);
    g.computeVertexNormals();
    streamGeos.push(g);
  }

  // ---------------------------------------------------------------- lochs
  const lochGeos = level.lochs.map((l) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of l.pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    minX -= 6;
    maxX += 6;
    minZ -= 6;
    maxZ += 6;
    const gx = Math.ceil((maxX - minX) / STEP) + 1;
    const gz = Math.ceil((maxZ - minZ) / STEP) + 1;
    const vp: number[] = [];
    const shore: number[] = [];
    const uv: number[] = [];
    const ix: number[] = [];
    for (let iz = 0; iz < gz; iz++) {
      for (let jx = 0; jx < gx; jx++) {
        const x = minX + jx * STEP;
        const z = minZ + iz * STEP;
        const q = level.lochQuery(x, z);
        vp.push(x, l.level, z);
        shore.push(1 - smoothstep(0, 10, -q.d));
        uv.push(x, z);
      }
    }
    for (let iz = 0; iz < gz - 1; iz++) {
      for (let jx = 0; jx < gx - 1; jx++) {
        const cx = minX + (jx + 0.5) * STEP;
        const cz = minZ + (iz + 0.5) * STEP;
        if (level.lochQuery(cx, cz).d > 5) continue;
        const v00 = iz * gx + jx;
        ix.push(v00, v00 + gx + 1, v00 + 1, v00, v00 + gx, v00 + gx + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
    g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    return g;
  });

  // ---------------------------------------------------------------- sheep trods
  // Narrow tracks worn by the flock: from each grazing spot towards the fold, and on to the
  // nearest other grazing spot, meandering, broken wherever they meet water, walls or a track.
  const trodNoise = new Noise2((rel.noiseSeed ?? 7) + 101);
  const trodLines: [number, number][][] = [];
  const spots = def.sheepGroups.map((g) => g.center);
  const goal = level.fold.mouth;
  const pathNear = (x: number, z: number) => pathDist(x, z) < 2.6;
  const trodOk = (x: number, z: number) =>
    pointInPolygon(x, z, bound) && polyDistance(x, z, bound) > 3 && level.waterQuery(x, z).edge > 1.5 && !level.penAt(x, z, -3) && !pathNear(x, z) &&
    level.circles.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > (c.r + 0.8) ** 2) && level.rects.every((r) => x < r.minX - 2 || x > r.maxX + 2 || z < r.minZ - 2 || z > r.maxZ + 2);
  const addTrod = (ax: number, az: number, bx: number, bz: number, seed: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 12) return;
    const n = Math.ceil(len / 1.5);
    const px = -(bz - az) / len;
    const pz = (bx - ax) / len;
    let run: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const wob = trodNoise.fbm(t * len / 22 + seed, seed * 3.1, 2, seed) * 9 * Math.sin(Math.PI * t);
      const x = ax + (bx - ax) * t + px * wob;
      const z = az + (bz - az) * t + pz * wob;
      if (trodOk(x, z)) run.push([x, z]);
      else {
        if (run.length > 5) trodLines.push(run);
        run = [];
      }
    }
    if (run.length > 5) trodLines.push(run);
  };
  spots.forEach(([x, z], i) => {
    addTrod(x, z, goal.x, goal.z, i * 1.7 + 0.3);
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const [ox, oz] of spots) {
      const d = Math.hypot(ox - x, oz - z);
      if (d > 1 && d < bd) {
        bd = d;
        best = [ox, oz];
      }
    }
    if (best) addTrod(x, z, best[0], best[1], i * 2.9 + 1.1);
  });
  const trodMask = { minX: w.minX, minZ: w.minZ, nx: Math.ceil(w.maxX - w.minX) + 1, nz: Math.ceil(w.maxZ - w.minZ) + 1, data: new Uint8Array(0) };
  trodMask.data = new Uint8Array(trodMask.nx * trodMask.nz);
  for (const line of trodLines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
      for (let k = 0; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps;
        const z = az + ((bz - az) * k) / steps;
        const mx = Math.round(x - trodMask.minX);
        const mz = Math.round(z - trodMask.minZ);
        if (mx >= 0 && mz >= 0 && mx < trodMask.nx && mz < trodMask.nz) trodMask.data[mz * trodMask.nx + mx] = 1;
      }
    }
  }

  // ---------------------------------------------------------------- paths and trods
  let paths: THREE.BufferGeometry | null = null;
  if (def.paths.length || trodLines.length) {
    const vp: number[] = [];
    const vc: number[] = [];
    const ix: number[] = [];
    const dirt = col(P.dirt);
    const edge = col(P.dirtEdge);
    const groundAt = (x: number, z: number) => {
      const gx = clamp((x - w.minX) / STEP, 0, nx - 1.001);
      const gz = clamp((z - w.minZ) / STEP, 0, nz - 1.001);
      const i0 = Math.floor(gx);
      const j0 = Math.floor(gz);
      const fx = gx - i0;
      const fz = gz - j0;
      const h00 = at(i0, j0);
      const h10 = at(i0 + 1, j0);
      const h01 = at(i0, j0 + 1);
      const h11 = at(i0 + 1, j0 + 1);
      return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    };
    const groundCol = (x: number, z: number) => {
      const ix2 = clamp(Math.round((x - w.minX) / STEP), 0, nx - 1);
      const iz2 = clamp(Math.round((z - w.minZ) / STEP), 0, nz - 1);
      const k2 = (iz2 * nx + ix2) * 3;
      return new THREE.Color(colors[k2], colors[k2 + 1], colors[k2 + 2]);
    };
    const trodCol = col(P.trod);
    for (const line of trodLines) {
      const start = vp.length / 3;
      line.forEach(([x, z], i) => {
        const a = line[Math.max(0, i - 1)];
        const b = line[Math.min(line.length - 1, i + 1)];
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const px = -(b[1] - a[1]) / tl;
        const pz = (b[0] - a[0]) / tl;
        const half = 0.42 + trodNoise.fbm(x / 4, z / 4, 2, 5) * 0.25;
        const gc = groundCol(x, z);
        const mid = gc.clone().lerp(trodCol, 0.75);
        [-half, 0, half].forEach((off, j) => {
          const vx = x + px * off;
          const vz = z + pz * off;
          vp.push(vx, groundAt(vx, vz) + 0.1, vz);
          const cc = j === 1 ? mid : gc;
          vc.push(cc.r, cc.g, cc.b);
        });
      });
      for (let i = 0; i < line.length - 1; i++) {
        for (let j = 0; j < 2; j++) {
          const a = start + i * 3 + j;
          const b = a + 1;
          const c2 = a + 3;
          const d2 = c2 + 1;
          ix.push(a, b, d2, a, d2, c2);
        }
      }
    }
    for (const Pth of def.paths) {
      const pts: [number, number][] = [];
      for (let i = 0; i < Pth.length - 1; i++) {
        const a = Pth[i];
        const b = Pth[i + 1];
        const n = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
        for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
      }
      pts.push([Pth[Pth.length - 1][0], Pth[Pth.length - 1][1]]);
      const start = vp.length / 3;
      const wet = pts.map(([x, z]) => {
        const s = level.streamQuery(x, z);
        return s.d < s.half + 2.5 || (level.lochs.length > 0 && level.lochQuery(x, z).d < 1.5) || level.onBridge(x, z);
      });
      pts.forEach(([x, z], i) => {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const px = -(b[1] - a[1]) / tl;
        const pz = (b[0] - a[0]) / tl;
        const wl = 1.05 + fbm(x / 3, z / 3, 2, 11) * 0.9;
        const wr = 1.05 + fbm(x / 3, z / 3, 2, 17) * 0.9;
        [-wl, -wl * 0.55, 0, wr * 0.55, wr].forEach((off, j) => {
          const vx = x + px * off;
          const vz = z + pz * off;
          vp.push(vx, groundAt(vx, vz) + 0.14, vz);
          const cc = j === 0 || j === 4 ? edge : dirt;
          vc.push(cc.r, cc.g, cc.b);
        });
      });
      for (let i = 0; i < pts.length - 1; i++) {
        if (wet[i] || wet[i + 1]) continue;
        for (let j = 0; j < 4; j++) {
          const a = start + i * 5 + j;
          const b = a + 1;
          const c2 = a + 5;
          const d2 = c2 + 1;
          ix.push(a, b, d2, a, d2, c2);
        }
      }
    }
    paths = new THREE.BufferGeometry();
    paths.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
    paths.setAttribute('color', new THREE.Float32BufferAttribute(vc, 3));
    paths.setIndex(ix);
    fixWinding(paths);
    paths.computeVertexNormals();
  }

  return {
    hf,
    streamLevels,
    bridgeDecks: bridgeY.map((y) => y + 0.45),
    penY: pads.map((p) => p.y),
    farmY,
    ground,
    paths,
    trodMask,
    streams: streamGeos,
    lochs: lochGeos,
    season,
  };
}

/** Make every triangle face up (+Y), whichever way its points were listed. */
function fixWinding(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const index = g.getIndex();
  if (!index) return;
  const arr = index.array as Uint32Array | Uint16Array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < arr.length; i += 3) {
    a.fromBufferAttribute(p, arr[i]);
    b.fromBufferAttribute(p, arr[i + 1]);
    c.fromBufferAttribute(p, arr[i + 2]);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (ny < 0) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
  }
}
