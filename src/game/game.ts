import * as THREE from 'three';
import { moodTime } from '../render/daycycle';
import { Stage } from '../render/stage';
import { Indicators, type Marker } from '../ui/indicators';
import { PerfOverlay } from '../ui/perf';
import { Ui, type UiAction } from '../ui/ui';
import { GreyboxActors } from '../world/actors-greybox';
import { buildGreybox } from '../world/greybox';
import { Terrain } from '../world/terrain';
import type { Difficulty } from './config';
import { Input } from './input';
import { Level } from './level';
import { Sim, type SimEvent } from './sim';

// Top-level state machine: title -> playing <-> paused -> ended -> (restart | title).

export type Mode = 'title' | 'playing' | 'paused' | 'ended';

export interface GameOptions {
  seed: number;
  test: boolean;
  difficulty?: Difficulty;
}

export class Game {
  readonly level = new Level();
  readonly terrain = new Terrain(this.level);
  readonly input = new Input();
  readonly stage: Stage;
  readonly ui: Ui;
  readonly actors: GreyboxActors;
  readonly indicators: Indicators;
  mode: Mode = 'title';
  sim: Sim | null = null;
  timeScale = 1;
  private last = 0;
  private clock = 0;
  private titleAngle = 0;
  private runs = 0;
  private howtoFrom: Mode | null = null;
  /** Pulse a beacon at the fold gate while latching is available. */
  private gateGlow = false;

  constructor(
    host: HTMLElement,
    private opts: GameOptions,
  ) {
    this.stage = new Stage(host);
    this.stage.scene.add(buildGreybox(this.level, this.terrain));
    this.actors = new GreyboxActors(this.terrain, this.level);
    this.stage.scene.add(this.actors.root);
    this.ui = new Ui(this.level);
    this.indicators = new Indicators(this.ui.root.querySelector('.hud') as HTMLElement);
    if (opts.difficulty) this.ui.setDifficulty(opts.difficulty);
    this.ui.onAction = (a) => this.onUi(a);
    this.toTitle();
  }

  start() {
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }

  private onUi(a: UiAction) {
    switch (a) {
      case 'play':
      case 'restart':
        this.newDay();
        break;
      case 'resume':
        this.setMode('playing');
        break;
      case 'title':
        this.toTitle();
        break;
      case 'howto':
        this.howtoFrom = this.mode;
        this.ui.show('howto');
        break;
      case 'close-howto':
        this.ui.show(this.howtoFrom === 'paused' ? 'pause' : this.howtoFrom === 'title' ? 'title' : null);
        this.howtoFrom = null;
        break;
    }
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.input.setEnabled(m === 'playing');
    this.ui.showHud(m === 'playing' || m === 'paused');
    if (m === 'playing') this.ui.show(null);
    if (m === 'paused') this.ui.show('pause');
  }

  toTitle() {
    this.sim = null;
    this.setMode('title');
    this.ui.show('title');
    this.ui.clearToasts();
  }

  newDay() {
    this.runs++;
    const seed = this.opts.seed + this.runs - 1;
    this.sim = new Sim(this.level, this.ui.difficulty, seed);
    const d = this.sim.dog;
    this.stage.snapTo(d.x, this.terrain.height(d.x, d.z), d.z);
    this.ui.clearToasts();
    this.gateGlow = false;
    this.warnedAt.clear();
    this.tipsShown.clear();
    this.ui.prompt(null);
    this.tip('move', 'WASD to move · get behind the sheep to drive them', 10, 0);
    this.ui.toast(`Bring at least ${this.sim.target} of ${this.sim.total} sheep home before dark`, 'info');
    this.setMode('playing');
  }

  private frameMs: number[] = [];

  /** Average frames per second over the last ~2 seconds of real frames. */
  fps() {
    if (this.frameMs.length === 0) return 0;
    return 1000 / (this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length);
  }

