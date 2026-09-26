# Woolgather

**Herd the flock home before nightfall.** A cosy-tense sheepdog game in the browser, built with
Vite, TypeScript and Three.js.

**[Play it in your browser](https://woolgather.pages.dev/play/)** (free, no install, desktop browser
with a keyboard or a gamepad) and see the **[landing page](https://woolgather.pages.dev/)** for
gameplay video of a whole evening, uncut, and a small herding toy to try the one rule.

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
| ![Pip circles behind a small flock and drives it along the track](docs/media/drive.gif) | ![Sheep run through the fold gate and gold hearts rise over them](docs/media/home.gif) |
| **Get behind them.** Swing wide round the far side of a flock and walk in: it moves off away from Pip. | **Through the gate.** Every sheep that makes it into the stone fold gets a gold heart. |
| ![The sun drops behind the ridge and the valley turns from gold to rose](docs/media/sunset.gif) | ![A grey wolf with a red ring stalks towards the flock](docs/media/stalk.gif) |
| **The sun goes down.** The light is the clock: at the red notch on the sun bar the gold turns to rose. | **The wolves come out.** A red ring marks each wolf, and a dashed line runs to the sheep it wants. |
| ![A wolf drags a sheep off, Pip sprints over and the wolf drops it](docs/media/snatch.gif) | ![The gate swings shut on all twelve sheep and the results card comes in](docs/media/win.gif) |
| **Snatch!** A banner counts down the seconds. Sprint over and run at the wolf or bark: it drops the sheep. | **Home before dark.** Every sheep in the fold, three stars. |

The clips are the finished game, recorded one frame at a time at 60 fps while the test bot played
one Standard evening (see [Footage](#footage)); in that evening it brought all twelve home in 3:33.

## Play it

Online: **https://woolgather.pages.dev/play/**. To run it locally (Node 20 or newer, a browser with
WebGL 2):

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

and open http://localhost:4317/.

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

## Screenshots

| | |
| --- | --- |
| ![The title screen](screenshots/01-title.png) | ![A wolf stalks the flock under the rose sunset](screenshots/03-wolf.png) |
| ![A snatch: sprint at it and bark](screenshots/04-snatch.png) | ![Nightfall at the fold](screenshots/05-night.png) |

![Every sheep is home: the day's results beside the fold](screenshots/06-win.png)

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
- **Process:** five milestones (greybox, models, feel, interface, polish), each closed by a
  self-test and a critic that saw only screenshots and the pitch: 52 critic rounds in all, most of
  them spent making a sunset read as a sunset. `CLAUDE.md` logs every round and decision, and
  `docs/progress/` keeps screenshots of the game at each stage.

## Testing

- `npm run playtest` (with `npm run dev` running) plays the game in headless Chrome through real
  key presses: a herding bot wins a Standard day, an idle day loses, the gate is latched, the menus
  are driven, and screenshots from the player's camera land in `test-results/`, with the console
  log and 20 assertions.
- `node tests/perf.mjs` measures frame times, draw calls, triangles and GPU time for each phase of
  the evening against the production preview (`--analyze` breaks the cost down). On the laptop it
  was built on (an RTX 5070 Ti) the game runs at 140-230 fps at 1080p, limited by the CPU; Auto
  graphics steps down on slower machines.
- `node tests/lookdev.mjs` captures the view at chosen times of day (`--nograde` shows the render
  without the colour grade).
- `node tests/site-check.mjs` checks the built public site in headless Chrome: screenshots at
  desktop and phone sizes, the herding toy played by a scripted dog, the game reaching its title
  at `/play/`, and no console errors, failed requests or horizontal scrolling.

## Footage

The landing page's clips and the GIFs above are filmed from the production build with a virtual
clock: `tests/film.mjs` replaces the page's `requestAnimationFrame` and `performance.now`, steps the
game one 1/60 s frame at a time and pipes every frame into ffmpeg, so the footage is a smooth 60 fps
however slowly it is captured. The game's events (a sheep home, the sunset, a snatch, a rescue) are
saved with their frame, and `tests/make-media.mjs` cuts the clips, posters, chapters and GIFs at
those events, so a new recording re-cuts itself.

```bash
npm run film -- --shoot hero            # the title shot from golden hour to night (the page's scroll-scrubbed opening)
npm run film -- --shoot day --nobuild   # the bot plays a whole Standard evening
npm run film -- --shoot night --nobuild # the last seconds before nightfall, and the loss
npm run media                           # clips, posters, scrub frames, chapters.json, README GIFs
```

The encoder is `ffmpeg-static` from npm; if your npm blocks install scripts, run
`npm approve-scripts ffmpeg-static` once.

## The public site

`site/` is the landing page (static HTML, CSS and JS; its media in `site/media/`). `npm run site`
builds `site-dist/` with the landing page at `/` and the game, built with base `/play/`, at
`/play/`. `npm run site -- --deploy` also deploys it to Cloudflare Pages (project `woolgather`,
https://woolgather.pages.dev).

## Project layout

| Folder | What is in it |
| --- | --- |
| `src/game/` | the simulation (flock, dog, wolves, day clock), input, level, the game loop and camera |
| `src/world/` | the valley, the animals and their animation, particles |
| `src/render/` | renderer, lights and day cycle, colour grade, the snatch close-up |
| `src/audio/` | Web Audio engine, effects, ambience and music |
| `src/ui/` | HUD, menus, minimap and edge markers |
| `blender_scripts/` | the Blender asset scripts |
| `site/` | the landing page and its media |
| `tests/` | self-test, perf, look-dev, film, media and site-check scripts |
| `tools/` | asset, progress-screenshot and site build tools |
