// A herding bot that plays Woolgather through real keyboard events.
// It reads the game state through window.__WG (test mode only) and presses WASD/Shift/Space.
// Strategy (after Strombom et al. 2014): collect strays back to the group, otherwise stand behind
// the group relative to the next waypoint and let the sheep flee forwards.

import { readFileSync } from 'node:fs';

const level = JSON.parse(readFileSync(new URL('../level/valley.json', import.meta.url), 'utf8'));

const fold = level.fold;
const FOLD_MIN_X = fold.center[0] - fold.halfW;
const GATE = { x: FOLD_MIN_X, z: fold.center[1] };
const FUNNEL = { x: FOLD_MIN_X - 12, z: fold.center[1] };
const INSIDE = { x: fold.center[0] + 2, z: fold.center[1] };
const bridge = level.bridge;
// Each crossing: a gathering point on the west bank and an exit point on the east bank.
const CROSSINGS = [
  {
    name: 'bridge',
    west: { x: bridge.center[0] - bridge.length / 2 - 3, z: bridge.center[1] },
    east: { x: bridge.center[0] + bridge.length / 2 + 5, z: bridge.center[1] },
  },
  {
    name: 'ford',
    west: { x: level.ford.center[0] - 8, z: level.ford.center[1] },
    east: { x: level.ford.center[0] + 9, z: level.ford.center[1] },
  },
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (x, z) => {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
};

function streamXAt(z) {
  const p = level.stream.points;
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, z0] = p[i];
    const [x1, z1] = p[i + 1];
    if ((z >= z0 && z <= z1) || (z >= z1 && z <= z0)) {
      const t = (z - z0) / (z1 - z0 || 1);
      return x0 + (x1 - x0) * t;
    }
  }
  return p[0][0];
}
const westOfStream = (p) => p.x < streamXAt(p.z) - 1;

function clusters(sheep, gap = 11) {
  const out = [];
  const seen = new Set();
  for (const s of sheep) {
    if (seen.has(s.id)) continue;
    const group = [];
    const stack = [s];
    seen.add(s.id);
    while (stack.length) {
      const a = stack.pop();
      group.push(a);
      for (const b of sheep) {
        if (!seen.has(b.id) && dist(a, b) < gap) {
          seen.add(b.id);
          stack.push(b);
        }
      }
    }
    const c = { x: 0, z: 0 };
    for (const g of group) {
      c.x += g.x / group.length;
      c.z += g.z / group.length;
    }
    const r = Math.max(...group.map((g) => dist(g, c)));
    out.push({ members: group, c, r });
  }
  return out;
}

// Solid blocks the dog must walk around: the fold and the farmhouse, padded.
const FOLD_RECT = {
  minX: fold.center[0] - fold.halfW,
  maxX: fold.center[0] + fold.halfW,
  minZ: fold.center[1] - fold.halfD,
  maxZ: fold.center[1] + fold.halfD,
};
const pad = (r, p) => ({ minX: r.minX - p, maxX: r.maxX + p, minZ: r.minZ - p, maxZ: r.maxZ + p });
const fh = level.farmhouse;
const BLOCKS = [
  pad(FOLD_RECT, 2.5),
  pad({ minX: fh.center[0] - fh.halfW, maxX: fh.center[0] + fh.halfW, minZ: fh.center[1] - fh.halfD, maxZ: fh.center[1] + fh.halfD }, 2),
];
const inRect = (p, r) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;

