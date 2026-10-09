// Bundled fonts (SIL Open Font License), no network fetch: Fraunces with its soft axis for
// display type, Nunito for everything else.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/fraunces/soft-italic.css';
import '@fontsource-variable/nunito';
import './style.css';
import type { Difficulty } from './game/config';
import { Game } from './game/game';
import { PerfOverlay } from './ui/perf';
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const test = params.has('test');
const seedParam = Number(params.get('seed'));
const diff = params.get('diff') as Difficulty | null;
const quality = params.get('quality');

const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `<div class="loading-title">Woolgather</div><div class="loading-bar"><div class="loading-fill"></div></div><div class="loading-note">Gathering the flock…</div>`;
document.body.appendChild(loading);
const fill = loading.querySelector('.loading-fill') as HTMLElement;

const game = new Game(document.getElementById('app')!, {
  seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : (Date.now() % 100000) + 1,
  test,
  difficulty: diff === 'gentle' || diff === 'standard' || diff === 'hard' ? diff : undefined,
  quality: quality === 'auto' || quality === 'high' || quality === 'medium' || quality === 'low' ? quality : undefined,
  noCutaway: params.has('nocutaway'),
});
if (params.has('fps')) game.perf = new PerfOverlay(game.stage.renderer);
game.start();

game
  .init((done, total) => {
    fill.style.width = `${Math.round((done / total) * 100)}%`;
  })
  .then(() => {
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 600);
    if (test) exposeTestHooks();
  })
  .catch((err) => {
    console.error(err);
    (loading.querySelector('.loading-note') as HTMLElement).textContent = 'The valley failed to load. Please reload the page.';
  });

