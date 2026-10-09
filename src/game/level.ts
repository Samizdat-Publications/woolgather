import { landmarkColliders, type LevelDef, type PenDef, type PlaceDef } from './leveldef';
import { closestOnSegment, pointInPolygon } from './math';

// Collision and query data for one level, built from its level file. Every static thing the flock
// can bump into lives here. Any number of streams, lochs, bridges, fords and pens; pens may face
// any way (each has its own frame: local +X runs in through the gate).

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

/** The stone fold model's size at scale 1 (inside half extents and gate width). */
export const FOLD_DIMS = { halfW: 9, halfD: 6.5, gateW: 6 };

export interface StreamHit {
  /** Distance from the stream centre line. */
  d: number;
  /** Unit normal pointing from the centre line towards the query point. */
  nx: number;
  nz: number;
  /** Closest point on the centre line. */
  cx: number;
  cz: number;
  /** Half width of the stream found. */
  half: number;
  /** Index of the stream found (-1 when there is none). */
  i: number;
}

/** Nearest open water: distance from its edge (negative in the water) and the way out of it. */
export interface WaterHit {
  edge: number;
  nx: number;
  nz: number;
  /** A point on the water's edge (or centre line for a stream). */
  cx: number;
  cz: number;
}

/** A pen (the fold, or a shearing pen) with its own frame: local +X runs in through the gate. */
export class Pen {
  readonly id: string;
  readonly role: PenDef['role'];
  readonly cx: number;
  readonly cz: number;
  readonly angle: number;
  readonly scale: number;
  readonly halfW: number;
  readonly halfD: number;
  readonly gateHalf: number;
  private c: number;
  private s: number;

  constructor(def: PenDef) {
    this.id = def.id;
    this.role = def.role;
    [this.cx, this.cz] = def.center;
    this.angle = (def.angleDeg * Math.PI) / 180;
    this.scale = def.scale ?? 1;
    this.halfW = FOLD_DIMS.halfW * this.scale;
    this.halfD = FOLD_DIMS.halfD * this.scale;
    this.gateHalf = (FOLD_DIMS.gateW / 2) * this.scale;
    this.c = Math.cos(this.angle);
    this.s = Math.sin(this.angle);
  }

  /** Local (lx, lz) to world, matching three.js rotation.y = angle. */
  toWorld(lx: number, lz: number) {
    return { x: this.cx + lx * this.c + lz * this.s, z: this.cz - lx * this.s + lz * this.c };
  }
  /** A local direction to a world direction. */
  dirToWorld(lx: number, lz: number) {
    return { x: lx * this.c + lz * this.s, z: -lx * this.s + lz * this.c };
  }
  toLocal(x: number, z: number) {
    const dx = x - this.cx;
    const dz = z - this.cz;
    return { x: dx * this.c - dz * this.s, z: dx * this.s + dz * this.c };
  }

  /** Into the pen through the gate (unit, world). */
  get inward() {
    return this.dirToWorld(1, 0);
  }
  /** The middle of the gateway. */
  get gate() {
    return this.toWorld(-this.halfW, 0);
  }
  /** A spot a few metres outside the gate, in the mouth of the guide fences. */
  get mouth() {
    return this.toWorld(-this.halfW - 6 * this.scale, 0);
  }
  /** A spot well inside, past the gate. */
  get inside() {
    return this.toWorld(-this.halfW + 4 * this.scale, 0);
  }

  /** In the guide-fence funnel past the mouth (or already in the gateway): head straight in. */
  inFunnel(x: number, z: number) {
    const l = this.toLocal(x, z);
    return l.x > -this.halfW - 6 * this.scale + 1 && l.x < this.halfW && Math.abs(l.z) < this.gateHalf + 5 * this.scale;
  }

  contains(x: number, z: number, margin = 0) {
    const l = this.toLocal(x, z);
    return l.x > -this.halfW + margin && l.x < this.halfW - margin && l.z > -this.halfD + margin && l.z < this.halfD - margin;
  }

  /** Through the gate line and inside the walls: counts as home. */
  through(x: number, z: number) {
    const l = this.toLocal(x, z);
    return l.x > -this.halfW + 0.5 && l.x < this.halfW && Math.abs(l.z) < this.halfD;
  }
}

