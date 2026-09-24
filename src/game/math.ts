// Small 2D helpers. Gameplay runs on the XZ plane, so a "vec" is {x, z}.

export interface V2 {
  x: number;
  z: number;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. `rate` is roughly "1/seconds to close most of the gap". */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const len = (x: number, z: number) => Math.sqrt(x * x + z * z);
export const dist = (a: V2, b: V2) => len(a.x - b.x, a.z - b.z);
export const dist2 = (ax: number, az: number, bx: number, bz: number) => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

/** Shortest signed difference between two angles, in radians. */
export const angleDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const dampAngle = (current: number, target: number, rate: number, dt: number) =>
  current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));

/** Closest point on segment AB to P. Returns t in [0,1] and the point. */
export function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  return { t, x: ax + abx * t, z: az + abz * t };
}

export function pointInPolygon(x: number, z: number, poly: ReadonlyArray<readonly [number, number]>) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Seeded PRNG (mulberry32). Deterministic runs make the Playwright self-test repeatable. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Uniform point in a disc. */
  disc(r: number) {
    const a = this.next() * Math.PI * 2;
    const d = Math.sqrt(this.next()) * r;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d };
  }
}
