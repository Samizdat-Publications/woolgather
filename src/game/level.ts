import valley from '../../level/valley.json';
import { closestOnSegment, pointInPolygon } from './math';

// Derived collision data for the valley. Every static thing the flock can bump into lives here.

export type Pt = readonly [number, number];

export interface CircleCol {
  x: number;
  z: number;
  r: number;
}
export interface SegCol {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
  /** Tags let some movers ignore some walls (wolves pass through the valley edge). */
  tag: 'wall' | 'fence' | 'boundary' | 'rail' | 'gate' | 'field';
}
export interface RectCol {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TreeDef {
  kind: 'pine' | 'oak' | 'birch';
  x: number;
  z: number;
  s: number;
}

const TRUNK_R: Record<TreeDef['kind'], number> = { pine: 0.75, oak: 1.05, birch: 0.45 };

/** The valley's named places, as the minimap labels them and the banners speak of them. */
export const PLACES: { name: string; phrase: string; x: number; z: number }[] = [
  { name: 'FAR BANK', phrase: 'on the far bank', x: -74, z: 28 },
  { name: 'GROVE', phrase: 'in the grove', x: 52, z: -52 },
  { name: 'MEADOW', phrase: 'in the meadow', x: -8, z: 26 },
  { name: 'ROCKS', phrase: 'by the rocks', x: 8, z: 58 },
  { name: 'FARM', phrase: 'by the farm', x: 80, z: 8 },
  { name: 'FORD', phrase: 'at the ford', x: -44, z: 52 },
  { name: 'BRIDGE', phrase: 'by the bridge', x: -35, z: -11 },
];

export interface StreamHit {
  /** Distance from the stream centre line. */
  d: number;
  /** Unit normal pointing from the centre line towards the query point. */
  nx: number;
  nz: number;
  /** Closest point on the centre line. */
  cx: number;
  cz: number;
}

export class Level {
  readonly data = valley;
  readonly boundary: Pt[] = valley.boundary as unknown as Pt[];
  readonly circles: CircleCol[] = [];
  readonly segs: SegCol[] = [];
  readonly rects: RectCol[] = [];
  readonly trees: TreeDef[] = [];
  readonly stream: Pt[] = valley.stream.points as unknown as Pt[];
  readonly streamHalf = valley.stream.halfWidth;
  readonly dens: Pt[] = valley.wolfDens as unknown as Pt[];

  // Fold interior (x/z extents), gate line and a point just outside the gate for AI and the bot.
  readonly fold = (() => {
    const f = valley.fold;
    const [cx, cz] = f.center;
    return {
      cx,
      cz,
      minX: cx - f.halfW,
      maxX: cx + f.halfW,
      minZ: cz - f.halfD,
      maxZ: cz + f.halfD,
      gateZ0: cz - f.gateWidth / 2,
      gateZ1: cz + f.gateWidth / 2,
      gateX: cx - f.halfW,
      /** A spot a few metres outside the gate, in the mouth of the guide fences. */
      mouth: { x: cx - f.halfW - 6, z: cz },
    };
  })();

  readonly bridge = (() => {
    const b = valley.bridge;
    const a = (b.angleDeg * Math.PI) / 180;
    return { x: b.center[0], z: b.center[1], len: b.length, w: b.width, ux: Math.cos(a), uz: Math.sin(a) };
  })();
  readonly ford = { x: valley.ford.center[0], z: valley.ford.center[1], r: valley.ford.radius };

  /**
   * Both ways over the stream as oriented boxes: (ux, uz) runs across the water, `len` along that
   * axis, `w` sideways. Driven sheep funnel onto these.
   */
  readonly crossings: { x: number; z: number; ux: number; uz: number; len: number; w: number }[] = [];

  constructor() {
    const f = this.fold;
    const wall = (ax: number, az: number, bx: number, bz: number, r = 0.45, tag: SegCol['tag'] = 'wall') =>
      this.segs.push({ ax, az, bx, bz, r, tag });

    // Stone fold with a gap in the west wall.
    wall(f.minX, f.minZ, f.maxX, f.minZ);
    wall(f.maxX, f.minZ, f.maxX, f.maxZ);
    wall(f.maxX, f.maxZ, f.minX, f.maxZ);
    wall(f.minX, f.minZ, f.minX, f.gateZ0);
    wall(f.minX, f.gateZ1, f.minX, f.maxZ);
    // Invisible line across the gate that only folded sheep respect.
    wall(f.minX, f.gateZ0, f.minX, f.gateZ1, 0.3, 'gate');
    for (const [[ax, az], [bx, bz]] of valley.fold.wings) wall(ax, az, bx, bz, 0.22, 'fence');
    // Old dry-stone field walls along the rim of the valley: sheep and Pip go round, wolves leap them.
    for (const line of valley.fieldWalls) {
      for (let i = 0; i < line.length - 1; i++) wall(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], 0.45, 'field');
    }

    // Bridge railings.
    const b = this.bridge;
    const px = -b.uz;
    const pz = b.ux;
    for (const side of [-1, 1]) {
      const ox = b.x + px * side * (b.w / 2);
      const oz = b.z + pz * side * (b.w / 2);
      wall(ox - b.ux * (b.len / 2), oz - b.uz * (b.len / 2), ox + b.ux * (b.len / 2), oz + b.uz * (b.len / 2), 0.2, 'rail');
    }

