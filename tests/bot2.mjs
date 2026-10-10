// HerdBot2: a level-agnostic herding bot for the season (any level, any objective).
// It plays through real keyboard events and reads the game through window.__WG (test mode only).
//
// Planning runs on the game's own 2 m walkability grid (__WG.navGrid()):
//   0 open ground, 1 water the sheep refuse, 2 solid (walls, rocks, buildings, outside the valley),
//   3 a crossing (bridge deck or open ford).
// - A flock distance field (Dijkstra from the fold mouth over cells 0 and 3, with a cost for cells
//   next to anything the sheep refuse) gives every group its way home and the crossings it needs.
// - Groups are driven Strombom-style: Pip stands behind the group, opposite a drive goal some way
//   ahead on that route; strays are collected back to the group first; a wrong-side Pip makes a
//   wide outrun outside the flight zone. Crossings are taken in two stages (line up on the axis,
//   then drive straight over), as the 1.0 bot did for Hollow Valley.
// - Pip's own moves use A* over cells 0, 1 and 3 (he wades) round walls, rocks, the fold and houses.
// See docs/BOT2.md for the full behaviour (ram, lambs, the lost lamb, wolves, the night watch).

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (x, z) => {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
};
const angWrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const isFree = (s) => s.state !== 'folded' && s.state !== 'lost' && s.state !== 'grabbed' && s.state !== 'hidden';
const SQ2 = Math.SQRT2;
const N8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQ2],
  [1, -1, SQ2],
  [-1, 1, SQ2],
  [-1, -1, SQ2],
];

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/** The level's walkability grid with the flock's way home and path queries. */
export class Nav {
  constructor(grid, def) {
    this.minX = grid.minX;
    this.minZ = grid.minZ;
    this.step = grid.step;
    this.nx = grid.nx;
    this.nz = grid.nz;
    this.cells = grid.cells;
    this.fold = grid.fold;
    const n = this.nx * this.nz;
    this.n = n;
    this.sheepClear = this.clearance((c) => c === 1 || c === 2);
    this.dogClear = this.clearance((c) => c === 2);
    const pen = (def.pens ?? []).find((p) => p.role === 'fold') ?? (def.pens ?? [])[0];
    const scale = pen?.scale ?? 1;
    this.pen = { halfW: 9 * scale, halfD: 6.5 * scale, scale };
    const inw = grid.fold.inward;
    this.inward = inw;
    this.perp = { x: -inw.z, z: inw.x };
    // The fold and its guide-fence funnel: Pip keeps out unless he means to go in.
    this.foldZone = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.pos(i);
      const l = this.local(p);
      const W = this.pen.halfW;
      if (l.x > -W - 1.5 && l.x < W + 1.5 && Math.abs(l.z) < this.pen.halfD + 1.5) this.foldZone[i] = 1;
    }
    // Every way over water, oriented: (ux, uz) runs across the water.
    this.crossings = [];
    let id = 0;
    for (const b of def.bridges ?? []) {
      const a = (b.angleDeg * Math.PI) / 180;
      this.crossings.push({ id: id++, kind: 'bridge', x: b.center[0], z: b.center[1], ux: Math.cos(a), uz: Math.sin(a), len: b.length, w: b.width, open: true });
    }
    (def.fords ?? []).forEach((f, k) => {
      const ax = streamNormalAt(def, f.center[0], f.center[1]);
      // A ford's crossing box (as the game builds it): the stream's width plus a margin each side.
      this.crossings.push({ id: id++, kind: 'ford', fordIndex: k, x: f.center[0], z: f.center[1], ux: ax.x, uz: ax.z, len: (ax.half + 1.5) * 2, w: f.radius * 1.6, open: true });
    });
    for (const c of this.crossings) {
      if (c.kind !== 'ford') continue;
      const i = this.cellOf(c.x, c.z);
      c.open = this.cells[i] === 3;
    }
    this.field = null;
    this.fieldSeed = null;
  }

  /** Pen-local coordinates (x runs in through the gate). */
  local(p) {
    const c = this.fold.center;
    const rx = p.x - c.x;
    const rz = p.z - c.z;
    return { x: rx * this.inward.x + rz * this.inward.z, z: rx * this.perp.x + rz * this.perp.z };
  }
  toWorldLocal(lx, lz) {
    const c = this.fold.center;
    return { x: c.x + this.inward.x * lx + this.perp.x * lz, z: c.z + this.inward.z * lx + this.perp.z * lz };
  }

  clearance(blocked) {
    const n = this.nx * this.nz;
    const d = new Int32Array(n).fill(1 << 20);
    const q = new Int32Array(n);
    let h = 0;
    let t = 0;
    for (let i = 0; i < n; i++) {
      if (blocked(this.cells[i])) {
        d[i] = 0;
        q[t++] = i;
      }
    }
    while (h < t) {
      const i = q[h++];
      const ix = i % this.nx;
      const iz = (i / this.nx) | 0;
      for (const [dx, dz] of N8) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        const j = jz * this.nx + jx;
        if (d[j] > d[i] + 1) {
          d[j] = d[i] + 1;
          q[t++] = j;
        }
      }
    }
    return d;
  }

  cellOf(x, z) {
    const ix = Math.max(0, Math.min(this.nx - 1, Math.round((x - this.minX) / this.step)));
    const iz = Math.max(0, Math.min(this.nz - 1, Math.round((z - this.minZ) / this.step)));
    return iz * this.nx + ix;
  }
  pos(i) {
    return { x: this.minX + (i % this.nx) * this.step, z: this.minZ + ((i / this.nx) | 0) * this.step };
  }
  passable(mode, i) {
    const c = this.cells[i];
    return mode === 'sheep' ? c === 0 || c === 3 : c !== 2;
  }
  /** Cost multiplier for entering cell i. */
  cost(mode, i, extra) {
    const c = this.cells[i];
    if (mode === 'sheep') {
      if (c === 3) return 1;
      const cl = this.sheepClear[i];
      return 1 + (cl <= 1 ? 2.5 : cl === 2 ? 0.8 : cl === 3 ? 0.2 : 0);
    }
    const cl = this.dogClear[i];
    let k = 1 + (c === 1 ? 1.1 : 0) + (cl <= 1 ? 2 : cl === 2 ? 0.4 : 0);
    if (this.foldZone[i]) k += 6;
    if (extra) k += extra(i);
    return k;
  }
  /** The nearest passable cell to (x, z) within a few metres, or -1. */
  snap(x, z, mode, radius = 10) {
    const i0 = this.cellOf(x, z);
    if (this.passable(mode, i0)) return i0;
    const ix0 = i0 % this.nx;
    const iz0 = (i0 / this.nx) | 0;
    let best = -1;
    let bd = Infinity;
    for (let r = 1; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix0 + dx;
          const jz = iz0 + dz;
          if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
          const j = jz * this.nx + jx;
          if (!this.passable(mode, j)) continue;
          const p = this.pos(j);
          const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (dd < bd) {
            bd = dd;
            best = j;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Dijkstra from the fold mouth over the cells sheep walk on: every cell's way home. */
  buildField() {
    const n = this.n;
    const f = new Float64Array(n).fill(Infinity);
    const seed = this.snap(this.fold.mouth.x, this.fold.mouth.z, 'sheep');
    this.fieldSeed = seed;
    if (seed < 0) {
      this.field = f;
      return;
    }
    const heap = new MinHeap();
    f[seed] = 0;
    heap.push(0, seed);
    while (heap.size) {
      const i = heap.pop();
      const ix = i % this.nx;
      const iz = (i / this.nx) | 0;
      for (const [dx, dz, l] of N8) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        const j = jz * this.nx + jx;
        if (!this.passable('sheep', j)) continue;
        if (dx && dz && (!this.passable('sheep', iz * this.nx + jx) || !this.passable('sheep', jz * this.nx + ix))) continue;
        const nd = f[i] + l * this.step * this.cost('sheep', j);
        if (nd < f[j]) {
          f[j] = nd;
          heap.push(nd, j);
        }
      }
    }
    this.field = f;
  }

  /** The flock's way home from (x, z): cell indices down the distance field to the mouth. */
  descend(p, maxCells = 400) {
    if (!this.field) this.buildField();
    let i = this.snap(p.x, p.z, 'sheep', 8);
    if (i < 0 || !Number.isFinite(this.field[i])) return [];
    const out = [i];
    while (i !== this.fieldSeed && out.length < maxCells) {
      const ix = i % this.nx;
      const iz = (i / this.nx) | 0;
      let best = -1;
      let bv = this.field[i];
      for (const [dx, dz] of N8) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        const j = jz * this.nx + jx;
        if (this.field[j] < bv) {
          bv = this.field[j];
          best = j;
        }
      }
      if (best < 0) break;
      i = best;
      out.push(i);
    }
    return out;
  }
  fieldDist(p) {
    if (!this.field) this.buildField();
    const i = this.snap(p.x, p.z, 'sheep', 8);
    return i < 0 ? Infinity : this.field[i];
  }

  astar(from, to, mode, extra) {
    const s = this.snap(from.x, from.z, mode, 12);
    const g0 = this.snap(to.x, to.z, mode, 12);
    if (s < 0 || g0 < 0) return [];
    if (s === g0) return [s];
    const n = this.n;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gp = this.pos(g0);
    const h = (i) => {
      const p = this.pos(i);
      const dx = Math.abs(p.x - gp.x);
      const dz = Math.abs(p.z - gp.z);
      return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz);
    };
    const heap = new MinHeap();
    g[s] = 0;
    heap.push(h(s), s);
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < n * 2) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === g0) {
        found = true;
        break;
      }
      const ix = i % this.nx;
      const iz = (i / this.nx) | 0;
      for (const [dx, dz, l] of N8) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        const j = jz * this.nx + jx;
        if (closed[j] || !this.passable(mode, j)) continue;
        if (dx && dz && (!this.passable(mode, iz * this.nx + jx) || !this.passable(mode, jz * this.nx + ix))) continue;
        const nd = g[i] + l * this.step * this.cost(mode, j, extra);
        if (nd < g[j]) {
          g[j] = nd;
          came[j] = i;
          heap.push(nd + h(j), j);
        }
      }
    }
    if (!found) return [];
    const path = [];
    for (let i = g0; i >= 0; i = came[i]) {
      path.push(i);
      if (i === s) break;
    }
    return path.reverse();
  }

  /** Is the straight line a-b clear for Pip (no solid cells, not much water, not through the fold)? */
  dogLine(a, b, allowFold = false) {
    const L = dist(a, b);
    const n = Math.max(1, Math.ceil(L / 0.8));
    let wet = 0;
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const z = a.z + ((b.z - a.z) * k) / n;
      const i = this.cellOf(x, z);
      const c = this.cells[i];
      if (c === 2) {
        // The cell may be solid only at its centre: test the true point against neighbours.
        if (k > 0 && k < n) return false;
        continue;
      }
      if (c === 1) wet += L / n;
      if (!allowFold && this.foldZone[i] && k > 0 && k < n) return false;
    }
    return wet < 7;
  }

  /** Is the straight line clear for the sheep (open ground or a crossing only)? */
  sheepLine(a, b) {
    const L = dist(a, b);
    const n = Math.max(1, Math.ceil(L / 1));
    for (let k = 1; k <= n; k++) {
      const i = this.cellOf(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n);
      if (!this.passable('sheep', i)) return false;
    }
    return true;
  }

  /**
   * A point about `L` metres down a path from `from`, cut short where the path bends away from
   * its first heading (so the drive goal never cuts a corner into a bank or a wall).
   */
  lookahead(path, from, L, stopAtCrossing = true) {
    if (path.length === 0) return null;
    let acc = 0;
    let prev = from;
    let heading = null;
    let out = this.pos(path[0]);
    for (let k = 0; k < path.length; k++) {
      const p = this.pos(path[k]);
      if (stopAtCrossing && this.cells[path[k]] === 3 && k > 0) break;
      acc += dist(prev, p);
      prev = p;
      const d = dist(from, p);
      if (d > 5) {
        const a = Math.atan2(p.z - from.z, p.x - from.x);
        if (heading === null) heading = a;
        else if (Math.abs(angWrap(a - heading)) > 0.55) break;
      }
      out = p;
      if (acc >= L) break;
    }
    return out;
  }
}

