import { DOG, SHEEP, WOLF } from './config';
import type { Input } from './input';
import type { Level, Pen } from './level';
import { clamp, closestOnSegment, dampAngle, invLerp, lerp, Rng } from './math';
import { collideStatic, separatePair, type Body } from './physics';
import { NO_PERKS, type Perks, type Rules } from './rules';

// The whole game rules live here, free of rendering, so the Playwright bot and the renderer read
// the same state. Everything moves on the XZ plane.

export interface Dog extends Body {
  facing: number;
  speed: number;
  stamina: number;
  staminaDelay: number;
  sprintLock: boolean;
  sprinting: boolean;
  creeping: boolean;
  barkCd: number;
  sinceBark: number;
  inWater: boolean;
  moving: boolean;
  /** Seconds Pip is still reeling from a ram's butt (no control). */
  stunT: number;
  /** Running over open ground with no sheep near (faster, and sprinting tires him less). */
  loping: boolean;
  /** Lying down: flat and still; the flock stops and settles. */
  lying: boolean;
  /** Flanking round a flock: 1 clockwise ("come bye"), -1 anticlockwise ("away"), 0 not. */
  flanking: number;
  /** Running the outrun (a charm). */
  outrunning?: boolean;
}

/** Fly, the old dog: at Pip's heel, running to a spot, or lying there holding it. */
export interface Helper extends Dog {
  mode: 'heel' | 'go' | 'down';
  tx: number;
  tz: number;
}

/** How far sheep keep off Fly while she lies holding a spot (and while she runs to it). */
export const FLY = { holdR: 6.5, runR: 8.5, wolfR: 8, speed: 9.5, heelSpeed: 12 };

export type SheepState = 'graze' | 'walk' | 'alert' | 'flee' | 'panic' | 'grabbed' | 'folded' | 'lost' | 'hidden';
export type SheepKind = 'ewe' | 'lamb' | 'ram' | 'black';

export interface Sheep extends Body {
  id: number;
  kind: SheepKind;
  /** A lamb's mother (sheep id), or -1 (an orphan follows Pip once found). */
  motherId: number;
  state: SheepState;
  facing: number;
  speed: number;
  fear: number;
  panicT: number;
  panicX: number;
  panicZ: number;
  alertT: number;
  wanderT: number;
  wanderX: number;
  wanderZ: number;
  grazing: boolean;
  bleatT: number;
  foldedAt: number;
  inWater: boolean;
  /** Seconds since the state last changed (animation uses it for hops). */
  stateT: number;
  prevDry: boolean;
  seed: number;
  trotX: number;
  trotZ: number;
  trotT: number;
  /** How long it has been driven steadily: a flock driven well settles into a quicker walk-on. */
  driveT: number;
  /** Seconds left following a flockmate that just went into a pen, and which pen. */
  followT: number;
  followPen: number;
  /** Where this sheep last settled: undisturbed sheep graze around it instead of wandering off. */
  homeX: number;
  homeZ: number;
  /** The ram's stubbornness (1 = will not budge, 0 = gives way) and how long he has given way for. */
  stubborn: number;
  yieldT: number;
  buttCd: number;
  /** Black sheep bolt now and then. */
  boltCd: number;
  /** The pen it is home in. */
  penId: string | null;
  /** Night watch: a ewe walking off on her own into the dark (seconds left), and where to. */
  strayT: number;
  strayX: number;
  strayZ: number;
}

export type WolfState = 'stalk' | 'charge' | 'drag' | 'flee' | 'gone';
/** In a pack: the bait shows itself on Pip's side and feints; the flanker circles to the far side. */
export type WolfRole = 'lone' | 'bait' | 'flanker';

export interface Wolf extends Body {
  id: number;
  state: WolfState;
  facing: number;
  speed: number;
  target: Sheep | null;
  respawnT: number;
  stateT: number;
  inWater: boolean;
  /** Seconds this wolf has been inside the valley: it must be seen approaching before it charges. */
  valleyT: number;
  role: WolfRole;
  /** The other wolf of its pair (wolf id), or -1. */
  mate: number;
  /** Bait: seconds left of a feint (a short rush at the flock that breaks off), and until the next. */
  feintT: number;
  feintCd: number;
  /** Flanker: seconds spent in position on the far side of the flock. */
  posT: number;
}

export type SimEvent =
  | { type: 'bark'; x: number; z: number }
  | { type: 'folded'; x: number; z: number; id: number; count: number }
  | { type: 'bleat'; x: number; z: number; id: number; urgent: boolean; kind: SheepKind }
  /** A wolf leaves the trees; (tx, tz) is the sheep it is after. */
  | { type: 'wolfSpawn'; x: number; z: number; id: number; tx: number; tz: number }
  | { type: 'wolfScared'; x: number; z: number; id: number }
  | { type: 'charge'; x: number; z: number; id: number }
  | { type: 'grab'; x: number; z: number; id: number }
  | { type: 'rescued'; x: number; z: number; id: number }
  | { type: 'lost'; x: number; z: number; id: number }
  | { type: 'dusk' }
  | { type: 'dawn' }
  | { type: 'targetMet' }
  | { type: 'splash'; x: number; z: number; big: boolean }
  /** The ram butts Pip (or a wolf). */
  | { type: 'butt'; x: number; z: number; wolf: boolean }
  | { type: 'stamp'; x: number; z: number }
  /** The ram gives way and moves off with the flock. */
  | { type: 'ramYield'; x: number; z: number }
  | { type: 'lambFound'; x: number; z: number; id: number }
  | { type: 'thunder'; x: number; z: number }
  | { type: 'flood' }
  /** Something in the dark startles part of the flock (night watch). */
  | { type: 'spook'; x: number; z: number }
  /** Night watch: a ewe wanders off on her own towards (tx, tz). */
  | { type: 'stray'; id: number; x: number; z: number; tx: number; tz: number }
  /** Night watch, midnight: something big crashes through the bracken and the flock scatters. */
  | { type: 'scatter'; x: number; z: number }
  /** A trial gate passed or missed. */
  | { type: 'gate'; index: number; name: string; passed: boolean; x: number; z: number }
  /** Two wolves pair up: the bait (x, z) howls; the flanker (fx, fz) slips round to the far side. */
  | { type: 'pack'; x: number; z: number; id: number; fx: number; fz: number; fid: number }
  /** The bait wolf rushes the flock and breaks off. */
  | { type: 'feint'; x: number; z: number; id: number }
  /** The flanker is in position behind the flock: a low growl from that side. */
  | { type: 'growl'; x: number; z: number; id: number }
  /** Pip sends Fly to lie down where he stands (down) or calls her back to heel. */
  | { type: 'fly'; x: number; z: number; down: boolean }
  /** The bell-wether's bell. */
  | { type: 'bell'; x: number; z: number };

export type Outcome =
  | { kind: 'win'; reason: 'all-home' | 'nightfall' | 'latched' | 'dawn' | 'trial'; stars: number }
  | { kind: 'lose'; reason: 'nightfall' | 'wolves' | 'judges' };

const RAM_EYE_RANGE = 10;
const RAM_BUTT_RANGE = 4.4;
const LEADER_RANGE = 18;

export class Sim {
  readonly rules: Rules;
  readonly perks: Perks;
  readonly rng: Rng;
  readonly dog: Dog;
  /** Fly, the old dog (a charm), or null. */
  readonly fly: Helper | null;
  /** The ewe wearing the bell (a charm), or -1. */
  bellId = -1;
  private bellT = 0;
  private flyCmdT = 0;
  readonly sheep: Sheep[] = [];
  readonly wolves: Wolf[] = [];
  readonly events: SimEvent[] = [];
  readonly total: number;
  readonly target: number;
  elapsed = 0;
  outcome: Outcome | null = null;
  folded = 0;
  lost = 0;
  rescues = 0;
  barks = 0;
  butts = 0;
  /** Current radius at which sheep start fleeing from the dog (for the UI ring). */
  dogThreatRadius = 0;
  /** Where and when each sheep was snatched (shown on the end card). */
  readonly lostLog: { t: number; x: number; z: number; kind: SheepKind }[] = [];
  flooded = false;
  /** Trial: the gate the flock should go through next, and each gate's result. */
  gateIdx = 0;
  readonly gateResults: ('passed' | 'missed' | null)[] = [];
  private gateCrossed = new Set<number>();
  private nextCrossed = new Set<number>();
  private duskAnnounced = false;
  private dawnAnnounced = false;
  private targetAnnounced = false;
  private nextWolfT = 0;
  private wolfIds = 0;
  private thunderT = 0;
  private spookT = 12;
  private strayCd = 20;
  private scattered = false;
  /**
   * One snatch at a time: while a wolf is dragging a sheep, or shortly after a snatch, the others
   * only stalk. One dog must always be able to answer every snatch.
   */
  private snatchCd = 0;

