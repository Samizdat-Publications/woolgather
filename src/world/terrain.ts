import type { Level } from '../game/level';
import { clamp, closestOnSegment } from '../game/math';

// Ground height from the Blender heightfield (terrain_height.bin), sampled with the same triangle
// split the mesh uses (diagonal from cell corner (ix, iz) to (ix+1, iz+1)), so feet land exactly on
// the rendered ground. Also answers water level (from terrain_meta.json) and the bridge deck.

export interface TerrainMeta {
  stream: [number, number, number][];
  bridgeDeck: number;
  foldY: number;
  farmY: number;
}

export interface HeightField {
  nx: number;
  nz: number;
  minX: number;
  minZ: number;
  step: number;
  data: Float32Array;
}

export function parseHeightField(buf: ArrayBuffer): HeightField {
  const dv = new DataView(buf);
  const nx = dv.getInt32(0, true);
  const nz = dv.getInt32(4, true);
  const minX = dv.getFloat32(8, true);
  const minZ = dv.getFloat32(12, true);
  const step = dv.getFloat32(16, true);
  const data = new Float32Array(buf.slice(20, 20 + nx * nz * 4));
  return { nx, nz, minX, minZ, step, data };
}

const RAMP = 1.6;
/** How deep actors stand in water (their feet go this far below the surface). */
const WADE = 0.38;

export class Terrain {
  private hf: HeightField | null = null;
  private meta: TerrainMeta | null = null;
  /** Water level per heightfield grid point (-Infinity away from the stream), built at load. */
  private waterGrid: Float32Array | null = null;

  constructor(private level: Level) {}

  setData(hf: HeightField, meta: TerrainMeta) {
    this.hf = hf;
    this.meta = meta;
    const grid = new Float32Array(hf.nx * hf.nz);
    for (let iz = 0; iz < hf.nz; iz++) {
      for (let ix = 0; ix < hf.nx; ix++) {
        grid[iz * hf.nx + ix] = this.waterExact(hf.minX + ix * hf.step, hf.minZ + iz * hf.step);
      }
    }
    this.waterGrid = grid;
  }

  get ready() {
    return !!this.hf;
  }

  /** Bare ground height (the rendered terrain surface). */
  ground(x: number, z: number) {
    const hf = this.hf;
    if (!hf) return 0;
    const gx = clamp((x - hf.minX) / hf.step, 0, hf.nx - 1.001);
    const gz = clamp((z - hf.minZ) / hf.step, 0, hf.nz - 1.001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const d = hf.data;
    const i = iz * hf.nx + ix;
    const h00 = d[i];
    const h10 = d[i + 1];
    const h01 = d[i + hf.nx];
    const h11 = d[i + hf.nx + 1];
    return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Water surface height near (x, z), or -Infinity away from the stream (grid lookup). */
  water(x: number, z: number) {
    const hf = this.hf;
    const g = this.waterGrid;
    if (!hf || !g) return -Infinity;
    const ix = Math.round((x - hf.minX) / hf.step);
    const iz = Math.round((z - hf.minZ) / hf.step);
    if (ix < 0 || iz < 0 || ix >= hf.nx || iz >= hf.nz) return -Infinity;
    return g[iz * hf.nx + ix];
  }

  /** Water surface height of the nearest stream point, or -Infinity if far from the stream. */
  private waterExact(x: number, z: number) {
    const pts = this.meta?.stream;
    if (!pts) return -Infinity;
    let best = Infinity;
    let y = -Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const c = closestOnSegment(x, z, a[0], a[1], b[0], b[1]);
      const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
      if (d2 < best) {
        best = d2;
        y = a[2] + (b[2] - a[2]) * c.t;
      }
    }
    return best < 8 * 8 ? y : -Infinity;
  }

  /** Top of whatever is there: ground, or the water surface over the stream. */
  surface(x: number, z: number) {
    return Math.max(this.ground(x, z), this.water(x, z));
  }

  get bridgeDeck() {
    return this.meta?.bridgeDeck ?? 0.55;
  }

  /** Where feet go: ground, the bridge deck (with ramps at its ends) or wading depth in water. */
  height(x: number, z: number) {
    let g = this.ground(x, z);
    const b = this.level.bridge;
    const dx = x - b.x;
    const dz = z - b.z;
    const along = dx * b.ux + dz * b.uz;
    const across = -dx * b.uz + dz * b.ux;
    if (Math.abs(across) <= b.w / 2 + 0.2 && Math.abs(along) <= b.len / 2) {
      const k = clamp((b.len / 2 - Math.abs(along)) / RAMP, 0, 1);
      return Math.max(g, g + (this.bridgeDeck - g) * (k * k * (3 - 2 * k)));
    }
    const w = this.water(x, z);
    if (w > g) g = Math.max(g, w - WADE);
    return g;
  }
}