/** The stream's crossing axis at a ford (unit normal to the nearest stream segment) and its half width. */
function streamNormalAt(def, x, z) {
  let best = Infinity;
  let out = { x: 1, z: 0, half: 3 };
  for (const s of def.streams ?? []) {
    const p = s.points;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best) {
        best = d;
        const n = norm(-dz, dx);
        out = { x: n.x, z: n.z, half: s.halfWidth };
      }
    }
  }
  return out;
}

/** Groups of free sheep: ewes, rams and black sheep cluster by distance; lambs join their mothers. */
function makeGroups(free, gap = 11) {
  const byId = new Map(free.map((s) => [s.id, s]));
  const attached = (s) => s.kind === 'lamb' && s.motherId >= 0 && byId.has(s.motherId);
  const core = free.filter((s) => !attached(s) && !(s.kind === 'lamb' && s.motherId < 0));
  const groups = [];
  const seen = new Set();
  for (const s of core) {
    if (seen.has(s.id)) continue;
    const members = [];
    const stack = [s];
    seen.add(s.id);
    while (stack.length) {
      const a = stack.pop();
      members.push(a);
      for (const b of core) {
        if (!seen.has(b.id) && dist(a, b) < gap) {
          seen.add(b.id);
          stack.push(b);
        }
      }
    }
    groups.push({ members, lambs: [] });
  }
  for (const s of free) {
    if (!attached(s)) continue;
    const g = groups.find((q) => q.members.some((m) => m.id === s.motherId));
    if (g) g.lambs.push(s);
  }
  for (const g of groups) {
    const all = g.members.concat(g.lambs);
    const c = { x: 0, z: 0 };
    for (const m of all) {
      c.x += m.x / all.length;
      c.z += m.z / all.length;
    }
    g.all = all;
    g.c = c;
    g.r = Math.max(1, ...all.map((m) => dist(m, c)));
    g.n = all.length;
  }
  return groups;
}