  constructor(
    readonly level: Level,
    rules: Rules,
    seed: number,
  ) {
    this.rules = rules;
    this.perks = rules.perks ?? NO_PERKS;
    this.rng = new Rng(seed);
    for (const f of level.fords) f.open = true;
    const [dx, dz] = rules.dogStart ?? level.def.dogStart;
    this.dog = {
      x: dx,
      z: dz,
      vx: 0,
      vz: 0,
      r: DOG.radius,
      facing: 0,
      speed: 0,
      stamina: DOG.staminaMax,
      staminaDelay: 0,
      sprintLock: false,
      sprinting: false,
      creeping: false,
      barkCd: 0,
      sinceBark: 99,
      inWater: false,
      moving: false,
      stunT: 0,
      loping: false,
      lying: false,
      flanking: 0,
    };
    this.fly = rules.fly && rules.objective !== 'trial' ? { ...this.dog, x: dx - 2, z: dz + 2.5, r: DOG.radius, mode: 'heel', tx: dx, tz: dz } : null;

    // The flock is placed from its own seed, so an evening starts the same way every time.
    const place = new Rng(rules.seed ?? seed);
    let id = 0;
    const spawn = (kind: SheepKind, gx: number, gz: number, radius: number, motherId = -1) => {
      let x = gx;
      let z = gz;
      for (let tries = 0; tries < 40; tries++) {
        const p = place.disc(radius);
        x = gx + p.x;
        z = gz + p.z;
        const clear =
          !level.inWater(x, z) &&
          this.sheep.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 > 2.2 * 2.2) &&
          level.circles.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > (c.r + 1.4) ** 2) &&
          level.segs.every((g) => g.tag === 'boundary' || segDist(x, z, g.ax, g.az, g.bx, g.bz) > g.r + 1.4) &&
          !level.penAt(x, z, -2);
        if (clear) break;
      }
      const s: Sheep = {
        id: id++,
        kind,
        motherId,
        x,
        z,
        vx: 0,
        vz: 0,
        r: kind === 'lamb' ? 0.75 : kind === 'ram' ? 1.45 : SHEEP.radius,
        state: 'graze',
        facing: place.range(-Math.PI, Math.PI),
        speed: 0,
        fear: 0,
        panicT: 0,
        panicX: 0,
        panicZ: 0,
        alertT: 0,
        wanderT: place.range(0.5, 5),
        wanderX: 0,
        wanderZ: 0,
        grazing: true,
        bleatT: place.range(3, 14),
        foldedAt: -1,
        inWater: false,
        stateT: 0,
        prevDry: true,
        seed: place.next(),
        trotX: 0,
        trotZ: 0,
        trotT: 0,
        driveT: 0,
        followT: 0,
        followPen: -1,
        homeX: x,
        homeZ: z,
        stubborn: kind === 'ram' ? 1 : 0,
        yieldT: 0,
        buttCd: 0,
        boltCd: place.range(2, 6),
        penId: null,
        strayT: 0,
        strayX: 0,
        strayZ: 0,
      };
      this.sheep.push(s);
      return s;
    };
    let bellSize = 0;
    for (const g of rules.flock) {
      const grp = level.def.sheepGroups.find((q) => q.id === g.at) ?? level.def.sheepGroups[0];
      const [gx, gz] = grp.center;
      const ewes: Sheep[] = [];
      for (let i = 0; i < g.ewes; i++) ewes.push(spawn('ewe', gx, gz, grp.radius));
      // The bell-wether: the first ewe of the biggest flock.
      if (rules.bell && ewes.length > bellSize) {
        bellSize = ewes.length;
        this.bellId = ewes[0].id;
      }
      if (g.ram) spawn('ram', gx, gz, grp.radius * 0.6);
      for (let i = 0; i < (g.black ?? 0); i++) spawn('black', gx, gz, grp.radius);
      for (let i = 0; i < (g.lambs ?? 0); i++) {
        const mum = ewes[i % Math.max(1, ewes.length)];
        if (mum) spawn('lamb', mum.x, mum.z, 2.2, mum.id);
      }
    }
    if (rules.lostLamb) {
      const s = spawn('lamb', rules.lostLamb[0], rules.lostLamb[1], 1.5, -1);
      s.state = 'hidden';
    }
    this.total = this.sheep.length;
    this.target = Math.min(this.total, rules.target);
    // Pip starts looking at the nearest flock: that is where to go first.
    let near = this.sheep.find((s) => s.state !== 'hidden') ?? this.sheep[0];
    for (const s of this.sheep) if (s.state !== 'hidden' && Math.hypot(s.x - dx, s.z - dz) < Math.hypot(near.x - dx, near.z - dz)) near = s;
    if (near) this.dog.facing = Math.atan2(near.x - dx, near.z - dz);
    this.thunderT = rules.thunder ? this.rng.range(...rules.thunder) * 0.6 : Infinity;
    for (let i = 0; i < level.gates.length; i++) this.gateResults.push(null);
  }

  get trial() {
    return this.rules.objective === 'trial';
  }

  /**
   * The judges' points: 100, less 15 for each gate missed, 12 for each ewe not penned, and up to
   * 10 for a slow round (anything past 60% of the time allowed).
   */
  trialScore() {
    const missed = this.gateResults.filter((g) => g === 'missed').length + (this.outcome ? this.gateResults.filter((g) => g === null).length : 0);
    const out = this.outcome ? this.total - this.folded : 0;
    const strict = !!this.rules.strict;
    const from = strict ? 0.45 : 0.6;
    const slow = Math.max(0, (this.elapsed - from * this.rules.dayLength) / ((1 - from) * this.rules.dayLength)) * (strict ? 15 : 10);
    return Math.max(0, Math.round(100 - (strict ? 20 : 15) * missed - 12 * out - slow));
  }

  /** Did the step from (px, pz) to (x, z) go between the posts of trial gate i? */
  private throughGate(i: number, px: number, pz: number, x: number, z: number) {
    const g = this.level.gates[i];
    if (!g) return false;
    const o = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const d1 = o(g.ax, g.az, g.bx, g.bz, px, pz);
    const d2 = o(g.ax, g.az, g.bx, g.bz, x, z);
    const d3 = o(px, pz, x, z, g.ax, g.az);
    const d4 = o(px, pz, x, z, g.bx, g.bz);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }

  /** Trial: count sheep through the next gate (and the one after, to call a gate missed). */
  private trialGates(s: Sheep, px: number, pz: number) {
    const i = this.gateIdx;
    if (i >= this.level.gates.length) return;
    const need = Math.ceil(this.total * 0.6);
    if (this.throughGate(i, px, pz, s.x, s.z)) this.gateCrossed.add(s.id);
    if (this.throughGate(i + 1, px, pz, s.x, s.z)) this.nextCrossed.add(s.id);
    const g = this.level.gates[i];
    if (this.gateCrossed.size >= need) {
      this.gateResults[i] = 'passed';
      this.events.push({ type: 'gate', index: i, name: g.name, passed: true, x: g.x, z: g.z });
      this.advanceGate(false);
    } else if (this.nextCrossed.size >= need) {
      // The flock went on to the next gate without this one: missed, and the next one counts.
      this.gateResults[i] = 'missed';
      this.events.push({ type: 'gate', index: i, name: g.name, passed: false, x: g.x, z: g.z });
      this.advanceGate(true);
      const n = this.level.gates[this.gateIdx];
      if (n) {
        this.gateResults[this.gateIdx] = 'passed';
        this.events.push({ type: 'gate', index: this.gateIdx, name: n.name, passed: true, x: n.x, z: n.z });
        this.advanceGate(false);
      }
    }
  }

  private advanceGate(keepNext: boolean) {
    this.gateIdx++;
    this.gateCrossed = keepNext ? this.nextCrossed : new Set();
    this.nextCrossed = new Set();
  }

  /** 0 at the start, 1 at nightfall (or dawn). */
  get t() {
    return clamp(this.elapsed / this.rules.dayLength, 0, 1);
  }
  get free() {
    return this.total - this.folded - this.lost;
  }
  get timeLeft() {
    return Math.max(0, this.rules.dayLength - this.elapsed);
  }
  get targetMet() {
    return this.rules.objective !== 'gather' ? false : this.folded >= this.target;
  }
  get watch() {
    return this.rules.objective === 'watch';
  }
  /** How many more may be lost before the evening is lost. */
  get spare() {
    return this.total - this.target - this.lost;
  }

  update(dt: number, input: Input | null) {
    if (this.outcome) return;
    this.elapsed += dt;
    this.updateDog(dt, input);
    if (this.fly) this.updateFly(this.fly, dt, input);
    if (this.bellId >= 0) this.updateBell(dt);
    this.updateSheep(dt);
    this.updateWolves(dt);
    this.updateWeather(dt);
    this.checkRules(input);
  }

  // ---------------------------------------------------------------- dog

  /**
   * The way to run to flank the nearest flock: round its middle (clockwise on screen for "come
   * bye", anticlockwise for "away"), easing out to just beyond the distance at which the sheep
   * would move, so the run turns them without pushing them. Null if no flock is near.
   */
  private flankDir(dir: number) {
    const d = this.dog;
    let near: Sheep | null = null;
    let nd = 60 * 60;
    for (const s of this.sheep) {
      if (!this.isFree(s)) continue;
      const dd = (s.x - d.x) ** 2 + (s.z - d.z) ** 2;
      if (dd < nd) {
        nd = dd;
        near = s;
      }
    }
    if (!near) return null;
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const s of this.sheep) {
      if (!this.isFree(s) || (s.x - near.x) ** 2 + (s.z - near.z) ** 2 > 14 * 14) continue;
      cx += s.x;
      cz += s.z;
      n++;
    }
    cx /= n;
    cz /= n;
    const rx = d.x - cx;
    const rz = d.z - cz;
    const r = Math.hypot(rx, rz) || 1;
    const ux = rx / r;
    const uz = rz / r;
    // The flock's own spread plus the moving dog's reach, and a little to spare.
    let spread = 0;
    for (const s of this.sheep) if (this.isFree(s) && (s.x - near.x) ** 2 + (s.z - near.z) ** 2 <= 14 * 14) spread = Math.max(spread, Math.hypot(s.x - cx, s.z - cz));
    const want = spread + (d.sprinting ? SHEEP.threatRadiusSprint : SHEEP.threatRadius) + 2;
    const radial = clamp((want - r) / 4, -1, 1);
    // Clockwise on screen (x right, z down the screen) is (-uz, ux).
    const tx = -uz * dir + ux * radial * 1.3;
    const tz = ux * dir + uz * radial * 1.3;
    const tl = Math.hypot(tx, tz) || 1;
    return { x: tx / tl, z: tz / tl };
  }

  /**
   * Fly: F (d-pad down) sends her to the spot where Pip stands, where she lies down and holds it:
   * sheep keep off her and wolves will not come near. F again calls her back to heel, where she
   * moves nothing.
   */
  private updateFly(f: Helper, dt: number, input: Input | null) {
    const d = this.dog;
    // One press, one command: a frame can hold several sim steps that all see the same key edge.
    this.flyCmdT = Math.max(0, this.flyCmdT - dt);
    if (input?.pressed('fly') && this.flyCmdT <= 0) {
      this.flyCmdT = 0.3;
      if (f.mode === 'heel') {
        f.mode = 'go';
        f.tx = d.x;
        f.tz = d.z;
      } else f.mode = 'heel';
      this.events.push({ type: 'fly', x: f.x, z: f.z, down: f.mode === 'go' });
    }
    let tx = f.tx;
    let tz = f.tz;
    let max = FLY.speed;
    if (f.mode === 'heel') {
      // A step behind Pip's shoulder.
      tx = d.x - Math.sin(d.facing) * 2.6 + Math.cos(d.facing) * 1.2;
      tz = d.z - Math.cos(d.facing) * 2.6 - Math.sin(d.facing) * 1.2;
      max = FLY.heelSpeed;
    }
    const dx = tx - f.x;
    const dz = tz - f.z;
    const dl = Math.hypot(dx, dz);
    if (f.mode === 'go' && dl < 0.8) f.mode = 'down';
    f.lying = f.mode === 'down';
    const want = f.mode === 'down' || dl < 0.6 ? 0 : Math.min(max, dl * 3);
    const ux = dl > 0.01 ? dx / dl : 0;
    const uz = dl > 0.01 ? dz / dl : 0;
    const k = 1 - Math.exp(-8 * dt);
    f.vx = lerp(f.vx, ux * want, k);
    f.vz = lerp(f.vz, uz * want, k);
    f.x += f.vx * dt;
    f.z += f.vz * dt;
    collideStatic(this.level, f, { boundary: true, gate: false });
    f.speed = Math.hypot(f.vx, f.vz);
    f.moving = f.speed > 0.3;
    if (f.speed > 0.4) f.facing = dampAngle(f.facing, Math.atan2(f.vx, f.vz), 10, dt);
    else if (f.mode === 'down') f.facing = dampAngle(f.facing, Math.atan2(d.x - f.x, d.z - f.z), 2, dt);
    f.inWater = this.level.inWater(f.x, f.z);
  }

  /** Fly's hold on the sheep: the radius they keep off her, or 0 while she is at heel. */
  get flyReach() {
    const f = this.fly;
    if (!f || f.mode === 'heel') return 0;
    return f.mode === 'down' ? FLY.holdR : FLY.runR;
  }

  /**
   * The outrun: a wide, pear-shaped run out to the far side of a flock (from the fold), to stop
   * behind it ready to bring it home. It goes for the nearest flock more than 20 m away (the one
   * Pip is not already working), else the nearest; it keeps outside the flock's flight zone on the
   * way, and stops on arrival. Null when there is nothing to run out to (or Pip is there).
   */
  private outrunDir() {
    const d = this.dog;
    let best: Sheep | null = null;
    let bd = Infinity;
    let near: Sheep | null = null;
    let nd = Infinity;
    for (const s of this.sheep) {
      if (!this.isFree(s)) continue;
      const dd = Math.hypot(s.x - d.x, s.z - d.z);
      if (dd < nd) {
        nd = dd;
        near = s;
      }
      if (dd > 20 && dd < bd) {
        bd = dd;
        best = s;
      }
    }
    const pick = best ?? near;
    if (!pick) return null;
    const f = this.flockAround(pick);
    const m = this.level.fold.mouth;
    const ax = f.cx - m.x;
    const az = f.cz - m.z;
    const al = Math.hypot(ax, az) || 1;
    const R = f.spread + SHEEP.threatRadiusSprint + 2;
    const tx = f.cx + (ax / al) * R;
    const tz = f.cz + (az / al) * R;
    const toT = Math.hypot(tx - d.x, tz - d.z);
    if (toT < 2.5) return null;
    const rx = d.x - f.cx;
    const rz = d.z - f.cz;
    const r = Math.hypot(rx, rz) || 1;
    if (r < R + 8) {
      // Close in: run round the flock towards the far side, holding the radius.
      const cur = Math.atan2(rz, rx);
      let da = Math.atan2(tz - f.cz, tx - f.cx) - cur;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < 0.2) return { x: (tx - d.x) / toT, z: (tz - d.z) / toT };
      const dir = Math.sign(da);
      const radial = clamp((R - r) / 4, -1, 1);
      const ox = (-rz / r) * dir + (rx / r) * radial * 1.3;
      const oz = (rx / r) * dir + (rz / r) * radial * 1.3;
      const ol = Math.hypot(ox, oz) || 1;
      return { x: ox / ol, z: oz / ol };
    }
    // Far out: head for the shoulder of the flock on the way round (never straight through it).
    const cur = Math.atan2(rz, rx);
    let da = Math.atan2(tz - f.cz, tx - f.cx) - cur;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const side = Math.sign(da) || 1;
    const sa = cur + side * Math.min(Math.abs(da), Math.asin(Math.min(1, (R + 4) / r)) + 0.2);
    const sx = f.cx + Math.cos(sa) * (R + 4);
    const sz = f.cz + Math.sin(sa) * (R + 4);
    const sl = Math.hypot(sx - d.x, sz - d.z) || 1;
    return { x: (sx - d.x) / sl, z: (sz - d.z) / sl };
  }

  /** The bell rings as its ewe walks: an event every so often while she moves. */
  private updateBell(dt: number) {
    const b = this.sheep[this.bellId];
    if (!b || !this.isFree(b)) return;
    this.bellT -= dt * Math.min(2.5, 0.3 + b.speed * 0.45);
    if (this.bellT <= 0) {
      this.bellT = 1;
      this.events.push({ type: 'bell', x: b.x, z: b.z });
    }
  }

  private updateDog(dt: number, input: Input | null) {
    const d = this.dog;
    const P = this.perks;
    const stunned = d.stunT > 0;
    d.stunT = Math.max(0, d.stunT - dt);
    d.lying = !stunned && !!input?.lie;
    let mx = stunned || d.lying ? 0 : (input?.moveX ?? 0);
    let mz = stunned || d.lying ? 0 : (input?.moveZ ?? 0);
    d.flanking = 0;
    let outrun = false;
    if (!stunned && !d.lying && input?.outrun && this.rules.outrun) {
      const o = this.outrunDir();
      if (o) {
        mx = o.x;
        mz = o.z;
        outrun = true;
      }
    } else if (!stunned && !d.lying && input?.flank) {
      const f = this.flankDir(input.flank);
      if (f) {
        mx = f.x;
        mz = f.z;
        d.flanking = input.flank;
      }
    }
    const mag = Math.hypot(mx, mz);
    d.creeping = !stunned && !d.lying && !!input?.creep;
    if (d.stamina <= 0) d.sprintLock = true;
    else if (d.stamina > 33) d.sprintLock = false;
    d.sprinting = !stunned && (!!input?.sprint || (outrun && mag > 0.5)) && mag > 0.1 && !d.creeping && !d.sprintLock && d.stamina > 0;
    d.outrunning = outrun;

    let max = (d.creeping ? DOG.creepSpeed : d.sprinting ? DOG.sprintSpeed : DOG.walkSpeed) * P.speed;
    // Crossing open ground with no sheep near, Pip lopes along faster (and sprints for longer):
    // the long runs between flocks were dead time.
    const lope = !d.creeping && this.nearestFree(d.x, d.z) > 30;
    if (lope && !d.sprinting) max *= 1.22;
    d.loping = lope;
    const wasWet = d.inWater;
    d.inWater = this.level.inWater(d.x, d.z);
    if (d.inWater) max *= this.level.inLoch(d.x, d.z) ? 0.42 : DOG.waterSpeedScale;
    if (d.inWater !== wasWet && d.speed > 2) this.events.push({ type: 'splash', x: d.x, z: d.z, big: true });

    const tvx = mx * max;
    const tvz = mz * max;
    const dvx = tvx - d.vx;
    const dvz = tvz - d.vz;
    const dl = Math.hypot(dvx, dvz);
    // Knocked back by the ram: Pip slides to a stop instead of steering.
    const step = (stunned ? 18 : DOG.accel) * dt * (mag < 0.05 ? (d.lying ? 2.2 : 1.4) : 1);
    if (dl <= step) {
      d.vx = tvx;
      d.vz = tvz;
    } else {
      d.vx += (dvx / dl) * step;
      d.vz += (dvz / dl) * step;
    }
    d.x += d.vx * dt;
    d.z += d.vz * dt;
    collideStatic(this.level, d, { boundary: true, gate: false });
    d.speed = Math.hypot(d.vx, d.vz);
    d.moving = d.speed > 0.3;
    if (d.speed > 0.4 && !stunned) d.facing = dampAngle(d.facing, Math.atan2(d.vx, d.vz), 14, dt);

    if (d.sprinting) {
      d.stamina = Math.max(0, d.stamina - DOG.staminaDrain * P.staminaDrain * (d.loping ? 0.55 : 1) * dt);
      d.staminaDelay = DOG.staminaRegenDelay;
    } else if (d.staminaDelay > 0) {
      d.staminaDelay -= dt;
    } else {
      d.stamina = Math.min(DOG.staminaMax, d.stamina + DOG.staminaRegen * dt);
    }

    d.barkCd = Math.max(0, d.barkCd - dt);
    d.sinceBark += dt;
    if (!stunned && input?.pressed('bark') && d.barkCd <= 0) this.bark();
  }

  /** Distance to the nearest loose sheep (Infinity if none). */
  nearestFree(x: number, z: number) {
    let best = Infinity;
    for (const s of this.sheep) {
      if (!this.isFree(s)) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  get barkRadius() {
    return DOG.barkRadius * this.perks.barkRadius;
  }
  get barkWolfRadius() {
    return DOG.barkWolfRadius * this.perks.barkRadius;
  }

  private bark() {
    const d = this.dog;
    d.barkCd = DOG.barkCooldown * this.perks.barkCooldown;
    d.sinceBark = 0;
    this.barks++;
    this.events.push({ type: 'bark', x: d.x, z: d.z });
    const R = this.barkRadius;
    for (const s of this.sheep) {
      if (s.state === 'grabbed' || s.state === 'lost' || s.state === 'folded' || s.state === 'hidden') continue;
      const dx = s.x - d.x;
      const dz = s.z - d.z;
      const dd = Math.hypot(dx, dz);
      if (s.kind === 'ram' && dd < R * 0.85) {
        // A bark knocks the fight out of the ram.
        s.stubborn = Math.max(0, s.stubborn - 0.42);
        if (s.stubborn <= 0.15 && s.yieldT <= 0) this.ramYields(s);
        continue;
      }
      if (s.motherId < 0 && s.kind === 'lamb') continue;
      if (dd < R) {
        s.panicT = SHEEP.panicTime * lerp(1, 0.55, dd / R);
        s.panicX = dx / (dd || 1);
        s.panicZ = dz / (dd || 1);
        s.alertT = 3;
      }
    }
    for (const w of this.wolves) {
      if (w.state === 'flee' || w.state === 'gone') continue;
      if (Math.hypot(w.x - d.x, w.z - d.z) < this.barkWolfRadius) this.scareWolf(w);
    }
  }

  private ramYields(s: Sheep) {
    s.yieldT = 9;
    s.stubborn = Math.min(s.stubborn, 0.1);
    s.alertT = 3;
    this.events.push({ type: 'ramYield', x: s.x, z: s.z });
  }

  // ---------------------------------------------------------------- sheep

  isFree(s: Sheep) {
    return s.state !== 'lost' && s.state !== 'grabbed' && s.state !== 'folded' && s.state !== 'hidden';
  }

  /** The ram if he is out on the hill with the flock. */
  private ram() {
    return this.sheep.find((s) => s.kind === 'ram' && this.isFree(s)) ?? null;
  }

  private updateSheep(dt: number) {
    const L = this.level;
    const d = this.dog;
    const flock = this.sheep;
    const dogR = d.lying
      ? 3.2
      : d.creeping
      ? SHEEP.threatRadiusCreep * this.perks.creep
      : d.sprinting
        ? SHEEP.threatRadiusSprint
        : lerp(SHEEP.threatRadiusStill, SHEEP.threatRadius, clamp(d.speed / DOG.walkSpeed, 0, 1));
    this.dogThreatRadius = dogR;
    const ram = this.ram();
    const byId = (id: number) => flock.find((o) => o.id === id) ?? null;

    for (const s of flock) {
      s.stateT += dt;
      if (s.state === 'lost' || s.state === 'grabbed') continue;
      if (s.state === 'folded') {
        this.updateFoldedSheep(s, dt);
        continue;
      }
      if (s.state === 'hidden') {
        // The lost lamb waits in the bracken, bleating now and then, until Pip finds it.
        s.bleatT -= dt;
        if (s.bleatT <= 0) {
          s.bleatT = this.rng.range(3, 6);
          this.events.push({ type: 'bleat', x: s.x, z: s.z, id: s.id, urgent: true, kind: s.kind });
        }
        if (Math.hypot(s.x - d.x, s.z - d.z) < 9) {
          s.state = 'walk';
          s.stateT = 0;
          this.events.push({ type: 'lambFound', x: s.x, z: s.z, id: s.id });
        }
        continue;
      }

      let vx = 0;
      let vz = 0;
      let fear = 0;
      const lamb = s.kind === 'lamb';
      const orphan = lamb && s.motherId < 0;
      const mother = lamb && !orphan ? byId(s.motherId) : null;

      // The ram: until he gives way he will not be pushed by a dog. He turns to face Pip, stamps,
      // and butts a dog that crowds him. Pip's stare (standing or creeping close) or a bark wears
      // him down; then he moves off like any sheep, and the flock follows him.
      let stubborn = false;
      if (s.kind === 'ram') {
        s.buttCd = Math.max(0, s.buttCd - dt);
        if (s.yieldT > 0) s.yieldT -= dt;
        stubborn = s.stubborn > 0.15 && s.yieldT <= 0;
        const ddx = d.x - s.x;
        const ddz = d.z - s.z;
        const dd = Math.hypot(ddx, ddz);
        if (stubborn) {
          if (dd < RAM_EYE_RANGE && d.speed < 3.2) {
            s.stubborn -= dt * (d.lying ? 0.42 : d.creeping ? 0.3 : 0.2) * this.perks.eye;
            if (s.stubborn <= 0.15) this.ramYields(s);
          }
          if (dd < RAM_BUTT_RANGE + d.r && !d.creeping && !d.lying && s.buttCd <= 0 && d.stunT <= 0) {
            // Butt: Pip is thrown back and loses control for a moment.
            const nx = ddx / (dd || 1);
            const nz = ddz / (dd || 1);
            d.vx = nx * 15;
            d.vz = nz * 15;
            d.stunT = 0.75;
            s.buttCd = 2.4;
            s.stubborn = Math.min(1, s.stubborn + 0.12);
            s.stateT = 0;
            this.butts++;
            this.events.push({ type: 'butt', x: s.x + nx * 1.4, z: s.z + nz * 1.4, wolf: false });
          } else if (dd < 9 && s.buttCd <= 0 && this.rng.next() < dt * 0.5) {
            this.events.push({ type: 'stamp', x: s.x, z: s.z });
            s.buttCd = Math.max(s.buttCd, 1.2);
          }
        } else if (s.yieldT <= 0 && dd > RAM_EYE_RANGE + 1) {
          // Out of Pip's stare he soon gets his nerve back and stops to face him again.
          s.stubborn = Math.min(1, s.stubborn + dt * 0.03);
        }
      }

      // Threats: the dog (not for the stubborn ram or an orphan lamb that trusts Pip) and wolves.
      const ddx = s.x - d.x;
      const ddz = s.z - d.z;
      const dd = Math.hypot(ddx, ddz);
      const myR = s.kind === 'black' ? dogR * 1.35 : s.kind === 'ram' ? dogR * 0.8 : dogR;
      if (dd < myR && !stubborn && !orphan) {
        const w = 1 - dd / myR;
        const sp = lerp(2.6, SHEEP.fleeSpeed * (lamb ? 1.08 : 1), Math.pow(w, 0.6));
        vx += (ddx / (dd || 1)) * sp;
        vz += (ddz / (dd || 1)) * sp;
        fear = Math.max(fear, w);
      }
      const fr = this.flyReach;
      if (fr > 0 && this.fly && !orphan) {
        // Fly holding a spot: the sheep give her room, as they would a dog lying at a gate.
        const fx = s.x - this.fly.x;
        const fz = s.z - this.fly.z;
        const fd = Math.hypot(fx, fz);
        if (fd < fr) {
          const w = 1 - fd / fr;
          const sp = lerp(2.4, SHEEP.fleeSpeed, Math.pow(w, 0.7));
          vx += (fx / (fd || 1)) * sp;
          vz += (fz / (fd || 1)) * sp;
          fear = Math.max(fear, w * 0.8);
        }
      }
      for (const w of this.wolves) {
        if (w.state === 'gone' || w.state === 'flee') continue;
        const wx = s.x - w.x;
        const wz = s.z - w.z;
        const wd = Math.hypot(wx, wz);
        // The ram stands his ground against wolves.
        if (s.kind === 'ram') continue;
        if (wd < SHEEP.wolfThreatRadius) {
          const k = 1 - wd / SHEEP.wolfThreatRadius;
          vx += (wx / (wd || 1)) * SHEEP.fleeSpeed * 1.1 * Math.pow(k, 0.6);
          vz += (wz / (wd || 1)) * SHEEP.fleeSpeed * 1.1 * Math.pow(k, 0.6);
          fear = Math.max(fear, k);
        }
      }
      if (s.panicT > 0) {
        s.panicT -= dt;
        vx += s.panicX * SHEEP.panicSpeed;
        vz += s.panicZ * SHEEP.panicSpeed;
        fear = 1;
      }
      // A black sheep is flighty: once frightened it may bolt off on its own.
      if (s.kind === 'black') {
        s.boltCd -= dt;
        if (fear > 0.35 && s.boltCd <= 0 && s.panicT <= 0) {
          s.boltCd = this.rng.range(4, 8);
          if (this.rng.next() < 0.55) {
            const a = Math.atan2(vx, vz) + this.rng.range(-1.1, 1.1);
            s.panicT = 1.3;
            s.panicX = Math.sin(a);
            s.panicZ = Math.cos(a);
          }
        }
      }
      if (fear > 0.05) {
        s.alertT = Math.max(s.alertT, 1.2 + fear * 2);
        const fl = Math.hypot(vx, vz);
        if (fl > 0.5) {
          // Driven the same way as before: the walk-on builds; turned hard, it starts again.
          const same = s.trotX * (vx / fl) + s.trotZ * (vz / fl);
          s.driveT = same > 0.7 ? Math.min(6, s.driveT + dt) : s.driveT * 0.5;
          s.trotX = vx / fl;
          s.trotZ = vz / fl;
          s.trotT = SHEEP.trotTime;
        }
      } else if (s.trotT > 0) {
        s.trotT -= dt * (d.lying && dd < 24 ? 3 : 1);
        const k = clamp(s.trotT / SHEEP.trotTime, 0, 1);
        // A flock driven steadily for a few seconds trots on more briskly (up to about half again).
        const walkOn = 1 + 0.45 * clamp((s.driveT - 1) / 3, 0, 1);
        vx += s.trotX * SHEEP.trotSpeed * k * walkOn;
        vz += s.trotZ * SHEEP.trotSpeed * k * walkOn;
      } else {
        s.driveT = Math.max(0, s.driveT - dt * 2);
      }
      s.alertT = Math.max(0, s.alertT - dt);
      const alert = s.alertT > 0;

      // On the approach to a crossing (in line with the deck): bunched tighter, and the water on
      // either side of the deck no longer pushes them back off it.
      const approach = this.onApproach(s);
      // ...and the same in the mouth of a pen, so a driven bunch files through the gate.
      const crowd = (approach || L.pens.some((p) => p.inFunnel(s.x, s.z))) && (s.alertT > 0 || fear > 0.05);

      // Flocking with free neighbours (lambs mostly keep to their mothers instead).
      let n = 0;
      let cx = 0;
      let cz = 0;
      let ax = 0;
      let az = 0;
      let sx = 0;
      let sz = 0;
      let neighbourAlert = false;
      for (const o of flock) {
        if (o === s || !this.isFree(o)) continue;
        const ox = o.x - s.x;
        const oz = o.z - s.z;
        const od2 = ox * ox + oz * oz;
        if (od2 > SHEEP.neighborRadius * SHEEP.neighborRadius) continue;
        const od = Math.sqrt(od2);
        n++;
        cx += o.x;
        cz += o.z;
        ax += o.vx;
        az += o.vz;
        // Near a bridge or ford driven sheep crowd closer, so a bunch fits through the gap.
        const sepR = ((SHEEP.separationRadius * (s.r + o.r)) / (2 * SHEEP.radius)) * (crowd ? 0.68 : 1);
        if (od < sepR) {
          const k = (1 - od / sepR) * SHEEP.separation;
          sx -= (ox / (od || 1)) * k;
          sz -= (oz / (od || 1)) * k;
        }
        if (o.fear > 0.25 && od < 7) neighbourAlert = true;
      }
      if (neighbourAlert) s.alertT = Math.max(s.alertT, 0.8);
      const cohK = (s.kind === 'black' ? 0.5 : lamb ? 0.3 : s.kind === 'ram' ? 0.4 : 1) * (s.strayT > 0 ? 0.15 : 1);
      // The bell-wether: her flock keeps close round her (and she leads the way when it moves).
      if (this.bellId >= 0 && s.id !== this.bellId) {
        const b = this.sheep[this.bellId];
        if (b && this.isFree(b)) {
          const bx = b.x - s.x;
          const bz = b.z - s.z;
          const bd = Math.hypot(bx, bz);
          if (bd > 3 && bd < 18) {
            const k = (alert ? 1.6 : 0.7) * Math.min(1, (bd - 3) / 6);
            vx += (bx / bd) * k;
            vz += (bz / bd) * k;
          }
        }
      }
      if (n > 0) {
        cx /= n;
        cz /= n;
        ax /= n;
        az /= n;
        const coh = (alert ? SHEEP.cohesionAlert : SHEEP.cohesion * 0.35) * cohK;
        const tx = cx - s.x;
        const tz = cz - s.z;
        const tl = Math.hypot(tx, tz);
        const pull = Math.min(tl * 0.35, alert ? 3 : 0.8) * coh;
        if (tl > 1.5) {
          vx += (tx / tl) * pull;
          vz += (tz / tl) * pull;
        }
        if (alert) {
          vx += ax * SHEEP.alignment * 0.6 * cohK;
          vz += az * SHEEP.alignment * 0.6 * cohK;
        }
      }
      vx += sx;
      vz += sz;

      // Where the ram goes, the ewes follow: they gather round him while he stands and fall in
      // behind him when he moves.
      if (ram && ram !== s && !lamb) {
        const rx = ram.x - s.x;
        const rz = ram.z - s.z;
        const rd = Math.hypot(rx, rz);
        if (rd < LEADER_RANGE && rd > 4) {
          const k = Math.min(1.4, (rd - 4) * 0.2) * (fear > 0.3 ? 0.4 : 1);
          vx += (rx / rd) * k;
          vz += (rz / rd) * k;
          if (ram.speed > 1) {
            vx += ram.vx * 0.3;
            vz += ram.vz * 0.3;
          }
        }
      }

      // Lambs stay at their mothers' heels; a ewe whose lamb has strayed turns back for it.
      if (mother && this.isFree(mother)) {
        const mx = mother.x - s.x;
        const mz = mother.z - s.z;
        const md = Math.hypot(mx, mz);
        if (md > 2.4) {
          const k = Math.min(fear > 0.3 ? 3 : 5, (md - 2.4) * 1.3);
          vx += (mx / md) * k;
          vz += (mz / md) * k;
        }
      } else if (mother && mother.state === 'folded') {
        // Mum is home: the lamb heads for the gate if it is anywhere near.
        const p = L.pens.find((q) => q.id === mother.penId) ?? L.fold;
        // Past the mouth (along the pen's own axis), head straight in; before it, for the mouth.
        const m = p.inFunnel(s.x, s.z) ? p.inside : p.mouth;
        const gx = m.x - s.x;
        const gz = m.z - s.z;
        const gd = Math.hypot(gx, gz);
        if (gd < 30) {
          vx += (gx / gd) * 2.2;
          vz += (gz / gd) * 2.2;
        }
      }
      if (orphan) {
        // Found: the lamb trots after Pip, close at his heels.
        const fx = d.x - s.x;
        const fz = d.z - s.z;
        const fd = Math.hypot(fx, fz);
        if (fd > 3.2 && fd < 40) {
          const k = Math.min(fear > 0.4 ? 2 : 6.5, (fd - 3.2) * 1.4);
          vx += (fx / fd) * k;
          vz += (fz / fd) * k;
          s.alertT = Math.max(s.alertT, 0.3);
        }
        // ...and runs in to the flock in the fold once it sees the gate.
        const p = L.fold;
        const gd = Math.hypot(p.mouth.x - s.x, p.mouth.z - s.z);
        if (gd < 14 || p.contains(s.x, s.z, -3)) {
          const tgt = p.inFunnel(s.x, s.z) ? p.inside : p.mouth;
          const td = Math.hypot(tgt.x - s.x, tgt.z - s.z) || 1;
          vx += ((tgt.x - s.x) / td) * 3.4;
          vz += ((tgt.z - s.z) / td) * 3.4;
        }
      }
      if (!lamb) {
        for (const o of flock) {
          if (o.kind !== 'lamb' || o.motherId !== s.id || !this.isFree(o)) continue;
          const lx = o.x - s.x;
          const lz = o.z - s.z;
          const ld = Math.hypot(lx, lz);
          if (ld > 9) {
            const k = Math.min(2.2, (ld - 9) * 0.35) * (fear > 0.3 ? 0.3 : 1);
            vx += (lx / ld) * k;
            vz += (lz / ld) * k;
            if (s.bleatT > 1.5 && this.rng.next() < dt * 0.4) s.bleatT = 0.1;
          }
        }
      }

      // Sheep inside a guide-fence funnel smell hay and their flockmates: a pull into the pen.
      // Only inside the funnel, and only a nudge unless they are already being driven.
      for (const p of L.pens) {
        const l = p.toLocal(s.x, s.z);
        const depth = -p.halfW + 0.5 - l.x;
        if (depth > 0 && depth < Math.max(8.5 * p.scale, 7.5) && Math.abs(l.z) < 3 * p.scale + depth * 1.05) {
          const inside = p.inside;
          const gx = inside.x - s.x;
          const gz = inside.z - s.z;
          const gl = Math.hypot(gx, gz) || 1;
          const k = alert || (lamb && mother?.state === 'folded') ? 2.2 + (1 - Math.min(1, p.scale)) * 6 : 0;
          vx += (gx / gl) * k;
          vz += (gz / gl) * k;
        }
      }

      if (s.followT > 0) {
        s.followT -= dt;
        const p = L.pens[s.followPen];
        if (p) {
          const tgt = p.inFunnel(s.x, s.z) ? p.inside : p.mouth;
          const gx = tgt.x - s.x;
          const gz = tgt.z - s.z;
          const gl = Math.hypot(gx, gz) || 1;
          const k = alert ? 3.4 : 2.4;
          vx += (gx / gl) * k;
          vz += (gz / gl) * k;
          s.alertT = Math.max(s.alertT, 0.4);
        }
      }

      // Sheep settle wherever the dog (or a wolf) left them, then graze around that spot.
      if (alert || fear > 0.05) {
        s.homeX = s.x;
        s.homeZ = s.z;
      } else if (!this.watch) {
        const hx = s.homeX - s.x;
        const hz = s.homeZ - s.z;
        const hd = Math.hypot(hx, hz);
        if (hd > 5) {
          vx += (hx / hd) * 0.3;
          vz += (hz / hd) * 0.3;
        }
      }

      // Driven sheep near a bridge end or a ford line up with it, the way a flock funnels onto a
      // path. Without this the outer sheep of a group jam against the railings.
      if (alert || fear > 0.05) {
        for (const c of L.crossings) {
          if (c.ford && !c.ford.open) continue;
          const dx = s.x - c.x;
          const dz = s.z - c.z;
          const along = dx * c.ux + dz * c.uz;
          const across = -dx * c.uz + dz * c.ux;
          const half = c.len / 2;
          if (Math.abs(along) > half + 9 || Math.abs(across) > c.w / 2 + 7) continue;
          const va = s.vx * c.ux + s.vz * c.uz;
          const onDeck = Math.abs(along) <= half;
          if (!onDeck && along * va >= 0) continue;
          // Line up with the deck (stronger the closer to it) and keep moving along it: the flock
          // files across instead of milling at the rails.
          const near = 1 - clamp((Math.abs(along) - half) / 9, 0, 1);
          const lat = clamp(-across * (onDeck ? 1.8 : 0.9 + 0.9 * near), -4, 4);
          const dir = Math.abs(va) > 0.2 ? Math.sign(va) : -Math.sign(along);
          const push = onDeck ? 2.6 : 1.4 + 1.2 * near;
          vx += -c.uz * lat + c.ux * dir * push;
          vz += c.ux * lat + c.uz * dir * push;
        }
      }

      // Calm grazing: short strolls, long pauses.
      if (!alert && fear < 0.05 && !stubborn) {
        s.wanderT -= dt;
        if (s.wanderT <= 0) {
          if (s.grazing) {
            const a = this.rng.range(-Math.PI, Math.PI);
            s.wanderX = Math.sin(a);
            s.wanderZ = Math.cos(a);
            s.wanderT = this.rng.range(0.8, 2.2);
            s.grazing = false;
          } else {
            s.wanderT = this.rng.range(2.5, 7);
            s.grazing = true;
          }
        }
        if (!s.grazing) {
          // On a night watch the sheep wander further: left alone the flock spreads out.
          const g = this.watch ? 1.5 : 1;
          vx += s.wanderX * SHEEP.grazeSpeed * g;
          vz += s.wanderZ * SHEEP.grazeSpeed * g;
        }
      } else {
        s.grazing = false;
        s.wanderT = this.rng.range(1, 3);
      }
      // A straying ewe (night watch) walks off on her own until the dog turns her or she gets there.
      if (s.strayT > 0) {
        s.strayT -= dt;
        const gx = s.strayX - s.x;
        const gz = s.strayZ - s.z;
        const gl = Math.hypot(gx, gz);
        if (alert || fear > 0.05 || gl < 3) s.strayT = 0;
        else {
          vx += (gx / gl) * 1.5;
          vz += (gz / gl) * 1.5;
        }
      }
      if (stubborn) {
        // Squared up to the dog: he holds his ground.
        vx *= 0.15;
        vz *= 0.15;
      }

      // Look ahead for obstacles, water and the valley edge.
      const av = this.avoidance(s, alert, this.onApproach(s, -0.3));
      vx += av.x;
      vz += av.z;

      const spdK = lamb ? 1.08 : s.kind === 'ram' ? 0.92 : 1;
      const cap = (s.panicT > 0 ? SHEEP.panicSpeed : fear > 0.02 || alert || s.trotT > 0 || orphan ? SHEEP.fleeSpeed : SHEEP.grazeSpeed * (s.strayT > 0 ? 1.9 : 1.3)) * spdK;
      const vl = Math.hypot(vx, vz);
      if (vl > cap) {
        vx = (vx / vl) * cap;
        vz = (vz / vl) * cap;
      }
      if (vl < 0.12) {
        vx = 0;
        vz = 0;
      }

      const accel = SHEEP.accel * (fear > 0.1 ? 1.4 : 0.6) * (lamb ? 1.3 : 1);
      const dvx = vx - s.vx;
      const dvz = vz - s.vz;
      const dl = Math.hypot(dvx, dvz);
      const step = accel * dt;
      if (dl <= step) {
        s.vx = vx;
        s.vz = vz;
      } else {
        s.vx += (dvx / dl) * step;
        s.vz += (dvz / dl) * step;
      }
      s.fear = lerp(s.fear, fear, 1 - Math.exp(-6 * dt));
      const px = s.x;
      const pz = s.z;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      collideStatic(L, s, { boundary: true, gate: false });
      this.keepDry(s);
      if (this.trial) this.trialGates(s, px, pz);

      s.speed = Math.hypot(s.vx, s.vz);
      if (stubborn && dd < 22) s.facing = dampAngle(s.facing, Math.atan2(d.x - s.x, d.z - s.z), 4, dt);
      else if (s.speed > 0.25) s.facing = dampAngle(s.facing, Math.atan2(s.vx, s.vz), 7, dt);
      else if (fear > 0.05 || alert) s.facing = dampAngle(s.facing, Math.atan2(d.x - s.x, d.z - s.z), 3, dt);

      const prev = s.state;
      s.state = s.panicT > 0 ? 'panic' : fear > 0.05 ? 'flee' : alert ? 'alert' : s.grazing ? 'graze' : 'walk';
      if (s.state !== prev) s.stateT = 0;

      s.bleatT -= dt * (fear > 0.3 ? 3 : 1) * (this.rules.weather === 'fog' ? 1.6 : 1);
      if (s.bleatT <= 0) {
        s.bleatT = this.rng.range(6, 18);
        this.events.push({ type: 'bleat', x: s.x, z: s.z, id: s.id, urgent: fear > 0.3, kind: s.kind });
      }

      // Home as soon as it is through a gate; penned sheep then wander deeper in.
      if (!this.watch) {
        for (const p of L.pens) if (p.through(s.x, s.z)) this.foldSheep(s, p);
      }
    }

    // Bodies push each other apart; the dog barely moves when shoved, the ram even less.
    for (let i = 0; i < flock.length; i++) {
      const a = flock[i];
      if (a.state === 'lost' || a.state === 'grabbed' || a.state === 'hidden') continue;
      for (let j = i + 1; j < flock.length; j++) {
        const b = flock[j];
        if (b.state === 'lost' || b.state === 'grabbed' || b.state === 'hidden') continue;
        separatePair(a, b, a.kind === 'ram' ? 0.1 : b.kind === 'ram' ? 0.9 : 0.5);
      }
      separatePair(d, a, a.state === 'folded' ? 0.5 : a.kind === 'ram' ? 0.85 : 0.12);
    }
  }

  /** In line with an open crossing's deck and within a few metres of it. */
  private onApproach(s: Sheep, pad = 1.5) {
    for (const c of this.level.crossings) {
      if (c.ford && !c.ford.open) continue;
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      const along = dx * c.ux + dz * c.uz;
      const across = -dx * c.uz + dz * c.ux;
      if (Math.abs(along) < c.len / 2 + 8 && Math.abs(across) < c.w / 2 + pad) return true;
    }
    return false;
  }

  private avoidance(s: Sheep, alert: boolean, approach = false) {
    const L = this.level;
    let x = 0;
    let z = 0;
    const look = SHEEP.obstacleLook;
    for (const c of L.circles) {
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      const rr = c.r + s.r + look;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr * rr) continue;
      const dd = Math.sqrt(d2) || 1;
      const k = 1 - (dd - c.r - s.r) / look;
      const px = dx / dd;
      const pz = dz / dd;
      const side = s.vx * pz - s.vz * px >= 0 ? 1 : -1;
      x += (px + -pz * side * 0.6) * k * 2.2;
      z += (pz + px * side * 0.6) * k * 2.2;
    }
    for (const g of L.segs) {
      if (g.tag === 'gate') continue;
      const c = closestOnSegment(s.x, s.z, g.ax, g.az, g.bx, g.bz);
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      const dd = Math.hypot(dx, dz) || 1;
      // Bridge rails only nudge (sheep slide along them instead of bouncing off the deck's end).
      const reach = g.r + s.r + (g.tag === 'boundary' ? 3 : g.tag === 'rail' ? 0.5 : 1.6);
      if (dd > reach) continue;
      const k = 1 - (dd - g.r - s.r) / (reach - g.r - s.r);
      const str = g.tag === 'boundary' ? 3 : g.tag === 'rail' ? 0.8 : 2;
      x += (dx / dd) * k * str;
      z += (dz / dd) * k * str;
      if (g.tag !== 'boundary' && g.tag !== 'rail' && g.tag !== 'field' && (g.bx - g.ax) ** 2 + (g.bz - g.az) ** 2 < 12 * 12) {
        // Slide along a short wall, fence or hurdle towards its nearer end (the way the sheep is already
        // heading along it, else the shorter way round): pressed straight into it, a driven flock
        // ground against the fence instead of flowing round it.
        const lx = g.bx - g.ax;
        const lz = g.bz - g.az;
        const ll = Math.hypot(lx, lz) || 1;
        const tx = lx / ll;
        const tz = lz / ll;
        const along = s.vx * tx + s.vz * tz;
        const toB = Math.hypot(g.bx - s.x, g.bz - s.z);
        const toA = Math.hypot(g.ax - s.x, g.az - s.z);
        const side = Math.abs(along) > 0.3 ? Math.sign(along) : toB < toA ? 1 : -1;
        x += tx * side * k * str * 0.9;
        z += tz * side * k * str * 0.9;
      }
    }
    // Water: sheep refuse to step in except on a bridge or at an open ford.
    if (!L.crossingAt(s.x, s.z) && !approach) {
      const w = L.waterQuery(s.x, s.z);
      const reach = SHEEP.waterAvoid * (alert ? 0.7 : 1.2);
      const edge = w.edge - s.r;
      if (edge < reach) {
        const k = clamp(1 - edge / reach, 0, 1.5);
        x += w.nx * k * 3.2;
        z += w.nz * k * 3.2;
      }
    }
    return { x, z };
  }

  /** Sheep cannot walk into water from dry land except at a crossing. */
  private keepDry(s: Sheep) {
    const L = this.level;
    const w = L.waterQuery(s.x, s.z);
    // Within half a body of the water's edge counts as stepping in.
    const wet = w.edge < s.r * 0.5 && !L.onBridge(s.x, s.z);
    s.inWater = wet;
    if (!wet) {
      s.prevDry = true;
      return;
    }
    if (L.crossingAt(s.x, s.z)) {
      s.prevDry = false;
      return;
    }
    if (s.prevDry) {
      // Stepped off the bank: put it back on the bank.
      const push = s.r * 0.5 - w.edge;
      s.x += w.nx * push;
      s.z += w.nz * push;
      const vn = s.vx * w.nx + s.vz * w.nz;
      if (vn < 0) {
        s.vx -= vn * w.nx;
        s.vz -= vn * w.nz;
      }
    } else {
      // Drifted out of the ford (or the ford flooded) while wading: wade out to the bank.
      s.x += w.nx * 0.08;
      s.z += w.nz * 0.08;
    }
  }

  private foldSheep(s: Sheep, p: Pen) {
    s.state = 'folded';
    s.stateT = 0;
    s.panicT = 0;
    s.fear = 0;
    s.alertT = 0;
    s.foldedAt = this.elapsed;
    s.wanderT = this.rng.range(0.5, 2);
    s.penId = p.id;
    this.folded++;
    this.events.push({ type: 'folded', x: s.x, z: s.z, id: s.id, count: this.folded });
    // Sheep follow sheep: once one goes in, the ones close behind it follow through the gate.
    const pi = this.level.pens.indexOf(p);
    for (const q of this.sheep) {
      if (q === s || !this.isFree(q) || (q.kind === 'ram' && q.stubborn > 0.15)) continue;
      if ((q.x - s.x) ** 2 + (q.z - s.z) ** 2 < 10 * 10) {
        q.followT = 3;
        q.followPen = pi;
      }
    }
  }

  private updateFoldedSheep(s: Sheep, dt: number) {
    const L = this.level;
    const p = L.pens.find((q) => q.id === s.penId) ?? L.fold;
    s.wanderT -= dt;
    let lvx = 0;
    let lvz = 0;
    const l = p.toLocal(s.x, s.z);
    // Walk well inside first, then potter about near the hay.
    if (l.x < -p.halfW + 4) {
      lvx += 1.6;
      lvz += -l.z * 0.1;
    } else if (s.wanderT <= 0) {
      if (s.grazing) {
        const a = this.rng.range(-Math.PI, Math.PI);
        s.wanderX = Math.sin(a);
        s.wanderZ = Math.cos(a);
        s.wanderT = this.rng.range(0.8, 1.8);
        s.grazing = false;
      } else {
        s.grazing = true;
        s.wanderT = this.rng.range(3, 8);
      }
    }
    const v = p.dirToWorld(lvx, lvz);
    let vx = v.x;
    let vz = v.z;
    if (!s.grazing && l.x >= -p.halfW + 4) {
      vx += s.wanderX * 0.6;
      vz += s.wanderZ * 0.6;
    }
    for (const o of this.sheep) {
      if (o === s || o.state !== 'folded') continue;
      const ox = s.x - o.x;
      const oz = s.z - o.z;
      const od = Math.hypot(ox, oz);
      const want = s.kind === 'lamb' && o.id === s.motherId ? 1.2 : 2.2;
      if (od < want && od > 0) {
        vx += (ox / od) * (want - od) * 1.5;
        vz += (oz / od) * (want - od) * 1.5;
      }
    }
    // A penned lamb keeps close to its mother.
    if (s.kind === 'lamb') {
      const m = this.sheep.find((o) => o.id === s.motherId && o.state === 'folded');
      if (m && Math.hypot(m.x - s.x, m.z - s.z) > 2.5) {
        vx += (m.x - s.x) * 0.5;
        vz += (m.z - s.z) * 0.5;
      }
    }
    s.vx = lerp(s.vx, vx, 1 - Math.exp(-4 * dt));
    s.vz = lerp(s.vz, vz, 1 - Math.exp(-4 * dt));
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    collideStatic(L, s, { boundary: true, gate: true });
    const c = p.toLocal(s.x, s.z);
    const cl = p.toWorld(clamp(c.x, -p.halfW + 0.9, p.halfW - 0.9), clamp(c.z, -p.halfD + 0.9, p.halfD - 0.9));
    s.x = cl.x;
    s.z = cl.z;
    s.speed = Math.hypot(s.vx, s.vz);
    if (s.speed > 0.2) s.facing = dampAngle(s.facing, Math.atan2(s.vx, s.vz), 5, dt);
    s.inWater = false;
  }

  /**
   * Night watch: a ewe at the far side of the flock from Pip sets off on her own towards a spot
   * 30-42 m out into the dark. Unless Pip turns her she keeps going, and the wolves notice.
   */
  private startStray() {
    const L = this.level;
    const d = this.dog;
    const free = this.sheep.filter((s) => this.isFree(s) && s.kind !== 'lamb' && s.kind !== 'ram');
    if (free.length < 4 || free.filter((s) => s.strayT > 0).length >= 2) return;
    let cx = 0;
    let cz = 0;
    for (const s of free) {
      cx += s.x;
      cz += s.z;
    }
    cx /= free.length;
    cz /= free.length;
    let best: Sheep | null = null;
    let bd = -1;
    for (const s of free) {
      if (s.strayT > 0 || s.fear > 0.05 || s.alertT > 0) continue;
      const dd = Math.hypot(s.x - d.x, s.z - d.z);
      if (dd > bd) {
        bd = dd;
        best = s;
      }
    }
    if (!best || bd < 13) return;
    const ax = best.x - cx;
    const az = best.z - cz;
    const base = Math.hypot(ax, az) > 1 ? Math.atan2(ax, az) : Math.atan2(best.x - d.x, best.z - d.z);
    for (let i = 0; i < 12; i++) {
      const a = base + this.rng.range(-1, 1);
      const r = this.rng.range(30, 42);
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      if (!L.insideValley(x, z) || L.boundaryDistance(x, z) < 7 || L.inWater(x, z) || L.penAt(x, z, -2) || L.acrossWater(best.x, best.z, x, z)) continue;
      best.strayT = 50;
      best.strayX = x;
      best.strayZ = z;
      this.events.push({ type: 'stray', id: best.id, x: best.x, z: best.z, tx: x, tz: z });
      return;
    }
  }

  /** Midnight on the watch: something big crashes through the bracken; the flock bolts three ways. */
  private scatter() {
    const free = this.sheep.filter((s) => this.isFree(s));
    if (free.length < 3) return;
    let cx = 0;
    let cz = 0;
    for (const s of free) {
      cx += s.x;
      cz += s.z;
    }
    cx /= free.length;
    cz /= free.length;
    const a0 = this.rng.range(0, Math.PI * 2);
    const third = (Math.PI * 2) / 3;
    for (const s of free) {
      s.strayT = 0;
      if (s.kind === 'ram') continue;
      const ang = Math.atan2(s.x - cx, s.z - cz);
      const k = Math.round((ang - a0) / third);
      const dir = a0 + k * third + this.rng.range(-0.3, 0.3);
      s.panicT = this.rng.range(2.4, 3.3);
      s.panicX = Math.sin(dir);
      s.panicZ = Math.cos(dir);
      s.alertT = 3;
    }
    // The wolves hold off for a moment: the player gets to see where everyone went.
    this.snatchCd = Math.max(this.snatchCd, 6);
    this.events.push({ type: 'scatter', x: cx, z: cz });
  }

  // ---------------------------------------------------------------- wolves

  private allowedWolves() {
    const r = this.rules;
    if (r.wolfStart === null || this.t < r.wolfStart) return 0;
    // At dawn the wolves give up and go back to the woods.
    if (this.watch && this.t > 0.9) return 0;
    const k = invLerp(r.wolfStart, this.watch ? 0.6 : 0.85, this.t);
    return Math.max(1, Math.round(lerp(1, r.maxWolves, k)));
  }

  private pickTarget(fromX: number, fromZ: number): Sheep | null {
    const d = this.dog;
    const ram = this.ram();
    let best: Sheep | null = null;
    let bestScore = -Infinity;
    for (const s of this.sheep) {
      if (!this.isFree(s) || s.kind === 'ram') continue;
      if (this.wolves.some((w) => w.target === s && w.state !== 'gone' && w.state !== 'flee')) continue;
      const toDog = Math.hypot(s.x - d.x, s.z - d.z);
      const toWolf = Math.hypot(s.x - fromX, s.z - fromZ);
      // Far from Pip is easy prey, but past about 100 m a snatch cannot be answered at all, and a
      // loss nobody could have stopped is not a challenge, so those sheep score much lower.
      let score = Math.min(toDog, 100) * 1.2 - Math.max(0, toDog - 100) * 1.5 - toWolf * 0.6 + (this.level.inFold(s.x, s.z, -6) ? -40 : 0);
      // Lambs are the easy prey; a sheep at the ram's side is not.
      if (s.kind === 'lamb') score += 18;
      if (s.kind === 'black') score += 6;
      if (ram && Math.hypot(s.x - ram.x, s.z - ram.z) < 8) score -= 25;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  private spawnWolf() {
    // Usually the sheep the dog is furthest from. The evening's first wolf instead goes for the
    // flock Pip is working, so the player meets it on screen before any sheep is lost.
    const d = this.dog;
    const first = this.wolfIds === 0;
    let s = this.pickTarget(d.x, d.z);
    if (first) {
      let bd = Infinity;
      for (const q of this.sheep) {
        if (!this.isFree(q) || q.kind === 'ram') continue;
        const dd = Math.hypot(q.x - d.x, q.z - d.z);
        if (dd < bd) {
          bd = dd;
          s = q;
        }
      }
    }
    if (!s) return;
    // A pack: a lone wolf already stalking Pip's flock calls a second one, which goes for the far
    // side of the same flock while the first shows itself.
    const bait = this.rules.pack && !first ? this.wolves.find((o) => o.state === 'stalk' && o.role === 'lone' && o.target && o.valleyT > 2 && Math.hypot(o.target.x - d.x, o.target.z - d.z) < 70) : undefined;
    let flock: { cx: number; cz: number } | null = null;
    if (bait?.target) {
      flock = this.flockAround(bait.target);
      // The sheep on the far side of that flock from the bait.
      let far = -Infinity;
      for (const q of this.sheep) {
        if (!this.isFree(q) || q.kind === 'ram' || (q.x - bait.target.x) ** 2 + (q.z - bait.target.z) ** 2 > 16 * 16) continue;
        const dd = Math.hypot(q.x - bait.x, q.z - bait.z);
        if (dd > far) {
          far = dd;
          s = q;
        }
      }
    }
    let den = this.level.dens[0];
    let bd = Infinity;
    for (const dn of this.level.dens) {
      const toDog = Math.hypot(dn[0] - d.x, dn[1] - d.z);
      if (toDog < 30) continue;
      // A flanker leaves from the den furthest round the far side of the flock from its mate.
      const dd = bait && flock ? -((dn[0] - flock.cx) * (flock.cx - bait.x) + (dn[1] - flock.cz) * (flock.cz - bait.z)) / (Math.hypot(dn[0] - flock.cx, dn[1] - flock.cz) || 1) : Math.hypot(dn[0] - s.x, dn[1] - s.z);
      if (dd < bd) {
        bd = dd;
        den = dn;
      }
    }
    const w: Wolf = {
      id: this.wolfIds++,
      x: den[0],
      z: den[1],
      vx: 0,
      vz: 0,
      r: WOLF.radius,
      state: 'stalk',
      facing: Math.atan2(s.x - den[0], s.z - den[1]),
      speed: 0,
      target: s,
      respawnT: 0,
      stateT: 0,
      inWater: false,
      valleyT: 0,
      role: bait ? 'flanker' : 'lone',
      mate: bait ? bait.id : -1,
      feintT: 0,
      feintCd: 0,
      posT: 0,
    };
    const slot = this.wolves.findIndex((o) => o.state === 'gone');
    if (slot >= 0) this.wolves[slot] = w;
    else this.wolves.push(w);
    this.events.push({ type: 'wolfSpawn', x: w.x, z: w.z, id: w.id, tx: s.x, tz: s.z });
    if (bait) {
      bait.role = 'bait';
      bait.mate = w.id;
      bait.feintCd = 2;
      this.events.push({ type: 'pack', x: bait.x, z: bait.z, id: bait.id, fx: w.x, fz: w.z, fid: w.id });
    }
  }

  /** The middle and spread of the free sheep within 16 m of a sheep (its flock, roughly). */
  private flockAround(s: Sheep) {
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const q of this.sheep) {
      if (!this.isFree(q) || (q.x - s.x) ** 2 + (q.z - s.z) ** 2 > 16 * 16) continue;
      cx += q.x;
      cz += q.z;
      n++;
    }
    cx /= n || 1;
    cz /= n || 1;
    let spread = 0;
    for (const q of this.sheep) if (this.isFree(q) && (q.x - s.x) ** 2 + (q.z - s.z) ** 2 <= 16 * 16) spread = Math.max(spread, Math.hypot(q.x - cx, q.z - cz));
    return { cx, cz, spread };
  }

  /** A wolf's pack mate, if it is still hunting. */
  private mateOf(w: Wolf) {
    if (w.mate < 0) return null;
    const m = this.wolves.find((o) => o.id === w.mate);
    return m && (m.state === 'stalk' || m.state === 'charge') ? m : null;
  }

  private scareWolf(w: Wolf) {
    if (w.state === 'drag' && w.target) {
      const s = w.target;
      s.state = 'panic';
      s.stateT = 0;
      s.panicT = 1.4;
      const dx = s.x - w.x;
      const dz = s.z - w.z;
      const dl = Math.hypot(dx, dz) || 1;
      s.panicX = dx / dl;
      s.panicZ = dz / dl;
      s.alertT = 3;
      if (!this.level.insideValley(s.x, s.z)) this.backInside(s);
      s.prevDry = !this.level.inWater(s.x, s.z);
      this.rescues++;
      this.snatchCd = Math.max(this.snatchCd, 8);
      this.events.push({ type: 'rescued', x: s.x, z: s.z, id: s.id });
    }
    w.state = 'flee';
    w.stateT = 0;
    w.target = null;
    w.feintT = 0;
    this.events.push({ type: 'wolfScared', x: w.x, z: w.z, id: w.id });
  }

  /** Put a sheep dropped beyond the valley edge back just inside it (edges block both ways). */
  private backInside(s: Sheep) {
    const poly = this.level.boundary;
    let bx = s.x;
    let bz = s.z;
    let bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const c = closestOnSegment(s.x, s.z, a[0], a[1], b[0], b[1]);
      const d = (c.x - s.x) ** 2 + (c.z - s.z) ** 2;
      if (d < bd) {
        bd = d;
        bx = c.x;
        bz = c.z;
      }
    }
    // A step past the edge point, towards the middle of the valley.
    const L = this.level;
    const mx = L.fold.cx - bx;
    const mz = L.fold.cz - bz;
    const ml = Math.hypot(mx, mz) || 1;
    s.x = bx + (mx / ml) * 2.5;
    s.z = bz + (mz / ml) * 2.5;
    s.panicX = mx / ml;
    s.panicZ = mz / ml;
  }

  private wolfGone(w: Wolf) {
    w.state = 'gone';
    w.target = null;
    this.nextWolfT = Math.max(this.nextWolfT, this.rng.range(...this.rules.wolfRespawn));
  }

  private updateWolves(dt: number) {
    const allowed = this.allowedWolves();
    if (allowed === 0) this.nextWolfT = this.watch && this.t < 0.5 ? 2 : 5;
    const active = this.wolves.filter((w) => w.state !== 'gone').length;
    this.nextWolfT -= dt;
    if (active < allowed && this.nextWolfT <= 0 && this.free > 0) {
      this.spawnWolf();
      this.nextWolfT = this.rng.range(...this.rules.wolfRespawn);
    }

    const d = this.dog;
    const spd = this.rules.wolfSpeedScale;
    this.snatchCd = Math.max(0, this.snatchCd - dt);
    const someoneDragging = this.wolves.some((o) => o.state === 'drag');
    const ram = this.ram();
    const dawn = this.watch && this.t > 0.9;
    for (const w of this.wolves) {
      if (w.state === 'gone') continue;
      w.stateT += dt;

      // Touching the dog always sends a wolf running; so does the ram's horns, and the dawn.
      if (w.state !== 'flee' && Math.hypot(w.x - d.x, w.z - d.z) < DOG.wolfScareTouch) this.scareWolf(w);
      if (ram && w.state !== 'flee' && w.state !== 'drag' && Math.hypot(w.x - ram.x, w.z - ram.z) < 4.2) {
        this.scareWolf(w);
        this.events.push({ type: 'butt', x: (w.x + ram.x) / 2, z: (w.z + ram.z) / 2, wolf: true });
      }
      if (dawn && (w.state === 'stalk' || w.state === 'charge')) this.scareWolf(w);
      const fly = this.fly && this.fly.mode !== 'heel' ? this.fly : null;
      if (fly && w.state !== 'flee' && w.state !== 'drag' && Math.hypot(w.x - fly.x, w.z - fly.z) < DOG.wolfScareTouch + 0.6) this.scareWolf(w);

      let tx = 0;
      let tz = 0;
      let speed = 0;
      const t = w.target;
      if ((w.state === 'stalk' || w.state === 'charge') && (!t || !this.isFree(t))) {
        w.target = this.pickTarget(w.x, w.z);
        w.state = 'stalk';
        if (!w.target) {
          w.state = 'flee';
          w.stateT = 0;
        }
      }

      const dogDx = w.x - d.x;
      const dogDz = w.z - d.z;
      const dogD = Math.hypot(dogDx, dogDz) || 1;

      if (w.state !== 'flee' && this.level.insideValley(w.x, w.z)) w.valleyT += dt;
      // A pack breaks up when one of the pair stops hunting.
      if (w.role !== 'lone' && (w.state === 'stalk' || w.state === 'charge') && !this.mateOf(w)) {
        w.role = 'lone';
        w.mate = -1;
        w.feintT = 0;
      }
      w.feintCd = Math.max(0, w.feintCd - dt);
      if (w.state === 'stalk' && w.target) {
        const s = w.target;
        const sx = s.x - w.x;
        const sz = s.z - w.z;
        const sd = Math.hypot(sx, sz) || 1;
        tx = sx / sd;
        tz = sz / sd;
        speed = WOLF.stalkSpeed * spd;
        const gentle = this.rules.pack !== 'full';
        const mate = this.mateOf(w);
        // The bait is brazen: it lets Pip come closer before it gives ground.
        const wary = w.role === 'bait' ? WOLF.dogWaryRadius * 0.6 : WOLF.dogWaryRadius;
        if (dogD < wary) {
          const k = 1 - dogD / wary;
          tx += (dogDx / dogD) * k * 2.2;
          tz += (dogDz / dogD) * k * 2.2;
        }
        if (ram) {
          // Wary of the ram's horns too.
          const rx = w.x - ram.x;
          const rz = w.z - ram.z;
          const rd = Math.hypot(rx, rz) || 1;
          if (rd < 9) {
            tx += (rx / rd) * (1 - rd / 9) * 2;
            tz += (rz / rd) * (1 - rd / 9) * 2;
          }
        }
        if (fly) {
          // Wolves give the old dog a wide berth.
          const fx = w.x - fly.x;
          const fz = w.z - fly.z;
          const fd = Math.hypot(fx, fz) || 1;
          if (fd < FLY.wolfR) {
            tx += (fx / fd) * (1 - fd / FLY.wolfR) * 2.4;
            tz += (fz / fd) * (1 - fd / FLY.wolfR) * 2.4;
          }
        }
        const sheepToDog = Math.min(Math.hypot(s.x - d.x, s.z - d.z), fly ? Math.hypot(s.x - fly.x, s.z - fly.z) + 1 : Infinity);
        const seenLongEnough = w.valleyT > (this.watch ? 3 : w.id === 0 ? 10 : 6);
        let mayCharge = !someoneDragging && this.snatchCd <= 0 && seenLongEnough;
        let range: number = WOLF.chargeRange;
        let lurk = true;
        if (w.role === 'bait' && mate) {
          // Shows itself on Pip's side and rushes the flock now and then; it only strikes for
          // real if Pip ignores it altogether.
          lurk = false;
          mayCharge = mayCharge && dogD > 24;
          if (w.feintT > 0) {
            w.feintT -= dt;
            speed = WOLF.chargeSpeed * spd * 0.8;
            if (sd < 6) w.feintT = 0;
          } else if (sd < WOLF.lurkRange) {
            // Prowl back and forth in plain view, about 13 m off the flock.
            const k = (13 - sd) / 13;
            const side = Math.sin(this.elapsed * 0.7 + w.id) > 0 ? 1 : -1;
            tx = (sx / sd) * -k * 1.5 + (-sz / sd) * 0.7 * side;
            tz = (sz / sd) * -k * 1.5 + (sx / sd) * 0.7 * side;
            speed = WOLF.stalkSpeed * spd * 0.7;
            if (w.feintCd <= 0 && dogD < 32 && !mayCharge) {
              w.feintT = 1.1;
              w.feintCd = gentle ? this.rng.range(7, 10) : this.rng.range(4, 7);
              this.events.push({ type: 'feint', x: w.x, z: w.z, id: w.id });
            }
          }
        } else if (w.role === 'flanker' && mate) {
          // Circle round outside the sheep's fear of wolves to the side of the flock away from the
          // bait, then wait there for Pip to commit to the bait.
          lurk = false;
          const f = this.flockAround(s);
          const ax = f.cx - mate.x;
          const az = f.cz - mate.z;
          const al = Math.hypot(ax, az) || 1;
          const R = f.spread + 15;
          const gx = f.cx + (ax / al) * R;
          const gz = f.cz + (az / al) * R;
          const rx = w.x - f.cx;
          const rz = w.z - f.cz;
          const rl = Math.hypot(rx, rz) || 1;
          const cur = Math.atan2(rz, rx);
          const want = Math.atan2(gz - f.cz, gx - f.cx);
          let da = want - cur;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const toGoal = Math.hypot(gx - w.x, gz - w.z);
          if (toGoal < 4) {
            w.posT += dt;
            if (w.posT - dt <= 0) this.events.push({ type: 'growl', x: w.x, z: w.z, id: w.id });
            tx = (gx - w.x) * 0.2;
            tz = (gz - w.z) * 0.2;
            speed = WOLF.stalkSpeed * spd * 0.3;
          } else {
            // Round the flock (never through it), holding the radius.
            const dir = Math.sign(da) || 1;
            const radial = clamp((R - rl) / 4, -1, 1);
            tx = (-rz / rl) * dir * (Math.abs(da) > 0.25 ? 1 : 0.3) + (rx / rl) * radial * 1.3 + ((gx - w.x) / (toGoal || 1)) * (Math.abs(da) > 0.25 ? 0 : 1);
            tz = (rx / rl) * dir * (Math.abs(da) > 0.25 ? 1 : 0.3) + (rz / rl) * radial * 1.3 + ((gz - w.z) / (toGoal || 1)) * (Math.abs(da) > 0.25 ? 0 : 1);
            speed = WOLF.stalkSpeed * spd * 1.15;
            if (dogD < WOLF.dogWaryRadius) {
              const k = 1 - dogD / WOLF.dogWaryRadius;
              tx += (dogDx / dogD) * k * 2.2;
              tz += (dogDz / dogD) * k * 2.2;
            }
          }
          // Pip has gone to the bait: he is further from this side of the flock than from it.
          const dogToBait = Math.hypot(d.x - mate.x, d.z - mate.z);
          const committed = sheepToDog > (gentle ? 20 : 16) && dogToBait < sheepToDog;
          mayCharge = mayCharge && w.posT > (gentle ? 3 : 1.2) && committed;
          range = R + 2;
          if (mayCharge) {
            // Go for whichever sheep of the flock is nearest.
            let nd = Infinity;
            for (const q of this.sheep) {
              if (!this.isFree(q) || q.kind === 'ram' || (q.x - f.cx) ** 2 + (q.z - f.cz) ** 2 > (f.spread + 2) ** 2) continue;
              const dd = Math.hypot(q.x - w.x, q.z - w.z);
              if (dd < nd && Math.hypot(q.x - d.x, q.z - d.z) > 8) {
                nd = dd;
                w.target = q;
              }
            }
          }
        }
        const tgt = w.target ?? s;
        const td = Math.hypot(tgt.x - w.x, tgt.z - w.z);
        if (mayCharge && td < range && Math.hypot(tgt.x - d.x, tgt.z - d.z) > (this.watch ? 6 : 8)) {
          w.state = 'charge';
          w.stateT = 0;
          w.feintT = 0;
          this.events.push({ type: 'charge', x: w.x, z: w.z, id: w.id });
        } else if (lurk && !mayCharge && sd < WOLF.lurkRange) {
          const k = (WOLF.lurkRange - sd) / WOLF.lurkRange;
          tx = -(sx / sd) * k * 2 + (-sz / sd) * 0.6;
          tz = -(sz / sd) * k * 2 + (sx / sd) * 0.6;
          speed = WOLF.stalkSpeed * spd * 0.6;
        }
      } else if (w.state === 'charge' && w.target) {
        const s = w.target;
        const sx = s.x - w.x;
        const sz = s.z - w.z;
        const sd = Math.hypot(sx, sz) || 1;
        tx = sx / sd;
        tz = sz / sd;
        speed = WOLF.chargeSpeed * spd;
        if (sd < WOLF.grabRange + s.r && !this.wolves.some((o) => o !== w && o.state === 'drag')) {
          this.snatchCd = this.watch ? 4 : 12;
          w.state = 'drag';
          w.stateT = 0;
          s.state = 'grabbed';
          s.stateT = 0;
          s.panicT = 0;
          this.events.push({ type: 'grab', x: s.x, z: s.z, id: s.id });
        } else if (dogD < 7 || w.stateT > (w.role === 'flanker' ? 5 : 4)) {
          w.state = 'stalk';
          w.stateT = 0;
          w.posT = 0;
        }
      } else if (w.state === 'drag' && w.target) {
        const den = this.level.nearestDen(w.x, w.z);
        const dx = den.x - w.x;
        const dz = den.z - w.z;
        const dl = Math.hypot(dx, dz) || 1;
        tx = dx / dl;
        tz = dz / dl;
        speed = this.dragSpeedFor(w) * clamp((w.stateT - 0.4) / 1.2, 0.2, 1);
        const s = w.target;
        const reach = s.kind === 'lamb' ? 2.6 : 3.3;
        s.x = w.x + Math.sin(w.facing) * reach;
        s.z = w.z + Math.cos(w.facing) * reach;
        s.vx = w.vx;
        s.vz = w.vz;
        s.facing = w.facing + Math.PI * 0.5;
        if (!this.level.insideValley(w.x, w.z) && this.level.boundaryDistance(w.x, w.z) > WOLF.lostDepth) {
          s.state = 'lost';
          s.stateT = 0;
          this.lost++;
          this.lostLog.push({ t: this.elapsed, x: s.x, z: s.z, kind: s.kind });
          this.snatchCd = Math.max(this.snatchCd, 8);
          this.events.push({ type: 'lost', x: s.x, z: s.z, id: s.id });
          this.wolfGone(w);
          continue;
        }
      } else if (w.state === 'flee') {
        const den = this.level.nearestDen(w.x, w.z);
        const dx = den.x - w.x;
        const dz = den.z - w.z;
        const dl = Math.hypot(dx, dz) || 1;
        tx = dx / dl + (dogDx / dogD) * 0.8;
        tz = dz / dl + (dogDz / dogD) * 0.8;
        speed = WOLF.fleeSpeed;
        if (!this.level.insideValley(w.x, w.z) && this.level.boundaryDistance(w.x, w.z) > 7) {
          this.wolfGone(w);
          continue;
        }
      }

      const tl = Math.hypot(tx, tz) || 1;
      let max = speed;
      const wasWet = w.inWater;
      w.inWater = this.level.inWater(w.x, w.z);
      if (w.inWater) max *= 0.6;
      if (wasWet !== w.inWater) this.events.push({ type: 'splash', x: w.x, z: w.z, big: false });
      const rate = w.state === 'charge' ? 10 : 5;
      w.vx = lerp(w.vx, (tx / tl) * max, 1 - Math.exp(-rate * dt));
      w.vz = lerp(w.vz, (tz / tl) * max, 1 - Math.exp(-rate * dt));
      w.x += w.vx * dt;
      w.z += w.vz * dt;
      collideStatic(this.level, w, { boundary: false, gate: false, field: false });
      w.speed = Math.hypot(w.vx, w.vz);
      if (w.state === 'drag') w.facing = dampAngle(w.facing, Math.atan2(-w.vx, -w.vz), 4, dt);
      else if (w.speed > 0.3) w.facing = dampAngle(w.facing, Math.atan2(w.vx, w.vz), 10, dt);
    }
  }

  /**
   * How fast a wolf drags its prey: slower the further Pip is (a heavy sheep and a long way to
   * go), so a snatch across the valley can still be answered. Lambs are light and go faster.
   */
  dragSpeedFor(w: Wolf) {
    const d = this.dog;
    const far = Math.hypot(w.x - d.x, w.z - d.z);
    const light = w.target?.kind === 'lamb' ? 1.15 : 1;
    return WOLF.dragSpeed * this.rules.wolfSpeedScale * light * lerp(1, 0.55, clamp((far - 25) / 60, 0, 1));
  }

  /** Seconds until a dragged sheep is lost: the wolf's way to the loss line in the trees. */
  dragEta(w: Wolf) {
    const L = this.level;
    const inside = L.insideValley(w.x, w.z);
    const left = inside ? L.boundaryDistance(w.x, w.z) + WOLF.lostDepth : Math.max(0, WOLF.lostDepth - L.boundaryDistance(w.x, w.z));
    const tussle = Math.max(0, 1.6 - w.stateT) * 0.6;
    return left / this.dragSpeedFor(w) + tussle;
  }

  /**
   * Seconds Pip needs to get within barking range of (x, z): sprinting while his stamina lasts,
   * then at a walk, plus a moment to wade if a stream is in the way.
   */
  rescueEta(x: number, z: number) {
    const d = this.dog;
    const L = this.level;
    let dist = Math.max(0, Math.hypot(x - d.x, z - d.z) - this.barkWolfRadius * 0.85);
    const wade = L.acrossWater(d.x, d.z, x, z) ? 1 : 0;
    const sprintFor = d.sprintLock ? 0 : d.stamina / (DOG.staminaDrain * this.perks.staminaDrain);
    const sprint = DOG.sprintSpeed * this.perks.speed;
    const sprintDist = sprintFor * sprint;
    if (dist <= sprintDist) return dist / sprint + wade;
    dist -= sprintDist;
    return sprintFor + dist / (DOG.walkSpeed * this.perks.speed) + wade;
  }

  // ---------------------------------------------------------------- weather

  private updateWeather(dt: number) {
    const r = this.rules;
    if (r.floodAt !== undefined && !this.flooded && this.t >= r.floodAt) {
      this.flooded = true;
      for (const f of this.level.fords) f.open = false;
      this.events.push({ type: 'flood' });
    }
    if (this.watch && this.t > 0.04 && this.t < 0.86) {
      this.strayCd -= dt;
      if (this.strayCd <= 0) {
        this.strayCd = this.rng.range(15, 24);
        this.startStray();
      }
    }
    if (this.watch && !this.scattered && this.t >= 0.42) {
      this.scattered = true;
      this.scatter();
    }
    if (this.watch && this.t < 0.9) {
      this.spookT -= dt;
      if (this.spookT <= 0) {
        this.spookT = this.rng.range(14, 22);
        const free = this.sheep.filter((s) => this.isFree(s));
        if (free.length) {
          // An owl or a fox in the dark: the nearest few bolt the other way.
          const s = this.rng.pick(free);
          const a = this.rng.range(0, Math.PI * 2);
          const x = s.x + Math.cos(a) * 7;
          const z = s.z + Math.sin(a) * 7;
          this.events.push({ type: 'spook', x, z });
          for (const q of free) {
            const dx = q.x - x;
            const dz = q.z - z;
            const dd = Math.hypot(dx, dz);
            if (dd > 16 || q.kind === 'ram') continue;
            q.panicT = 0.9 + (1 - dd / 16) * 0.6;
            q.panicX = dx / (dd || 1);
            q.panicZ = dz / (dd || 1);
            q.alertT = 2;
          }
        }
      }
    }
    if (r.thunder) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = this.rng.range(...r.thunder);
        // Lightning strikes on the hill near a flock: every sheep that hears it bolts away.
        const free = this.sheep.filter((s) => this.isFree(s) && s.state !== 'hidden');
        if (free.length === 0) return;
        const s = this.rng.pick(free);
        const a = this.rng.range(0, Math.PI * 2);
        const x = s.x + Math.cos(a) * this.rng.range(10, 20);
        const z = s.z + Math.sin(a) * this.rng.range(10, 20);
        this.events.push({ type: 'thunder', x, z });
        for (const q of free) {
          const dx = q.x - x;
          const dz = q.z - z;
          const dd = Math.hypot(dx, dz);
          if (dd > 50 || q.kind === 'ram') continue;
          q.panicT = 1.1 + (1 - dd / 50) * 0.9;
          q.panicX = dx / (dd || 1);
          q.panicZ = dz / (dd || 1);
          q.alertT = 3;
        }
      }
    }
  }

  // ---------------------------------------------------------------- rules

  private checkRules(input: Input | null) {
    const r = this.rules;
    if (r.wolfStart !== null && !this.duskAnnounced && this.t >= r.wolfStart) {
      this.duskAnnounced = true;
      if (!this.watch) this.events.push({ type: 'dusk' });
    }
    if (this.watch && !this.dawnAnnounced && this.t >= 0.9) {
      this.dawnAnnounced = true;
      this.events.push({ type: 'dawn' });
    }
    if (this.trial) {
      // Penning ends the round; any gates not yet taken count as missed.
      if (this.free === 0 || this.t >= 1) {
        const pen = this.free === 0;
        this.outcome = { kind: 'win', reason: 'trial', stars: 0 };
        const score = this.trialScore();
        const stars = score >= 90 ? 3 : score >= 75 ? 2 : score >= 55 ? 1 : 0;
        this.outcome = null;
        this.finish(stars > 0 ? { kind: 'win', reason: pen ? 'trial' : 'nightfall', stars } : { kind: 'lose', reason: 'judges' });
      }
      return;
    }
    if (this.watch) {
      if (this.total - this.lost < this.target) this.finish({ kind: 'lose', reason: 'wolves' });
      else if (this.t >= 1 && !this.sheep.some((s) => s.state === 'grabbed')) this.finish({ kind: 'win', reason: 'dawn', stars: this.stars() });
      return;
    }
    if (!this.targetAnnounced && this.targetMet && this.free > 0) {
      this.targetAnnounced = true;
      this.events.push({ type: 'targetMet' });
    }
    const grabbed = this.sheep.some((s) => s.state === 'grabbed');
    if (this.folded >= this.target && this.free === 0) {
      this.finish({ kind: 'win', reason: 'all-home', stars: this.stars() });
    } else if (this.total - this.lost < this.target) {
      this.finish({ kind: 'lose', reason: 'wolves' });
    } else if (this.t >= 1) {
      if (this.targetMet) this.finish({ kind: 'win', reason: 'nightfall', stars: this.stars() });
      else this.finish({ kind: 'lose', reason: 'nightfall' });
    } else if (this.targetMet && !grabbed && input?.pressed('latch')) {
      this.finish({ kind: 'win', reason: 'latched', stars: this.stars() });
    }
  }

  /** The two-star mark: halfway between the target and the whole flock. */
  get twoStar() {
    return Math.ceil((this.target + this.total) / 2);
  }

  stars() {
    if (this.trial) {
      const sc = this.trialScore();
      return sc >= 90 ? 3 : sc >= 75 ? 2 : 1;
    }
    if (this.watch) {
      if (this.lost === 0) return 3;
      return this.lost <= Math.floor((this.total - this.target) / 2) ? 2 : 1;
    }
    if (this.folded >= this.total) return 3;
    return this.folded >= this.twoStar ? 2 : 1;
  }

  private finish(o: Outcome) {
    this.outcome = o;
    this.dog.vx = 0;
    this.dog.vz = 0;
  }
}

/** Distance from (x, z) to the segment a-b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
