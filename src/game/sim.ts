import { DIFFICULTIES, DOG, SHEEP, WOLF, type Difficulty, type DifficultyPreset } from './config';
import type { Input } from './input';
import type { Level } from './level';
import { clamp, closestOnSegment, dampAngle, invLerp, lerp, Rng } from './math';
import { collideStatic, separatePair, type Body } from './physics';

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
}

export type SheepState = 'graze' | 'walk' | 'alert' | 'flee' | 'panic' | 'grabbed' | 'folded' | 'lost';

export interface Sheep extends Body {
  id: number;
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
  | { type: 'bleat'; x: number; z: number; id: number; urgent: boolean }
  /** A wolf leaves the trees; (tx, tz) is the sheep it is after. */
  | { type: 'wolfSpawn'; x: number; z: number; id: number; tx: number; tz: number }
  | { type: 'wolfScared'; x: number; z: number; id: number }
  | { type: 'charge'; x: number; z: number; id: number }
  | { type: 'grab'; x: number; z: number; id: number }
  | { type: 'rescued'; x: number; z: number; id: number }
  | { type: 'lost'; x: number; z: number; id: number }
  | { type: 'dusk' }
  | { type: 'targetMet' }
  | { type: 'splash'; x: number; z: number; big: boolean };

export type Outcome =
  | { kind: 'win'; reason: 'all-home' | 'nightfall' | 'latched'; stars: number }
  | { kind: 'lose'; reason: 'nightfall' | 'wolves' };

export class Sim {
  readonly preset: DifficultyPreset;
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
  /** Current radius at which sheep start fleeing from the dog (for the UI ring). */
  dogThreatRadius = 0;
  /** Where and when each sheep was snatched (shown on the end card). */
  readonly lostLog: { t: number; x: number; z: number }[] = [];
  private duskAnnounced = false;
  private targetAnnounced = false;
  private nextWolfT = 0;
  private wolfIds = 0;
  /**
   * One snatch at a time: while a wolf is dragging a sheep, or shortly after a snatch, the others
   * only stalk. One dog must always be able to answer every snatch.
   */
  private snatchCd = 0;