/** Seeded random numbers (mulberry32), so a skill's noise is the same run to run. */
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How the bot plays (see docs/BOT2.md):
 * - expert: perfect knowledge, textbook lines, flanks with Z/X.
 * - average: a stand-in for a person on a first play. It only reacts to a wolf once it is on screen,
 *   close, or announced, and 0.4 s late; it goes for the nearest wolf (a bait wolf fools it); it
 *   changes its mind at most every half second (so it overshoots); its drive points wander 2-3.5 m;
 *   it walks unless the target is over 40 m away; it stops to look around now and then; it goes
 *   round a flock closer and only once well off line (so it pushes flocks sideways and splits them),
 *   going wider once a drive has stalled. Every delay and
 *   draw uses game time and a seeded RNG, so a run plays the same in season-run and in a capture.
 */
const SKILLS = {
  expert: { react: 0, aim: 0, sprintFar: 18, pause: null, orbit: 15, slack: 0.7, flank: true, nearestWolf: false, hold: 0 },
  average: { react: 0.4, aim: 3.5, sprintFar: 40, pause: [15, 32, 1.2, 2.6], orbit: 11, slack: 1.3, flank: false, nearestWolf: true, hold: 0.5 },
};

export class HerdBot2 {
  constructor(page, log = () => {}, opts = {}) {
    this.page = page;
    this.log = log;
    this.skillName = opts.skill && SKILLS[opts.skill] ? opts.skill : 'expert';
    this.skill = SKILLS[this.skillName];
    this.rng = rng32(opts.seed ?? 7);
    /** Wolves the bot knows about: id -> game time it noticed them. */
    this.noticed = new Map();
    this.announced = new Set();
    this.aimOff = { x: 0, z: 0, until: -1 };
    this.pauseAt = null;
    this.pauseUntil = -1;
    this.keys = new Set();
    this.nav = null;
    this.navKey = '';
    this.def = null;
    this.lastPos = null;
    this.stuckT = 0;
    this.jiggle = null;
    this.focus = null;
    this.cross = null;
    this.foldStage = false;
    this.orbitDir = 0;
    this.dogPath = null;
    this.flockPath = null;
    this.barks = 0;
    this.stats = {};
    this.stuckTotal = 0;
    this.latched = false;
    this.lastLatch = -99;
    this.progress = { id: null, best: Infinity, t: 0 };
    this.stallT = 0;
    /** Sheep found outside the valley edge (unreachable): id -> where and when. */
    this.stranded = new Map();
    /** The found lost lamb: how long it has stood at the gate without going in. */
    this.gateWait = 0;
    this.lambGivenUp = null;
  }

  async setKeys(want) {
    for (const k of [...this.keys]) {
      if (!want.has(k)) {
        await this.page.keyboard.up(k);
        this.keys.delete(k);
      }
    }
    for (const k of want) {
      if (!this.keys.has(k)) {
        await this.page.keyboard.down(k);
        this.keys.add(k);
      }
    }
  }

  async release() {
    await this.setKeys(new Set());
  }

  /** Fetch the grid when the level changes and again whenever a ford floods. */
  async ensureNav(st) {
    const key = `${st.levelId}|${(st.fords ?? []).map((f) => (f ? 1 : 0)).join('')}`;
    if (key === this.navKey && this.nav) return;
    const [grid, def] = await this.page.evaluate(() => [window.__WG.navGrid(), window.__WG.level]);
    this.def = def;
    this.nav = new Nav(grid, def);
    if (st.objective !== 'watch') this.nav.buildField();
    this.navKey = key;
    this.dogPath = null;
    this.flockPath = null;
    this.cross = null;
    this.log(`nav ${key}: ${grid.nx}x${grid.nz}, crossings ${this.nav.crossings.map((c) => `${c.kind}${c.open ? '' : '(shut)'}`).join(',')}`);
  }

  // ------------------------------------------------------------------ planning helpers

