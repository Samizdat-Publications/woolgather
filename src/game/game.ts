import * as THREE from 'three';
import { moodTime } from '../render/daycycle';
import { Stage } from '../render/stage';
import { WolfCam } from '../render/wolfcam';
import { hudState, Indicators, type Marker } from '../ui/indicators';
import { PerfOverlay } from '../ui/perf';
import { Ui, type UiAction } from '../ui/ui';
import { Actors } from '../world/actors';
import { loadAssets } from '../world/assets';
import { Terrain } from '../world/terrain';
import { buildWorld, updateWorld, type WorldHandles } from '../world/world';
import { DOG, type Difficulty } from './config';
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
  readonly indicators: Indicators;
  readonly wolfCam: WolfCam;
  actors: Actors | null = null;
  world: WorldHandles | null = null;
  mode: Mode = 'title';
  sim: Sim | null = null;
  timeScale = 1;
  /** True once every Blender asset is loaded and the valley is built. */
  ready = false;
  private last = 0;
  private clock = 0;
  private titleAngle = 0;
  private runs = 0;
  private howtoFrom: Mode | null = null;
  /** Latching is available (the target is met and sheep are still out).  */
  private gateGlow = false;
  /** 1 = gate leaves wide open, 0 = shut (they swing shut when the day is won). */
  private gateOpen = 1;
  private gateTarget = 1;
  /** Seconds until the end card appears (lets the player see the gate close / night fall). */
  private endCardT = 0;

  constructor(
    host: HTMLElement,
    private opts: GameOptions,
  ) {
    this.stage = new Stage(host);
    this.ui = new Ui(this.level);
    this.indicators = new Indicators(this.ui.root.querySelector('.hud') as HTMLElement);
    this.wolfCam = new WolfCam(this.ui.root.querySelector('.hud') as HTMLElement);
    if (opts.difficulty) this.ui.setDifficulty(opts.difficulty);
    this.ui.onAction = (a) => this.onUi(a);
    this.toTitle();
  }

  /** Load the Blender assets and build the valley. */
  async init(onProgress: (done: number, total: number) => void) {
    const assets = await loadAssets(onProgress);
    this.terrain.setData(assets.heightField, assets.meta);
    this.world = buildWorld(this.level, this.terrain, assets);
    this.stage.scene.add(this.world.root);
    this.actors = new Actors(assets, this.terrain);
    this.stage.scene.add(this.actors.root);
    this.ready = true;
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
    if (!this.ready) return;
    this.runs++;
    this.gateOpen = this.gateTarget = 1;
    this.endCardT = 0;
    const seed = this.opts.seed + this.runs - 1;
    this.sim = new Sim(this.level, this.ui.difficulty, seed);
    const d = this.sim.dog;
    this.stage.snapTo(d.x, this.terrain.height(d.x, d.z), d.z);
    this.ui.clearToasts();
    this.gateGlow = false;
    this.warnedAt.clear();
    this.tipsShown.clear();
    this.stalkWarned.clear();
    this.dragFeasible = null;
    this.ui.prompt(null);
    // The counter states the target; the first tip is about moving.
    this.tip('move', 'WASD to move · get behind the sheep to drive them', 10, 0);
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
          // A win swings the gate shut; the card follows once the moment has landed.
          if (sim.outcome.kind === 'win') this.gateTarget = 0;
          this.endCardT = 1.2;
        }
      }
    } else if (this.mode === 'paused') {
      if (input.pressed('pause') && this.howtoFrom === null) this.setMode('playing');
    } else if (this.mode === 'ended') {
      if (this.endCardT > 0) {
        this.endCardT -= rawDt;
        if (this.endCardT <= 0 && sim?.outcome) this.ui.showEnd(sim.outcome, sim);
      } else if (input.pressed('confirm')) this.newDay();
    }

    if (!this.ready || !this.world || !this.actors) {
      this.stage.render();
      return;
    }
    this.actors.root.visible = !!sim;
    let mood;
    if (sim) {
      mood = this.stage.applyMood(moodTime(sim.t, sim.preset.wolfStart, sim.preset.dayLength));
      this.actors.sync(sim, this.mode === 'paused' ? 0 : rawDt, mood, this.mode === 'playing');
      this.ui.update(sim, this.mode === 'paused' ? 0 : rawDt, this.clock);
      this.ui.minimap.setMood(mood.t);
      if (this.mode === 'ended' && sim.outcome?.kind === 'win') {
        // Look at the fold while the gate closes.
        const f = this.level.fold;
        this.stage.setFocusGoal(f.minX + 1, this.terrain.ground(f.cx, f.cz), f.cz, 1.1);
      } else {
        this.frameCamera(sim);
      }
    } else {
      // Title: a low shot across the valley into the golden-hour sun, drifting slowly to and fro.
      this.titleAngle += rawDt * 0.04;
      this.stage.setTitleShot(-10, this.terrain.ground(-10, 4) + 1, 4, 0.1 + Math.sin(this.titleAngle) * 0.2);
      mood = this.stage.applyMood(0.28);
    }
    this.gateOpen += (this.gateTarget - this.gateOpen) * (1 - Math.exp(-3.5 * rawDt));
    const open = this.gateOpen * 1.65;
    if (this.world.gateN) this.world.gateN.rotation.y = open;
    if (this.world.gateS) this.world.gateS.rotation.y = -open;
    this.stage.updateCamera(this.mode === 'paused' ? 0 : rawDt);
    updateWorld(this.world, mood, this.clock, this.stage.camera, sim ? this.actors.focusPoints(sim) : [], rawDt);
    if (sim && (this.mode === 'playing' || this.mode === 'paused')) {
      this.indicators.update(this.stage.camera, this.markers(sim));
      this.ui.fadeMap(this.behindMap(sim));
    }
    else this.indicators.clear();
    if (sim && this.mode === 'playing') this.trackSnatch(sim, rawDt);
    if (this.mode === 'playing' || this.mode === 'paused') this.wolfCam.update(this.mode === 'paused' ? 0 : rawDt);
    else this.wolfCam.hide();
    hudState.insetVisible = this.wolfCam.visible;
    hudState.insetSide = this.wolfCam.side;
    this.stage.render((r, target) => this.wolfCam.render(r, this.stage.scene, target));
  }

  /**
   * Wolf cam: show a hunt the player cannot see, from the moment a wolf lines up a straggler
   * until the snatch is settled.
   */
  private trackSnatch(sim: Sim, dt: number) {
    const L = this.level;
    const offScreen = (x: number, z: number) => {
      tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
      // Anything even at the edge of the view counts as seen: the inset never repeats it.
      return !(tmpV.z < 1 && Math.abs(tmpV.x) < 0.98 && Math.abs(tmpV.y) < 0.96);
    };
    let best: { x: number; z: number; text: string; rank: number; id: number; heading: number } | null = null;
    for (const w of sim.wolves) {
      const s = w.target;
      if (!s || w.state === 'gone' || w.state === 'flee') continue;
      // The inset is for hunts out of view; a wolf on screen is shown by the main camera.
      if (!offScreen(w.x, w.z)) continue;
      // The top banner says where; the inset's own label only says what, and how long is left.
      let rank = 0;
      let text = '';
      if (w.state === 'drag') {
        // The banner carries the countdown; the inset is the picture. Nothing to show if Pip
        // cannot get there in time.
        if (this.dragFeasible === false) continue;
        rank = 3;
        text = 'Snatch!';
      } else if (w.state === 'charge') {
        rank = 2;
        text = 'Wolf charging a straggler!';
      } else if (Math.hypot(w.x - s.x, w.z - s.z) < 16) {
        rank = 1;
        text = `Wolf stalking sheep ${L.placeName(s.x, s.z)}`;
      }
      if (rank && (!best || rank > best.rank)) best = { x: w.x, z: w.z, text, rank, id: w.id, heading: w.facing };
    }
    if (best) {
      this.insetWolf = best.id;
      // The inset opens on the side of the screen the threat lies towards.
      tmpV.set(best.x, this.terrain.height(best.x, best.z), best.z).project(this.stage.camera);
      const side = (tmpV.z > 1 ? -tmpV.x : tmpV.x) < 0 ? 'left' : 'right';
      this.wolfCam.track(best.x, this.terrain.height(best.x, best.z), best.z, best.heading, best.text, side, dt);
    } else if (this.wolfCam.visible) {
      // While the inset lingers, stay on the same wolf rather than on the spot it left.
      const w = sim.wolves.find((o) => o.id === this.insetWolf && o.state !== 'gone');
      if (w) this.wolfCam.follow(w.x, this.terrain.height(w.x, w.z), w.z, w.facing, dt);
    }
  }
  private insetWolf = -1;

  /**
   * Keep Pip and the sheep he is working in one frame: the focus leans towards the nearby flock
   * and the camera pulls back as the group spreads, so the way ahead stays visible. A wolf hunting
   * near Pip is framed too, so the threat is seen in the valley and not only as an edge marker.
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
    const grow = (x: number, z: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    };
    for (const s of sim.sheep) {
      if (s.state === 'lost' || s.state === 'folded') continue;
      if ((s.x - d.x) ** 2 + (s.z - d.z) ** 2 > 26 * 26) continue;
      grow(s.x, s.z);
      // Lead the frame the way the flock is moving, so the ground it is heading for is in view.
      grow(s.x + s.vx * 1.2, s.z + s.vz * 1.2);
      cx += s.x;
      cz += s.z;
      n++;
    }
    let framed = n > 0;
    // Hunting wolves near Pip are framed; a wolf dragging a sheep is pulled into view from
    // further out, so the alert and the picture agree.
    let dragFrame = false;
    for (const w of sim.wolves) {
      if (w.state !== 'stalk' && w.state !== 'charge' && w.state !== 'drag') continue;
      const reach = w.state === 'drag' ? 52 : 40;
      if ((w.x - d.x) ** 2 + (w.z - d.z) ** 2 > reach * reach) continue;
      grow(w.x, w.z);
      framed = true;
      if (w.state === 'drag') dragFrame = true;
    }
    let zoom = 1;
    if (framed) {
      if (n > 0) {
        cx /= n;
        cz /= n;
        // Bring the next landmark into shot (the fold gate, bridge or ford) when the flock is near it.
        const L = this.level;
        const inside = { x: L.fold.minX + 4, z: L.fold.cz };
        let best: { x: number; z: number }[] | null = null;
        let bd = 42 * 42;
        for (const pts of [[L.fold.mouth, inside], [L.bridge], [L.ford]]) {
          const p = pts[0];
          const dd = (p.x - cx) ** 2 + (p.z - cz) ** 2;
          if (dd < bd) {
            bd = dd;
            best = pts;
          }
        }
        for (const p of best ?? []) grow(p.x, p.z);
      }
      // Frame the whole working group (Pip, flock, landmark), not Pip with the rest at the edges.
      const bx = (minX + maxX) / 2;
      const bz = (minZ + maxZ) / 2;
      fx += (bx - fx) * 0.85;
      fz += (bz - fz) * 0.85;
      // At zoom 1 the view spans about +-27 m across, 15 m towards the camera, 26 m away from it.
      const halfW = Math.max(maxX - fx, fx - minX) + 5;
      // Wider margin at the bottom, where the meters, hints and edge markers sit.
      const south = maxZ - fz + 8;
      const north = fz - minZ + 5;
      zoom = Math.min(dragFrame ? 1.95 : 1.6, Math.max(1, halfW / 27, south / 15, north / 26));
    }
    if (d.sprinting) zoom = Math.max(zoom, 1.08);
    this.stage.setFocusGoal(fx, this.terrain.height(d.x, d.z), fz, zoom);
  }

  private markers(sim: Sim): Marker[] {
    const h = (x: number, z: number) => this.terrain.height(x, z);
    const f = this.level.fold;
    const out: Marker[] = [
      {
        id: 'fold',
        kind: 'fold',
        // Once latching is open the marker moves to the gatepost and says how to shut it.
        x: this.gateGlow ? f.minX - 0.6 : f.minX + 2,
        y: h(f.minX, f.cz) + (this.gateGlow ? 3.4 : 3),
        z: this.gateGlow ? f.cz - (f.maxZ - f.minZ) * 0.5 : f.cz,
        labelOnScreen: this.gateGlow ? 'Enter: latch the gate' : sim.elapsed < 45 ? 'Fold' : undefined,
      },
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
      // A sheep partly in view counts as visible.
      if (tmpV.z < 1 && Math.abs(tmpV.x) < 1.03 && Math.abs(tmpV.y) < 1.03) anyVisible = true;
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
        case 'wolfSpawn': {
          // Name the sheep it is after, by the place names on the minimap: that is where Pip has
          // to be. (Compass words were read as "where the wolf is" and "where the sheep are".)
          const d = this.sim?.dog;
          if (!d) break;
          // A wolf after Pip's own flock is announced when it comes into view (updateHints).
          if (Math.hypot(e.tx - d.x, e.tz - d.z) >= 26) this.ui.toast(`A wolf is after the sheep ${this.level.placeName(e.tx, e.tz)}!`, 'warn');
          break;
        }
        case 'grab':
          // The sticky alert (updateHints) and the wolf cam carry the news until it is settled.
          this.stage.addShake(0.35);
          break;
        case 'lost':
          this.ui.toast('A sheep was dragged into the woods.', 'danger');
          break;
        case 'rescued':
          this.ui.toast('Sheep rescued!', 'good');
          break;
        case 'targetMet':
          // The latch prompt banner carries this; a toast would say the same thing twice.
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
  /** The hint bar is showing what to do about a snatch. */
  private dragHint = false;
  /** Whether Pip can reach the current snatch in time (null when there is none). */
  private dragFeasible: boolean | null = null;
  /** An out-of-reach snatch has been announced. */
  private lossNoted = false;
  /** Wolves already announced as stalking. */
  private stalkWarned = new Set<number>();

  /** Is the fold, Pip or a loose sheep under the minimap? Then it fades so they show through. */
  private behindMap(sim: Sim) {
    const r = this.ui.mapRect();
    if (!r) return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const under = (x: number, z: number) => {
      tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
      if (tmpV.z > 1) return false;
      const px = ((tmpV.x + 1) / 2) * w;
      const py = ((1 - tmpV.y) / 2) * h;
      return px > r.left - 24 && px < r.right + 24 && py > r.top - 24 && py < r.bottom + 24;
    };
    const f = this.level.fold;
    if (under(f.cx, f.cz) || under(f.minX, f.cz) || under(sim.dog.x, sim.dog.z)) return true;
    return sim.sheep.some((s) => s.state !== 'lost' && under(s.x, s.z));
  }

  /** Is (x, z) inside the main view (with a margin)? */
  private onScreen(x: number, z: number) {
    tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
    return tmpV.z < 1 && Math.abs(tmpV.x) < 0.9 && Math.abs(tmpV.y) < 0.85;
  }

  /** Show a tutorial tip once, for `seconds` of play. */
  private tip(id: string, text: string, seconds: number, now: number) {
    // Never over the snatch instructions; the tip can come up later.
    if (this.tipsShown.has(id) || this.dragHint) return;
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
    // A snatch in progress holds the message slot until it is settled: the news at the top with
    // one number (seconds until the sheep is lost, the same as the inset), what to do in the hint
    // bar. If Pip cannot get there in time the hint says so instead of asking the impossible.
    const dragger = sim.wolves.find((w) => w.state === 'drag' && w.target);
    if (dragger?.target) {
      const s = dragger.target;
      const far = Math.hypot(s.x - d.x, s.z - d.z);
      const eta = sim.dragEta(dragger);
      const secs = Math.max(1, Math.ceil(eta));
      const margin = eta - sim.rescueEta(dragger.x, dragger.z);
      // Hysteresis so the advice does not flicker as the numbers move.
      if (this.dragFeasible === null) this.dragFeasible = margin > 0.5;
      else if (this.dragFeasible && margin < -1) this.dragFeasible = false;
      else if (!this.dragFeasible && margin > 1.5) this.dragFeasible = true;
      const place = this.level.placeName(s.x, s.z);
      const inRange = Math.hypot(dragger.x - d.x, dragger.z - d.z) < DOG.barkWolfRadius - 1;
      if (inRange || far < 16) {
        this.ui.alert(`A wolf has one of your sheep! ${secs} s to save it`);
        this.ui.hint(inRange ? 'Bark (Space) now to make it let go!' : 'Bark (Space) or run into the wolf to make it let go');
      } else if (this.dragFeasible) {
        this.ui.alert(`A wolf has a sheep ${place}! ${secs} s to save it`);
        this.ui.hint('Run at it (Shift to sprint), then bark (Space)!');
      } else {
        // Out of reach: one calm line, no countdown and no inset (see trackSnatch).
        this.ui.alert(null);
        if (!this.lossNoted) {
          this.lossNoted = true;
          this.ui.toast(`A wolf is taking a sheep ${place}: too far to save it`, 'warn');
        }
        this.ui.hint('Keep the rest of the flock together');
      }
      this.dragHint = true;
      this.tipUntil = 0;
    } else {
      this.dragFeasible = null;
      this.lossNoted = false;
      this.ui.alert(null);
      if (this.dragHint) {
        this.dragHint = false;
        this.ui.hint('');
      }
    }

    // Warn as a wolf closes in on its prey, before it can strike. A wolf after Pip's own flock is
    // announced once it is actually in view, so the words and the picture agree.
    for (const w of sim.wolves) {
      if (w.state !== 'stalk' || !w.target || this.stalkWarned.has(w.id)) continue;
      const s = w.target;
      const visible = this.onScreen(w.x, w.z);
      const nearPip = Math.hypot(s.x - d.x, s.z - d.z) < 26;
      if (nearPip ? !visible : Math.hypot(w.x - s.x, w.z - s.z) > 20) continue;
      this.stalkWarned.add(w.id);
      this.ui.toast(nearPip ? 'A wolf is stalking your flock!' : `A wolf is stalking the sheep ${this.level.placeName(s.x, s.z)}!`, 'warn');
    }
    const wasGlowing = this.gateGlow;
    this.gateGlow = sim.targetMet && sim.free > 0 && !grabbed;
    this.ui.prompt(this.gateGlow ? 'Target met! Press <kbd>Enter</kbd> to latch the gate and end the day, or keep herding for more stars' : null);
    // The call to action replaces the objective it completes, and wins over tutorial tips.
    if (this.gateGlow && !wasGlowing) this.ui.dropInfoToast();
    if (this.gateGlow && this.tipUntil > 0) {
      this.tipUntil = 0;
      this.ui.hint('');
    }

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
    // Only when a wolf is near Pip and in view: off-screen hunts are shown by the wolf cam.
    if (sim.wolves.some((w) => (w.state === 'stalk' || w.state === 'charge') && Math.hypot(w.x - d.x, w.z - d.z) < 30 && this.onScreen(w.x, w.z))) {
      this.tip('wolf', 'Wolves run from Pip: run at one or bark (Space) to drive it off', 7, t);
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
