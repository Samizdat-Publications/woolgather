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
}

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
}

export type WolfState = 'stalk' | 'charge' | 'drag' | 'flee' | 'gone';

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
  | { type: 'flood' };

export type Outcome =
  | { kind: 'win'; reason: 'all-home' | 'nightfall' | 'latched' | 'dawn'; stars: number }
  | { kind: 'lose'; reason: 'nightfall' | 'wolves' };

const RAM_EYE_RANGE = 10;
const RAM_BUTT_RANGE = 4.4;
const LEADER_RANGE = 18;

export class Sim {
  readonly rules: Rules;
  readonly perks: Perks;
  readonly rng: Rng;
  readonly dog: Dog;
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
  private duskAnnounced = false;
  private dawnAnnounced = false;
  private targetAnnounced = false;
  private nextWolfT = 0;
  private wolfIds = 0;
  private thunderT = 0;
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
    };

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
        homeX: x,
        homeZ: z,
        stubborn: kind === 'ram' ? 1 : 0,
        yieldT: 0,
        buttCd: 0,
        boltCd: place.range(2, 6),
        penId: null,
      };
      this.sheep.push(s);
      return s;
    };
    for (const g of rules.flock) {
      const grp = level.def.sheepGroups.find((q) => q.id === g.at) ?? level.def.sheepGroups[0];
      const [gx, gz] = grp.center;
      const ewes: Sheep[] = [];
      for (let i = 0; i < g.ewes; i++) ewes.push(spawn('ewe', gx, gz, grp.radius));
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
    return this.rules.objective === 'watch' ? false : this.folded >= this.target;
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
    this.updateSheep(dt);
    this.updateWolves(dt);
    this.updateWeather(dt);
    this.checkRules(input);
  }

  // ---------------------------------------------------------------- dog

  private updateDog(dt: number, input: Input | null) {
    const d = this.dog;
    const P = this.perks;
    const stunned = d.stunT > 0;
    d.stunT = Math.max(0, d.stunT - dt);
    const mx = stunned ? 0 : (input?.moveX ?? 0);
    const mz = stunned ? 0 : (input?.moveZ ?? 0);
    const mag = Math.hypot(mx, mz);
    d.creeping = !stunned && !!input?.creep;
    if (d.stamina <= 0) d.sprintLock = true;
    else if (d.stamina > 33) d.sprintLock = false;
    d.sprinting = !stunned && !!input?.sprint && mag > 0.1 && !d.creeping && !d.sprintLock && d.stamina > 0;

    let max = (d.creeping ? DOG.creepSpeed : d.sprinting ? DOG.sprintSpeed : DOG.walkSpeed) * P.speed;
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
    const step = (stunned ? 18 : DOG.accel) * dt * (mag < 0.05 ? 1.4 : 1);
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
      d.stamina = Math.max(0, d.stamina - DOG.staminaDrain * P.staminaDrain * dt);
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
        s.stubborn = Math.max(0, s.stubborn - 0.55);
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

  private isFree(s: Sheep) {
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
    const dogR = d.creeping
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
            s.stubborn -= dt * (d.creeping ? 0.3 : 0.2) * this.perks.eye;
            if (s.stubborn <= 0.15) this.ramYields(s);
          }
          if (dd < RAM_BUTT_RANGE + d.r && !d.creeping && s.buttCd <= 0 && d.stunT <= 0) {
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
        } else if (s.yieldT <= 0 && dd > 16) {
          // Left alone he gets his nerve back.
          s.stubborn = Math.min(1, s.stubborn + dt * 0.05);
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
          s.trotX = vx / fl;
          s.trotZ = vz / fl;
          s.trotT = SHEEP.trotTime;
        }
      } else if (s.trotT > 0) {
        s.trotT -= dt;
        const k = clamp(s.trotT / SHEEP.trotTime, 0, 1);
        vx += s.trotX * SHEEP.trotSpeed * k;
        vz += s.trotZ * SHEEP.trotSpeed * k;
      }
      s.alertT = Math.max(0, s.alertT - dt);
      const alert = s.alertT > 0;

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
        const sepR = (SHEEP.separationRadius * (s.r + o.r)) / (2 * SHEEP.radius);
        if (od < sepR) {
          const k = (1 - od / sepR) * SHEEP.separation;
          sx -= (ox / (od || 1)) * k;
          sz -= (oz / (od || 1)) * k;
        }
        if (o.fear > 0.25 && od < 7) neighbourAlert = true;
      }
      if (neighbourAlert) s.alertT = Math.max(s.alertT, 0.8);
      const cohK = s.kind === 'black' ? 0.5 : lamb ? 0.3 : s.kind === 'ram' ? 0.4 : 1;
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
        const m = Math.hypot(p.mouth.x - s.x, p.mouth.z - s.z) > 4 ? p.mouth : p.inside;
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
        if (gd < 14) {
          const tgt = gd > 4 ? p.mouth : p.inside;
          vx += ((tgt.x - s.x) / (gd || 1)) * 3;
          vz += ((tgt.z - s.z) / (gd || 1)) * 3;
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
        if (depth > 0 && depth < 8.5 * p.scale && Math.abs(l.z) < 3 * p.scale + depth * 1.05) {
          const inside = p.inside;
          const gx = inside.x - s.x;
          const gz = inside.z - s.z;
          const gl = Math.hypot(gx, gz) || 1;
          const k = alert || (lamb && mother?.state === 'folded') ? 2.2 : 0;
          vx += (gx / gl) * k;
          vz += (gz / gl) * k;
        }
      }

      // Sheep settle wherever the dog (or a wolf) left them, then graze around that spot.
      if (alert || fear > 0.05) {
        s.homeX = s.x;
        s.homeZ = s.z;
      } else {
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
          const lat = clamp(-across * (onDeck ? 1.2 : 0.8), -3, 3);
          const dir = Math.abs(va) > 0.2 ? Math.sign(va) : -Math.sign(along);
          vx += -c.uz * lat + c.ux * dir * 1.3;
          vz += c.ux * lat + c.uz * dir * 1.3;
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
          vx += s.wanderX * SHEEP.grazeSpeed;
          vz += s.wanderZ * SHEEP.grazeSpeed;
        }
      } else {
        s.grazing = false;
        s.wanderT = this.rng.range(1, 3);
      }
      if (stubborn) {
        // Squared up to the dog: he holds his ground.
        vx *= 0.15;
        vz *= 0.15;
      }

      // Look ahead for obstacles, water and the valley edge.
      const av = this.avoidance(s, alert);
      vx += av.x;
      vz += av.z;

      const spdK = lamb ? 1.08 : s.kind === 'ram' ? 0.92 : 1;
      const cap = (s.panicT > 0 ? SHEEP.panicSpeed : fear > 0.02 || alert || s.trotT > 0 || orphan ? SHEEP.fleeSpeed : SHEEP.grazeSpeed * 1.3) * spdK;
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
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      collideStatic(L, s, { boundary: true, gate: false });
      this.keepDry(s);

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

  private avoidance(s: Sheep, alert: boolean) {
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
      const reach = g.r + s.r + (g.tag === 'boundary' ? 3 : 1.6);
      if (dd > reach) continue;
      const k = 1 - (dd - g.r - s.r) / (reach - g.r - s.r);
      const str = g.tag === 'boundary' ? 3 : 2;
      x += (dx / dd) * k * str;
      z += (dz / dd) * k * str;
    }
    // Water: sheep refuse to step in except on a bridge or at an open ford.
    if (!L.crossingAt(s.x, s.z)) {
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
      let score = toDog * 1.2 - toWolf * 0.6 + (this.level.inFold(s.x, s.z, -6) ? -40 : 0);
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
    let den = this.level.dens[0];
    let bd = Infinity;
    for (const dn of this.level.dens) {
      const toDog = Math.hypot(dn[0] - d.x, dn[1] - d.z);
      if (toDog < 30) continue;
      const dd = Math.hypot(dn[0] - s.x, dn[1] - s.z);
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
    };
    const slot = this.wolves.findIndex((o) => o.state === 'gone');
    if (slot >= 0) this.wolves[slot] = w;
    else this.wolves.push(w);
    this.events.push({ type: 'wolfSpawn', x: w.x, z: w.z, id: w.id, tx: s.x, tz: s.z });
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
      s.prevDry = !this.level.inWater(s.x, s.z);
      this.rescues++;
      this.snatchCd = Math.max(this.snatchCd, 8);
      this.events.push({ type: 'rescued', x: s.x, z: s.z, id: s.id });
    }
    w.state = 'flee';
    w.stateT = 0;
    w.target = null;
    this.events.push({ type: 'wolfScared', x: w.x, z: w.z, id: w.id });
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
      if (w.state === 'stalk' && w.target) {
        const s = w.target;
        const sx = s.x - w.x;
        const sz = s.z - w.z;
        const sd = Math.hypot(sx, sz) || 1;
        tx = sx / sd;
        tz = sz / sd;
        speed = WOLF.stalkSpeed * spd;
        if (dogD < WOLF.dogWaryRadius) {
          const k = 1 - dogD / WOLF.dogWaryRadius;
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
        const sheepToDog = Math.hypot(s.x - d.x, s.z - d.z);
        const seenLongEnough = w.valleyT > (w.id === 0 ? 10 : 6);
        const mayCharge = !someoneDragging && this.snatchCd <= 0 && seenLongEnough;
        if (mayCharge && sd < WOLF.chargeRange && sheepToDog > 8) {
          w.state = 'charge';
          w.stateT = 0;
          this.events.push({ type: 'charge', x: w.x, z: w.z, id: w.id });
        } else if (!mayCharge && sd < WOLF.lurkRange) {
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
          this.snatchCd = 12;
          w.state = 'drag';
          w.stateT = 0;
          s.state = 'grabbed';
          s.stateT = 0;
          s.panicT = 0;
          this.events.push({ type: 'grab', x: s.x, z: s.z, id: s.id });
        } else if (dogD < 7 || w.stateT > 4) {
          w.state = 'stalk';
          w.stateT = 0;
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