  /** Where to drive a group next: {p, name}. */
  groupGoal(g) {
    const nav = this.nav;
    const fold = nav.fold;
    // Trial: take the next gate like a crossing: line the flock up on its side, then drive through.
    const gt = this.st?.objective === 'trial' ? this.st.gate : null;
    if (gt) {
      const dx = gt.bx - gt.ax;
      const dz = gt.bz - gt.az;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l;
      const nz = dx / l;
      const side = Math.sign((g.c.x - gt.x) * nx + (g.c.z - gt.z) * nz) || 1;
      if (!this.gateRun || this.gateRun.idx !== this.st.gateIdx) this.gateRun = { idx: this.st.gateIdx, s: side, stage: 'gather' };
      const s = this.gateRun.s;
      const ap = { x: gt.x + nx * s * 10, z: gt.z + nz * s * 10 };
      const ex = { x: gt.x - nx * s * 14, z: gt.z - nz * s * 14 };
      const da = dist(g.c, ap);
      if (this.gateRun.stage === 'gather' && da < 5) this.gateRun.stage = 'cross';
      else if (this.gateRun.stage === 'cross' && da > 18 && dist(g.c, ex) > 18) this.gateRun.stage = 'gather';
      if (this.gateRun.stage === 'cross') return { p: ex, name: 'gate-through' };
      if (da < 18 && nav.sheepLine(g.c, ap)) return { p: ap, name: 'gate-line-up' };
      const fp = this.flockPathTo(g.c, ap);
      return { p: nav.lookahead(fp, g.c, 14) ?? ap, name: 'gate-approach' };
    }
    this.gateRun = null;
    const l = nav.local(g.c);
    const W = nav.pen.halfW;
    const S = nav.pen.scale;
    const inZone = this.foldStage ? l.x > -W - 18 * S && Math.abs(l.z) < 11 * S : l.x > -W - 15 * S && Math.abs(l.z) < 9 * S;
    if (inZone && nav.sheepLine(g.c, fold.mouth)) {
      this.foldStage = true;
      return { p: fold.inside, name: 'fold' };
    }
    this.foldStage = false;
    const path = nav.descend(g.c);
    if (path.length === 0) return { p: fold.mouth, name: 'mouth (no path)' };
    // The first crossing on the way home, if any.
    let cr = null;
    for (let k = 0; k < path.length; k++) {
      if (nav.cells[path[k]] !== 3) continue;
      const p = nav.pos(path[k]);
      let bd = Infinity;
      for (const c of nav.crossings) {
        if (!c.open) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < bd) {
          bd = d;
          cr = c;
        }
      }
      break;
    }
    if (cr) {
      const along = (g.c.x - cr.x) * cr.ux + (g.c.z - cr.z) * cr.uz;
      if (!this.cross || this.cross.id !== cr.id) this.cross = { id: cr.id, s: Math.sign(along) || 1, stage: 'gather' };
      const s = this.cross.s;
      const ap = { x: cr.x + cr.ux * s * (cr.len / 2 + 5), z: cr.z + cr.uz * s * (cr.len / 2 + 5) };
      const ex = { x: cr.x - cr.ux * s * (cr.len / 2 + 8), z: cr.z - cr.uz * s * (cr.len / 2 + 8) };
      const da = dist(g.c, ap);
      if (this.cross.stage === 'gather' && da < 6) this.cross.stage = 'cross';
      else if (this.cross.stage === 'cross' && da > 14 && along * s > cr.len / 2) this.cross.stage = 'gather';
      if (this.cross.stage === 'cross') return { p: ex, name: `${cr.kind}-cross` };
      if (da < 16 && nav.sheepLine(g.c, ap)) return { p: ap, name: `${cr.kind}-approach` };
      const fp = this.flockPathTo(g.c, ap);
      const p = nav.lookahead(fp, g.c, 15) ?? ap;
      return { p, name: `${cr.kind}-approach` };
    }
    this.cross = null;
    const p = nav.lookahead(path, g.c, 16, false) ?? fold.mouth;
    return { p, name: 'home' };
  }

  /** A* for the flock to a waypoint, cached for a moment. */
  flockPathTo(from, to) {
    const fp = this.flockPath;
    if (fp && dist(fp.to, to) < 2 && dist(fp.from, from) < 4 && this.now - fp.t < 2) return fp.path;
    const path = this.nav.astar(from, to, 'sheep');
    this.flockPath = { from: { ...from }, to: { ...to }, path, t: this.now };
    return path;
  }

  /** Where Pip should steer to reach `target` (straight if clear, else along an A* path). */
  route(dog, target, opts = {}) {
    const nav = this.nav;
    const allowFold = !!opts.allowFold;
    // A target inside a wall or a rock (a drive point just behind a flock pressed against a field
    // wall) has no path: Pip would push at it from the wrong side forever. Use the nearest open cell.
    if (nav.cells[nav.cellOf(target.x, target.z)] === 2) {
      const ti = nav.cellOf(target.x, target.z);
      const tx = ti % nav.nx;
      const tz = (ti / nav.nx) | 0;
      let best = null;
      let bd = Infinity;
      for (let r = 1; r <= 6 && !best; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = tx + dx;
            const z = tz + dz;
            if (x < 0 || z < 0 || x >= nav.nx || z >= nav.nz) continue;
            const i = z * nav.nx + x;
            if (nav.cells[i] === 2) continue;
            const p = nav.pos(i);
            const d = Math.hypot(p.x - target.x, p.z - target.z) + 0.3 * Math.hypot(p.x - dog.x, p.z - dog.z);
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
        }
      }
      if (best) target = best;
    }
    if (nav.dogLine(dog, target, allowFold)) {
      this.dogPath = null;
      return { p: target, via: 'line' };
    }
    const dp = this.dogPath;
    let path;
    if (dp && dist(dp.to, target) < 3 && this.now - dp.t < 1.5 && dp.allowFold === allowFold) path = dp.path;
    else {
      const extra = allowFold ? (i) => (nav.foldZone[i] ? -6 : 0) : null;
      path = nav.astar(dog, target, 'dog', extra);
      this.dogPath = { to: { ...target }, path, t: this.now, allowFold };
    }
    if (path.length < 2) return { p: target, via: 'nopath' };
    // Nearest node on the path, then the furthest node ahead (within 10 m) that is in plain view.
    let k0 = 0;
    let bd = Infinity;
    for (let k = 0; k < path.length; k++) {
      const d = dist(dog, nav.pos(path[k]));
      if (d < bd) {
        bd = d;
        k0 = k;
      }
    }
    let pick = nav.pos(path[Math.min(path.length - 1, k0 + 1)]);
    for (let k = k0 + 1; k < path.length; k++) {
      const p = nav.pos(path[k]);
      if (dist(dog, p) > 10) break;
      if (nav.dogLine(dog, p, allowFold)) pick = p;
    }
    return { p: pick, via: 'path' };
  }

  /** Orbit outside the flight zone when Pip is on the wrong side of the group. */
  outrun(dog, g, target, minR = 15, slack = 0.7) {
    const orbitR = g.r + minR;
    const cur = Math.atan2(dog.z - g.c.z, dog.x - g.c.x);
    const want = Math.atan2(target.z - g.c.z, target.x - g.c.x);
    const da = angWrap(want - cur);
    if (Math.abs(da) <= (this.orbitDir ? 0.7 : slack) || dist(target, g.c) > orbitR + 4) {
      this.orbitDir = 0;
      return null;
    }
    const r = Math.max(orbitR, Math.min(dist(dog, g.c), orbitR + 8));
    // Pick the way round with less in the way (walls, the valley edge), and keep to it.
    if (!this.orbitDir) {
      const blocked = (dir) => {
        let b = 0;
        const span = dir === Math.sign(da) ? Math.abs(da) : Math.PI * 2 - Math.abs(da);
        for (let a = 0.3; a < span; a += 0.3) {
          const x = g.c.x + Math.cos(cur + dir * a) * r;
          const z = g.c.z + Math.sin(cur + dir * a) * r;
          if (this.nav.cells[this.nav.cellOf(x, z)] === 2) b += 1;
        }
        return b * 3 + span * 2;
      };
      this.orbitDir = blocked(1) <= blocked(-1) ? 1 : -1;
    }
    const ahead = (dir) => {
      for (const rr of [r, r - 3, r + 4, r - 6, r - 9]) {
        const x = g.c.x + Math.cos(cur + dir * 0.55) * rr;
        const z = g.c.z + Math.sin(cur + dir * 0.55) * rr;
        if (this.nav.cells[this.nav.cellOf(x, z)] !== 2) return { x, z };
      }
      return null;
    };
    let p = ahead(this.orbitDir);
    if (!p) {
      // Walled off this way round (the valley's edge behind the flock): go round the other way.
      this.orbitDir = -this.orbitDir;
      p = ahead(this.orbitDir);
    }
    return p ?? { x: g.c.x + Math.cos(cur + this.orbitDir * 0.55) * r, z: g.c.z + Math.sin(cur + this.orbitDir * 0.55) * r };
  }

  /** The wolves this bot knows about (all of them for the expert). */
  knownWolves(st) {
    if (!this.skill.react) return st.wolves;
    const now = st.elapsed;
    for (const w of st.wolves) {
      if (this.noticed.has(w.id)) continue;
      if (w.onScreen || w.state === 'drag' || this.announced.has(w.id) || dist(w, st.dog) < 25) this.noticed.set(w.id, now);
    }
    for (const id of [...this.noticed.keys()]) if (!st.wolves.some((w) => w.id === id)) this.noticed.delete(id);
    return st.wolves.filter((w) => this.noticed.has(w.id) && now - this.noticed.get(w.id) >= this.skill.react);
  }

  /** A person's drive point wanders: a seeded offset redrawn every few seconds of game time. */
  aim(p) {
    if (!this.skill.aim) return p;
    if (this.now >= this.aimOff.until) {
      const a = this.rng() * Math.PI * 2;
      const r = this.skill.aim * (0.4 + 0.6 * this.rng());
      this.aimOff = { x: Math.cos(a) * r, z: Math.sin(a) * r, until: this.now + 2.5 + this.rng() * 2 };
    }
    return { x: p.x + this.aimOff.x, z: p.z + this.aimOff.z };
  }

  /** A person stops to look around now and then (never with a wolf about). */
  pausing(st) {
    const P = this.skill.pause;
    if (!P) return false;
    const now = st.elapsed;
    if (this.pauseAt === null) this.pauseAt = now + P[0] + this.rng() * (P[1] - P[0]);
    if (now < this.pauseUntil) return true;
    if (now >= this.pauseAt) {
      this.pauseAt = now + P[0] + this.rng() * (P[1] - P[0]);
      if (st.wolves.some((w) => w.state === 'drag' || w.state === 'charge')) return false;
      this.pauseUntil = now + P[2] + this.rng() * (P[3] - P[2]);
      return true;
    }
    return false;
  }

  tally(cat, dt) {
    this.stats[cat] = (this.stats[cat] ?? 0) + dt;
  }

  // ------------------------------------------------------------------ decisions

  /** Returns {target, sprint, bark, creep, latch, why, cat, allowFold}. */
  decide(st) {
    this.st = st;
    const dog = st.dog;
    const now = st.elapsed;
    if (dog.stunT > 0) return { target: null, why: 'stunned', cat: 'stunned' };
    // Sheep outside the valley edge (a wolf dragged them out and dropped them) cannot be reached:
    // Pip and the sheep both stop at the edge. They are noted for the report and left alone.
    const boundary = this.def?.boundary;
    const outside = (s) => boundary && !pointInPolygon(s.x, s.z, boundary);
    for (const s of st.sheep) {
      if (isFree(s) && outside(s) && !this.stranded.has(s.id)) {
        this.stranded.set(s.id, { t: +now.toFixed(1), x: +s.x.toFixed(1), z: +s.z.toFixed(1) });
        this.log(`sheep ${s.id} is stranded outside the valley at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
      }
    }
    const free = st.sheep.filter((s) => isFree(s) && !(outside(s) && dist(s, dog) > 3));
    const quiet = st.evening === 'long-light';
    const canBark = dog.barkCd <= 0;

    // 1. Wolves: rescue a snatch the game calls feasible, then intercept hunters near the flock.
    const watch = st.objective === 'watch';
    const known = this.knownWolves(st);
    const draggers = st.dragFeasible === false ? [] : known.filter((w) => w.state === 'drag');
    const nearSheep = (w) => Math.min(Infinity, ...free.map((s) => dist(s, w)));
    const hunting = known.filter((w) => w.state === 'stalk' || w.state === 'charge');
    let threat = draggers.sort((a, b) => dist(a, dog) - dist(b, dog))[0];
    if (!threat && this.skill.nearestWolf) {
      // A first-time player runs at the wolf they can see nearest to Pip.
      threat = hunting.filter((w) => nearSheep(w) < 22 && dist(w, dog) < 45).sort((a, b) => dist(a, dog) - dist(b, dog))[0];
    } else if (!threat) {
      // A pack: the wolf circling behind the flock is the real danger; a bait wolf showing itself
      // and feinting is ignored unless it charges for real.
      threat = hunting.filter((w) => w.role === 'flanker' && nearSheep(w) < 32).sort((a, b) => nearSheep(a) - nearSheep(b))[0];
      const real = hunting.filter((w) => w.role !== 'bait' || w.state === 'charge');
      if (threat) {
        // handled below
      } else if (watch) {
        // Every wolf that comes near the flock is met, the one closest to a sheep first.
        threat = real.filter((w) => nearSheep(w) < 40).sort((a, b) => nearSheep(a) - nearSheep(b))[0];
      } else {
        threat = real.filter((w) => nearSheep(w) < 16 && dist(w, dog) < 45).sort((a, b) => dist(a, dog) - dist(b, dog))[0];
      }
    }
    if (threat) {
      const d = dist(threat, dog);
      // The old grey only hears a bark from about 12.9 m (and takes two): the expert closes in
      // first; a first-time player barks from the usual distance and wastes some.
      const grey = threat.kind === 'grey';
      const barkAt = grey && this.skillName === 'expert' ? 11.5 : watch ? 16 : 14;
      return {
        target: { x: threat.x, z: threat.z },
        sprint: d > (this.skillName === 'expert' ? 6 : 10),
        bark: canBark && d < barkAt && (!quiet || threat.state === 'drag' || d < 9),
        why: `wolf ${threat.kind ?? 'wolf'} ${threat.state}${threat.stagger ? ' (staggered)' : ''} ${d.toFixed(0)}m`,
        cat: threat.state === 'drag' ? 'rescue' : 'wolf',
      };
    }

    if (watch) return this.decideWatch(st, free);

    // 2. The found lost lamb: lead it home at a walk.
    const orphan = free.find((s) => s.kind === 'lamb' && s.motherId < 0 && s.id !== this.lambGivenUp?.id);
    const nav = this.nav;
    const fold = nav.fold;
    const others = free.filter((s) => s.kind !== 'lamb' || s.motherId >= 0);
    if (st.folded >= st.target && st.t > 0.9) return { target: null, latch: true, why: 'latch: late', cat: 'latch' };
    if (orphan) {
      const dl = dist(orphan, dog);
      const busyMouth = others.some((s) => dist(s, fold.mouth) < 22);
      const goIn = dist(orphan, fold.mouth) < 16 && !busyMouth;
      const goal = goIn ? fold.inside : fold.mouth;
      // It only follows within 40 m: if Pip got called away, go back for it.
      // A lamb that does not come (water or a wall between them) is fetched: Pip goes back to it.
      if (dl < 7) this.lambFetch = false;
      if (dl > 30 || this.lambFetch) return { target: { x: orphan.x, z: orphan.z }, sprint: dl > 45, why: `lamb: go back for it (${dl.toFixed(0)}m)`, cat: 'lamb' };
      if (dl > 10 && dist(dog, fold.mouth) > 4) {
        this.lambWaitT = (this.lambWaitT ?? 0) + (this.lastDt ?? 0.1);
        if (this.lambWaitT > 5) {
          this.lambFetch = true;
          this.lambWaitT = 0;
        }
        return { target: null, why: `lamb: wait (${dl.toFixed(0)}m behind)`, cat: 'lamb' };
      }
      this.lambWaitT = 0;
      if (dist(dog, goal) < 1.5) {
        // Standing at the gate with the lamb beside it: a lamb that will not go in is noted and left.
        this.gateWait = dist(orphan, fold.gate) < 8 ? this.gateWait + (this.lastDt ?? 0.1) : 0;
        if (this.gateWait > 20) {
          const l = nav.local(orphan);
          this.lambGivenUp = { id: orphan.id, t: +now.toFixed(1), x: +orphan.x.toFixed(1), z: +orphan.z.toFixed(1), localX: +l.x.toFixed(2), localZ: +l.z.toFixed(2), dog: { x: +dog.x.toFixed(1), z: +dog.z.toFixed(1) } };
          this.log(`lost lamb ${orphan.id} would not go through the gate in 20 s: at (${orphan.x.toFixed(1)}, ${orphan.z.toFixed(1)}), pen-local x ${l.x.toFixed(2)} (gate line at ${-nav.pen.halfW})`);
        }
        return { target: null, why: 'lamb: at the gate', cat: 'lamb' };
      }
      this.gateWait = 0;
      return { target: goal, sprint: false, allowFold: goIn, why: `lamb: lead ${goIn ? 'in' : 'to the gate'}`, cat: 'lamb' };
    }

    // 3. Latch once the target is met and the rest cannot be brought in time.
    const groups = makeGroups(others);
    const hidden = st.sheep.find((s) => s.state === 'hidden');
    const timeLeft = (1 - st.t) * (st.dayLength ?? 300);
    if (st.folded >= st.target) {
      let best = Infinity;
      for (const g of groups) best = Math.min(best, dist(dog, g.c) / 9 + nav.fieldDist(g.c) / 2.2 + 8);
      if (hidden && groups.length === 0) best = (dist(dog, hidden) + nav.fieldDist(hidden)) / 7 + 8;
      if (best > timeLeft * 0.9) return { target: null, latch: true, why: `latch: ${best.toFixed(0)}s needed, ${timeLeft.toFixed(0)}s left`, cat: 'latch' };
    }

    // 4. The lost lamb, once the rest are home (or the target is met), or when it is on the way.
    if (hidden && (groups.length === 0 || st.folded >= st.target || dist(hidden, dog) < 25)) {
      return { target: { x: hidden.x, z: hidden.z }, sprint: dist(hidden, dog) > 30, why: `fetch lost lamb ${dist(hidden, dog).toFixed(0)}m`, cat: 'lamb' };
    }
    if (groups.length === 0) return { target: null, why: 'all home', cat: 'idle' };

    // 5. Pick the group to work: stick with the previous focus if it still exists. A group that has
    //    made no progress for 45 s is left alone for 40 s while another is worked, as a player
    //    would (the bot once spent five minutes on one ewe at a bridge while eleven waited).
    if (this.focus && this.stalled && now - this.progress.t > 45 && groups.length > 1) {
      this.log(`giving up on the group at (${this.focus.x.toFixed(0)}, ${this.focus.z.toFixed(0)}) for now: no progress in ${(now - this.progress.t).toFixed(0)} s`);
      this.avoid = { c: { ...this.focus }, until: now + 40 };
      this.focus = null;
      this.progress = { best: Infinity, t: now };
    }
    const avoided = (q) => this.avoid && now < this.avoid.until && dist(q.c, this.avoid.c) < 20;
    const choice = groups.some((q) => !avoided(q)) ? groups.filter((q) => !avoided(q)) : groups;
    let g = null;
    if (this.focus) g = choice.slice().sort((a, b) => dist(a.c, this.focus) - dist(b.c, this.focus))[0];
    if (!g || dist(g.c, this.focus) > 25) {
      const score = (q) => dist(q.c, dog) + nav.fieldDist(q.c) * 0.35 - q.n * 2;
      g = choice.slice().sort((a, b) => score(a) - score(b))[0];
      this.cross = null;
      this.orbitDir = 0;
    }
    this.focus = { ...g.c };
    const goal = this.groupGoal(g);

    // Progress watch (for the trace): has this group's way home shortened lately?
    const fd = nav.fieldDist(g.c);
    if (Math.abs(fd - this.progress.best) > 40 || fd < this.progress.best - 3) this.progress = { best: fd, t: now };
    this.stalled = now - this.progress.t > 30;

    // 6. Angus: a stubborn ram in the group anchors it. Stare him down (creep in, stand still),
    //    barking when he is near enough; never crowd him.
    const ram = g.members.find((s) => s.kind === 'ram') ?? free.find((s) => s.kind === 'ram' && dist(s, g.c) < g.r + 10);
    if (ram && ram.stubborn > 0.15 && ram.yieldT <= 0) {
      const dr = dist(dog, ram);
      const away = norm(ram.x - goal.p.x, ram.z - goal.p.z);
      let spot = { x: ram.x + away.x * 8, z: ram.z + away.z * 8 };
      if (nav.cells[nav.cellOf(spot.x, spot.z)] === 2) {
        const side = norm(dog.x - ram.x, dog.z - ram.z);
        spot = { x: ram.x + side.x * 8, z: ram.z + side.z * 8 };
      }
      const bark = canBark && dr < 11 && !quiet;
      if (dr < 6.2) {
        // Too close: back off (creeping, so he does not butt).
        const out = norm(dog.x - ram.x, dog.z - ram.z);
        return { target: { x: ram.x + out.x * 8, z: ram.z + out.z * 8 }, creep: true, bark, why: 'ram: back off', cat: 'ram' };
      }
      if (dist(dog, spot) < 2.5 || (dr < 10 && dr > 6.5 && dist(dog, spot) < 5)) return { target: null, creep: true, bark, why: `ram: stare (${ram.stubborn.toFixed(2)})`, cat: 'ram' };
      // Go round him, never through the 6 m around his horns.
      let target = spot;
      const segD = distToSeg(ram, dog, spot);
      if (segD < 7) {
        const cur = Math.atan2(dog.z - ram.z, dog.x - ram.x);
        const want = Math.atan2(spot.z - ram.z, spot.x - ram.x);
        const da = angWrap(want - cur);
        const rr = Math.max(9, Math.min(dr, 12));
        target = { x: ram.x + Math.cos(cur + Math.sign(da) * 0.6) * rr, z: ram.z + Math.sin(cur + Math.sign(da) * 0.6) * rr };
      }
      return { target, creep: dr < 13, sprint: dr > 30, bark, why: `ram: to stare spot (${ram.stubborn.toFixed(2)}, ${dr.toFixed(0)}m)`, cat: 'ram' };
    }

    // 7. Collect strays, else drive (Strombom).
    const n = g.members.length;
    const loose = 3 + 1.4 * Math.sqrt(g.n);
    const strayOk = (s) => s.kind !== 'lamb' || !others.some((m) => m.id === s.motherId) || dist(s, others.find((m) => m.id === s.motherId)) > 12;
    const stray = g.all.filter((s) => dist(s, g.c) > loose && strayOk(s)).sort((a, b) => dist(b, g.c) - dist(a, g.c))[0];
    let target;
    let why;
    let cat;
    if (stray && n > 1 && goal.name !== 'fold') {
      const away = norm(stray.x - g.c.x, stray.z - g.c.z);
      target = { x: stray.x + away.x * 4.5, z: stray.z + away.z * 4.5 };
      why = `collect stray ${stray.id}`;
      cat = 'collect';
    } else {
      const back = norm(g.c.x - goal.p.x, g.c.z - goal.p.z);
      const stand = g.r + 6.5;
      target = { x: g.c.x + back.x * stand, z: g.c.z + back.z * stand };
      why = `drive ${g.n} to ${goal.name}`;
      cat = 'drive';
    }
    // A ram that has given way still gets a bark when he starts to dig in again.
    let bark = false;
    if (ram && canBark && !quiet && ram.yieldT <= 0 && ram.stubborn > 0.12 && dist(dog, ram) < 12) bark = true;

    // 8. Outrun: on the wrong side of the group, orbit it outside the flight zone.
    const orbit = this.outrun(dog, g, target, this.stalled ? 15 : this.skill.orbit, this.stalled ? 0.7 : this.skill.slack);
    if (orbit) {
      target = orbit;
      why += ' (outrun)';
      cat = 'outrun';
    }
    const dc = dist(dog, g.c);
    const far = this.skill.sprintFar;
    const sprint = orbit ? dc > g.r + far : dist(dog, target) > far && dc > g.r + 15;
    // Expert: go round with the flank command (the game keeps Pip just outside the flight zone).
    let flank = 0;
    // Not at a crossing, a trial gate or the fold: the flank key circles the whole flock and does
    // not mind water, so lining up on a bridge it ran round and round across the stream.
    if (orbit && this.skill.flank && !this.cross && !this.foldStage && !this.gateRun) {
      // Only when the game's flank would go round this group (it circles the flock nearest Pip).
      const nearest = free.slice().sort((a, b) => dist(a, dog) - dist(b, dog))[0];
      if (nearest && g.all.some((m) => m.id === nearest.id) && dist(nearest, dog) < g.r + 30) flank = this.orbitDir;
    }
    if (cat === 'drive' || cat === 'collect' || cat === 'outrun') target = this.aim(target);
    if (this.stalled) why += ' [stalled]';
    return { target, sprint, bark, why, cat, flank };
  }

  /** Night watch: keep the flock bunched and stay close to it. */
  decideWatch(st, free) {
    const dog = st.dog;
    if (free.length === 0) return { target: null, why: 'no sheep left', cat: 'idle' };
    const groups = makeGroups(free, 14).sort((a, b) => b.n - a.n);
    const main = groups[0];
    const c = main.c;
    // Bring other groups and strays back to the main bunch.
    const loose = 4 + 1.5 * Math.sqrt(main.n);
    const strays = free.filter((s) => dist(s, c) > loose && !(s.kind === 'lamb' && free.some((m) => m.id === s.motherId && dist(m, s) < 4)));
    const stray = strays.sort((a, b) => dist(a, dog) - dist(b, dog))[0];
    if (stray) {
      const away = norm(stray.x - c.x, stray.z - c.z);
      let target = { x: stray.x + away.x * 4.5, z: stray.z + away.z * 4.5 };
      const sg = { c, r: main.r };
      const orbit = this.outrun(dog, { c: stray, r: 2 }, target, 11);
      let why = `watch: collect ${stray.id}`;
      if (orbit) {
        target = orbit;
        why += ' (outrun)';
      }
      void sg;
      return { target, sprint: dist(dog, target) > 25, why, cat: 'collect' };
    }
    // Guard: stand off the bunch on the side wolves are coming from (or the side Pip is on).
    const wolf = st.wolves.filter((w) => w.state !== 'flee').sort((a, b) => dist(a, c) - dist(b, c))[0];
    const side = wolf ? norm(wolf.x - c.x, wolf.z - c.z) : norm(dog.x - c.x, dog.z - c.z);
    const R = main.r + 9;
    let spot = { x: c.x + side.x * R, z: c.z + side.z * R };
    if (this.nav.cells[this.nav.cellOf(spot.x, spot.z)] === 2) spot = { x: c.x - side.x * R, z: c.z - side.z * R };
    if (dist(dog, spot) < 3) return { target: null, why: 'watch: guard', cat: 'guard' };
    const orbit = this.outrun(dog, main, spot, 10);
    return { target: orbit ?? spot, sprint: dist(dog, spot) > 30, why: `watch: to guard spot${orbit ? ' (outrun)' : ''}`, cat: 'guard' };
  }

  /**
   * One decision and the keys for it. `events` are the game's events since the last step (from
   * __WG.drain()): the average skill learns of a wolf from its announcement.
   */
  async step(st, dt, events = []) {
    this.now = st.elapsed;
    this.lastDt = dt;
    for (const e of events) if (e.type === 'wolfSpawn' || e.type === 'charge') this.announced.add(e.id);
    await this.ensureNav(st);
    const dog = st.dog;
    let d = this.decide(st);
    if (d.cat !== 'rescue' && d.cat !== 'wolf' && this.pausing(st)) d = { target: null, why: 'looking around', cat: 'pause' };
    // A person keeps going where they were heading for a moment before changing course.
    if (this.skill.hold) {
      const h = this.held;
      const urgent = (d.cat === 'rescue' || d.cat === 'wolf') && h?.d.cat !== d.cat;
      if (h && st.elapsed < h.until && !urgent && h.d.cat !== 'pause') d = { ...h.d, bark: d.bark, latch: d.latch };
      else this.held = { d, until: st.elapsed + this.skill.hold };
    }
    this.tally(d.cat ?? 'other', dt);
    const keys = new Set();
    if (d.target) {
      const r = this.route(dog, d.target, { allowFold: d.allowFold });
      let dx = r.p.x - dog.x;
      let dz = r.p.z - dog.z;
      // Unstick: if Pip has been pushing into something, slide sideways for a moment.
      const want = Math.hypot(d.target.x - dog.x, d.target.z - dog.z);
      if (this.lastPos && dist(this.lastPos, dog) < 0.6 * dt && want > 2 && !d.creep) this.stuckT += dt;
      else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.8 && !this.jiggle) {
        const side = Math.random() < 0.5 ? 1 : -1;
        this.jiggle = { t: 0.9, x: -dz * side, z: dx * side };
        this.dogPath = null;
      }
      if (this.jiggle) {
        dx = this.jiggle.x;
        dz = this.jiggle.z;
        this.jiggle.t -= dt;
        this.stuckTotal += dt;
        if (this.jiggle.t <= 0) {
          this.jiggle = null;
          this.stuckT = 0;
        }
      }
      const l = Math.hypot(dx, dz);
      if (d.flank && !this.jiggle && r.via === 'line') {
        // Flank command: X runs round clockwise on screen ("come bye", the angle grows), Z the other way.
        keys.add(d.flank > 0 ? 'KeyX' : 'KeyZ');
        if (d.sprint && dog.stamina > 20) keys.add('ShiftLeft');
      } else if (l > 0.7) {
        if (dx > 0.38 * l) keys.add('KeyD');
        if (dx < -0.38 * l) keys.add('KeyA');
        if (dz > 0.38 * l) keys.add('KeyS');
        if (dz < -0.38 * l) keys.add('KeyW');
        if (d.sprint && !d.creep && dog.stamina > 20) keys.add('ShiftLeft');
      }
    } else {
      this.stuckT = 0;
      this.jiggle = null;
    }
    if (d.creep) keys.add('KeyC');
    this.lastPos = { x: dog.x, z: dog.z };
    await this.setKeys(keys);
    if (d.bark && dog.barkCd <= 0 && dog.stunT <= 0) {
      await this.page.keyboard.press('Space');
      this.barks++;
    }
    if (d.latch && st.elapsed - this.lastLatch > 0.5) {
      await this.page.keyboard.press('Enter');
      this.lastLatch = st.elapsed;
    }
    return d;
  }
}

/** Even-odd test: is (x, z) inside the polygon [[x, z], ...]? */
function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from point p to segment a-b. */
function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}