function exposeTestHooks() {
  // Test hooks for the Playwright self-test. Read-only except the time scale and scenario setup.
  (window as unknown as { __WG: unknown }).__WG = {
    state: () => game.snapshot(),
    /** Is the audio running, and how many sounds have played. */
    audioState: () => game.audio.debug(),
    setTimeScale: (k: number) => {
      game.timeScale = k;
    },
    get level() {
      return game.level.def;
    },
    /** Events since the last call, each with the day clock t (film cut marks). */
    drain: () => game.eventLog.splice(0),
    /** Film: show the title shot at mood time t (0 golden hour .. 1 night), or null for the default. */
    titleMood: (t: number | null) => {
      game.titleMood = t;
    },
    /** The graphics tier in use (and whether Auto chose it). */
    quality: () => ({ tier: game.stage.quality }),
    /** GPU timing for the perf test: start, then read the mean per frame since the last read. */
    gpuStart: () => game.stage.startGpuTimer(),
    gpuTime: () => game.stage.takeGpuTime(),
    /** Perf analysis: the heaviest meshes by triangles drawn (instances included). */
    heavy: () => {
      const out: { name: string; tris: number; count: number; shadow: boolean; transparent: boolean }[] = [];
      game.stage.scene.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position: { count: number } } }; count?: number; castShadow: boolean; material: { transparent?: boolean } | { transparent?: boolean }[]; name: string; visible: boolean };
        if (!m.isMesh || !m.geometry || !o.visible) return;
        const g = m.geometry;
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const count = (m as { count?: number }).count ?? 1;
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        out.push({ name: `${o.parent?.name ?? ''}/${o.name}`, tris: tris * count, count, shadow: m.castShadow, transparent: !!mat?.transparent });
      });
      out.sort((a, b) => b.tris - a.tris);
      // Meshes grouped by parent name (each one is at least one draw call, two if it casts shadows).
      const groups: Record<string, number> = {};
      for (const o of out) groups[o.name.split('/')[0] || '(root)'] = (groups[o.name.split('/')[0] || '(root)'] ?? 0) + 1;
      const topGroups = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 20);
      return { total: out.reduce((a, b) => a + b.tris, 0), shadowTris: out.filter((o) => o.shadow).reduce((a, b) => a + b.tris, 0), top: out.slice(0, 25), meshCount: out.length, shadowMeshes: out.filter((o) => o.shadow).length, groups: topGroups };
    },
    /** Look-dev: the visible objects whose world position projects within r px of a screen point. */
    near: (px: number, py: number, r = 60) => {
      const out: { name: string; type: string; d: number; x: number; z: number }[] = [];
      const cam = game.stage.camera;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const v = new THREE.Vector3();
      game.stage.scene.traverseVisible((o) => {
        o.getWorldPosition(v);
        const wx = v.x;
        const wz = v.z;
        v.project(cam);
        if (v.z > 1) return;
        const sx = ((v.x + 1) / 2) * w;
        const sy = ((1 - v.y) / 2) * h;
        const d = Math.hypot(sx - px, sy - py);
        if (d < r) out.push({ name: `${o.parent?.name ?? ''}/${o.name}`, type: o.type, d: Math.round(d), x: Math.round(wx), z: Math.round(wz) });
      });
      return out.sort((a, b) => a.d - b.d).slice(0, 30);
    },
    /** The player's wheel zoom (1 = default; 0.5 = all the way in, tilted to the horizon). */
    zoom: (z: number) => {
      game.stage.userZoom = z;
    },
    /** Look-dev: what the camera sees at a screen point (nearest hits first). */
    pick: (px: number, py: number) => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1), game.stage.camera);
      return ray.intersectObjects(game.stage.scene.children, true).slice(0, 6).map((h) => {
        const m = (h.object as THREE.Mesh).material as THREE.Material | undefined;
        return { name: `${h.object.parent?.name ?? ''}/${h.object.name}`, type: h.object.type, mat: m?.type, matName: m?.name, d: Math.round(h.distance * 10) / 10, y: Math.round(h.point.y * 100) / 100 };
      });
    },
    /** Look-dev: the current values of a named uniform on every material in the scene that has it. */
    uniform: (name: string) => {
      const out: { mesh: string; value: unknown }[] = [];
      game.stage.scene.traverseVisible((o) => {
        const m = (o as unknown as { material?: { uniforms?: Record<string, { value: unknown }> } }).material;
        const u = m?.uniforms?.[name];
        if (u) out.push({ mesh: `${o.parent?.name ?? ''}/${o.name}`, value: u.value });
      });
      return out;
    },
    /** Perf analysis: switch a costly feature off or on. */
    toggle: (what: string, on: boolean) => {
      const st = game.stage;
      if (what === 'shadows') st.setShadows(on);
      if (what === 'bloom') st.grade.bloomOff = !on;
      if (what === 'msaa') st.grade.setSamples(on ? 4 : 0);
    },
    /** Renderer counts for the last frame, for the perf test. */
    perf: () => {
      const i = game.stage.renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
    },
    /** Look-dev: show the render with or without the colour grade. */
    setGrade: (on: boolean) => {
      game.stage.grade.enabled = on;
    },
    /** Jump the day clock (0..1) for look-dev screenshots. */
    jumpTo: (t: number) => {
      if (game.sim) game.sim.elapsed = t * game.sim.rules.dayLength;
    },
    /** Look-dev: put Pip somewhere so the camera frames that part of the valley. */
    teleportDog: (x: number, z: number) => {
      const s = game.sim;
      if (!s) return;
      s.dog.x = x;
      s.dog.z = z;
      game.stage.snapTo(x, game.terrain.height(x, z), z);
    },
    /** Season: open an evening's card (unlocking the season if asked), or begin it at once. */
    evening: (id: string, begin = false) => game.testEvening(id, begin),
    /** Classic evening at a difficulty. */
    classic: (d: Difficulty) => game.testClassic(d),
    /** Season progress: wipe it, or mark every evening won (to test the map and charms). */
    progress: (what: 'reset' | 'all') => game.testProgress(what),
    /**
     * Walkability for the bot's path planner on a 2 m grid over the level: 0 open ground, 1 water
     * (sheep refuse it), 2 solid (walls, rocks, buildings, outside the valley), 3 a crossing.
     */
    navGrid: () => game.navGrid(),
    /** Scenario setup: walk `n` loose sheep straight into the fold (they count next frame). */
    placeInFold: (n: number) => {
      const s = game.sim;
      if (!s) return 0;
      const f = game.level.fold;
      let moved = 0;
      for (const q of s.sheep) {
        if (moved >= n) break;
        if (q.state === 'folded' || q.state === 'lost' || q.state === 'grabbed') continue;
        q.x = f.cx + ((moved % 4) - 1.5) * 2;
        q.z = f.cz + (Math.floor(moved / 4) - 1) * 2;
        moved++;
      }
      return moved;
    },
  };
}
