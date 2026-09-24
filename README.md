# Woolgather

Herd the flock home before nightfall.

You are Pip, a border collie in a highland valley at golden hour. The sheep have scattered across
the hills, the sun is going down, and wolves come out after dark. Drive the flock over the bridge
and through the gate of the stone fold by the farmhouse before night falls.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5317/ (the port is fixed so it never collides with the sibling games
in the parent folder). Production build:

```bash
npm run build
npm run preview
```

Requires Node 20+ and a WebGL2-capable browser.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | WASD or Arrow keys | Left stick |
| Sprint (uses stamina) | Shift | RT or RB |
| Creep (sheep stay calm until you are close) | C (hold) | LT or LB |
| Bark (startles sheep, scares wolves) | Space or B | A or X |
| Latch the gate once enough sheep are home | Enter | Y |
| Pause | Esc or P | Start |

## How to play

- Sheep run away from you as a group. Stand *behind* the flock, on the far side from where you
  want it to go, and it will move ahead of you.
- Get too close, sprint, or bark and they scatter. Creep to get around a flock without spooking it.
- Sheep will not wade the stream. Use the wooden bridge or the shallow ford with stepping stones.
- Once the sun sets, wolves come out of the pines to snatch stragglers. Run into them or bark to
  make them drop their prey and flee.
- You win when every sheep still yours is in the fold (and you have at least the day's target),
  when night falls with the target met, or when you latch the gate early after meeting it.
- You lose if night falls before the target is met, or if wolves take so many sheep the target is
  out of reach.

## Credits and tech

- Built with Vite, TypeScript and Three.js.
- Every model was made in Blender with the Python scripts in `blender_scripts/` (one script per
  asset family) and exported to `public/assets/` as glTF binaries. `npm run assets` rebuilds them
  (needs Blender 5.x on PATH or in `BLENDER_PATH`).
- All sound effects and music are synthesized live with the Web Audio API. No audio files.
- Fonts: Fraunces and Nunito (SIL Open Font License), bundled from npm.
