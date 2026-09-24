import './style.css';
import type { Difficulty } from './game/config';
import { Game } from './game/game';
import { PerfOverlay } from './ui/perf';

const params = new URLSearchParams(location.search);
const test = params.has('test');
const seedParam = Number(params.get('seed'));
const diff = params.get('diff') as Difficulty | null;

const game = new Game(document.getElementById('app')!, {
  seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : (Date.now() % 100000) + 1,
  test,
  difficulty: diff === 'gentle' || diff === 'standard' || diff === 'hard' ? diff : undefined,
});
if (params.has('fps')) game.perf = new PerfOverlay(game.stage.renderer);
game.start();

if (test) {
  // Test hooks for the Playwright self-test. Read-only except the time scale.
  (window as unknown as { __WG: unknown }).__WG = {
    state: () => game.snapshot(),
    setTimeScale: (k: number) => {
      game.timeScale = k;
    },
    /** Jump the day clock (0..1) for look-dev screenshots. */
    jumpTo: (t: number) => {
      if (game.sim) game.sim.elapsed = t * game.sim.preset.dayLength;
    },
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
    level: game.level.data,
  };
}
