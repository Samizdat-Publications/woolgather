import * as THREE from 'three';
import hollowDef from '../../level/hollow.json';
import lochDef from '../../level/loch.json';
import passDef from '../../level/pass.json';
import showDef from '../../level/show.json';
import corrieDef from '../../level/corrie.json';
import { GameAudio } from '../audio/audio';
import { dawnTime, moodTime } from '../render/daycycle';
import { QUALITY_TIERS, Stage, type Quality } from '../render/stage';
import { INSET, WolfCam } from '../render/wolfcam';
import { hudState, Indicators, type Marker } from '../ui/indicators';
import { PerfOverlay } from '../ui/perf';
import { Ui } from '../ui/ui';
import { Actors } from '../world/actors';
import { loadAssets, type Assets } from '../world/assets';
import { GrassField } from '../world/grass';
import { Life } from '../world/life';
import { Particles } from '../world/particles';
import { Terrain } from '../world/terrain';
import { generateTerrain, type Season } from '../world/terraingen';
import { WeatherFx } from '../world/weatherfx';
import { buildWorld, disposeWorld, treeHoles, updateWorld, type WorldHandles } from '../world/world';
import type { Difficulty } from './config';
import { Input } from './input';
import { Level } from './level';
import type { LevelDef } from './leveldef';
import { classicRules, type Rules } from './rules';
import { loadProgress, perksFor, saveProgress, SEASON, totalStars, CHARMS, SECOND_CHARM_STARS, type Evening, type Progress } from './season';
import { Sim, type SimEvent } from './sim';

// Top-level state machine: title -> (season map -> evening card) or classic -> playing <-> paused
// -> ended -> (next evening | again | season map | title).

export type Mode = 'title' | 'menu' | 'playing' | 'paused' | 'ended';

export const LEVELS: Record<string, LevelDef> = {
  hollow: hollowDef as unknown as LevelDef,
  loch: lochDef as unknown as LevelDef,
  pass: passDef as unknown as LevelDef,
  show: showDef as unknown as LevelDef,
  corrie: corrieDef as unknown as LevelDef,
};

export interface GameOptions {
  seed: number;
  test: boolean;
  difficulty?: Difficulty;
  /** Graphics: a fixed tier, or 'auto' (the default, remembered from the pause menu). */
  quality?: 'auto' | Quality;
  /** Skip the sunset cutaway (the bot and the self-test). */
  noCutaway?: boolean;
}

