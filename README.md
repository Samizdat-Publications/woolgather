# Woolgather

**Herd the flock home before nightfall.** A cosy-tense sheepdog game in the browser, built with
Vite, TypeScript and Three.js.

![Herding in the golden hour](screenshots/02-golden-hour.png)

You are Pip, a border collie in a highland valley at golden hour. The flock has scattered across
the hills, the sun is going down, and when it sets the wolves come out. Herd every sheep you can
into the stone fold by the farmhouse before night falls.

Sheep are a real flock: they graze, bunch together when nervous and flee from you as a group. You
steer them by *where you stand*, not by pushing them one at a time. Creep up quietly, get behind
the flock, drive it over the bridge and through the fold gate. When the gold turns to a rose sunset
the wolves slip out of the pines to snatch stragglers: chase them off or bark them away before they
drag a sheep into the trees. Night falls in violet and moonlight.

| | |
| --- | --- |
| ![The title screen](screenshots/01-title.png) | ![A wolf stalks the flock under the rose sunset](screenshots/03-wolf.png) |
| ![A snatch: sprint at it and bark](screenshots/04-snatch.png) | ![Nightfall at the fold](screenshots/05-night.png) |

![Every sheep is home: the day's results beside the fold](screenshots/06-win.png)

## Play it

```bash
npm install
npm run dev
```

Then open http://localhost:5317/ (the port is fixed so it never collides with the sibling games in
the parent folder). For the production build:

```bash
npm run build
npm run preview
```

and open http://localhost:4317/. Needs Node 20 or newer and a browser with WebGL 2.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move Pip | WASD or arrow keys | Left stick |
| Sprint (uses stamina) | Shift | RT or RB |
| Creep: sheep stay calm until you are close | C (hold) | LT or LB |
| Bark: startles sheep, scares wolves off | Space or B | A or X |
| Latch the gate once enough sheep are home | Enter | Y |
| Pause (sound and graphics settings) | Esc or P | Start |
| Sound on or off | M | |

Menus work with the mouse, the keyboard (arrows or WASD move between buttons, Enter chooses, left
and right pick the evening on the title) or a gamepad (d-pad or stick, A chooses).

## How to play

- Sheep move **away** from Pip. Stand on the far side of a flock from where you want it to go and
  it trots on ahead of you. The dashed ring round Pip is his reach: sheep inside it move away.
  Creeping shrinks it, sprinting grows it, a bark startles everything near.
- Sheep will not wade the stream: cross at the wooden bridge or the shallow ford.
- Drive them through the gate of the stone fold by the farmhouse. The counter shows how many are
  home, the target, a pip for every sheep and how many more you can afford to lose.
- When the sun sets (the red notch on the sun bar) wolves come out of the pines for stragglers.
  Run at a wolf or bark and it drops its prey. A snatch out of sight shows in a close-up at the
  left edge, with the time left to save the sheep.
- Once the target is met, Enter latches the gate and ends the day; or keep herding for more stars.
- You win when every sheep still yours is in the fold (with at least the target), when night falls
  with the target met, or when you latch the gate early. You lose if night falls before the target
  is met, or if the wolves take so many that the target is out of reach.

| Evening | Sheep (need) | Length | Wolves |
| --- | --- | --- | --- |
| Gentle | 12 (9) | 8.5 minutes | from halfway, one at a time |
| Standard | 12 (9) | 6 minutes | after 2 minutes, up to two |
| Hard | 16 (13) | 5 minutes | after 1 minute, up to three, faster |

## Settings

The pause menu has volume, music and effects sliders, a mute switch and the graphics choice:
**Auto** (the default) starts at High and steps down a tier while the game runs below about 52
frames a second; **High**, **Medium** and **Low** fix the render resolution, multisampling, shadow
map size and bloom. Both choices are remembered. `?quality=low` in the URL picks a tier too.

## How it was made

- **Models:** every model was made in Blender (5.1) by the Python scripts in `blender_scripts/`, one
  per asset family (characters, nature, structures, terrain, effects), and exported to
  `public/assets/` as glTF binaries. During development the scripts ran through the Blender MCP in
  headless Blender processes; `npm run assets` rebuilds them all (needs Blender on PATH or in
  `BLENDER_PATH`). The level layout (`level/valley.json`) is shared by the terrain script and the
  game. The animals are rigid-part rigs animated procedurally (gaits, poses, a bark, a startle).
- **Textures:** none are image files. Colour comes from material and vertex colours, procedural
  noise in shaders (the stream, the ford, the ground) and canvas-drawn sprites (the heart, glows).
- **Light and colour:** the scene renders to a multisampled half-float target; one pass adds a
  bloom, tone maps and grades it in OKLCH/OKLab through the evening (golden hour, rose sunset,
  violet twilight, moonlit night), with the sky's colour along the top edge, light shafts from a
  low sun and a vignette.
- **Sound:** every sound effect and the adaptive folk score are synthesised live with the Web Audio
  API. There are no audio files.
- **Fonts:** Fraunces and Nunito (SIL Open Font License), bundled from npm, so nothing is fetched at
  runtime.

## Testing

- `npm run playtest` (with `npm run dev` running) plays the game in headless Chrome through real
  key presses: a herding bot wins a Standard day, an idle day loses, the gate is latched, the menus
  are driven, and screenshots from the player's camera land in `test-results/`, with the console
  log and 20 assertions.
- `node tests/perf.mjs` measures frame times, draw calls, triangles and GPU time for each phase of
  the evening against the production preview (`--analyze` breaks the cost down). On the laptop it was built on
  (an RTX 5070 Ti) the game runs at 140-230 fps at 1080p, limited by the CPU; Auto graphics steps
  down on slower machines.
- `node tests/lookdev.mjs` captures the view at chosen times of day (`--nograde` shows the render
  without the colour grade).
- Every milestone ended with these self-tests and a critic that saw only the screenshots and the
  pitch; `CLAUDE.md` logs every round and decision, and `docs/progress/` keeps screenshots of the
  game at each stage.

## Project layout

| Folder | What is in it |
| --- | --- |
| `src/game/` | the simulation (flock, dog, wolves, day clock), input, level, the game loop and camera |
| `src/world/` | the valley, the animals and their animation, particles |
| `src/render/` | renderer, lights and day cycle, colour grade, the snatch close-up |
| `src/audio/` | Web Audio engine, effects, ambience and music |
| `src/ui/` | HUD, menus, minimap and edge markers |
| `blender_scripts/` | the Blender asset scripts |
| `tests/`, `tools/` | self-test, perf and look-dev scripts, asset and progress tools |
