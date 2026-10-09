// Seeded 2D gradient (Perlin) noise and fractal sums, for terrain built at load time.

const GRAD = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];

export class Noise2 {
  private perm = new Uint8Array(512);

  constructor(seed = 1) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Gradient noise in about [-1, 1]. */
  noise(x: number, z: number) {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;
    const X = xi & 255;
    const Z = zi & 255;
    const P = this.perm;
    const g = (h: number, dx: number, dz: number) => {
      const v = GRAD[h & 7];
      return v[0] * dx + v[1] * dz;
    };
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const aa = g(P[P[X] + Z], xf, zf);
    const ba = g(P[P[X + 1] + Z], xf - 1, zf);
    const ab = g(P[P[X] + Z + 1], xf, zf - 1);
    const bb = g(P[P[X + 1] + Z + 1], xf - 1, zf - 1);
    const x1 = aa + (ba - aa) * u;
    const x2 = ab + (bb - ab) * u;
    return (x1 + (x2 - x1) * w) * 1.41;
  }

  /** Fractal sum, the same shape as the Blender scripts' fbm (halving amplitude, doubling frequency). */
  fbm(x: number, z: number, octaves = 3, seed = 0) {
    let total = 0;
    let amp = 1;
    let freq = 1;
    const ox = seed * 31.7;
    const oz = seed * -17.3;
    for (let i = 0; i < octaves; i++) {
      total += amp * this.noise(x * freq + ox, z * freq + oz);
      amp *= 0.5;
      freq *= 2.03;
    }
    return total * 0.5;
  }
}