  constructor(
    readonly level: Level,
    difficulty: Difficulty,
    seed: number,
  ) {
    this.preset = DIFFICULTIES[difficulty];
    this.rng = new Rng(seed);
    const [dx, dz] = level.data.dogStart;
    this.dog = {
      x: dx,
      z: dz,
      vx: 0,
      vz: 0,
      r: DOG.radius,
      facing: 0, // set below, towards the nearest flock; facing angle is atan2(vx, vz)
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
    };

    let id = 0;
    for (const g of level.data.sheepGroups) {
      const n = g.counts[difficulty];
      for (let i = 0; i < n; i++) {
        let x = 0;
        let z = 0;
        for (let tries = 0; tries < 30; tries++) {
          const p = this.rng.disc(g.radius);
          x = g.center[0] + p.x;
          z = g.center[1] + p.z;
          const clear =
            !level.inWater(x, z) &&
            this.sheep.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 > 2.2 * 2.2) &&
            level.circles.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > (c.r + 1.2) ** 2);
          if (clear) break;
        }
        this.sheep.push({
          id: id++,
          x,
          z,
          vx: 0,
          vz: 0,
          r: SHEEP.radius,
          state: 'graze',
          facing: this.rng.range(-Math.PI, Math.PI),
          speed: 0,
          fear: 0,
          panicT: 0,
          panicX: 0,
          panicZ: 0,
          alertT: 0,
          wanderT: this.rng.range(0.5, 5),
          wanderX: 0,
          wanderZ: 0,
          grazing: true,
          bleatT: this.rng.range(3, 14),
          foldedAt: -1,
          inWater: false,
          stateT: 0,
          prevDry: true,
          seed: this.rng.next(),
          trotX: 0,
          trotZ: 0,
          trotT: 0,
          homeX: x,
          homeZ: z,
        });
      }
    }
    this.total = this.sheep.length;
    this.target = this.total - this.preset.targetMissing;
    // Pip starts side-on to the camera, looking at the nearest flock: that is where to go first,
    // and a collie reads best in profile.
    let near = this.sheep[0];
    for (const s of this.sheep) if (Math.hypot(s.x - dx, s.z - dz) < Math.hypot(near.x - dx, near.z - dz)) near = s;
    if (near) this.dog.facing = Math.atan2(near.x - dx, near.z - dz);
  }

  /** 0 at golden hour, 1 at nightfall. */
  get t() {
    return clamp(this.elapsed / this.preset.dayLength, 0, 1);
  }
  get free() {
    return this.total - this.folded - this.lost;
  }
  get timeLeft() {
    return Math.max(0, this.preset.dayLength - this.elapsed);
  }
  get targetMet() {
    return this.folded >= this.target;
  }

  update(dt: number, input: Input | null) {
    if (this.outcome) return;
    this.elapsed += dt;
    this.updateDog(dt, input);
    this.updateSheep(dt);
    this.updateWolves(dt);
    this.checkRules(input);
  }

  // ---------------------------------------------------------------- dog

  private updateDog(dt: number, input: Input | null) {
    const d = this.dog;
    const mx = input?.moveX ?? 0;
    const mz = input?.moveZ ?? 0;
    const mag = Math.hypot(mx, mz);
    d.creeping = !!input?.creep;
    // Running dry locks sprint until a third of the bar has come back.
    if (d.stamina <= 0) d.sprintLock = true;
    else if (d.stamina > 33) d.sprintLock = false;
    d.sprinting = !!input?.sprint && mag > 0.1 && !d.creeping && !d.sprintLock && d.stamina > 0;

    let max = d.creeping ? DOG.creepSpeed : d.sprinting ? DOG.sprintSpeed : DOG.walkSpeed;
    const wasWet = d.inWater;
    d.inWater = this.level.inWater(d.x, d.z);
    if (d.inWater) max *= DOG.waterSpeedScale;
    if (d.inWater !== wasWet && d.speed > 2) this.events.push({ type: 'splash', x: d.x, z: d.z, big: true });

    const tvx = mx * max;
    const tvz = mz * max;
    const dvx = tvx - d.vx;
    const dvz = tvz - d.vz;
    const dl = Math.hypot(dvx, dvz);
    const step = DOG.accel * dt * (mag < 0.05 ? 1.4 : 1);
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
    if (d.speed > 0.4) d.facing = dampAngle(d.facing, Math.atan2(d.vx, d.vz), 14, dt);

    if (d.sprinting) {
      d.stamina = Math.max(0, d.stamina - DOG.staminaDrain * dt);
      d.staminaDelay = DOG.staminaRegenDelay;
    } else if (d.staminaDelay > 0) {
      d.staminaDelay -= dt;
    } else {
      d.stamina = Math.min(DOG.staminaMax, d.stamina + DOG.staminaRegen * dt);
    }

    d.barkCd = Math.max(0, d.barkCd - dt);
    d.sinceBark += dt;
    if (input?.pressed('bark') && d.barkCd <= 0) this.bark();
  }

  private bark() {
    const d = this.dog;
    d.barkCd = DOG.barkCooldown;
    d.sinceBark = 0;
    this.barks++;
    this.events.push({ type: 'bark', x: d.x, z: d.z });
    for (const s of this.sheep) {
      if (s.state === 'grabbed' || s.state === 'lost' || s.state === 'folded') continue;
      const dx = s.x - d.x;
      const dz = s.z - d.z;
      const dd = Math.hypot(dx, dz);
      if (dd < DOG.barkRadius) {
        s.panicT = SHEEP.panicTime * lerp(1, 0.55, dd / DOG.barkRadius);
        s.panicX = dx / (dd || 1);
        s.panicZ = dz / (dd || 1);
        s.alertT = 3;
      }
    }
    for (const w of this.wolves) {
      if (w.state === 'flee' || w.state === 'gone') continue;
      if (Math.hypot(w.x - d.x, w.z - d.z) < DOG.barkWolfRadius) this.scareWolf(w);
    }
  }

  // ---------------------------------------------------------------- sheep

  private updateSheep(dt: number) {
    const L = this.level;
    const d = this.dog;
    const flock = this.sheep;
    const dogR = d.creeping
      ? SHEEP.threatRadiusCreep
      : d.sprinting
        ? SHEEP.threatRadiusSprint
        : lerp(SHEEP.threatRadiusStill, SHEEP.threatRadius, clamp(d.speed / DOG.walkSpeed, 0, 1));
    this.dogThreatRadius = dogR;

    for (const s of flock) {
      s.stateT += dt;
      if (s.state === 'lost' || s.state === 'grabbed') continue;
      if (s.state === 'folded') {
        this.updateFoldedSheep(s, dt);
        continue;
      }

      let vx = 0;
      let vz = 0;
      let fear = 0;

      // Threats: the dog and any hunting wolf.
      const ddx = s.x - d.x;
      const ddz = s.z - d.z;
      const dd = Math.hypot(ddx, ddz);
      if (dd < dogR) {
        const w = 1 - dd / dogR;
        const sp = lerp(2.6, SHEEP.fleeSpeed, Math.pow(w, 0.6));
        vx += (ddx / (dd || 1)) * sp;
        vz += (ddz / (dd || 1)) * sp;
        fear = Math.max(fear, w);
      }
      for (const w of this.wolves) {
        if (w.state === 'gone' || w.state === 'flee') continue;
        const wx = s.x - w.x;
        const wz = s.z - w.z;
        const wd = Math.hypot(wx, wz);
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
      if (fear > 0.05) {
        s.alertT = Math.max(s.alertT, 1.2 + fear * 2);
        // Remember which way we were fleeing so we can trot on once the dog eases off.
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

      // Flocking with free neighbours.
      let n = 0;
      let cx = 0;
      let cz = 0;
      let ax = 0;
      let az = 0;
      let sx = 0;
      let sz = 0;
      let neighbourAlert = false;
      for (const o of flock) {
        if (o === s || o.state === 'lost' || o.state === 'grabbed' || o.state === 'folded') continue;
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
        if (od < SHEEP.separationRadius) {
          const k = (1 - od / SHEEP.separationRadius) * SHEEP.separation;
          sx -= (ox / (od || 1)) * k;
          sz -= (oz / (od || 1)) * k;
        }
        if (o.fear > 0.25 && od < 7) neighbourAlert = true;
      }
      if (neighbourAlert) s.alertT = Math.max(s.alertT, 0.8);
      if (n > 0) {
        cx /= n;
        cz /= n;
        ax /= n;
        az /= n;
        const coh = alert ? SHEEP.cohesionAlert : SHEEP.cohesion * 0.35;
        const tx = cx - s.x;
        const tz = cz - s.z;
        const tl = Math.hypot(tx, tz);
        // Pull towards the group, stronger when far, capped so it never beats fear.
        const pull = Math.min(tl * 0.35, alert ? 3 : 0.8) * coh;
        if (tl > 1.5) {
          vx += (tx / tl) * pull;
          vz += (tz / tl) * pull;
        }
        if (alert) {
          vx += ax * SHEEP.alignment * 0.6;
          vz += az * SHEEP.alignment * 0.6;
        }
      }
      vx += sx;
      vz += sz;

      // Sheep inside the guide-fence funnel smell hay and their flockmates: a pull into the fold.
      // Only inside the funnel, and only a nudge unless they are already being driven.
      const f = L.fold;
      const depth = f.minX + 0.5 - s.x; // metres out from the gate
      if (depth > 0 && depth < 8.5 && Math.abs(s.z - f.cz) < 3 + depth * 1.05) {
        const gx = f.minX + 4 - s.x;
        const gz = f.cz - s.z;
        const gl = Math.hypot(gx, gz) || 1;
        // Only sheep that are being driven take the last steps in; grazers do not wander home.
        const k = alert ? 2.2 : 0;
        vx += (gx / gl) * k;
        vz += (gz / gl) * k;
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

      // Driven sheep near a bridge end or the ford line up with it, the way a flock funnels
      // onto a path. Without this the outer sheep of a group jam against the railings.
      if (alert || fear > 0.05) {
        for (const c of L.crossings) {
          const dx = s.x - c.x;
          const dz = s.z - c.z;
          const along = dx * c.ux + dz * c.uz;
          const across = -dx * c.uz + dz * c.ux;
          const half = c.len / 2;
          if (Math.abs(along) > half + 9 || Math.abs(across) > c.w / 2 + 7) continue;
          const va = s.vx * c.ux + s.vz * c.uz;
          const onDeck = Math.abs(along) <= half;
          if (!onDeck && along * va >= 0) continue; // not heading onto it
          const lat = clamp(-across * (onDeck ? 1.2 : 0.8), -3, 3);
          const dir = Math.abs(va) > 0.2 ? Math.sign(va) : -Math.sign(along);
          vx += -c.uz * lat + c.ux * dir * 1.3;
          vz += c.ux * lat + c.uz * dir * 1.3;
        }
      }

      // Calm grazing: short strolls, long pauses.
      if (!alert && fear < 0.05) {
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

      // Look ahead for obstacles, water and the valley edge.
      const av = this.avoidance(s, alert);
      vx += av.x;
      vz += av.z;

      // Cap desired speed by state.
      const cap = s.panicT > 0 ? SHEEP.panicSpeed : fear > 0.02 || alert || s.trotT > 0 ? SHEEP.fleeSpeed : SHEEP.grazeSpeed * 1.3;
      const vl = Math.hypot(vx, vz);
      if (vl > cap) {
        vx = (vx / vl) * cap;
        vz = (vz / vl) * cap;
      }
      // Very small desires resolve to standing still (grazing).
      if (vl < 0.12) {
        vx = 0;
        vz = 0;
      }

      const accel = SHEEP.accel * (fear > 0.1 ? 1.4 : 0.6);
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
      if (s.speed > 0.25) s.facing = dampAngle(s.facing, Math.atan2(s.vx, s.vz), 7, dt);
      else if (fear > 0.05 || alert) s.facing = dampAngle(s.facing, Math.atan2(d.x - s.x, d.z - s.z), 3, dt);

      const prev = s.state;
      s.state = s.panicT > 0 ? 'panic' : fear > 0.05 ? 'flee' : alert ? 'alert' : s.grazing ? 'graze' : 'walk';
      if (s.state !== prev) s.stateT = 0;

      s.bleatT -= dt * (fear > 0.3 ? 3 : 1);
      if (s.bleatT <= 0) {
        s.bleatT = this.rng.range(6, 18);
        this.events.push({ type: 'bleat', x: s.x, z: s.z, id: s.id, urgent: fear > 0.3 });
      }

      // Home as soon as it is through the gate; folded sheep then wander deeper in.
      if (s.x > f.minX + 0.5 && s.x < f.maxX && s.z > f.minZ && s.z < f.maxZ) this.foldSheep(s);
    }

    // Bodies push each other apart; the dog barely moves when shoved.
    for (let i = 0; i < flock.length; i++) {
      const a = flock[i];
      if (a.state === 'lost' || a.state === 'grabbed') continue;
      for (let j = i + 1; j < flock.length; j++) {
        const b = flock[j];
        if (b.state === 'lost' || b.state === 'grabbed') continue;
        separatePair(a, b);
      }
      // Folded sheep are penned in (clamped), so Pip shares the shove with them.
      separatePair(d, a, a.state === 'folded' ? 0.5 : 0.12);
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
      // Push away and slightly sideways (relative to motion) so the flock flows around rocks.
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
    // Water: sheep refuse to step in except on the bridge or at the ford.
    const onCrossing = L.crossingAt(s.x, s.z);
    if (!onCrossing) {
      const w = L.streamQuery(s.x, s.z);
      const edge = L.streamHalf + s.r;
      const reach = SHEEP.waterAvoid * (alert ? 0.7 : 1.2);
      if (w.d < edge + reach) {
        const k = clamp(1 - (w.d - edge) / reach, 0, 1.5);
        x += w.nx * k * 3.2;
        z += w.nz * k * 3.2;
      }
    }
    return { x, z };
  }

  /** Sheep cannot walk into the stream from dry land except at a crossing. */
  private keepDry(s: Sheep) {
    const L = this.level;
    const w = L.streamQuery(s.x, s.z);
    const edge = L.streamHalf + s.r * 0.5;
    const wet = w.d < edge && !L.onBridge(s.x, s.z);
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
      s.x = w.cx + w.nx * edge;
      s.z = w.cz + w.nz * edge;
      const vn = s.vx * w.nx + s.vz * w.nz;
      if (vn < 0) {
        s.vx -= vn * w.nx;
        s.vz -= vn * w.nz;
      }
    } else {
      // Drifted out of the ford while wading: wade out towards the nearest bank.
      s.x += w.nx * 0.08;
      s.z += w.nz * 0.08;
    }
  }

  private foldSheep(s: Sheep) {
    s.state = 'folded';
    s.stateT = 0;
    s.panicT = 0;
    s.fear = 0;
    s.alertT = 0;
    s.foldedAt = this.elapsed;
    s.wanderT = this.rng.range(0.5, 2);
    this.folded++;
    this.events.push({ type: 'folded', x: s.x, z: s.z, id: s.id, count: this.folded });
  }

  private updateFoldedSheep(s: Sheep, dt: number) {
    const L = this.level;
    const f = L.fold;
    s.wanderT -= dt;
    let vx = 0;
    let vz = 0;
    // Walk well inside first, then potter about near the hay.
    if (s.x < f.minX + 4) {
      vx += 1.6;
      vz += (f.cz - s.z) * 0.1;
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
    if (!s.grazing && s.x >= f.minX + 4) {
      vx += s.wanderX * 0.6;
      vz += s.wanderZ * 0.6;
    }
    for (const o of this.sheep) {
      if (o === s || o.state !== 'folded') continue;
      const ox = s.x - o.x;
      const oz = s.z - o.z;
      const od = Math.hypot(ox, oz);
      if (od < 2.2 && od > 0) {
        vx += (ox / od) * (2.2 - od) * 1.5;
        vz += (oz / od) * (2.2 - od) * 1.5;
      }
    }
    s.vx = lerp(s.vx, vx, 1 - Math.exp(-4 * dt));
    s.vz = lerp(s.vz, vz, 1 - Math.exp(-4 * dt));
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    collideStatic(L, s, { boundary: true, gate: true });
    s.x = clamp(s.x, f.minX + 0.9, f.maxX - 0.9);
    s.z = clamp(s.z, f.minZ + 0.9, f.maxZ - 0.9);
    s.speed = Math.hypot(s.vx, s.vz);
    if (s.speed > 0.2) s.facing = dampAngle(s.facing, Math.atan2(s.vx, s.vz), 5, dt);
    s.inWater = false;
  }

  // ---------------------------------------------------------------- wolves

  private allowedWolves() {
    const p = this.preset;
    if (this.t < p.wolfStart) return 0;
    const k = invLerp(p.wolfStart, 0.85, this.t);
    return Math.max(1, Math.round(lerp(1, p.maxWolves, k)));
  }

  private pickTarget(fromX: number, fromZ: number): Sheep | null {
    const d = this.dog;
    let best: Sheep | null = null;
    let bestScore = -Infinity;
    for (const s of this.sheep) {
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'grabbed') continue;
      if (this.wolves.some((w) => w.target === s && w.state !== 'gone' && w.state !== 'flee')) continue;
      const toDog = Math.hypot(s.x - d.x, s.z - d.z);
      const toWolf = Math.hypot(s.x - fromX, s.z - fromZ);
      const score = toDog * 1.2 - toWolf * 0.6 + (this.level.inFold(s.x, s.z, -6) ? -40 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  private spawnWolf() {
    // Usually the sheep the dog is furthest from. The day's first wolf instead goes for the flock
    // Pip is working, so the player meets it on screen before any sheep is lost.
    const d = this.dog;
    const first = this.wolfIds === 0;
    let s = this.pickTarget(d.x, d.z);
    if (first) {
      let bd = Infinity;
      for (const q of this.sheep) {
        if (q.state === 'folded' || q.state === 'lost' || q.state === 'grabbed') continue;
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
    this.nextWolfT = Math.max(this.nextWolfT, this.rng.range(...this.preset.wolfRespawn));
  }

  private updateWolves(dt: number) {
    const allowed = this.allowedWolves();
    if (allowed === 0) this.nextWolfT = 5; // first howl, then a short pause before the first wolf
    const active = this.wolves.filter((w) => w.state !== 'gone').length;
    this.nextWolfT -= dt;
    if (active < allowed && this.nextWolfT <= 0 && this.free > 0) {
      this.spawnWolf();
      this.nextWolfT = this.rng.range(...this.preset.wolfRespawn);
    }

    const d = this.dog;
    const spd = this.preset.wolfSpeedScale;
    this.snatchCd = Math.max(0, this.snatchCd - dt);
    const someoneDragging = this.wolves.some((o) => o.state === 'drag');
    for (const w of this.wolves) {
      if (w.state === 'gone') continue;
      w.stateT += dt;

      // Touching the dog always sends a wolf running.
      if (w.state !== 'flee' && Math.hypot(w.x - d.x, w.z - d.z) < DOG.wolfScareTouch) this.scareWolf(w);

      let tx = 0;
      let tz = 0;
      let speed = 0;
      const t = w.target;
      if ((w.state === 'stalk' || w.state === 'charge') && (!t || t.state === 'folded' || t.state === 'lost' || t.state === 'grabbed')) {
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
          // Circle away from the dog while still sneaking towards the sheep.
          const k = 1 - dogD / WOLF.dogWaryRadius;
          tx += (dogDx / dogD) * k * 2.2;
          tz += (dogDz / dogD) * k * 2.2;
        }
        const sheepToDog = Math.hypot(s.x - d.x, s.z - d.z);
        // A wolf has to be seen creeping through the valley for a while before it may charge.
        const seenLongEnough = w.valleyT > (w.id === 0 ? 10 : 6);
        const mayCharge = !someoneDragging && this.snatchCd <= 0 && seenLongEnough;
        if (mayCharge && sd < WOLF.chargeRange && sheepToDog > 8) {
          w.state = 'charge';
          w.stateT = 0;
          this.events.push({ type: 'charge', x: w.x, z: w.z, id: w.id });
        } else if (!mayCharge && sd < WOLF.lurkRange) {
          // Not allowed to strike yet: lurk outside the flock's fear radius, circling. Close enough
          // to be a visible threat, far enough that the flock can still be driven.
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
        // The sheep struggles for a moment before the wolf gets it moving: time for Pip to react.
        speed = this.dragSpeedFor(w) * clamp((w.stateT - 0.4) / 1.2, 0.2, 1);
        const s = w.target;
        // The sheep hangs from the wolf's jaws, slightly behind its nose.
        s.x = w.x + Math.sin(w.facing) * 1.1;
        s.z = w.z + Math.cos(w.facing) * 1.1;
        s.vx = w.vx;
        s.vz = w.vz;
        s.facing = w.facing + Math.PI * 0.5;
        if (!this.level.insideValley(w.x, w.z) && this.level.boundaryDistance(w.x, w.z) > WOLF.lostDepth) {
          s.state = 'lost';
          s.stateT = 0;
          this.lost++;
          this.lostLog.push({ t: this.elapsed, x: s.x, z: s.z });
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
      collideStatic(this.level, w, { boundary: false, gate: false });
      w.speed = Math.hypot(w.vx, w.vz);
      // Dragging wolves back away towards the trees, facing their prey (and the valley).
      if (w.state === 'drag') w.facing = dampAngle(w.facing, Math.atan2(-w.vx, -w.vz), 4, dt);
      else if (w.speed > 0.3) w.facing = dampAngle(w.facing, Math.atan2(w.vx, w.vz), 10, dt);
    }
  }

  /**
   * How fast a wolf drags its prey: slower the further Pip is (a heavy sheep and a long way to
   * go), so a snatch across the valley can still be answered.
   */
  dragSpeedFor(w: Wolf) {
    const d = this.dog;
    const far = Math.hypot(w.x - d.x, w.z - d.z);
    return WOLF.dragSpeed * this.preset.wolfSpeedScale * lerp(1, 0.55, clamp((far - 25) / 60, 0, 1));
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
   * then at a walk, plus a moment to wade if the stream is in the way.
   */
  rescueEta(x: number, z: number) {
    const d = this.dog;
    const L = this.level;
    let dist = Math.max(0, Math.hypot(x - d.x, z - d.z) - DOG.barkWolfRadius * 0.85);
    const sideA = L.streamQuery(d.x, d.z).nx;
    const sideB = L.streamQuery(x, z).nx;
    const wade = Math.sign(sideA) !== Math.sign(sideB) ? 1 : 0;
    const sprintFor = d.sprintLock ? 0 : d.stamina / DOG.staminaDrain;
    const sprintDist = sprintFor * DOG.sprintSpeed;
    if (dist <= sprintDist) return dist / DOG.sprintSpeed + wade;
    dist -= sprintDist;
    return sprintFor + dist / DOG.walkSpeed + wade;
  }

  // ---------------------------------------------------------------- rules

  private checkRules(input: Input | null) {
    if (!this.duskAnnounced && this.t >= this.preset.wolfStart) {
      this.duskAnnounced = true;
      this.events.push({ type: 'dusk' });
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

  stars() {
    if (this.folded >= this.total) return 3;
    return this.folded >= Math.ceil((this.target + this.total) / 2) ? 2 : 1;
  }

  private finish(o: Outcome) {
    this.outcome = o;
    this.dog.vx = 0;
    this.dog.vz = 0;
  }
}