    this.crossings.push({ x: b.x, z: b.z, ux: b.ux, uz: b.uz, len: b.len, w: b.w });
    const fq = this.streamQuery(this.ford.x + 0.01, this.ford.z);
    // Across-the-water axis at the ford is the stream normal there.
    const fn = Math.abs(fq.d) > 1e-3 ? { x: fq.nx, z: fq.nz } : { x: 1, z: 0 };
    this.crossings.push({ x: this.ford.x, z: this.ford.z, ux: fn.x, uz: fn.z, len: (this.streamHalf + 1.5) * 2, w: this.ford.r * 1.6 });

    // Valley edge (the forest). Wolves ignore it.
    const poly = this.boundary;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      wall(ax, az, bx, bz, 0.1, 'boundary');
    }

    const fh = valley.farmhouse;
    this.rects.push({
      minX: fh.center[0] - fh.halfW,
      maxX: fh.center[0] + fh.halfW,
      minZ: fh.center[1] - fh.halfD,
      maxZ: fh.center[1] + fh.halfD,
    });

    for (const [x, z, r] of valley.rocks) this.circles.push({ x, z, r: r * 0.9 });
    for (const t of valley.trees) {
      const [kind, x, z, s] = t as [TreeDef['kind'], number, number, number];
      this.trees.push({ kind, x, z, s });
      this.circles.push({ x, z, r: TRUNK_R[kind] * s });
    }
    for (const [x, z, s] of valley.bushes) this.circles.push({ x, z, r: 1.0 * s });
    for (const [x, z] of valley.hay) this.circles.push({ x, z, r: 1.05 });
    this.circles.push({ x: valley.lantern[0], z: valley.lantern[1], r: 0.3 });
    this.circles.push({ x: valley.signpost[0], z: valley.signpost[1], r: 0.25 });
  }

  /**
   * Where in the valley a point is, in the words the minimap labels use ("in the grove"), so
   * warnings never depend on which way a compass word is measured.
   */
  /**
   * Where (x, z) is, in the words of the minimap's own labels, so a banner never names a place
   * the map calls something else: at the bridge or the ford, by the fold, on the far bank (across
   * the stream), or the nearest of the other labelled places.
   */
  placeName(x: number, z: number) {
    const near = (p: { x: number; z: number }, r: number) => (x - p.x) ** 2 + (z - p.z) ** 2 < r * r;
    const place = (name: string) => PLACES.find((p) => p.name === name)!;
    if (near(place('BRIDGE'), 14)) return 'by the bridge';
    if (near(place('FORD'), 13)) return 'at the ford';
    if (this.inFold(x, z, -8)) return 'by the fold';
    if (x < this.streamQuery(x, z).cx) return 'on the far bank';
    let best = PLACES[0];
    let bd = Infinity;
    for (const p of PLACES) {
      if (p.name === 'FAR BANK' || p.name === 'BRIDGE' || p.name === 'FORD') continue;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best.phrase;
  }

  inFold(x: number, z: number, margin = 0) {
    const f = this.fold;
    return x > f.minX + margin && x < f.maxX - margin && z > f.minZ + margin && z < f.maxZ - margin;
  }

  insideValley(x: number, z: number) {
    return pointInPolygon(x, z, this.boundary);
  }

  /** Distance to the valley edge (always positive). */
  boundaryDistance(x: number, z: number) {
    let best = Infinity;
    const poly = this.boundary;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const c = closestOnSegment(x, z, ax, az, bx, bz);
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < best) best = d;
    }
    return best;
  }

  streamQuery(x: number, z: number): StreamHit {
    let best = Infinity;
    let cx = 0;
    let cz = 0;
    const pts = this.stream;
    for (let i = 0; i < pts.length - 1; i++) {
      const c = closestOnSegment(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
      if (d2 < best) {
        best = d2;
        cx = c.x;
        cz = c.z;
      }
    }
    const d = Math.sqrt(best);
    const nx = d > 1e-6 ? (x - cx) / d : 1;
    const nz = d > 1e-6 ? (z - cz) / d : 0;
    return { d, nx, nz, cx, cz };
  }

  onBridge(x: number, z: number, inset = 0) {
    const b = this.bridge;
    const dx = x - b.x;
    const dz = z - b.z;
    const along = dx * b.ux + dz * b.uz;
    const across = -dx * b.uz + dz * b.ux;
    return Math.abs(along) <= b.len / 2 && Math.abs(across) <= b.w / 2 - inset;
  }

  inFord(x: number, z: number) {
    return (x - this.ford.x) ** 2 + (z - this.ford.z) ** 2 <= this.ford.r * this.ford.r;
  }

  /** True where sheep may stand on the stream (bridge deck or the shallow ford). */
  crossingAt(x: number, z: number) {
    return this.onBridge(x, z) || this.inFord(x, z);
  }

  inWater(x: number, z: number) {
    if (this.onBridge(x, z)) return false;
    return this.streamQuery(x, z).d < this.streamHalf;
  }

  nearestDen(x: number, z: number) {
    let best = this.dens[0];
    let bd = Infinity;
    for (const d of this.dens) {
      const dd = (d[0] - x) ** 2 + (d[1] - z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return { x: best[0], z: best[1] };
  }
}