export class Game {
  level: Level = new Level(LEVELS.hollow);
  readonly terrain = new Terrain(this.level);
  readonly input = new Input();
  readonly stage: Stage;
  readonly ui: Ui;
  readonly indicators: Indicators;
  readonly wolfCam: WolfCam;
  readonly audio: GameAudio;
  assets: Assets | null = null;
  actors: Actors | null = null;
  particles: Particles | null = null;
  weatherFx: WeatherFx | null = null;
  life: Life | null = null;
  grass: GrassField | null = null;
  world: WorldHandles | null = null;
  mode: Mode = 'title';
  sim: Sim | null = null;
  /** The rules being played, and the season evening they come from (null: a classic evening). */
  rules: Rules | null = null;
  evening: Evening | null = null;
  progress: Progress = loadProgress();
  timeScale = 1;
  /** True once every Blender asset is loaded and the first place is built. */
  ready = false;
  private placeKey = '';
  private last = 0;
  private clock = 0;
  private titleAngle = 0;
  private runs = 0;
  private howtoFrom: string | null = null;
  /** Latching is available (the target is met and sheep are still out).  */
  private gateGlow = false;
  /** 1 = gate leaves wide open, 0 = shut (they swing shut when the day is won). */
  private gateOpen = 1;
  private gateTarget = 1;
  /** Seconds until the end card appears (lets the player see the gate close / night fall). */
  private endCardT = 0;
  /** Weather now (eased towards the evening's): rain, overcast, mist, snowfall. */
  private wx = { rain: 0, cloud: 0, mist: 0, snow: 0, leaves: 0 };
  private flash = 0;
  private flashT = -1;
  /** In mist: where and when Pip last saw each sheep (the map only shows these). */
  private seen = new Map<number, { x: number; z: number; t: number }>();
  /**
   * The menus' backdrop: the evening's own flock grazing in the establishing shot, with Pip
   * watching them (a sim that is never steered and never ends).
   */
  private viewSim: Sim | null = null;
  /**
   * The sunset cutaway: when the sun drops and the wolves come out, a few seconds of a low shot
   * from beside Pip into the western sky (the evening waits), then back to the herding view.
   */
  private cutaway: { t: number; x: number; z: number; angle: number } | null = null;
  /** In mist: where sheep bleated lately (a sheep glyph shows there for a moment). */
  private bleats = new Map<number, { x: number; z: number; until: number }>();
  /** Tips already given this session (the basics are not repeated every evening). */
  private tipsEver = new Set<string>();
  /** One-off messages already shown this evening (the ram's first butt, and so on). */
  private said = new Set<string>();

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
    this.ui.onAction = (a, arg) => this.onUi(a, arg);
    this.ui.bindSound(this.audio.engine.settings, () => this.audio.engine.apply());
    this.qualityMode = opts.quality ?? loadQuality();
    this.stage.setQuality(this.qualityMode === 'auto' ? 'high' : this.qualityMode);
    this.ui.bindQuality(
      () => ({ mode: this.qualityMode, tier: this.stage.quality }),
      (m) => {
        this.qualityMode = m;
        saveQuality(m);
        this.frameWindow.length = 0;
        this.stage.setQuality(m === 'auto' ? 'high' : m);
        this.grass?.setFraction(GRASS_TIER[this.stage.quality]);
      },
    );
    this.toTitle();
  }

  /** Load the Blender assets and build the first place. */
  async init(onProgress: (done: number, total: number) => void) {
    const assets = await loadAssets(onProgress);
    this.assets = assets;
    this.actors = new Actors(assets, this.terrain);
    this.stage.scene.add(this.actors.root);
    this.weatherFx = new WeatherFx();
    this.stage.scene.add(this.weatherFx.root);
    this.loadPlace('hollow', 'summer');
    this.warmUp();
    this.ready = true;
    if (this.mode === 'title') this.makeViewSim(classicRules('standard'));
    this.ui.renderSeason(this.progress);
  }

  /**
   * Build a place for a season (ground, water, props, the valley's life, fireflies), replacing the
   * last one. Cheap when it is already the one showing.
   */
  loadPlace(levelId: string, season: Season) {
    const key = `${levelId}|${season}`;
    if (key === this.placeKey && this.world) return;
    const a = this.assets;
    if (!a) return;
    const t0 = performance.now();
    this.placeKey = key;
    if (this.world) disposeWorld(this.world);
    if (this.particles) this.particles.root.removeFromParent();
    if (this.life) this.life.dispose();
    if (this.grass) this.grass.dispose();
    this.level = new Level(LEVELS[levelId] ?? LEVELS.hollow);
    const gen = generateTerrain(this.level, season);
    this.terrain.setLevel(this.level, gen);
    this.world = buildWorld(this.level, this.terrain, a, gen);
    this.stage.scene.add(this.world.root);
    // Fireflies drift near cover, over the meadows and round the fold.
    const spots: { x: number; z: number }[] = [];
    const L = this.level;
    for (const [x, z] of L.def.bushes) for (let k = 0; k < 2; k++) spots.push({ x: x + (Math.random() - 0.5) * 6, z: z + (Math.random() - 0.5) * 6 });
    for (const t of L.trees) spots.push({ x: t.x + (Math.random() - 0.5) * 5, z: t.z + (Math.random() - 0.5) * 5 });
    const fold = L.fold;
    for (let k = 0; k < 18; k++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * 22;
      spots.push({ x: fold.cx + Math.cos(ang) * r, z: fold.cz + Math.sin(ang) * r });
    }
    const w = L.def.world;
    for (let k = 0; k < 600 && spots.length < 220; k++) {
      const x = w.minX + Math.random() * (w.maxX - w.minX);
      const z = w.minZ + Math.random() * (w.maxZ - w.minZ);
      if (L.insideValley(x, z) && !L.penAt(x, z, -2) && !L.inWater(x, z)) spots.push({ x, z });
    }
    this.particles = new Particles(a, this.terrain, season === 'winter' ? spots.slice(0, 40) : spots);
    this.stage.scene.add(this.particles.root);
    this.life = new Life(L, this.terrain, season, this.world.chimney);
    this.stage.scene.add(this.life.root);
    this.grass = new GrassField(L, this.terrain, gen, season, { density: 2.6 });
    this.grass.setFraction(GRASS_TIER[this.stage.quality]);
    this.stage.scene.add(this.grass.root);
    this.ui.setLevel(L);
    this.audio.setLevel(L);
    if (this.opts.test) console.info(`[woolgather] built ${levelId} (${season}) in ${Math.round(performance.now() - t0)} ms`);
  }

  start() {
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }

  /**
   * Compile every shader the day will need now, behind the loading screen: a wolf's first
   * appearance and the fireflies at dusk each froze the game for a moment while theirs compiled.
   */
  private warmUp() {
    if (!this.actors) return;
    const extra = this.actors.warmUpObjects();
    const scene = this.stage.scene;
    const r = this.stage.renderer;
    scene.add(...extra);
    r.setRenderTarget(this.stage.grade.target);
    r.compile(scene, this.stage.camera);
    r.setRenderTarget(null);
    scene.remove(...extra);
  }

  private onUi(a: string, arg?: string) {
    switch (a) {
      case 'season':
        this.openSeason();
        break;
      case 'classic':
        this.evening = null;
        this.newDay(classicRules(this.ui.difficulty));
        break;
      case 'evening': {
        const ev = SEASON.find((e) => e.id === arg);
        if (ev) this.openEvening(ev);
        break;
      }
      case 'begin':
        if (this.evening) this.newDay(this.eveningRules(this.evening));
        break;
      case 'charm':
        if (arg) this.toggleCharm(arg);
        break;
      case 'next': {
        const i = this.evening ? SEASON.indexOf(this.evening) : -1;
        const next = SEASON[i + 1];
        if (next) this.openEvening(next);
        else this.openSeason();
        break;
      }
      case 'restart':
        if (this.rules) this.newDay(this.evening ? this.eveningRules(this.evening) : this.rules);
        break;
      case 'resume':
        this.setMode('playing');
        break;
      case 'title':
        this.toTitle();
        break;
      case 'howto':
        this.howtoFrom = this.ui.current;
        this.ui.show('howto');
        break;
      case 'close-howto':
        this.ui.show((this.howtoFrom as Parameters<Ui['show']>[0]) ?? null);
        this.howtoFrom = null;
        break;
    }
  }

  private eveningRules(ev: Evening): Rules {
    return { ...ev.rules, id: ev.id, perks: perksFor(this.progress.charms) };
  }

  /** Wear or take off a charm (one slot, two once enough stars are earned). */
  private toggleCharm(id: string) {
    const p = this.progress;
    const stars = totalStars(p);
    const c = CHARMS.find((q) => q.id === id);
    if (!c || stars < c.stars) return;
    const slots = stars >= SECOND_CHARM_STARS ? 2 : 1;
    if (p.charms.includes(id)) p.charms = p.charms.filter((q) => q !== id);
    else {
      p.charms.push(id);
      while (p.charms.length > slots) p.charms.shift();
    }
    saveProgress(p);
    if (this.evening) this.ui.renderIntro(this.evening, p);
  }

  private openSeason() {
    this.sim = null;
    this.rules = null;
    this.ui.renderSeason(this.progress);
    this.setMode('menu');
    this.ui.show('season');
    const last = SEASON.find((e) => e.id === this.progress.last) ?? SEASON[0];
    this.loadPlace(last.rules.levelId, last.rules.season);
    this.menuRules = last.rules as Rules;
    this.makeViewSim({ ...last.rules, id: 'view' });
  }

  /** A grazing flock and a watching Pip in the menu shot, between the camera and its focus. */
  private makeViewSim(rules: Rules) {
    if (!this.ready) return;
    const L = this.level;
    const sim = new Sim(L, { ...rules, objective: 'gather', wolfStart: null, thunder: undefined, floodAt: undefined, lostLamb: undefined, dayLength: 1e6 }, 7);
    const ts = L.def.titleShot ?? { x: 0, z: 0, angle: 0.1 };
    const a = ts.angle;
    // Towards the camera from the focus, and across the view.
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    const px = -fz;
    const pz = fx;
    const ok = (x: number, z: number) => L.insideValley(x, z) && !L.inWater(x, z) && L.waterQuery(x, z).edge > 2 && !L.penAt(x, z, -3) && L.circles.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > (c.r + 1.5) ** 2);
    const rng = sim.rng;
    let placed = 0;
    for (const s of sim.sheep.slice(0, 9)) {
      for (let k = 0; k < 30; k++) {
        // Either side of the shot, where the menu card leaves the view open.
        const along = rng.range(-2, 20);
        const across = (placed % 2 ? 1 : -1) * rng.range(22, 34);
        const x = ts.x + fx * along + px * across;
        const z = ts.z + fz * along + pz * across;
        if (!ok(x, z)) continue;
        s.x = s.homeX = x;
        s.z = s.homeZ = z;
        placed++;
        break;
      }
    }
    // The rest of the flock stays out of shot.
    for (const s of sim.sheep.slice(9)) s.state = 'hidden';
    sim.sheep.forEach((s) => {
      if (s.kind === 'lamb' && s.motherId >= 0) {
        const m = sim.sheep.find((o) => o.id === s.motherId);
        if (m && m.state !== 'hidden') {
          s.x = m.x + 1.5;
          s.z = m.z + 1;
          s.state = 'graze';
        }
      }
    });
    const dx = ts.x + fx * 22 + px * 24;
    const dz = ts.z + fz * 22 + pz * 24;
    sim.dog.x = ok(dx, dz) ? dx : ts.x + fx * 40;
    sim.dog.z = ok(dx, dz) ? dz : ts.z + fz * 40;
    sim.dog.facing = Math.atan2(ts.x - sim.dog.x, ts.z - sim.dog.z);
    this.viewSim = placed > 0 ? sim : null;
  }

  /** The card for one evening, over an establishing shot of its place in its season. */
  private openEvening(ev: Evening) {
    this.sim = null;
    this.evening = ev;
    this.progress.last = ev.id;
    saveProgress(this.progress);
    this.loadPlace(ev.rules.levelId, ev.rules.season);
    this.menuRules = ev.rules as Rules;
    this.makeViewSim({ ...ev.rules, id: 'view' });
    this.ui.renderIntro(ev, this.progress);
    this.setMode('menu');
    this.ui.show('intro');
  }
  /** Weather and light for the menu's establishing shot. */
  private menuRules: Rules | null = null;

  /**
   * Enter (or the gamepad's A) on a menu: a focused button is the player's choice (Enter clicks
   * it by itself; a gamepad press clicks it here), otherwise the screen's default action.
   */
  private confirm(fallback: () => unknown) {
    const el = document.activeElement;
    if (el instanceof HTMLButtonElement && this.ui.root.contains(el)) {
      if (this.input.device === 'gamepad') el.click();
      return;
    }
    fallback();
  }

  /** Arrow keys, WASD, the d-pad or the stick move between menu buttons; left and right choose the evening on the title. */
  private menuNav() {
    const input = this.input;
    if (this.mode === 'title' && this.howtoFrom === null) {
      if (input.pressed('left')) this.ui.cycleDifficulty(-1);
      if (input.pressed('right')) this.ui.cycleDifficulty(1);
    }
    const dir = input.pressed('up') ? -1 : input.pressed('down') ? 1 : 0;
    if (dir) this.ui.moveFocus(dir);
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.ui.setPaused(m === 'paused');
    this.input.setEnabled(m === 'playing');
    this.ui.showHud(m === 'playing' || m === 'paused');
    if (m === 'playing') this.ui.show(null);
    if (m === 'paused') this.ui.show('pause');
  }

  toTitle() {
    this.sim = null;
    this.rules = null;
    this.evening = null;
    this.menuRules = null;
    if (this.ready) {
      this.loadPlace('hollow', 'summer');
      this.makeViewSim(classicRules('standard'));
    }
    this.setMode('title');
    this.ui.show('title');
    this.ui.clearToasts();
  }

  newDay(rules: Rules) {
    if (!this.ready) return;
    this.runs++;
    this.rules = rules;
    this.loadPlace(rules.levelId, rules.season);
    this.gateOpen = this.gateTarget = 1;
    this.endCardT = 0;
    const seed = this.opts.seed + this.runs - 1;
    this.viewSim = null;
    this.sim = new Sim(this.level, rules, seed);
    this.ui.setRules(rules);
    this.audio.newDay(seed, rules);
    const d = this.sim.dog;
    this.stage.snapTo(d.x, this.terrain.height(d.x, d.z), d.z, BASE_ZOOM);
    this.ui.clearToasts();
    this.gateGlow = false;
    this.warnedAt.clear();
    this.tipsShown.clear();
    this.stalkWarned.clear();
    this.said.clear();
    this.seen.clear();
    this.bleats.clear();
    this.ui.minimap.memory = rules.weather === 'fog' ? this.seen : null;
    if (rules.weather === 'fog') for (const s of this.sim.sheep) if (s.state !== 'hidden') this.seen.set(s.id, { x: s.x, z: s.z, t: 0 });
    this.ui.minimap.refresh();
    this.stalkToast = null;
    this.dragFeasible = null;
    this.flashT = -1;
    this.cutaway = null;
    this.ui.prompt(null);
    if (rules.objective === 'watch') this.tip('move', 'Keep the flock together · run at wolves or bark (Space) to drive them off', 10, 0);
    else if (rules.tutorial || (!this.evening && this.runs === 1)) this.tip('move', 'WASD moves Pip · get behind the sheep · hold C to creep', 10, 0);
    else if (this.evening?.newThing) this.tip('new', this.evening.newThing.tip, 10, 0);
    this.setMode('playing');
  }

  private frameMs: number[] = [];
  private qualityMode: 'auto' | Quality = 'auto';
  private frameWindow: number[] = [];

  /** Auto graphics: step down a tier while most frames of play miss about 52 fps. */
  private autoQuality(ms: number) {
    if (this.qualityMode !== 'auto' || this.mode !== 'playing' || this.stage.quality === 'low') {
      this.frameWindow.length = 0;
      return;
    }
    this.frameWindow.push(ms);
    if (this.frameWindow.length < 150) return;
    const sorted = this.frameWindow.splice(0).sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)] > 19) {
      this.stage.setQuality(this.stage.quality === 'high' ? 'medium' : 'low');
      this.grass?.setFraction(GRASS_TIER[this.stage.quality]);
      this.ui.syncQuality();
    }
  }
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
    this.autoQuality(now - this.last);
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

  /** The mood (0 golden hour .. 1 night) the light should show now. */
  private moodNow(sim: Sim | null) {
    if (sim) {
      const r = sim.rules;
      if (r.objective === 'watch') return dawnTime(sim.t);
      return moodTime(sim.t, r.wolfStart ?? 0.7, r.dayLength);
    }
    if (this.titleMood !== null) return this.titleMood;
    if (this.menuRules?.objective === 'watch') return 0.94;
    return 0.28;
  }

  /** Ease the weather towards the evening's (or the menu shot's). */
  private updateWeather(rawDt: number, sim: Sim | null) {
    const r = sim?.rules ?? this.menuRules;
    const w = r?.weather ?? 'clear';
    const into = sim ? Math.min(1, sim.elapsed / 20) : 1;
    const want = {
      rain: w === 'storm' ? 0.35 + 0.65 * into : 0,
      cloud: w === 'storm' ? 0.85 : w === 'fog' ? 0.35 : w === 'snow' ? 0.3 : 0,
      mist: w === 'fog' ? (sim ? 0.95 : 0.6) : 0,
      snow: w === 'snow' ? 1 : 0,
      leaves: r?.season === 'autumn' && w !== 'storm' ? 1 : 0,
    };
    const k = 1 - Math.exp(-1.5 * rawDt);
    for (const key of Object.keys(want) as (keyof typeof want)[]) this.wx[key] += (want[key] - this.wx[key]) * k;
    if (this.flashT >= 0) {
      this.flashT += rawDt;
      // A double flicker, then darkness.
      const t = this.flashT;
      this.flash = t < 0.08 ? 1 : t < 0.16 ? 0.25 : t < 0.26 ? 0.8 : Math.max(0, 0.8 - (t - 0.26) * 4);
      if (t > 0.6) this.flashT = -1;
    } else this.flash = 0;
    this.stage.weather.cloud = this.wx.cloud;
    this.stage.weather.mist = this.wx.mist;
    this.stage.weather.flash = this.flash;
    this.stage.weather.snow = this.wx.snow;
  }

  private tick(dt: number, rawDt: number) {
    const input = this.input;
    const sim = this.sim;

    if (input.pressed('mute')) {
      const muted = this.audio.toggleMute();
      this.ui.syncSound();
      this.ui.toast(muted ? 'Sound off (M to turn it back on)' : 'Sound on', 'info');
    }
    if (this.mode !== 'playing') this.menuNav();
    if (this.mode === 'title') {
      if (input.pressed('confirm')) this.confirm(() => this.howtoFrom === null && this.openSeason());
    } else if (this.mode === 'menu') {
      if (input.pressed('pause')) this.ui.current === 'intro' ? this.openSeason() : this.toTitle();
      else if (input.pressed('confirm')) this.confirm(() => this.ui.current === 'intro' && this.evening && this.newDay(this.eveningRules(this.evening)));
    } else if (this.mode === 'playing' && sim) {
      if (this.cutaway) {
        this.cutaway.t -= rawDt;
        if (this.cutaway.t <= 0 || input.pressed('confirm') || input.pressed('pause')) this.endCutaway(sim);
      } else if (input.pressed('pause')) {
        this.setMode('paused');
      } else {
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        for (let i = 0; i < steps; i++) sim.update(dt / steps, input);
        this.audio.onEvents(sim.events, sim);
        this.effects(sim, dt);
        this.handleEvents(sim.events);
        if (this.opts.test) for (const e of sim.events) if (e.type !== 'bleat' && e.type !== 'splash') this.eventLog.push({ ...e, t: +sim.elapsed.toFixed(2) });
        sim.events.length = 0;
        this.updateHints(sim, dt);
        if (sim.rules.weather === 'fog') this.rememberSheep(sim);
        if (sim.outcome) {
          this.audio.outcome(sim.outcome.kind === 'win');
          this.setMode('ended');
          if (sim.outcome.kind === 'win' && !sim.watch) this.gateTarget = 0;
          this.endCardT = 1.2;
        }
      }
    } else if (this.mode === 'paused') {
      if (input.pressed('pause') && this.howtoFrom === null) this.setMode('playing');
      else if (input.pressed('confirm')) this.confirm(() => this.howtoFrom === null && this.setMode('playing'));
    } else if (this.mode === 'ended') {
      if (this.endCardT > 0) {
        this.endCardT -= rawDt;
        if (this.endCardT <= 0 && sim?.outcome) this.finishEvening(sim);
      } else if (input.pressed('confirm')) this.confirm(() => this.onUi(sim?.outcome?.kind === 'win' && this.evening ? 'next' : 'restart'));
    }

    if (!this.ready || !this.world || !this.actors) {
      this.stage.render();
      return;
    }
    const view = sim ? null : this.viewSim;
    this.actors.root.visible = !!(sim ?? view);
    this.updateWeather(rawDt, sim);
    const mood = this.stage.applyMood(this.moodNow(sim));
    if (view) {
      view.update(rawDt, null);
      view.elapsed = 5;
      this.actors.sync(view, rawDt, mood, false);
    }
    if (sim) {
      this.actors.sync(sim, this.mode === 'paused' ? 0 : rawDt, mood, this.mode === 'playing');
      this.ui.update(sim, this.mode === 'paused' ? 0 : dt, this.clock);
      this.ui.minimap.setMood(mood.t);
      if (this.mode === 'ended' && sim.outcome?.kind === 'win' && !sim.watch) {
        this.pipHome(sim, rawDt);
        this.frameResults();
      } else if (this.cutaway) {
        const c = this.cutaway;
        this.stage.setTitleShot(c.x, this.terrain.ground(c.x, c.z) + 1.5, c.z, c.angle, 34, 7);
      } else {
        this.frameCamera(sim);
      }
    } else {
      // Title and menus: a low shot across the place towards the evening sky, drifting to and fro.
      this.titleAngle += rawDt * 0.04;
      const ts = this.level.def.titleShot ?? { x: 0, z: 0, angle: 0.1 };
      this.stage.setTitleShot(ts.x, this.terrain.ground(ts.x, ts.z) + 1, ts.z, ts.angle + Math.sin(this.titleAngle) * 0.2);
    }
    this.audio.update(rawDt, sim, mood.t, mood.night, this.mode === 'menu' ? 'title' : this.mode, sim && this.mode === 'playing' ? this.tension(sim) : 0, this.wx);
    const tgt = this.stage.grade.target;
    const pdt = this.mode === 'paused' ? 0 : dt;
    this.particles?.update(pdt, this.stage.camera, this.clock, mood.night, tgt.height);
    this.weatherFx?.update(pdt, this.stage.camera, this.stage.focus, this.wx, mood.night, tgt.height, this.clock);
    if (this.life) this.life.pointScale = tgt.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.stage.camera.fov / 2)));
    this.life?.update(pdt, this.clock, sim, mood, this.stage.focus);
    this.updateGrass(sim);
    this.gateOpen += (this.gateTarget - this.gateOpen) * (1 - Math.exp(-3.5 * rawDt));
    const open = this.gateOpen * 1.65;
    for (const g of this.world.gates) {
      if (g.n) g.n.rotation.y = open;
      if (g.s) g.s.rotation.y = -open;
    }
    this.stage.updateCamera(this.mode === 'paused' ? 0 : rawDt);
    this.updateMist(sim);
    updateWorld(this.world, mood, this.clock, this.stage.camera, sim ? this.actors.focusPoints(sim) : [], rawDt, tgt.width, tgt.height, this.wx);
    if (sim && !this.cutaway && (this.mode === 'playing' || this.mode === 'paused')) {
      this.indicators.update(this.stage.camera, this.markers(sim));
      this.ui.fadeMap(this.behindMap(sim));
      this.ui.fadePanels(this.subjectsOnScreen(sim));
      this.ui.clearOf(this.threatsOnScreen(sim), rawDt);
    } else this.indicators.clear();
    if (sim && this.mode === 'playing') this.trackSnatch(sim, dt);
    if (this.mode === 'playing' || this.mode === 'paused') this.wolfCam.update(this.mode === 'paused' ? 0 : dt);
    else this.wolfCam.hide();
    hudState.insetVisible = this.wolfCam.visible;
    this.stage.grade.setInset(this.wolfCam.visible ? this.wolfCam.rect : null);
    hudState.insetRect = this.wolfCam.rect;
    hudState.mapRect = this.ui.mapRect();
    hudState.countsRect = this.ui.countsRect();
    hudState.bottomRects = this.ui.bottomRects();
    const forest = this.world.forest;
    this.stage.render((r, target) => {
      treeHoles(false);
      for (const f of forest) f.visible = false;
      this.wolfCam.render(r, this.stage.scene, target);
      for (const f of forest) f.visible = true;
      treeHoles(true);
    });
  }

  /** Wind in the grass, and the animals parting it as they move (nearest the camera first). */
  private updateGrass(sim: Sim | null) {
    if (!this.grass) return;
    const f = this.stage.focus;
    const push: { x: number; z: number; r: number; k: number; d: number }[] = [];
    if (sim) {
      const add = (x: number, z: number, r: number, k: number) => {
        const d = (x - f.x) ** 2 + (z - f.z) ** 2;
        if (d < 60 * 60) push.push({ x, z, r, k, d });
      };
      add(sim.dog.x, sim.dog.z, 2.6, 0.95);
      for (const s of sim.sheep) if (s.state !== 'lost' && s.state !== 'hidden') add(s.x, s.z, s.kind === 'lamb' ? 1.3 : s.kind === 'ram' ? 2.4 : 1.9, 0.75);
      for (const w of sim.wolves) if (w.state !== 'gone') add(w.x, w.z, 2.2, 0.85);
      push.sort((a, b) => a.d - b.d);
    }
    const wind = 1 + this.wx.rain * 1.3 - this.wx.mist * 0.6 - this.wx.snow * 0.3;
    this.grass.update(this.clock, wind, push);
  }

  private startCutaway(sim: Sim) {
    const d = sim.dog;
    // Look west into the sunset from just east of Pip (the low shot stands east of its focus).
    const sun = this.stage.mood.sunDir;
    const angle = Math.atan2(-sun.z, -sun.x);
    this.cutaway = { t: 3.4, x: d.x, z: d.z, angle };
    this.ui.showHud(false);
    this.indicators.clear();
  }

  private endCutaway(sim: Sim) {
    this.cutaway = null;
    this.ui.showHud(true);
    const d = sim.dog;
    this.stage.snapTo(d.x, this.terrain.height(d.x, d.z), d.z, BASE_ZOOM);
    this.stage.setFocusGoal(d.x, this.terrain.height(d.x, d.z), d.z, BASE_ZOOM);
  }

  /** Mist: the veil centred on Pip, its banks drifting with the ground under the camera. */
  private updateMist(sim: Sim | null) {
    const amount = this.wx.mist;
    let cx = 0.5;
    let cy = 0.5;
    if (sim) {
      const d = sim.dog;
      tmpV.set(d.x, this.terrain.height(d.x, d.z) + 0.8, d.z).project(this.stage.camera);
      cx = (tmpV.x + 1) / 2;
      cy = (tmpV.y + 1) / 2;
    }
    const f = this.stage.focus;
    // About 22 m of clear air round Pip (the herding view is about 42 m tall at zoom 1).
    this.stage.grade.setMist(amount, this.stage.mistColor, cx, cy, f.x * 0.045, -f.z * 0.045, sim ? 0.36 : 0.9);
  }

  /** In mist, the map remembers where Pip last saw each sheep. */
  private rememberSheep(sim: Sim) {
    const d = sim.dog;
    for (const s of sim.sheep) {
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'hidden') continue;
      if ((s.x - d.x) ** 2 + (s.z - d.z) ** 2 < 26 * 26) this.seen.set(s.id, { x: s.x, z: s.z, t: sim.elapsed });
    }
  }

  /** Results: stars, the ribbon, the season's progress, and what is next. */
  private finishEvening(sim: Sim) {
    const o = sim.outcome!;
    const ev = this.evening;
    let ribbon = false;
    let firstWin = false;
    let unlocked: string[] = [];
    if (ev && o.kind === 'win') {
      ribbon = ev.ribbon.check(sim);
      const p = this.progress;
      const before = totalStars(p);
      const prev = p.evenings[ev.id];
      firstWin = !prev || prev.stars === 0;
      p.evenings[ev.id] = { stars: Math.max(prev?.stars ?? 0, o.stars), ribbon: (prev?.ribbon ?? false) || ribbon, best: Math.max(prev?.best ?? 0, sim.folded) };
      saveProgress(p);
      const after = totalStars(p);
      unlocked = CHARMS.filter((c) => c.stars > before && c.stars <= after).map((c) => c.title);
    }
    const i = ev ? SEASON.indexOf(ev) : -1;
    this.ui.showEnd(o, sim, {
      evening: ev,
      ribbon,
      firstWin,
      next: ev && o.kind === 'win' ? (SEASON[i + 1] ?? null) : null,
      unlocked,
      seasonDone: !!ev && o.kind === 'win' && i === SEASON.length - 1,
      progress: this.progress,
    });
  }

  /**
   * Wolf cam: show a hunt the player cannot see, from the moment a wolf lines up a straggler
   * until the snatch is settled.
   */
  private trackSnatch(sim: Sim, dt: number) {
    const offScreen = (x: number, z: number) => {
      tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
      return !(tmpV.z < 1 && Math.abs(tmpV.x) < 0.98 && Math.abs(tmpV.y) < 0.96);
    };
    let best: { x: number; z: number; text: string; rank: number; id: number; heading: number } | null = null;
    for (const w of sim.wolves) {
      const s = w.target;
      if (!s || w.state === 'gone' || w.state === 'flee') continue;
      if (!offScreen(w.x, w.z)) continue;
      let rank = 0;
      let text = '';
      if (w.state === 'drag') {
        if (this.dragFeasible === false) continue;
        rank = 3;
        text = 'Snatch!';
      }
      if (rank && (!best || rank > best.rank)) best = { x: w.x, z: w.z, text, rank, id: w.id, heading: w.facing };
    }
    if (best) {
      this.insetWolf = best.id;
      const dock = this.insetDock(sim, best.x, best.z);
      this.wolfCam.track(best.x, this.terrain.height(best.x, best.z), best.z, best.heading, best.text, dock.x, dock.y, dock.point, dt);
    } else if (this.wolfCam.visible) {
      const w = sim.wolves.find((o) => o.id === this.insetWolf && o.state !== 'gone');
      if (w && !offScreen(w.x, w.z)) this.wolfCam.hide();
      else if (w) this.wolfCam.follow(w.x, this.terrain.height(w.x, w.z), w.z, w.facing, dt);
    }
  }
  private insetWolf = -1;

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
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'grabbed' || s.state === 'hidden') continue;
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
    const banner = this.ui.bannerUp;
    const SAFE = { side: 6, north: banner ? 9 : 6, south: 4 };
    const hunting = sim.wolves.some((w) => w.state === 'stalk' || w.state === 'charge' || w.state === 'drag');
    const top = (banner ? 13 : 9) + (hunting ? 4 : 0);
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
    // In mist the camera frames only what Pip can see; on a night watch the whole flock.
    const reachSheep = this.wx.mist > 0.5 ? 18 : sim.watch ? 40 : 26;
    for (const s of sim.sheep) {
      if (s.state === 'lost' || s.state === 'folded' || s.state === 'hidden') continue;
      if ((s.x - d.x) ** 2 + (s.z - d.z) ** 2 > reachSheep * reachSheep) continue;
      grow(s.x, s.z);
      grow(s.x + s.vx * 1.2, s.z + s.vz * 1.2);
      cx += s.x;
      cz += s.z;
      n++;
    }
    let framed = n > 0;
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
      const reach = w.state === 'drag' ? 52 : sim.watch ? 46 : 40;
      if ((w.x - d.x) ** 2 + (w.z - d.z) ** 2 > reach * reach) continue;
      growEss(w.x, w.z);
      growEss(w.x - 5, w.z - 6);
      growEss(w.x + 5, w.z + 3);
      if (w.target && (w.state === 'stalk' || w.state === 'charge') && (w.target.x - w.x) ** 2 + (w.target.z - w.z) ** 2 < 30 * 30) growEss(w.target.x, w.target.z);
      framed = true;
      ess.wolves++;
      if (w.state === 'drag') dragFrame = true;
    }
    const L = this.level;
    if (this.gateGlow) {
      const m = L.fold.mouth;
      if ((m.x - d.x) ** 2 + (m.z - d.z) ** 2 < 55 * 55) {
        grow(m.x, m.z);
        grow(L.fold.inside.x, L.fold.inside.z);
        framed = true;
      }
    }
    let zoom = BASE_ZOOM;
    if (framed) {
      if (n > 0) {
        cx /= n;
        cz /= n;
        // Bring the next landmark into shot (the fold gate, a bridge or a ford) when the flock is near it.
        let best: { x: number; z: number }[] | null = null;
        let bd = 42 * 42;
        const marks: { x: number; z: number }[][] = sim.watch ? [] : [[L.fold.mouth, L.fold.inside]];
        if (sim.trial && sim.gateIdx < L.gates.length) {
          const g = L.gates[sim.gateIdx];
          marks.length = 0;
          marks.push([{ x: g.ax, z: g.az }, { x: g.bx, z: g.bz }]);
        }
        for (const b of L.bridges) marks.push([b]);
        for (const f of L.fords) if (f.open) marks.push([f]);
        for (const pts of marks) {
          const p = pts[0];
          const dd = (p.x - cx) ** 2 + (p.z - cz) ** 2;
          if (dd < bd) {
            bd = dd;
            best = pts;
          }
        }
        for (const p of best ?? []) grow(p.x, p.z);
      }
      const cap = dragFrame ? 1.75 : 1.6;
      const fit = (x0: number, x1: number, z0: number, z1: number) => {
        const cx0 = fx + ((x0 + x1) / 2 - fx) * 0.85;
        const cz0 = fz + ((VIEW.north * (z1 + 8) + VIEW.south * (z0 - top)) / (VIEW.north + VIEW.south) - fz) * 0.85;
        const halfW = Math.max(x1 - cx0, cx0 - x0) + 5;
        return { x: cx0, z: cz0, zoom: Math.max(BASE_ZOOM, halfW / VIEW.half, (z1 - cz0 + 8) / VIEW.south, (cz0 - z0 + top) / VIEW.north) };
      };
      let f = fit(minX, maxX, minZ, maxZ);
      if (f.zoom > cap && ess.wolves > 0) f = fit(ess.minX, ess.maxX, ess.minZ, ess.maxZ);
      fx = f.x;
      fz = f.z;
      zoom = Math.min(cap, f.zoom);
    }
    if (d.sprinting) zoom = Math.max(zoom, BASE_ZOOM * 1.08);
    // Mist keeps the camera close: there is nothing to see further out.
    if (this.wx.mist > 0.5) zoom = Math.min(zoom, 1.25);
    this.stage.setFocusGoal(fx, this.terrain.height(d.x, d.z), fz, zoom);
  }

  /**
   * After a win the camera looks at the fold while the gate closes, with the fold and Pip in the
   * part of the screen the results card leaves free.
   */
  private frameResults() {
    const f = this.level.fold;
    const w = window.innerWidth;
    const aspect = w / Math.max(1, window.innerHeight);
    const cardRight = Math.max(24, 0.05 * w) + Math.min(520, 0.9 * w);
    const frac = Math.min(0.7, cardRight / w);
    const zoom = 1.1;
    const halfW = VIEW.half * zoom * (aspect / (16 / 9));
    const m = f.mouth;
    const freeCentre = ((frac + 1) / 2 - 0.5) * 2 * halfW;
    const cx = (m.x + f.cx) / 2;
    const cz = (m.z + f.cz) / 2;
    this.stage.setFocusGoal(cx - freeCentre, this.terrain.ground(f.cx, f.cz), cz + 2, zoom);
  }

  /** After a win Pip trots to the mouth of the fold and stands facing his flock, wagging. */
  private pipHome(sim: Sim, dt: number) {
    const d = sim.dog;
    const p = this.level.fold;
    const m = p.mouth;
    const dx = m.x - d.x;
    const dz = m.z - d.z;
    const dist = Math.hypot(dx, dz);
    d.sprinting = false;
    d.creeping = false;
    if (dist > 45) return;
    if (dist > 0.6) {
      const sp = Math.min(6.5, dist * 3);
      d.vx = (dx / dist) * sp;
      d.vz = (dz / dist) * sp;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.speed = sp;
      d.facing = Math.atan2(d.vx, d.vz);
      this.pipArrived = false;
    } else {
      d.vx = 0;
      d.vz = 0;
      d.speed = 0;
      const inw = p.inward;
      let a = Math.atan2(inw.x, inw.z) - d.facing;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      d.facing += a * (1 - Math.exp(-6 * dt));
      if (!this.pipArrived) {
        this.pipArrived = true;
        d.sinceBark = 0;
      }
    }
  }
  private pipArrived = false;

  private markers(sim: Sim): Marker[] {
    const h = (x: number, z: number) => this.terrain.height(x, z);
    const f = this.level.fold;
    const out: Marker[] = [];
    const L = this.level;
    if (sim.trial && sim.gateIdx < L.gates.length) {
      const g = L.gates[sim.gateIdx];
      out.push({ id: 'gate', kind: 'gate', x: g.x, y: h(g.x, g.z) + 2.6, z: g.z, labelOnScreen: g.name });
    }
    if (!sim.watch && !(sim.trial && sim.gateIdx < L.gates.length)) {
      const post = f.toWorld(-f.halfW - 0.6, -f.halfD * 0.5);
      const ins = f.toWorld(-f.halfW + 2, 0);
      out.push({
        id: 'fold',
        kind: 'fold',
        x: this.gateGlow ? post.x : ins.x,
        y: h(f.gate.x, f.gate.z) + (this.gateGlow ? 3.4 : 3),
        z: this.gateGlow ? post.z : ins.z,
        labelOnScreen: this.gateGlow ? (this.ui.promptIsChip ? 'Enter: latch the gate' : undefined) : sim.elapsed < 45 ? 'Fold' : undefined,
      });
    }
    const shown = this.wolfCam.visible ? sim.wolves.find((w) => w.id === this.insetWolf && w.state !== 'gone') : undefined;
    for (const s of sim.sheep) {
      if (s.state === 'grabbed' && shown?.target !== s) out.push({ id: `g${s.id}`, kind: 'grab', x: s.x, y: h(s.x, s.z) + 1, z: s.z, muted: this.dragFeasible === false });
    }
    const snatch = sim.wolves.some((w) => w.state === 'drag');
    const misty = this.wx.mist > 0.5;
    for (const w of sim.wolves) {
      if ((w.state === 'stalk' || w.state === 'charge') && w !== shown && !snatch && (!misty || Math.hypot(w.x - sim.dog.x, w.z - sim.dog.z) < 40)) out.push({ id: `w${w.id}`, kind: 'wolf', x: w.x, y: h(w.x, w.z) + 1, z: w.z });
    }
    // If no loose sheep is in view, point at the nearest one (in mist: the nearest Pip remembers).
    const cam = this.stage.camera;
    const d = sim.dog;
    let nearest: { x: number; z: number } | null = null;
    let nd = Infinity;
    let anyVisible = false;
    for (const s of sim.sheep) {
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'grabbed' || s.state === 'hidden') continue;
      tmpV.set(s.x, h(s.x, s.z) + 0.8, s.z).project(cam);
      if (tmpV.z < 1 && Math.abs(tmpV.x) < 1.03 && Math.abs(tmpV.y) < 1.03 && (!misty || (s.x - d.x) ** 2 + (s.z - d.z) ** 2 < 26 * 26)) anyVisible = true;
      const p = misty ? this.seen.get(s.id) : s;
      if (!p) continue;
      const dd = (p.x - d.x) ** 2 + (p.z - d.z) ** 2;
      if (dd < nd) {
        nd = dd;
        nearest = p;
      }
    }
    if (!anyVisible && nearest && !snatch) out.push({ id: 'stray', kind: 'sheep', x: nearest.x, y: h(nearest.x, nearest.z) + 1, z: nearest.z });
    // In mist a bleat shows where it came from, for a moment.
    for (const [id, b] of this.bleats) {
      if (b.until < sim.elapsed) this.bleats.delete(id);
      else out.push({ id: `bleat${id}`, kind: 'sheep', x: b.x, y: h(b.x, b.z) + 1.2, z: b.z, iconOnScreen: true });
    }
    if (this.runs === 1 && sim.elapsed < 20 && (sim.rules.tutorial || !this.evening)) {
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
          p.ripple(d.x, d.z, 1.5, sim.barkRadius, 0.55);
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
        case 'folded': {
          p.heart(e.x, e.z);
          p.ripple(e.x, e.z, 0.8, 4, 0.5);
          const i = sim.sheep.findIndex((s) => s.id === e.id);
          if (i >= 0) this.actors.hop(i);
          break;
        }
        case 'charge':
          p.dust(e.x, e.z, 0, 0, 1.3);
          break;
        case 'bleat': {
          const i = sim.sheep.findIndex((s) => s.id === e.id);
          if (i >= 0) this.actors.bleat(i);
          if (sim.rules.weather === 'fog') this.bleats.set(e.id, { x: e.x, z: e.z, until: sim.elapsed + 1.8 });
          break;
        }
        case 'butt':
          p.dust(e.x, e.z, 0, 0, 1.5);
          p.ripple(e.x, e.z, 0.6, 3.5, 0.5);
          this.stage.addShake(e.wolf ? 0.2 : 0.45);
          this.hitStop = Math.max(this.hitStop, 0.08);
          break;
        case 'stamp':
          p.dust(e.x, e.z, 0, 0, 0.9);
          break;
        case 'spook':
          p.ripple(e.x, e.z, 0.8, 6, 0.35);
          break;
        case 'ramYield':
          p.ripple(e.x, e.z, 1, 5, 0.4);
          break;
        case 'lambFound':
          p.heart(e.x, e.z);
          break;
        case 'thunder':
          this.flashT = 0;
          this.stage.addShake(0.5);
          break;
        case 'gate':
          if (e.passed) {
            p.ripple(e.x, e.z, 1, 6, 0.6);
            p.heart(e.x, e.z);
          }
          break;
      }
    }
    for (const f of this.actors.footfalls) p.dust(f.x, f.z, f.dx, f.dz, f.size * (this.wx.snow > 0.5 ? 1.2 : 1));
    this.actors.footfalls.length = 0;
    this.dustT += dt;
    if (this.dustT < 0.1) return;
    this.dustT = 0;
    for (const w of sim.wolves) {
      if (w.state !== 'drag' || !w.target) continue;
      const sp = Math.hypot(w.vx, w.vz) || 1;
      if (Math.random() < 0.6) p.dust(w.target.x - (w.vx / sp) * 0.9, w.target.z - (w.vz / sp) * 0.9, w.vx / sp, w.vz / sp, 1.2);
      if (Math.random() < 0.3) p.tufts(w.target.x, w.target.z, 2);
    }
  }

  /** 0..1: how close the danger is, for the music. */
  private tension(sim: Sim) {
    const d = sim.dog;
    let t = sim.timeLeft < 60 && !sim.watch ? 0.3 + 0.3 * (1 - sim.timeLeft / 60) : 0;
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

  private once(id: string, fn: () => void) {
    if (this.said.has(id)) return;
    this.said.add(id);
    fn();
  }

  private handleEvents(events: SimEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'dusk':
          this.ui.toast('The sun is setting. Wolves are stirring in the pines.', 'warn');
          if (this.sim && !this.sim.watch && !this.opts.noCutaway) this.startCutaway(this.sim);
          break;
        case 'dawn':
          this.ui.toast('Dawn is breaking! The wolves slink back to the woods.', 'good');
          break;
        case 'wolfSpawn': {
          const d = this.sim?.dog;
          if (!d) break;
          if (Math.hypot(e.tx - d.x, e.tz - d.z) >= 26) this.ui.toast(`A wolf is after the sheep ${this.level.placeName(e.tx, e.tz)}!`, 'warn');
          break;
        }
        case 'grab':
          this.stage.addShake(0.35);
          break;
        case 'lost':
          this.ui.toast('A sheep was dragged into the woods.', 'danger');
          break;
        case 'rescued':
          this.ui.toast('Sheep rescued!', 'good');
          break;
        case 'bark':
          this.stage.addShake(0.12);
          break;
        case 'butt':
          if (!e.wolf) this.once('butt', () => this.ui.toast('Angus butts Pip away! Stand still near him, or bark, to stare him down', 'warn'));
          else this.once('buttWolf', () => this.ui.toast('Angus sees the wolf off with his horns!', 'good'));
          break;
        case 'ramYield':
          this.once('yield', () => this.ui.toast('Angus gives way: the ewes will follow him', 'good'));
          break;
        case 'lambFound':
          this.ui.toast('You found the lost lamb! It follows Pip: lead it to the fold', 'good');
          break;
        case 'flood':
          this.ui.toast('The stream has flooded: the ford is gone! Use the bridge', 'danger');
          this.ui.minimap.refresh();
          break;
        case 'gate': {
          const next = this.level.gates[e.index + 1];
          if (e.passed) this.ui.toast(`Through the ${e.name.toLowerCase()}!${next ? ` Now the ${next.name.toLowerCase()}` : ' Now pen them'}`, 'good');
          else this.ui.toast(`Missed the ${e.name.toLowerCase()}: -15 points`, 'warn');
          break;
        }
        default:
          break;
      }
    }
  }

  private warnedAt = new Set<number>();
  private tipsShown = new Set<string>();
  private tipUntil = 0;
  private farT = 0;
  private dragHint = false;
  private dragFeasible: boolean | null = null;
  private stalkWarned = new Set<number>();
  private stalkToast: { id: number; text: string } | null = null;

  /** Is Pip or a loose sheep (or the fold while sheep go in) under the minimap? Then it fades. */
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
    if (under(sim.dog.x, sim.dog.z)) return true;
    if (sim.sheep.some((s) => s.state !== 'lost' && s.state !== 'folded' && s.state !== 'hidden' && under(s.x, s.z))) return true;
    const f = this.level.fold;
    const m = f.mouth;
    const nearGate = sim.sheep.some((s) => s.state !== 'lost' && s.state !== 'folded' && (s.x - m.x) ** 2 + (s.z - m.z) ** 2 < 30 * 30);
    const corners = [f.toWorld(-f.halfW, 0), f.toWorld(0, 0), f.toWorld(f.halfW, -f.halfD), f.toWorld(f.halfW, f.halfD)];
    return nearGate && corners.some((c) => under(c.x, c.z));
  }

  private threatsOnScreen(sim: Sim) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const out: { x: number; y: number }[] = [];
    const add = (x: number, z: number) => {
      tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 1 || Math.abs(tmpV.y) > 1) return;
      out.push({ x: ((tmpV.x + 1) / 2) * w, y: ((1 - tmpV.y) / 2) * h });
    };
    for (const wf of sim.wolves) {
      if (wf.state === 'gone' || wf.state === 'flee') continue;
      add(wf.x, wf.z);
      if (wf.state === 'drag' && wf.target) add(wf.target.x, wf.target.z);
    }
    return out;
  }

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
    for (const s of sim.sheep) if (s.state !== 'folded' && s.state !== 'lost' && s.state !== 'hidden') add(s.x, s.z);
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

  private onScreen(x: number, z: number) {
    tmpV.set(x, this.terrain.height(x, z) + 0.8, z).project(this.stage.camera);
    return tmpV.z < 1 && Math.abs(tmpV.x) < 0.9 && Math.abs(tmpV.y) < 0.85;
  }

  /** Show a tutorial tip once, for `seconds` of play. */
  private tip(id: string, text: string, seconds: number, now: number) {
    if (this.tipsShown.has(id) || this.dragHint) return;
    if (['ring', 'sprint', 'wolf'].includes(id) && this.tipsEver.has(id)) return;
    this.tipsShown.add(id);
    this.tipsEver.add(id);
    this.ui.hint(text);
    this.tipUntil = now + seconds;
    this.tipId = id;
  }
  private tipId = '';

  /** Tips fire when the situation they explain comes up; the latch prompt shows once it matters. */
  private updateHints(sim: Sim, dt: number) {
    const t = sim.elapsed;
    const d = sim.dog;
    for (const s of [60, 30]) {
      if (sim.timeLeft <= s && !this.warnedAt.has(s)) {
        this.warnedAt.add(s);
        if (sim.timeLeft < s - 4) continue;
        if (sim.watch) {
          this.ui.toast(s === 60 ? 'One minute until dawn: hold on!' : 'Dawn in 30 seconds!', 'warn');
          continue;
        }
        const what = sim.targetMet ? 'latch the gate or bring the rest in!' : `${Math.max(0, sim.target - sim.folded)} more sheep needed!`;
        this.ui.toast(s === 60 ? `One minute until nightfall: ${what}` : `Night falls in 30 seconds: ${what}`, 'danger');
      }
    }

    const grabbed = sim.sheep.some((s) => s.state === 'grabbed');
    const dragger = sim.wolves.find((w) => w.state === 'drag' && w.target);
    if (dragger?.target) {
      const s = dragger.target;
      const far = Math.hypot(s.x - d.x, s.z - d.z);
      const eta = sim.dragEta(dragger);
      const secs = Math.max(1, Math.ceil(eta));
      const margin = eta - sim.rescueEta(dragger.x, dragger.z);
      if (this.dragFeasible === null) this.dragFeasible = margin > 0.5;
      else if (this.dragFeasible && margin < -1) this.dragFeasible = false;
      else if (!this.dragFeasible && margin > 1.5) this.dragFeasible = true;
      const place = this.level.placeName(s.x, s.z);
      const what = s.kind === 'lamb' ? 'lamb' : 'sheep';
      const inRange = Math.hypot(dragger.x - d.x, dragger.z - d.z) < sim.barkWolfRadius - 1;
      if (inRange || far < 16) {
        this.ui.alert(`A wolf has one of your ${what === 'lamb' ? 'lambs' : 'sheep'}! ${secs} s to save it`, inRange ? 'Bark (Space) now: it drops the sheep!' : 'Run at it or bark (Space) near it: it drops the sheep');
        this.ui.hint('');
      } else if (this.dragFeasible) {
        const dist = Math.round(Math.hypot(dragger.x - d.x, dragger.z - d.z));
        this.ui.alert(`A wolf has a ${what} ${place}! ${this.arrowTo(dragger.x, dragger.z)} ${dist} m · ${secs} s to save it`, 'Sprint (Shift) to it, then run at it or bark (Space) near it');
        this.ui.hint('');
      } else {
        this.ui.alert(`A wolf is carrying a ${what} off ${place}! ${this.arrowTo(dragger.x, dragger.z)}`, 'Too far to save it: keep the rest of the flock together', true);
        this.ui.hint('');
      }
      this.dragHint = true;
      this.tipUntil = 0;
    } else {
      this.dragFeasible = null;
      this.ui.alert(null);
      if (this.dragHint) {
        this.dragHint = false;
        this.ui.hint('');
      }
    }

    for (const w of sim.wolves) {
      if (w.state !== 'stalk' || !w.target || this.stalkWarned.has(w.id)) continue;
      const s = w.target;
      const visible = this.onScreen(w.x, w.z);
      const nearPip = Math.hypot(s.x - d.x, s.z - d.z) < 26;
      if (nearPip ? !visible : Math.hypot(w.x - s.x, w.z - s.z) > 20) continue;
      this.stalkWarned.add(w.id);
      const arrow = visible ? '' : ` ${this.arrowTo(w.x, w.z)}`;
      const prey = s.kind === 'lamb' ? 'a lamb' : 'the sheep';
      const text = nearPip ? `A wolf is stalking your flock!${arrow}` : `A wolf is stalking ${prey} ${this.level.placeName(s.x, s.z)}!${arrow}`;
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
    this.ui.prompt(this.gateGlow ? 'Target met! <kbd>Enter</kbd> latches the gate, or herd more for stars' : null, 'Target met · <kbd>Enter</kbd> latches the gate');
    if (this.gateGlow && !wasGlowing) this.ui.dropInfoToast();
    if (this.gateGlow && this.tipUntil > 0) {
      this.tipUntil = 0;
      this.ui.hint('');
    }

    const wolvesOut = sim.rules.wolfStart !== null && sim.t >= sim.rules.wolfStart;
    let nearest = Infinity;
    for (const s of sim.sheep) {
      if (s.state === 'folded' || s.state === 'lost' || s.state === 'grabbed' || s.state === 'hidden') continue;
      nearest = Math.min(nearest, Math.hypot(s.x - d.x, s.z - d.z));
    }
    if (!wolvesOut && nearest < 22 && !sim.watch) {
      if (t > 20 || this.runs > 1) this.tip('ring', 'Hold C to creep: the dashed ring shrinks and the sheep stay calmer', 9, t);
    }
    // Angus: explain the stare the first time Pip squares up to him.
    const ram = sim.sheep.find((s) => s.kind === 'ram' && s.state !== 'folded' && s.state !== 'lost');
    if (ram && ram.stubborn > 0.15 && Math.hypot(ram.x - d.x, ram.z - d.z) < 14) this.tip('ram', 'Angus stands his ground: stand still or creep (C) near him to stare him down, or bark (Space)', 9, t);
    this.farT = nearest > 45 && nearest < Infinity ? this.farT + dt : 0;
    if (!wolvesOut && this.farT > 3 && this.tipsShown.has('ring')) this.tip('sprint', 'Long way to the next sheep? Hold Shift to sprint', 6, t);
    if (sim.wolves.some((w) => (w.state === 'stalk' || w.state === 'charge') && Math.hypot(w.x - d.x, w.z - d.z) < 30 && this.onScreen(w.x, w.z))) {
      this.tip('wolf', 'Wolves run from Pip: run at one or bark (Space) to drive it off', 7, t);
    }
    const wolfAbout = sim.wolves.some((w) => (w.state === 'stalk' || w.state === 'charge' || w.state === 'drag') && Math.hypot(w.x - d.x, w.z - d.z) < 40);
    if (this.tipUntil > 0 && (t > this.tipUntil || (this.tipId === 'wolf' && !wolfAbout))) {
      this.tipUntil = 0;
      this.ui.hint('');
    }
  }

  /** Events since the last call (test mode only; for the film script's cut marks). */
  eventLog: Record<string, unknown>[] = [];
  /** Film: the title shot at another time of the evening (null: the usual golden hour). */
  titleMood: number | null = null;

  /** Test hook: open an evening's card, or start it at once. */
  testEvening(id: string, begin: boolean) {
    const ev = SEASON.find((e) => e.id === id);
    if (!ev) return false;
    this.openEvening(ev);
    if (begin) this.newDay(this.eveningRules(ev));
    return true;
  }

  testClassic(d: Difficulty) {
    this.ui.setDifficulty(d);
    this.evening = null;
    this.newDay(classicRules(d));
  }

  testProgress(what: 'reset' | 'all') {
    this.progress = what === 'reset' ? { evenings: {}, charms: [] } : { evenings: Object.fromEntries(SEASON.map((e) => [e.id, { stars: 2, ribbon: false }])), charms: [] };
    saveProgress(this.progress);
    this.ui.renderSeason(this.progress);
    return totalStars(this.progress);
  }

  /**
   * Walkability on a 2 m grid for the bot's path planner: 0 open, 1 water sheep refuse, 2 solid
   * (walls, rocks, buildings, outside the valley), 3 a crossing (bridge deck or open ford).
   */
  navGrid() {
    const L = this.level;
    const w = L.def.world;
    const step = 2;
    const nx = Math.round((w.maxX - w.minX) / step) + 1;
    const nz = Math.round((w.maxZ - w.minZ) / step) + 1;
    const cells = new Array<number>(nx * nz).fill(0);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = w.minX + ix * step;
        const z = w.minZ + iz * step;
        let v = 0;
        if (!L.insideValley(x, z)) v = 2;
        else if (L.crossingAt(x, z)) v = 3;
        else if (L.inWater(x, z) || L.waterQuery(x, z).edge < 1) v = 1;
        else if (L.circles.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 1) ** 2)) v = 2;
        else if (L.rects.some((r) => x > r.minX - 1.2 && x < r.maxX + 1.2 && z > r.minZ - 1.2 && z < r.maxZ + 1.2)) v = 2;
        else {
          for (const s of L.segs) {
            if (s.tag === 'gate' || s.tag === 'boundary') continue;
            const dx = s.bx - s.ax;
            const dz = s.bz - s.az;
            const l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
            if ((x - s.ax - dx * t) ** 2 + (z - s.az - dz * t) ** 2 < (s.r + 1.3) ** 2) {
              v = 2;
              break;
            }
          }
        }
        cells[iz * nx + ix] = v;
      }
    }
    const f = L.fold;
    return {
      minX: w.minX,
      minZ: w.minZ,
      step,
      nx,
      nz,
      cells,
      fold: { gate: f.gate, mouth: f.mouth, inside: f.inside, inward: f.inward, center: { x: f.cx, z: f.cz } },
      farmhouse: L.rects[0] ?? null,
    };
  }

  /** Debug snapshot for the Playwright bot. */
  snapshot() {
    const s = this.sim;
    return {
      mode: this.mode,
      screen: this.ui.current,
      fps: Math.round(this.fps() * 10) / 10,
      difficulty: this.ui.difficulty,
      evening: this.evening?.id ?? null,
      levelId: this.level.def.id,
      objective: s?.rules.objective ?? null,
      outcome: s?.outcome ?? null,
      t: s?.t ?? 0,
      elapsed: s?.elapsed ?? 0,
      folded: s?.folded ?? 0,
      lost: s?.lost ?? 0,
      total: s?.total ?? 0,
      target: s?.target ?? 0,
      fords: this.level.fords.map((f) => f.open),
      dog: s ? { x: s.dog.x, z: s.dog.z, vx: s.dog.vx, vz: s.dog.vz, stamina: s.dog.stamina, barkCd: s.dog.barkCd, stunT: s.dog.stunT } : null,
      sheep: s ? s.sheep.map((q) => ({ id: q.id, x: q.x, z: q.z, state: q.state, kind: q.kind, stubborn: q.stubborn, yieldT: q.yieldT, motherId: q.motherId })) : [],
      wolves: s ? s.wolves.filter((w) => w.state !== 'gone').map((w) => ({ id: w.id, x: w.x, z: w.z, state: w.state })) : [],
      dragFeasible: this.dragFeasible,
      /** Trial: the next gate (posts a and b, middle x z) and the results so far. */
      gateIdx: s?.gateIdx ?? 0,
      gate: s && s.trial && s.gateIdx < this.level.gates.length ? this.level.gates[s.gateIdx] : null,
      score: s?.trial ? s.trialScore() : null,
      progress: { stars: totalStars(this.progress), evenings: this.progress.evenings },
    };
  }
}

const tmpV = new THREE.Vector3();
/** Share of the grass field drawn at each graphics tier. */
const GRASS_TIER: Record<Quality, number> = { high: 1, medium: 0.55, low: 0.2 };
/** The herding camera's usual distance (1 = the configured offset). */
const BASE_ZOOM = 0.98;
const QUALITY_KEY = 'woolgather.quality';

function loadQuality(): 'auto' | Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (q === 'auto' || (q && q in QUALITY_TIERS)) return q as 'auto' | Quality;
  } catch {
    // Storage blocked: Auto.
  }
  return 'auto';
}

function saveQuality(q: 'auto' | Quality) {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    // Not remembered: fine.
  }
}

/** Ground in view at zoom 1 around the focus (metres): across, towards the camera, away from it. */
const VIEW = { half: 27.3, south: 17.8, north: 24.3 };
