import * as THREE from 'three';
import { GameAudio } from '../audio/audio';
import { moodTime } from '../render/daycycle';
import { Stage } from '../render/stage';
import { INSET, WolfCam } from '../render/wolfcam';
import { hudState, Indicators, type Marker } from '../ui/indicators';
import { PerfOverlay } from '../ui/perf';
import { Ui, type UiAction } from '../ui/ui';
import { Actors } from '../world/actors';
import { Particles } from '../world/particles';
import { loadAssets } from '../world/assets';
import { Terrain } from '../world/terrain';
import { buildWorld, treeHoles, updateWorld, type WorldHandles } from '../world/world';
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
  readonly audio: GameAudio;
  actors: Actors | null = null;
  particles: Particles | null = null;
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
    this.audio = new GameAudio(this.level);
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
    // Fireflies drift near cover: bushes and the trees inside the valley.
    const spots: { x: number; z: number }[] = [];
    for (const [x, z] of this.level.data.bushes) for (let k = 0; k < 2; k++) spots.push({ x: x + (Math.random() - 0.5) * 6, z: z + (Math.random() - 0.5) * 6 });
    for (const t of this.level.trees) spots.push({ x: t.x + (Math.random() - 0.5) * 5, z: t.z + (Math.random() - 0.5) * 5 });
    this.particles = new Particles(assets, this.terrain, spots);
    this.stage.scene.add(this.particles.root);
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
    this.audio.newDay(seed);
    const d = this.sim.dog;
    this.stage.snapTo(d.x, this.terrain.height(d.x, d.z), d.z, BASE_ZOOM);
    this.ui.clearToasts();
    this.gateGlow = false;
    this.warnedAt.clear();
    this.tipsShown.clear();
    this.stalkWarned.clear();
    this.stalkToast = null;
    this.dragFeasible = null;
    this.ui.prompt(null);
    // The counter states the target; the first tip is about moving.
    this.tip('move', 'WASD to move · get behind the sheep to drive them', 10, 0);
    this.setMode('playing');
  }

  private frameMs: number[] = [];
  /** Seconds of hit-stop left (the action nearly freezes on a rescue). */
  private hitStop = 0;
  private dustT = 0;

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
    let dt = rawDt * this.timeScale;
    if (this.hitStop > 0) {
      this.hitStop -= rawDt;
      dt *= 0.06;
    }
    this.clock += rawDt;
    this.input.poll();
    this.tick(dt, rawDt);
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  private tick(dt: number, rawDt: number) {
    const input = this.input;
    const sim = this.sim;

    if (input.pressed('mute')) {
      const muted = this.audio.toggleMute();
      this.ui.toast(muted ? 'Sound off (M to turn it back on)' : 'Sound on', 'info');
    }
    if (this.mode === 'title') {
      if (input.pressed('confirm') && this.howtoFrom === null) this.newDay();
    } else if (this.mode === 'playing' && sim) {
      if (input.pressed('pause')) {
        this.setMode('paused');
      } else {
        // Fixed-ish substeps keep the flocking stable at low frame rates.
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        for (let i = 0; i < steps; i++) sim.update(dt / steps, input);
        this.audio.onEvents(sim.events, sim);
        this.effects(sim, dt);
        this.handleEvents(sim.events);
        sim.events.length = 0;
        this.updateHints(sim, dt);
        if (sim.outcome) {
          this.audio.outcome(sim.outcome.kind === 'win');
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
      // Messages and the close-up run on game time (the same as real time outside tests).
      this.ui.update(sim, this.mode === 'paused' ? 0 : dt, this.clock);
      this.ui.minimap.setMood(mood.t);
      if (this.mode === 'ended' && sim.outcome?.kind === 'win') {
        // Look at the fold while the gate closes, with the fold to the right of the results card.
        const f = this.level.fold;
        this.stage.setFocusGoal(f.cx - 12, this.terrain.ground(f.cx, f.cz), f.cz + 2, 1.15);
      } else {
        this.frameCamera(sim);
      }
    } else {
      // Title: a low shot across the valley into the golden-hour sun, drifting slowly to and fro.
      this.titleAngle += rawDt * 0.04;
      this.stage.setTitleShot(-10, this.terrain.ground(-10, 4) + 1, 4, 0.1 + Math.sin(this.titleAngle) * 0.2);
      mood = this.stage.applyMood(0.28);
    }
    this.audio.update(rawDt, sim, mood.t, mood.night, this.mode, sim && this.mode === 'playing' ? this.tension(sim) : 0);
    this.particles?.update(this.mode === 'paused' ? 0 : dt, this.stage.camera, this.clock, mood.night);
    this.gateOpen += (this.gateTarget - this.gateOpen) * (1 - Math.exp(-3.5 * rawDt));
    const open = this.gateOpen * 1.65;
    if (this.world.gateN) this.world.gateN.rotation.y = open;
    if (this.world.gateS) this.world.gateS.rotation.y = -open;
    this.stage.updateCamera(this.mode === 'paused' ? 0 : rawDt);
    const buf = this.stage.renderer.getDrawingBufferSize(tmpV2);
    updateWorld(this.world, mood, this.clock, this.stage.camera, sim ? this.actors.focusPoints(sim) : [], rawDt, buf.x, buf.y);
    if (sim && (this.mode === 'playing' || this.mode === 'paused')) {
      this.indicators.update(this.stage.camera, this.markers(sim));
      this.ui.fadeMap(this.behindMap(sim));
      this.ui.fadePanels(this.subjectsOnScreen(sim));
    }
    else this.indicators.clear();
    if (sim && this.mode === 'playing') this.trackSnatch(sim, dt);
    if (this.mode === 'playing' || this.mode === 'paused') this.wolfCam.update(this.mode === 'paused' ? 0 : dt);
    else this.wolfCam.hide();
    hudState.insetVisible = this.wolfCam.visible;
    hudState.insetRect = this.wolfCam.rect;
    hudState.mapRect = this.ui.mapRect();
    const forest = this.world.forest;
    this.stage.render((r, target) => {
      // Tree cut-outs are placed for the main view only; the close-up follows a wolf into the
      // pines, so the forest ring is left out of it (the camera would sit inside the trees).
      treeHoles(false);
      for (const f of forest) f.visible = false;
      this.wolfCam.render(r, this.stage.scene, target);
      for (const f of forest) f.visible = true;
      treeHoles(true);
    });
  }

  /**
   * Wolf cam: show a hunt the player cannot see, from the moment a wolf lines up a straggler
   * until the snatch is settled.
   */
  private trackSnatch(sim: Sim, dt: number) {
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
      }
      if (rank && (!best || rank > best.rank)) best = { x: w.x, z: w.z, text, rank, id: w.id, heading: w.facing };
    }
    if (best) {
      this.insetWolf = best.id;
      const dist = Math.round(Math.hypot(best.x - sim.dog.x, best.z - sim.dog.z));
      const dock = this.insetDock(sim, best.x, best.z);
      this.wolfCam.track(best.x, this.terrain.height(best.x, best.z), best.z, best.heading, `${best.text} · ${dist} m`, dock.x, dock.y, dock.point, dt);
    } else if (this.wolfCam.visible) {
      // While the inset lingers, stay on the same wolf rather than on the spot it left.
      const w = sim.wolves.find((o) => o.id === this.insetWolf && o.state !== 'gone');
      if (w) this.wolfCam.follow(w.x, this.terrain.height(w.x, w.z), w.z, w.facing, dt);
    }
  }
  private insetWolf = -1;

  /**
   * Where the wolf-cam inset goes for a snatch at (x, z) off screen: always the same place, the
   * left edge at mid-height, clear of the counter, so the eye knows where to look (its arrow points
   * the way); it only slides along the edge while Pip or the sheep near him would be under it.
   * Returns the frame's top-left and the threat's (off screen) position for the arrow.
   */
  private insetDock(sim: Sim, x: number, z: number) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cam = this.stage.camera;
    const toScreen = (px: number, pz: number) => {
      tmpV.set(px, this.terrain.height(px, pz) + 0.8, pz).project(cam);
      const behind = tmpV.z > 1;
      const nx = behind ? -tmpV.x : tmpV.x;
      const ny = behind ? -tmpV.y : tmpV.y;
      return { x: ((nx + 1) / 2) * w, y: ((1 - ny) / 2) * h, behind };
    };
    const dx = INSET.margin;
    const top = 124;
    const bottom = h - 84 - INSET.h;
    const keep: { x: number; y: number }[] = [];
    const d = sim.dog;
    const add = (px: number, pz: number) => {
      const p = toScreen(px, pz);
      if (!p.behind) keep.push(p);
    };
    add(d.x, d.z);
    for (const s of sim.sheep) {
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'grabbed') continue;
      if ((s.x - d.x) ** 2 + (s.z - d.z) ** 2 < 30 * 30) add(s.x, s.z);
    }
    const pad = 26;
    const blocked = (y: number) => keep.some((p) => p.x > dx - pad && p.x < dx + INSET.w + pad && p.y > y - pad && p.y < y + INSET.h + pad);
    const home = Math.max(top, Math.min(bottom, Math.round((h - INSET.h) / 2)));
    let y = home;
    for (let off = 20; off < h && blocked(y); off += 20) {
      if (home - off >= top && !blocked(home - off)) y = home - off;
      else if (home + off <= bottom) y = home + off;
    }
    return { x: dx, y: Math.max(top, Math.min(bottom, y)), point: toScreen(x, z) };
  }

  /**
   * Keep Pip and the sheep he is working in one frame: the focus leans towards the nearby flock
   * and the camera pulls back as the group spreads, so the way ahead stays visible. A wolf hunting
   * near Pip is framed too, so the threat is seen in the valley and not only as an edge marker.
   */
  private frameCamera(sim: Sim) {
    const d = sim.dog;
    let fx = d.x + d.vx * 0.35;
    let fz = d.z + d.vz * 0.35;
    // Pip's safe band: the frame always keeps this much ground round him, so he never ends up
    // under the timer and banners at the top or on the bottom edge (north is up the screen).
    const SAFE = { side: 6, north: 6, south: 4 };
    let minX = d.x - SAFE.side;
    let maxX = d.x + SAFE.side;
    let minZ = d.z - SAFE.north;
    let maxZ = d.z + SAFE.south;
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
    // further out, so the alert and the picture agree. They (with their prey and Pip) are the
    // must-haves: `ess` is their box.
    let dragFrame = false;
    const ess = { minX, maxX, minZ, maxZ, wolves: 0 };
    const growEss = (x: number, z: number) => {
      grow(x, z);
      ess.minX = Math.min(ess.minX, x);
      ess.maxX = Math.max(ess.maxX, x);
      ess.minZ = Math.min(ess.minZ, z);
      ess.maxZ = Math.max(ess.maxZ, z);
    };
    for (const w of sim.wolves) {
      if (w.state !== 'stalk' && w.state !== 'charge' && w.state !== 'drag') continue;
      const reach = w.state === 'drag' ? 52 : 40;
      if ((w.x - d.x) ** 2 + (w.z - d.z) ** 2 > reach * reach) continue;
      growEss(w.x, w.z);
      growEss(w.x - 5, w.z - 6);
      growEss(w.x + 5, w.z + 3);
      // A stalking or charging wolf brings its prey into the frame too, so the player can see
      // which sheep it is after and where to cut in.
      if (w.target && (w.state === 'stalk' || w.state === 'charge') && (w.target.x - w.x) ** 2 + (w.target.z - w.z) ** 2 < 30 * 30) growEss(w.target.x, w.target.z);
      framed = true;
      ess.wolves++;
      if (w.state === 'drag') dragFrame = true;
    }
    let zoom = BASE_ZOOM;
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
      // At zoom 1 the view spans VIEW: about +-27 m across, 18 m towards the camera, 24 m away.
      // Margins keep everything framed clear of the timer and banners at the top (9 m: the far
      // side of the tilted view is squeezed) and of the meters, hints and edge markers at the
      // bottom (8 m). Capped so Pip, with his outline, stays a readable size.
      const cap = dragFrame ? 1.75 : 1.6;
      const fit = (x0: number, x1: number, z0: number, z1: number) => {
        // The tilted view sees further away from the camera than towards it, so the centre that
        // needs the least zoom sits south of the box's middle: where both margins bind equally.
        const cx0 = fx + ((x0 + x1) / 2 - fx) * 0.85;
        const cz0 = fz + ((VIEW.north * (z1 + 8) + VIEW.south * (z0 - 9)) / (VIEW.north + VIEW.south) - fz) * 0.85;
        const halfW = Math.max(x1 - cx0, cx0 - x0) + 5;
        return { x: cx0, z: cz0, zoom: Math.max(BASE_ZOOM, halfW / VIEW.half, (z1 - cz0 + 8) / VIEW.south, (cz0 - z0 + 9) / VIEW.north) };
      };
      let f = fit(minX, maxX, minZ, maxZ);
      // When everything will not fit, the hunt wins: the wolf, its prey and Pip stay in frame and
      // the far side of the flock may go off the edge.
      if (f.zoom > cap && ess.wolves > 0) f = fit(ess.minX, ess.maxX, ess.minZ, ess.maxZ);
      fx = f.x;
      fz = f.z;
      zoom = Math.min(cap, f.zoom);
    }
    if (d.sprinting) zoom = Math.max(zoom, BASE_ZOOM * 1.08);
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
        labelOnScreen: this.gateGlow ? (this.ui.promptIsChip ? 'Enter: latch the gate' : undefined) : sim.elapsed < 45 ? 'Fold' : undefined,
      },
    ];
    // The wolf-cam inset stands in for the edge marker of the hunt it is showing.
    const shown = this.wolfCam.visible ? sim.wolves.find((w) => w.id === this.insetWolf && w.state !== 'gone') : undefined;
    for (const s of sim.sheep) {
      if (s.state === 'grabbed' && shown?.target !== s) out.push({ id: `g${s.id}`, kind: 'grab', x: s.x, y: h(s.x, s.z) + 1, z: s.z, iconOnScreen: true });
    }
    for (const w of sim.wolves) {
      if ((w.state === 'stalk' || w.state === 'charge') && w !== shown) out.push({ id: `w${w.id}`, kind: 'wolf', x: w.x, y: h(w.x, w.z) + 1, z: w.z });
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
    // The first seconds of the first day: name the dashed ring on the ring itself.
    if (this.runs === 1 && sim.elapsed < 20) {
      const r = sim.dogThreatRadius;
      out.push({ id: 'reach', kind: 'note', x: d.x, y: h(d.x, d.z - r), z: d.z - r, labelOnScreen: "Pip's reach: sheep inside it move away", onScreenOnly: true });
    }
    return out;
  }

  /**
   * Feel: particles and hit feedback for what the sim just did, and a steady kick of dust from
   * anything running.
   */
  private effects(sim: Sim, dt: number) {
    const p = this.particles;
    if (!p || !this.actors) return;
    const d = sim.dog;
    for (const e of sim.events) {
      switch (e.type) {
        case 'bark':
          p.ripple(d.x, d.z, 1.5, DOG.barkRadius, 0.55);
          break;
        case 'splash':
          p.splash(e.x, e.z, e.big);
          break;
        case 'grab':
          p.tufts(e.x, e.z, 10);
          break;
        case 'rescued':
          p.tufts(e.x, e.z, 7);
          p.ripple(e.x, e.z, 1, 7, 0.6);
          this.hitStop = 0.12;
          this.stage.addShake(0.3);
          break;
        case 'wolfScared':
          p.dust(e.x, e.z, 0, 0, 1.6);
          this.hitStop = Math.max(this.hitStop, 0.05);
          break;
        case 'folded':
          p.heart(e.x, e.z);
          break;
        case 'charge':
          p.dust(e.x, e.z, 0, 0, 1.3);
          break;
        case 'bleat': {
          const i = sim.sheep.findIndex((s) => s.id === e.id);
          if (i >= 0) this.actors.bleat(i);
          break;
        }
      }
    }
    // Dust behind anything running: Pip at a sprint, bolting sheep, charging wolves.
    this.dustT += dt;
    if (this.dustT < 0.08) return;
    this.dustT = 0;
    const kick = (x: number, z: number, vx: number, vz: number, size: number) => {
      const sp = Math.hypot(vx, vz) || 1;
      p.dust(x - (vx / sp) * 0.8, z - (vz / sp) * 0.8, vx / sp, vz / sp, size);
    };
    if (d.sprinting && d.speed > 6 && !d.inWater) kick(d.x, d.z, d.vx, d.vz, 1);
    for (const s of sim.sheep) {
      if ((s.state === 'flee' || s.state === 'panic') && s.speed > 5 && !s.inWater && Math.random() < 0.35) kick(s.x, s.z, s.vx, s.vz, 0.8);
    }
    for (const w of sim.wolves) {
      if ((w.state === 'charge' || w.state === 'flee') && w.speed > 6 && !w.inWater) kick(w.x, w.z, w.vx, w.vz, 1.1);
    }
  }

  /** 0..1: how close the danger is, for the music. */
  private tension(sim: Sim) {
    const d = sim.dog;
    let t = sim.timeLeft < 60 ? 0.3 + 0.3 * (1 - sim.timeLeft / 60) : 0;
    for (const w of sim.wolves) {
      if (w.state === 'drag') t = Math.max(t, this.dragFeasible === false ? 0.55 : 1);
      else if (w.state === 'charge') t = Math.max(t, 0.85);
      else if (w.state === 'stalk') {
        const near = Math.hypot(w.x - d.x, w.z - d.z) < 45 || (w.target && Math.hypot(w.x - w.target.x, w.z - w.target.z) < 18);
        t = Math.max(t, near ? 0.6 : 0.35);
      }
    }
    return Math.min(1, t);
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
  /** The stalking warning on show, and whose it is. */
  private stalkToast: { id: number; text: string } | null = null;

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
    // Only an animal under the map makes it see-through: the fold and the farmhouse may sit under
    // it (that is where the map gets read), people need to see Pip and the sheep.
    if (under(sim.dog.x, sim.dog.z)) return true;
    return sim.sheep.some((s) => s.state !== 'lost' && s.state !== 'folded' && under(s.x, s.z));
  }

  /** Screen positions (CSS pixels) of Pip, the loose sheep and the hunting wolves in view. */
  private subjectsOnScreen(sim: Sim) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const out: { x: number; y: number }[] = [];
    const add = (x: number, z: number) => {
      tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 1 || Math.abs(tmpV.y) > 1) return;
      out.push({ x: ((tmpV.x + 1) / 2) * w, y: ((1 - tmpV.y) / 2) * h });
    };
    add(sim.dog.x, sim.dog.z);
    for (const s of sim.sheep) if (s.state !== 'folded' && s.state !== 'lost') add(s.x, s.z);
    for (const wf of sim.wolves) if (wf.state !== 'gone') add(wf.x, wf.z);
    return out;
  }

  /** An arrow pointing from the middle of the screen towards (x, z), for banners. */
  private arrowTo(x: number, z: number) {
    tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
    const behind = tmpV.z > 1;
    const nx = behind ? -tmpV.x : tmpV.x;
    const ny = behind ? -tmpV.y : tmpV.y;
    const a = Math.atan2(ny, nx);
    return ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
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
        if (sim.timeLeft < s - 4) continue;
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
        this.ui.alert(`A wolf has one of your sheep! ${secs} s to save it`, inRange ? 'Bark (Space) now to make it let go!' : 'Bark (Space) or run into the wolf');
        this.ui.hint('');
      } else if (this.dragFeasible) {
        const dist = Math.round(Math.hypot(dragger.x - d.x, dragger.z - d.z));
        this.ui.alert(`A wolf has a sheep ${place}! ${this.arrowTo(dragger.x, dragger.z)} ${dist} m · ${secs} s to save it`, 'Sprint at it (Shift), then bark (Space)');
        this.ui.hint('');
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
      const text = nearPip ? `A wolf is stalking your flock! ${this.arrowTo(w.x, w.z)}` : `A wolf is stalking the sheep ${this.level.placeName(s.x, s.z)}! ${this.arrowTo(w.x, w.z)}`;
      this.ui.toast(text, 'warn');
      this.stalkToast = { id: w.id, text };
    }
    if (this.stalkToast) {
      const st = this.stalkToast;
      const w = sim.wolves.find((o) => o.id === st.id);
      if (!w || (w.state !== 'stalk' && w.state !== 'charge')) {
        this.ui.dropToast(st.text);
        this.stalkToast = null;
      }
    }
    const wasGlowing = this.gateGlow;
    this.gateGlow = sim.targetMet && sim.free > 0 && !grabbed;
    this.ui.prompt(
      this.gateGlow ? 'Target met! Press <kbd>Enter</kbd> to latch the gate and end the day, or keep herding for more stars' : null,
      'Target met · <kbd>Enter</kbd> latches the gate',
    );
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
      if (t > 20 || this.runs > 1) this.tip('ring', 'Hold C to creep: the dashed ring shrinks and the sheep stay calmer', 9, t);
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
      /** Whether the game judges the current snatch reachable (null: no snatch). */
      dragFeasible: this.dragFeasible,
    };
  }
}

const tmpV = new THREE.Vector3();
/** The herding camera's usual distance (1 = the configured offset): far enough that Pip's reach
 * ring takes about half the screen's height. */
const BASE_ZOOM = 1.2;
/** Ground in view at zoom 1 around the focus (metres): across, towards the camera, away from it. */
const VIEW = { half: 27.3, south: 17.8, north: 24.3 };
const tmpV2 = new THREE.Vector2();
