import type { Level, SegCol } from './level';
import { clamp, closestOnSegment } from './math';

export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
}

export interface CollideOpts {
  /** Collide with the valley edge (dog and sheep do, wolves don't). */
  boundary: boolean;
  /** Collide with the invisible gate line (only folded sheep). */
  gate: boolean;
  /** Collide with the low field walls on the rim (wolves leap them; default yes). */
  field?: boolean;
}

function slide(b: Body, nx: number, nz: number) {
  const vn = b.vx * nx + b.vz * nz;
  if (vn < 0) {
    b.vx -= vn * nx;
    b.vz -= vn * nz;
  }
}

function segAllowed(s: SegCol, o: CollideOpts) {
  if (s.tag === 'boundary') return o.boundary;
  if (s.tag === 'gate') return o.gate;
  if (s.tag === 'field') return o.field ?? true;
  return true;
}

/** Push a body out of every static collider it overlaps and remove velocity into the contact. */
export function collideStatic(level: Level, b: Body, o: CollideOpts) {
  let hit = false;
  for (let iter = 0; iter < 2; iter++) {
    for (const c of level.circles) {
      const dx = b.x - c.x;
      const dz = b.z - c.z;
      const min = b.r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-4;
        const nx = dx / d;
        const nz = dz / d;
        b.x = c.x + nx * min;
        b.z = c.z + nz * min;
        slide(b, nx, nz);
        hit = true;
      }
    }
    for (const s of level.segs) {
      if (!segAllowed(s, o)) continue;
      const c = closestOnSegment(b.x, b.z, s.ax, s.az, s.bx, s.bz);
      const dx = b.x - c.x;
      const dz = b.z - c.z;
      const min = b.r + s.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2);
        let nx: number;
        let nz: number;
        if (d > 1e-5) {
          nx = dx / d;
          nz = dz / d;
        } else {
          // Dead centre on the line: push along the segment normal.
          const lx = s.bx - s.ax;
          const lz = s.bz - s.az;
          const l = Math.hypot(lx, lz) || 1;
          nx = -lz / l;
          nz = lx / l;
        }
        b.x = c.x + nx * min;
        b.z = c.z + nz * min;
        slide(b, nx, nz);
        hit = true;
      }
    }
    for (const r of level.rects) {
      const cx = clamp(b.x, r.minX, r.maxX);
      const cz = clamp(b.z, r.minZ, r.maxZ);
      const dx = b.x - cx;
      const dz = b.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < b.r * b.r) {
        let nx: number;
        let nz: number;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          nz = dz / d;
          b.x = cx + nx * b.r;
          b.z = cz + nz * b.r;
        } else {
          // Inside the rectangle: leave by the nearest face.
          const exits = [
            [b.x - r.minX, -1, 0],
            [r.maxX - b.x, 1, 0],
            [b.z - r.minZ, 0, -1],
            [r.maxZ - b.z, 0, 1],
          ].sort((a, c) => a[0] - c[0]);
          nx = exits[0][1];
          nz = exits[0][2];
          b.x = nx < 0 ? r.minX - b.r : nx > 0 ? r.maxX + b.r : b.x;
          b.z = nz < 0 ? r.minZ - b.r : nz > 0 ? r.maxZ + b.r : b.z;
        }
        slide(b, nx, nz);
        hit = true;
      }
    }
  }
  return hit;
}

/** Soft push between two bodies of the same kind (sheep vs sheep, sheep vs dog). */
export function separatePair(a: Body, b: Body, aShare = 0.5) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const min = a.r + b.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 1e-10) return false;
  const d = Math.sqrt(d2);
  const push = min - d;
  const nx = dx / d;
  const nz = dz / d;
  a.x -= nx * push * aShare;
  a.z -= nz * push * aShare;
  b.x += nx * push * (1 - aShare);
  b.z += nz * push * (1 - aShare);
  return true;
}