/** Liang-Barsky: does segment a->b pass through rectangle r? */
function segHitsRect(a, b, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const edges = [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dz, a.z - r.minZ],
    [dz, r.maxZ - a.z],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

const WINGS = fold.wings.map(([[ax, az], [bx, bz]]) => ({ a: { x: ax, z: az }, b: { x: bx, z: bz } }));
const cross2 = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
function segsIntersect(p1, p2, p3, p4) {
  const d1 = cross2(p3, p4, p1);
  const d2 = cross2(p3, p4, p2);
  const d3 = cross2(p1, p2, p3);
  const d4 = cross2(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Walk around blocks via their corners; leave the fold through its gate. */
function route(dog, target) {
  if (inRect(dog, FOLD_RECT)) return { x: FOLD_RECT.minX - 3, z: fold.center[1] };
  // Guide fences: go round the far (open) end of a fence instead of pushing into it.
  for (const w of WINGS) {
    if (segsIntersect(dog, target, w.a, w.b)) {
      const out = norm(w.b.x - w.a.x, w.b.z - w.a.z);
      return { x: w.b.x + out.x * 2.5, z: w.b.z + out.z * 2.5 };
    }
  }
  for (const r of BLOCKS) {
    if (inRect(target, r) || !segHitsRect(dog, target, r)) continue;
    const corners = [
      { x: r.minX - 0.5, z: r.minZ - 0.5 },
      { x: r.maxX + 0.5, z: r.minZ - 0.5 },
      { x: r.maxX + 0.5, z: r.maxZ + 0.5 },
      { x: r.minX - 0.5, z: r.maxZ + 0.5 },
    ].filter((c) => !segHitsRect(dog, c, r));
    if (corners.length === 0) continue;
    corners.sort((a, b) => dist(dog, a) + dist(a, target) - (dist(dog, b) + dist(b, target)));
    return corners[0];
  }
  return target;
}

function eastGoal(c) {
  // Approach the funnel from the west, then drive straight through the gate.
  if (c.x > FUNNEL.x - 3 && Math.abs(c.z - GATE.z) < 9) return { p: INSIDE, name: 'fold' };
  return { p: FUNNEL, name: 'funnel' };
}

export class HerdBot {
  constructor(page, log = () => {}) {
    this.page = page;
    this.log = log;
    this.keys = new Set();
    this.lastPos = null;
    this.stuckT = 0;
    this.jiggle = null;
    this.focus = null;
    this.lastBark = 0;
  }

  /** Next waypoint for a group, with hysteresis so the plan does not flip-flop. */
  goalFor(c) {
    if (!westOfStream(c)) {
      this.cross = null;
      return eastGoal(c);
    }
    if (!this.cross || dist(c, this.cross.west) > 45) {
      this.cross = CROSSINGS.slice().sort((a, b) => dist(c, a.west) - dist(c, b.west))[0];
      this.crossStage = 'gather';
    }
    if (this.crossStage === 'gather' && dist(c, this.cross.west) < 5) this.crossStage = 'cross';
    else if (this.crossStage === 'cross' && dist(c, this.cross.west) > 13) this.crossStage = 'gather';
    return this.crossStage === 'gather'
      ? { p: this.cross.west, name: `${this.cross.name}-west` }
      : { p: this.cross.east, name: `${this.cross.name}-cross` };
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

  /** Returns {target:{x,z}|null, sprint, bark, why}. */
  decide(st) {
    const dog = st.dog;
    const free = st.sheep.filter((s) => s.state !== 'folded' && s.state !== 'lost' && s.state !== 'grabbed');
    const now = st.elapsed;

    // 1. Wolves first: rescue grabbed sheep, then intercept hunters that are close.
    // Like a player reading the banner: a snatch the game calls too far to save is left alone.
    const draggers = st.dragFeasible === false ? [] : st.wolves.filter((w) => w.state === 'drag');
    // Only break off herding for wolves that are actually closing on a sheep.
    const nearSheep = (w) => Math.min(...free.map((s) => dist(s, w)), Infinity);
    const hunters = st.wolves.filter((w) => (w.state === 'stalk' || w.state === 'charge') && nearSheep(w) < 16);
    const threat = draggers[0] || hunters.filter((w) => dist(w, dog) < 45).sort((a, b) => dist(a, dog) - dist(b, dog))[0];
    if (threat) {
      const d = dist(threat, dog);
      return { target: threat, sprint: d > 6, bark: d < 14 && now - this.lastBark > 1.4, why: `wolf ${threat.state} ${d.toFixed(0)}m` };
    }
    if (free.length === 0) return { target: null, sprint: false, bark: false, why: 'all home' };
    // Late in the day with the target met: latch the gate rather than risk the stragglers.
    if (st.folded >= st.target && st.t > 0.9) return { target: null, sprint: false, bark: false, latch: true, why: 'latch gate' };

    // 2. Pick the group to work: stick with the previous focus if it still exists.
    const groups = clusters(free);
    let g;
    if (this.focus) g = groups.slice().sort((a, b) => dist(a.c, this.focus) - dist(b.c, this.focus))[0];
    if (!g || dist(g.c, this.focus) > 25) {
      g = groups.slice().sort((a, b) => dist(a.c, dog) + dist(a.c, GATE) * 0.35 - (dist(b.c, dog) + dist(b.c, GATE) * 0.35))[0];
    }
    this.focus = g.c;
    const goalInfo = this.goalFor(g.c);
    const goal = goalInfo.p;

    // 3. Collect strays, else drive.
    const n = g.members.length;
    const loose = 3 + 1.4 * Math.sqrt(n);
    const stray = g.members.filter((s) => dist(s, g.c) > loose).sort((a, b) => dist(b, g.c) - dist(a, g.c))[0];
    let target;
    let why;
    if (stray && n > 1) {
      const away = norm(stray.x - g.c.x, stray.z - g.c.z);
      target = { x: stray.x + away.x * 4.5, z: stray.z + away.z * 4.5 };
      why = `collect stray ${stray.id}`;
    } else {
      const back = norm(g.c.x - goal.x, g.c.z - goal.z);
      const stand = g.r + 6.5;
      target = { x: g.c.x + back.x * stand, z: g.c.z + back.z * stand };
      why = `drive ${n} to ${goalInfo.name}`;
    }

    // 4. Outrun: if we are on the wrong side of the group, orbit it outside the flight zone
    //    (like a real collie's wide outrun) instead of cutting through and scattering it.
    const orbitR = g.r + 15;
    const cur = Math.atan2(dog.z - g.c.z, dog.x - g.c.x);
    const want = Math.atan2(target.z - g.c.z, target.x - g.c.x);
    let da = want - cur;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    let orbiting = false;
    if (Math.abs(da) > 0.7 && dist(target, g.c) < orbitR + 4) {
      const step = Math.sign(da) * 0.55;
      const r = Math.max(orbitR, dist(dog, g.c));
      target = { x: g.c.x + Math.cos(cur + step) * r, z: g.c.z + Math.sin(cur + step) * r };
      why += ' (outrun)';
      orbiting = true;
    }
    // Sprinting widens the flight zone to 15 m, so only sprint while well clear of the group.
    const dc = dist(dog, g.c);
    const sprint = orbiting ? dc > g.r + 18 : dist(dog, target) > 18 && dc > orbitR;
    return { target, sprint, bark: false, why };
  }

  async step(st, dt) {
    const dog = st.dog;
    const d = this.decide(st);
    const keys = new Set();
    if (d.target) {
      const goTo = route(dog, d.target);
      let dx = goTo.x - dog.x;
      let dz = goTo.z - dog.z;
      // Unstick: if we have been pushing into something, slide sideways for a moment.
      if (this.lastPos && dist(this.lastPos, dog) < 0.05 * dt * 60 && Math.hypot(dx, dz) > 2) this.stuckT += dt;
      else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.8 && !this.jiggle) this.jiggle = { t: 0.9, x: -dz, z: dx };
      if (this.jiggle) {
        dx = this.jiggle.x;
        dz = this.jiggle.z;
        this.jiggle.t -= dt;
        if (this.jiggle.t <= 0) {
          this.jiggle = null;
          this.stuckT = 0;
        }
      }
      const l = Math.hypot(dx, dz);
      if (l > 1.0) {
        if (dx > 0.38 * l) keys.add('KeyD');
        if (dx < -0.38 * l) keys.add('KeyA');
        if (dz > 0.38 * l) keys.add('KeyS');
        if (dz < -0.38 * l) keys.add('KeyW');
        if (d.sprint && st.dog.stamina > 20) keys.add('ShiftLeft');
      }
    }
    this.lastPos = { x: dog.x, z: dog.z };
    await this.setKeys(keys);
    if (d.bark) {
      await this.page.keyboard.press('Space');
      this.lastBark = st.elapsed;
    }
    if (d.latch) await this.page.keyboard.press('Enter');
    return d;
  }
}