  perf: PerfOverlay | null = null;

  private frame(now: number) {
    this.perf?.frame(now - this.last);
    this.frameMs.push(now - this.last);
    if (this.frameMs.length > 120) this.frameMs.shift();
    const rawDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const dt = rawDt * this.timeScale;
    this.clock += rawDt;
    this.input.poll();
    this.tick(dt, rawDt);
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  private tick(dt: number, rawDt: number) {
    const input = this.input;
    const sim = this.sim;

    if (this.mode === 'title') {
      if (input.pressed('confirm') && this.howtoFrom === null) this.newDay();
    } else if (this.mode === 'playing' && sim) {
      if (input.pressed('pause')) {
        this.setMode('paused');
      } else {
        // Fixed-ish substeps keep the flocking stable at low frame rates.
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        for (let i = 0; i < steps; i++) sim.update(dt / steps, input);
        this.handleEvents(sim.events);
        sim.events.length = 0;
        this.updateHints(sim, dt);
        if (sim.outcome) {
          this.setMode('ended');
          this.ui.showEnd(sim.outcome, sim);
        }
      }
    } else if (this.mode === 'paused') {
      if (input.pressed('pause') && this.howtoFrom === null) this.setMode('playing');
    } else if (this.mode === 'ended') {
      if (input.pressed('confirm')) this.newDay();
    }

    this.actors.root.visible = !!sim;
    if (sim) {
      this.actors.sync(sim, this.mode === 'paused' ? 0 : rawDt, this.gateGlow && this.mode === 'playing');
      this.ui.update(sim, this.mode === 'paused' ? 0 : rawDt, this.clock);
      this.frameCamera(sim);
      this.stage.applyMood(moodTime(sim.t, sim.preset.wolfStart));
    } else {
      // Title: slow orbit over the valley at golden hour.
      this.titleAngle += rawDt * 0.05;
      this.stage.setFocusGoal(Math.sin(this.titleAngle) * 30, 0, Math.cos(this.titleAngle) * 20, 1.4);
      this.stage.applyMood(0.3);
    }
    this.stage.updateCamera(this.mode === 'paused' ? 0 : rawDt);
    if (sim && (this.mode === 'playing' || this.mode === 'paused')) this.indicators.update(this.stage.camera, this.markers(sim));
    else this.indicators.clear();
    this.stage.render();
  }

  /**
   * Keep Pip and the sheep he is working in one frame: the focus leans towards the nearby flock
   * and the camera pulls back as the group spreads, so the way ahead stays visible.
   */
  private frameCamera(sim: Sim) {
    const d = sim.dog;
    let fx = d.x + d.vx * 0.35;
    let fz = d.z + d.vz * 0.35;
    let minX = d.x;
    let maxX = d.x;
    let minZ = d.z;
    let maxZ = d.z;
    let n = 0;
    let cx = 0;
    let cz = 0;
    for (const s of sim.sheep) {
      if (s.state === 'lost' || s.state === 'folded') continue;
      if ((s.x - d.x) ** 2 + (s.z - d.z) ** 2 > 26 * 26) continue;
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
      cx += s.x;
      cz += s.z;
      n++;
    }
    let zoom = 1;
    if (n > 0) {
      cx /= n;
      cz /= n;
      // Bring the next landmark into shot (fold gate, bridge or ford) when the flock is near it.
      const L = this.level;
      let best: { x: number; z: number } | null = null;
      let bd = 40 * 40;
      for (const p of [L.fold.mouth, L.bridge, L.ford]) {
        const dd = (p.x - cx) ** 2 + (p.z - cz) ** 2;
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      if (best) {
        minX = Math.min(minX, best.x);
        maxX = Math.max(maxX, best.x);
        minZ = Math.min(minZ, best.z);
        maxZ = Math.max(maxZ, best.z);
      }
      const bx = (minX + maxX) / 2;
      const bz = (minZ + maxZ) / 2;
      fx += (bx - fx) * 0.45;
      fz += (bz - fz) * 0.45;
      // At zoom 1 the view spans about +-27 m across, 15 m towards the camera, 26 m away from it.
      const halfW = Math.max(maxX - fx, fx - minX) + 5;
      const south = maxZ - fz + 4;
      const north = fz - minZ + 4;
      zoom = Math.min(1.55, Math.max(1, halfW / 27, south / 15, north / 26));
    }
    if (d.sprinting) zoom = Math.max(zoom, 1.08);
    this.stage.setFocusGoal(fx, this.terrain.height(d.x, d.z), fz, zoom);
  }

  private markers(sim: Sim): Marker[] {
    const h = (x: number, z: number) => this.terrain.height(x, z);
    const f = this.level.fold;
    const out: Marker[] = [
      { id: 'fold', kind: 'fold', x: f.minX + 2, y: h(f.minX, f.cz) + 3, z: f.cz, labelOnScreen: sim.elapsed < 45 ? 'Fold' : undefined },
    ];
    for (const s of sim.sheep) {
      if (s.state === 'grabbed') out.push({ id: `g${s.id}`, kind: 'grab', x: s.x, y: h(s.x, s.z) + 1, z: s.z });
    }
    for (const w of sim.wolves) {
      if (w.state === 'stalk' || w.state === 'charge') out.push({ id: `w${w.id}`, kind: 'wolf', x: w.x, y: h(w.x, w.z) + 1, z: w.z });
    }
    // If no loose sheep is in view, point at the nearest one.
    const cam = this.stage.camera;
    const d = sim.dog;
    let nearest: (typeof sim.sheep)[number] | null = null;
    let nd = Infinity;
    let anyVisible = false;
    for (const s of sim.sheep) {
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'grabbed') continue;
      tmpV.set(s.x, h(s.x, s.z) + 0.8, s.z).project(cam);
      if (tmpV.z < 1 && Math.abs(tmpV.x) < 0.95 && Math.abs(tmpV.y) < 0.92) anyVisible = true;
      const dd = (s.x - d.x) ** 2 + (s.z - d.z) ** 2;
      if (dd < nd) {
        nd = dd;
        nearest = s;
      }
    }
    if (!anyVisible && nearest) out.push({ id: 'stray', kind: 'sheep', x: nearest.x, y: h(nearest.x, nearest.z) + 1, z: nearest.z });
    return out;
  }

  private handleEvents(events: SimEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'dusk':
          this.ui.toast('The sun is setting. Wolves are stirring in the pines.', 'warn');
          break;
        case 'wolfSpawn':
          this.ui.toast(`A wolf is prowling ${compass(e.x, e.z, this.sim?.dog.x, this.sim?.dog.z)}!`, 'warn');
          break;
        case 'grab': {
          this.ui.toast(`A wolf has a sheep ${compass(e.x, e.z, this.sim?.dog.x, this.sim?.dog.z)}! Chase it down!`, 'danger');
          this.stage.addShake(0.35);
          // Show the snatch: lean the camera towards it if it happened away from Pip.
          const d = this.sim?.dog;
          if (d && Math.hypot(e.x - d.x, e.z - d.z) > 14) this.stage.glance(e.x, e.z);
          break;
        }
        case 'lost':
          this.ui.toast('A sheep was dragged into the woods.', 'danger');
          break;
        case 'rescued':
          this.ui.toast('Sheep rescued!', 'good');
          break;
        case 'targetMet':
          this.ui.toast('Enough sheep are home! Bring the rest, or press Enter to latch the gate.', 'good');
          break;
        case 'bark':
          this.stage.addShake(0.12);
          break;
        default:
          break;
      }
    }
  }

  private warnedAt = new Set<number>();
  private tipsShown = new Set<string>();
  private tipUntil = 0;
  private farT = 0;

  /** Show a tutorial tip once, for `seconds` of play. */
  private tip(id: string, text: string, seconds: number, now: number) {
    if (this.tipsShown.has(id)) return;
    this.tipsShown.add(id);
    this.ui.hint(text);
    this.tipUntil = now + seconds;
  }

  /** Tips fire when the situation they explain comes up; the latch prompt shows once it matters. */
  private updateHints(sim: Sim, dt: number) {
    const t = sim.elapsed;
    const d = sim.dog;
    // Nightfall warnings.
    for (const s of [60, 30]) {
      if (sim.timeLeft <= s && !this.warnedAt.has(s)) {
        this.warnedAt.add(s);
        const what = sim.targetMet ? 'latch the gate or bring the rest in!' : `${Math.max(0, sim.target - sim.folded)} more sheep needed!`;
        this.ui.toast(s === 60 ? `One minute until nightfall: ${what}` : `Night falls in 30 seconds: ${what}`, 'danger');
      }
    }

    const grabbed = sim.sheep.some((s) => s.state === 'grabbed');
    this.gateGlow = sim.targetMet && sim.free > 0 && !grabbed;
    this.ui.prompt(this.gateGlow ? 'Target met! Press <kbd>Enter</kbd> to latch the gate and end the day, or keep herding for more stars' : null);

    const wolvesOut = sim.t >= sim.preset.wolfStart;
    let nearest = Infinity;
    for (const s of sim.sheep) {
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'grabbed') continue;
      nearest = Math.min(nearest, Math.hypot(s.x - d.x, s.z - d.z));
    }
    if (!wolvesOut && nearest < 22) {
      this.tip('ring', "The pale ring is Pip's reach: sheep inside it run away. Hold C to creep and shrink it", 9, t);
    }
    this.farT = nearest > 45 && nearest < Infinity ? this.farT + dt : 0;
    if (!wolvesOut && this.farT > 3 && this.tipsShown.has('ring')) {
      this.tip('sprint', 'Long way to the next sheep? Hold Shift to sprint', 6, t);
    }
    if (sim.wolves.some((w) => w.state === 'stalk' || w.state === 'charge')) {
      this.tip('wolf', 'Wolf! Run at it, or bark with Space, to make it drop its prey', 9, t);
    }
    if (this.tipUntil > 0 && t > this.tipUntil) {
      this.tipUntil = 0;
      this.ui.hint('');
    }
  }

  /** Debug snapshot for the Playwright bot. */
  snapshot() {
    const s = this.sim;
    return {
      mode: this.mode,
      fps: Math.round(this.fps() * 10) / 10,
      difficulty: this.ui.difficulty,
      outcome: s?.outcome ?? null,
      t: s?.t ?? 0,
      elapsed: s?.elapsed ?? 0,
      folded: s?.folded ?? 0,
      lost: s?.lost ?? 0,
      total: s?.total ?? 0,
      target: s?.target ?? 0,
      dog: s ? { x: s.dog.x, z: s.dog.z, vx: s.dog.vx, vz: s.dog.vz, stamina: s.dog.stamina, barkCd: s.dog.barkCd } : null,
      sheep: s ? s.sheep.map((q) => ({ id: q.id, x: q.x, z: q.z, state: q.state })) : [],
      wolves: s ? s.wolves.filter((w) => w.state !== 'gone').map((w) => ({ id: w.id, x: w.x, z: w.z, state: w.state })) : [],
    };
  }
}

const tmpV = new THREE.Vector3();

/** Direction of (x, z) as seen from (ox, oz), e.g. "to the north-west". */
function compass(x: number, z: number, ox = 0, oz = 0) {
  const a = Math.atan2(x - ox, -(z - oz)); // 0 = north
  const names = ['to the north', 'to the north-east', 'to the east', 'to the south-east', 'to the south', 'to the south-west', 'to the west', 'to the north-west'];
  const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[i];
}