export class Level {
  readonly def: LevelDef;
  readonly boundary: Pt[];
  readonly circles: CircleCol[] = [];
  readonly segs: SegCol[] = [];
  readonly rects: RectCol[] = [];
  readonly trees: TreeDef[] = [];
  readonly streams: { pts: Pt[]; half: number }[];
  readonly lochs: { pts: Pt[]; level: number }[];
  readonly dens: Pt[];
  readonly pens: Pen[];
  readonly places: PlaceDef[];
  readonly bridges: { x: number; z: number; len: number; w: number; ux: number; uz: number }[];
  /** Fords; `open` goes false when the stream floods. */
  readonly fords: { x: number; z: number; r: number; open: boolean }[];
  /** A trial course's gates (in order) and the handler's post, if this level has one. */
  readonly gates: { name: string; ax: number; az: number; bx: number; bz: number; x: number; z: number }[];
  readonly post: { x: number; z: number } | null;

  /**
   * Every way over water as an oriented box: (ux, uz) runs across the water, `len` along that
   * axis, `w` sideways. Driven sheep funnel onto these.
   */
  readonly crossings: { x: number; z: number; ux: number; uz: number; len: number; w: number; kind: 'bridge' | 'ford'; ford?: { open: boolean } }[] = [];

  constructor(def: LevelDef) {
    this.def = def;
    this.boundary = def.boundary;
    this.streams = def.streams.map((s) => ({ pts: s.points, half: s.halfWidth }));
    // Loch outlines are drawn with a handful of points: rounded off (Chaikin, twice) so the shore
    // curves instead of running in straight cuts with corners.
    this.lochs = def.lochs.map((l) => ({ pts: chaikin(chaikin(l.points)), level: l.level }));
    this.dens = def.wolfDens;
    this.pens = def.pens.map((p) => new Pen(p));
    this.places = def.places;
    this.bridges = def.bridges.map((b) => {
      const a = (b.angleDeg * Math.PI) / 180;
      return { x: b.center[0], z: b.center[1], len: b.length, w: b.width, ux: Math.cos(a), uz: Math.sin(a) };
    });
    this.fords = def.fords.map((f) => ({ x: f.center[0], z: f.center[1], r: f.radius, open: true }));
    this.gates = (def.trial?.gates ?? []).map((g) => ({ name: g.name, ax: g.a[0], az: g.a[1], bx: g.b[0], bz: g.b[1], x: (g.a[0] + g.b[0]) / 2, z: (g.a[1] + g.b[1]) / 2 }));
    this.post = def.trial ? { x: def.trial.post[0], z: def.trial.post[1] } : null;
    // Gate posts and the handler's post are solid.
    for (const g of this.gates) {
      this.circles.push({ x: g.ax, z: g.az, r: 0.35 }, { x: g.bx, z: g.bz, r: 0.35 });
    }
    if (this.post) this.circles.push({ x: this.post.x, z: this.post.z, r: 0.3 });

    const wall = (ax: number, az: number, bx: number, bz: number, r = 0.45, tag: SegCol['tag'] = 'wall') => this.segs.push({ ax, az, bx, bz, r, tag });
    const localWall = (p: Pen, ax: number, az: number, bx: number, bz: number, r = 0.45, tag: SegCol['tag'] = 'wall') => {
      const a = p.toWorld(ax, az);
      const b = p.toWorld(bx, bz);
      wall(a.x, a.z, b.x, b.z, r, tag);
    };

    for (const p of this.pens) {
      const hw = p.halfW;
      const hd = p.halfD;
      const gw = p.gateHalf;
      const k = p.scale;
      // Stone walls with a gap in the west (local -X) wall.
      localWall(p, -hw, -hd, hw, -hd);
      localWall(p, hw, -hd, hw, hd);
      localWall(p, hw, hd, -hw, hd);
      localWall(p, -hw, -hd, -hw, -gw);
      localWall(p, -hw, gw, -hw, hd);
      // Invisible line across the gate that only penned sheep respect.
      localWall(p, -hw, -gw, -hw, gw, 0.3, 'gate');
      // Guide fences flaring out from the gate posts (as the fold model draws them).
      localWall(p, -hw, -3 * k, -17 * k, -11.5 * k, 0.22, 'fence');
      localWall(p, -hw, 3 * k, -17 * k, 11.5 * k, 0.22, 'fence');
      // The lanterns on the gateposts.
      for (const side of [-1, 1]) {
        const l = p.toWorld(-9.8 * k, 7.4 * k * side);
        this.circles.push({ x: l.x, z: l.z, r: 0.3 });
      }
    }
    // Old dry-stone field walls along the rim of the valley: sheep and Pip go round, wolves leap them.
    for (const line of def.fieldWalls) {
      for (let i = 0; i < line.length - 1; i++) wall(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], 0.45, 'field');
    }

    // Bridge railings.
    for (const b of this.bridges) {
      const px = -b.uz;
      const pz = b.ux;
      for (const side of [-1, 1]) {
        const ox = b.x + px * side * (b.w / 2);
        const oz = b.z + pz * side * (b.w / 2);
        wall(ox - b.ux * (b.len / 2), oz - b.uz * (b.len / 2), ox + b.ux * (b.len / 2), oz + b.uz * (b.len / 2), 0.2, 'rail');
      }
      this.crossings.push({ x: b.x, z: b.z, ux: b.ux, uz: b.uz, len: b.len, w: b.w, kind: 'bridge' });
    }
    for (const f of this.fords) {
      const fq = this.streamQuery(f.x + 0.01, f.z);
      // The across-the-water axis at the ford is the stream normal there.
      const fn = Math.abs(fq.d) > 1e-3 ? { x: fq.nx, z: fq.nz } : { x: 1, z: 0 };
      this.crossings.push({ x: f.x, z: f.z, ux: fn.x, uz: fn.z, len: (fq.half + 1.5) * 2, w: f.r * 1.6, kind: 'ford', ford: f });
    }

    // Valley edge (the forest). Wolves ignore it.
    const poly = this.boundary;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      wall(ax, az, bx, bz, 0.1, 'boundary');
    }

    const fh = def.farmhouse;
    if (fh) this.rects.push({ minX: fh.center[0] - fh.halfW, maxX: fh.center[0] + fh.halfW, minZ: fh.center[1] - fh.halfD, maxZ: fh.center[1] + fh.halfD });

    for (const [x, z, r] of def.rocks) this.circles.push({ x, z, r: r * 0.9 });
    for (const l of def.landmarks ?? []) {
      const col = landmarkColliders(l);
      this.circles.push(...col.circles);
      for (const sg of col.segs) wall(sg.ax, sg.az, sg.bx, sg.bz, 0.4);
    }
    for (const t of def.trees) {
      const [kind, x, z, s] = t as [TreeDef['kind'], number, number, number];
      this.trees.push({ kind, x, z, s });
      this.circles.push({ x, z, r: TRUNK_R[kind] * s });
    }
    for (const [x, z, s] of def.bushes) this.circles.push({ x, z, r: 1.0 * s });
    for (const [x, z] of def.hay) this.circles.push({ x, z, r: 1.05 });
    for (const [x, z] of def.signposts) this.circles.push({ x, z, r: 0.25 });
  }

  /** The pen that takes the whole flock home. */
  get fold() {
    return this.pens.find((p) => p.role === 'fold') ?? this.pens[0];
  }

  /** The pen (x, z) is inside, if any. */
  penAt(x: number, z: number, margin = 0) {
    for (const p of this.pens) if (p.contains(x, z, margin)) return p;
    return null;
  }

  /**
   * Where (x, z) is, in the words of the minimap's own labels, so a banner never names a place the
   * map calls something else: at a crossing, by the fold, on the far bank (across the stream from
   * the fold), or the nearest of the other labelled places.
   */
  placeName(x: number, z: number) {
    for (const p of this.places) {
      if (p.kind === 'crossing' && (x - p.x) ** 2 + (z - p.z) ** 2 < (p.r ?? 13) ** 2) return p.phrase;
    }
    if (this.inFold(x, z, -8)) return 'by the fold';
    const bank = this.places.find((p) => p.kind === 'bank');
    if (bank && this.acrossWater(x, z, this.fold.gate.x, this.fold.gate.z)) return bank.phrase;
    let best: PlaceDef | null = null;
    let bd = Infinity;
    for (const p of this.places) {
      if (p.kind === 'crossing' || p.kind === 'bank') continue;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best?.phrase ?? 'out on the hill';
  }

  /** Does the straight line from a to b cross a stream? */
  acrossWater(ax: number, az: number, bx: number, bz: number) {
    for (const s of this.streams) {
      for (let i = 0; i < s.pts.length - 1; i++) {
        if (segsCross(ax, az, bx, bz, s.pts[i][0], s.pts[i][1], s.pts[i + 1][0], s.pts[i + 1][1])) return true;
      }
    }
    return false;
  }

  inFold(x: number, z: number, margin = 0) {
    return this.fold.contains(x, z, margin);
  }

  insideValley(x: number, z: number) {
    return pointInPolygon(x, z, this.boundary);
  }

  /** Distance to the valley edge (always positive). */
  boundaryDistance(x: number, z: number) {
    return polyDistance(x, z, this.boundary);
  }

  /** Nearest stream centre line (d = Infinity when the level has none). */
  streamQuery(x: number, z: number): StreamHit {
    let best = Infinity;
    let cx = 0;
    let cz = 0;
    let half = 0;
    let si = -1;
    this.streams.forEach((s, k) => {
      const pts = s.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const c = closestOnSegment(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
        if (d2 < best) {
          best = d2;
          cx = c.x;
          cz = c.z;
          half = s.half;
          si = k;
        }
      }
    });
    if (si < 0) return { d: Infinity, nx: 1, nz: 0, cx: x + 1e6, cz: z, half: 0, i: -1 };
    const d = Math.sqrt(best);
    const nx = d > 1e-6 ? (x - cx) / d : 1;
    const nz = d > 1e-6 ? (z - cz) / d : 0;
    return { d, nx, nz, cx, cz, half, i: si };
  }

  /** Signed distance to the nearest loch's shore (negative inside the water) and the way out. */
  lochQuery(x: number, z: number) {
    let best = { d: Infinity, nx: 1, nz: 0, cx: x, cz: z };
    for (const l of this.lochs) {
      const pts = l.pts;
      let bd = Infinity;
      let bx = 0;
      let bz = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const c = closestOnSegment(x, z, a[0], a[1], b[0], b[1]);
        const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
        if (d2 < bd) {
          bd = d2;
          bx = c.x;
          bz = c.z;
        }
      }
      const inside = pointInPolygon(x, z, pts);
      const dd = Math.sqrt(bd) * (inside ? -1 : 1);
      if (dd < best.d) {
        const l2 = Math.sqrt(bd) || 1;
        // Out of the water: from inside, towards the shore point; from outside, away from it.
        const nx = inside ? (bx - x) / l2 : (x - bx) / l2;
        const nz = inside ? (bz - z) / l2 : (z - bz) / l2;
        best = { d: dd, nx, nz, cx: bx, cz: bz };
      }
    }
    return best;
  }

  /** The nearest open water of any kind (streams and lochs). */
  waterQuery(x: number, z: number): WaterHit {
    const s = this.streamQuery(x, z);
    const l = this.lochQuery(x, z);
    const se = s.d - s.half;
    if (se <= l.d) return { edge: se, nx: s.nx, nz: s.nz, cx: s.cx, cz: s.cz };
    return { edge: l.d, nx: l.nx, nz: l.nz, cx: l.cx, cz: l.cz };
  }

  onBridge(x: number, z: number, inset = 0) {
    for (const b of this.bridges) {
      const dx = x - b.x;
      const dz = z - b.z;
      const along = dx * b.ux + dz * b.uz;
      const across = -dx * b.uz + dz * b.ux;
      if (Math.abs(along) <= b.len / 2 && Math.abs(across) <= b.w / 2 - inset) return true;
    }
    return false;
  }

  /** The bridge under (x, z), with the deck's along/across coordinates, or null. */
  bridgeAt(x: number, z: number, pad = 0) {
    for (const b of this.bridges) {
      const dx = x - b.x;
      const dz = z - b.z;
      const along = dx * b.ux + dz * b.uz;
      const across = -dx * b.uz + dz * b.ux;
      if (Math.abs(along) <= b.len / 2 && Math.abs(across) <= b.w / 2 + pad) return { b, along, across };
    }
    return null;
  }

  inFord(x: number, z: number) {
    for (const f of this.fords) if (f.open && (x - f.x) ** 2 + (z - f.z) ** 2 <= f.r * f.r) return true;
    return false;
  }

  /** True where sheep may stand on water (a bridge deck or an open ford). */
  crossingAt(x: number, z: number) {
    return this.onBridge(x, z) || this.inFord(x, z);
  }

  inWater(x: number, z: number) {
    if (this.onBridge(x, z)) return false;
    const s = this.streamQuery(x, z);
    if (s.d < s.half) return true;
    return this.lochs.length > 0 && this.lochQuery(x, z).d < 0;
  }

  /** In a loch (deep water, not a stream). */
  inLoch(x: number, z: number) {
    return this.lochs.length > 0 && this.lochQuery(x, z).d < 0;
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

export function polyDistance(x: number, z: number, poly: readonly Pt[]) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const c = closestOnSegment(x, z, ax, az, bx, bz);
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < best) best = d;
  }
  return best;
}

function segsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** One round of Chaikin corner cutting on a closed polygon. */
function chaikin(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  return out;
}
