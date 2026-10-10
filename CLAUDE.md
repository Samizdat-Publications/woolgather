# WOOLGATHER - project guide for Claude

Third game in the `Opu5.5 Game Prompt` master folder. This folder is its own git repo.
Other games live in sibling folders and are built by other sessions: never touch files outside `woolgather/`.

## Pitch

**Woolgather** is a cosy-tense sheepdog game set in a highland valley at golden hour.
You are Pip, a border collie. The flock has scattered across the hills, the sun is going down,
and when it sets the wolves come out. Herd every sheep you can into the stone fold by the
farmhouse before night falls.

Sheep are a real flock: they graze, bunch together when nervous and flee from you as a group.
You steer them by *where you stand*, not by pushing them one at a time. Creep up quietly, get
behind the flock, drive it over the bridge and through the fold gate. When the gold turns to a
rose sunset the wolves slip out of the pines to snatch stragglers: chase them off or bark them
away before they drag a sheep into the trees. Night falls in violet and moonlight.

- Win: every sheep that is still yours is in the fold (and you have at least the day's target),
  or night falls with the target met, or you latch the gate early once the target is met.
- Lose: night falls before the target is met, or wolves take so many sheep that the target is
  no longer reachable.
- **The Season** (Woolgather 2): ten evenings on one hill farm from midsummer to the first snow,
  over five places (Hollow Valley, Loch Ailsa, Crannach Corrie, Glenbrae Show Field, The High Pass),
  each adding one thing: crossings, lambs and a lost lamb, Old Angus the ram and wolves that hunt in
  pairs, a sheepdog trial (gates in order, judged on points), a night watch until dawn, mist, a
  storm with a flood, the Gathering (every flock off the hill, with Old Fly), first snow. Stars plus
  one ribbon per evening, a harder Wolf Moon tier at three stars, charms bought with stars (some
  verbs: the outrun, Old Fly, the bell-wether), Pip's coats, best times. Balance: the expert bot
  has a fight, the average bot wins only some of the time; `src/game/tuning.ts` scales it all.
- **Classic evening**: the 1.0 game in Hollow Valley at Gentle, Standard or Hard.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move (screen-relative) | WASD / Arrow keys | Left stick |
| Sprint (uses stamina) | Shift | RT / RB |
| Creep (sheep stay calm until close) | C (hold) | LT / LB |
| Lie down (the flock stops; the strongest stare against a ram) | Q (hold) | B |
| Flank: run round the nearest flock ("away" / "come bye") | Z / X (hold) | D-pad left / right |
| Outrun to the far side of a loose flock (charm "The Outrun") | Z and X together (hold) | Left stick click |
| Fly, the old dog: lie down here / come back (charm "Old Fly") | F | D-pad down |
| Bark (startles sheep, scares wolves) | Space or B | A / X |
| Latch the gate (only once target is met) | Enter | Y |
| Pause | Esc or P | Start |
| Zoom; all the way in, a low tilted view across the valley | Mouse wheel | |

Ctrl is deliberately unused: Ctrl+W closes the browser tab and cannot be intercepted.

## Tech

- Vite + TypeScript + Three.js (WebGLRenderer, PCF soft shadows, ACES tone mapping).
- All gameplay simulation is 2D on the XZ plane; Y comes from the terrain heightfield.
- DOM/CSS overlay for all UI. Fonts: Fraunces (display) and Nunito (UI), both SIL Open Font
  License, bundled from npm `@fontsource-variable/*` (no runtime network fetch).
- Audio: recorded sounds generated with the ElevenLabs Sound Effects API (`public/audio/`,
  `tools/gen-sfx.mjs`, `docs/audio/SFX.md`), loaded by `src/audio/samples.ts`, and a recorded score
  from the ElevenLabs Music API (`public/audio/music/`, `tools/gen-music.mjs`, `docs/audio/MUSIC.md`,
  played by `src/audio/score.ts`). Web Audio synthesis is the fallback and still makes the chimes,
  the lose sting and the adaptive tension layer over the score.
- Assets: `blender_scripts/*.py` (one script per asset family) generate every model and export
  `.glb` to `public/assets/`. Shared helpers live in `blender_scripts/wg_lib.py`.
- Levels: `level/*.json` (`src/game/leveldef.ts`) are the single source of truth. The ground,
  water, tracks and sheep trods are generated at load time in TypeScript (`src/world/terraingen.ts`),
  per level and per season; Blender only makes the props and animals. `level/valley.json` is kept
  for the Blender scripts (fold, bridge and farmhouse dimensions) and the 1.0 bot.
- Rules: `src/game/rules.ts` (one evening's rules), `src/game/season.ts` (the nine evenings, charms,
  saved progress in localStorage `woolgather.season.v1`).

### Commands

- `npm install`, `npm run dev` (port 5317), `npm run build`, `npm run preview` (port 4317)
- `npm run assets` regenerates every asset through Blender (needs Blender 5.x on PATH or
  `BLENDER_PATH`). During development the scripts are run through the Blender MCP.
- `npm run playtest` runs the Playwright self-test (scripted input, screenshots, console log)
  against a running dev server. Screenshots land in `test-results/`.
- `node tests/season-run.mjs [--evenings a,b] [--parallel 3] [--skill expert|average] [--moon]
  [--dist <build>]` builds and plays every season evening with `tests/bot2.mjs` (a level-agnostic A*
  herding bot, `docs/BOT2.md`) and reports the results. Give concurrent runs their own `--dist`.
- `node tests/playtest.mjs --serve <build>` runs the self-test on a frozen build (no dev server).
- `node tests/place-shots.mjs`, `tests/season-stills.mjs`, `tests/heavy.mjs`: blind place-test
  shots, the landing page's evening stills, the heaviest meshes of an evening.
- `node tests/perf-season.mjs --dist <build>` measures fps, draw calls and triangles per evening.
- `node tests/shot.mjs "<step>" ...` quick screenshots of the dev server (see the file for steps).
- Critic system (`docs/critic/README.md`): `node tests/critic/capture.mjs --dist <build> --label rNN
  --scenario season`, then `node tests/critic/round.mjs --label rNN --blurb "..."` (contact sheets,
  Gemini video and stills critics with `GEMINI_API_KEY` from `.env.local`, scoreboard), then the two
  blind Claude critics (subagents that may read only the sheets or the stills). Scores in
  `docs/critic/SCOREBOARD.md`.
- `npm run film -- --shoot hero|day|night [--nobuild]` films the production build at 60 fps on a
  virtual clock; `npm run media` cuts `site/media/` and the README GIFs (`docs/media/`) from it.
- `npm run site` builds the public site into `site-dist/` (landing page at `/`, the game at `/play/`);
  `npm run site -- --deploy` also deploys it to Cloudflare Pages. `node tests/site-check.mjs` checks
  the built site in headless Chrome (`--url` checks the live one).

### Running the Blender scripts via MCP

The interactive Blender instance behind the MCP may be shared with other sessions, so never build
in its open scene. Run a family script in an isolated background process from the MCP:

```python
import subprocess, bpy
log = open(r"<repo>/blender_scripts/logs/<family>.log", "w")
p = subprocess.Popen([bpy.app.binary_path, "--background", "--factory-startup", "--python",
                      r"<repo>/blender_scripts/<family>.py"], stdout=log, stderr=subprocess.STDOUT)
result = {"pid": p.pid}
```

Use `Popen` (non-blocking) and return at once: a blocking `subprocess.run` holds Blender's main
thread and the MCP request times out. Poll the pid / read the log from the shell afterwards.
The MCP server is single-threaded and shared, so a request can time out simply because another
session is using it; wait and retry rather than touching the shared scene.

### Test hooks

`?test=1` exposes `window.__WG` (state snapshot, time scale, seed, `evening(id, begin)` (also
`'daily'` or `'daily-YYYY-MM-DD'`), `classic(d)`, `progress('reset'|'all')`, `navGrid()`, `zoom(z)`)
for the bots and tests, and look-dev probes: `near(px, py)` (objects whose origin projects near a
screen point), `pick(px, py)` (what the camera sees there), `uniform(name)` (a shader uniform's
value on every material that has it).
`?seed=N` fixes the RNG. `?diff=gentle|standard|hard` preselects difficulty. `?fps=1` shows a
frame-time overlay. `?nocutaway` skips the sunset cutaway. None of these change gameplay unless used.

## Milestones (in order, do not skip ahead)

1. **Greybox** - core loop with primitive shapes: dog movement, flocking sheep, fold detection,
   wolves at dusk, day timer, win and lose states. Self-test loop.
2. **Assets** - model everything in Blender via scripts, export GLB, swap into the game. Self-test.
3. **Feel** - procedural animation, camera, particles, screen shake, hit feedback, synthesized SFX
   and music. Self-test.
4. **UI** - designed title screen, HUD, pause menu, game over and victory screens. Consistent font,
   palette and spacing. Self-test.
5. **Polish and perf** - steady 60 fps on a mid-range laptop, zero console errors. Self-test.

Self-test loop after every milestone: Playwright plays via scripted input, captures player-camera
screenshots and console output; a critic subagent that sees ONLY screenshots + this pitch lists the
5 worst problems; fix; repeat until the worst remaining issue is cosmetic.

Progress screenshots (user request): after every self-test round, save the telling shots with
`node tools/save-progress.mjs <runDir> <label> "<file>=<caption>" ...` into `docs/progress/`
(committed, captioned in `docs/progress/PROGRESS.md`). They feed the README later.

Status: 2.0.0 ("The Season", tag `v2.0.0`) released and live at https://woolgather.pages.dev
(the game at /play/), merged to `main`. 1.0.0 is tag `v1.0.0`. Run reports:
`docs/OVERNIGHT-REPORT.md` (the season), `docs/RUN2-REPORT.md` (the hard rebalance, packs, Wolf
Moon, charms, landmarks). Stewart plays next and tunes difficulty via `src/game/tuning.ts`. The
DECISIONS log below has the history.

## Asset list

| Family script | Output | Contents |
| --- | --- | --- |
| `characters.py` | `collie.glb`, `sheep.glb`, `wolf.glb` | Rigid-part characters with pivots at joints (body, head, tail, 4 legs, ears) for procedural animation |
| `nature.py` | `nature.glb` | pine A/B, oak, birch, bush, 3 rocks, grass tuft, 3 flowers, reeds, log, stump |
| `structures.py` | `structures.glb` | stone fold with gate, guide fences, farmhouse, bridge, dry-stone wall segment, fence segment, lantern post, hay bale, trough, stepping stones, signpost |
| `landmarks.py` | `landmarks.glb` | crags A/B (schist outcrop, granite tor), scree fan, standing stone, cairn, ruined shieling, stell wall arc (quarter ring, origin at the ring's centre), jetty (origin at the landward end, runs out along game +Z), clinker rowing boat, trial judges' box with saltire flag, snow pole, peat hag, cotton grass. Previews in `docs/assets/landmarks/` |
| `terrain.py` | `terrain.glb`, `water.glb`, `terrain_height.bin` | valley ground mesh (vertex colours), stream surface ribbon, heightfield for gameplay |
| `fx.py` | `fx.glb` | sky dome, bark shockwave ring, soft ring, thick danger ring, moon, heart, wool tuft, dust puff, splash drop |

### Asset conventions

- Units are metres. Blender Z-up is exported as glTF Y-up (`export_yup`).
- Characters face Blender **-Y**, which becomes three.js **+Z** (the game's facing angle 0).
- Rigid-part characters: an empty root named after the asset (`collie`, `sheep`, `wolf`) with child
  meshes `body`, `head`, `tail`, `leg_fl`, `leg_fr`, `leg_bl`, `leg_br` (plus `ear_l`, `ear_r`,
  `eyes` where present). Each part's origin sits on its joint (hip, shoulder, neck, tail root)
  so the game rotates parts in place for procedural animation.
- Props in a family GLB are top-level objects named exactly as the game looks them up
  (`pine_a`, `rock_b`, `fold`, `bridge` ...), origin at ground contact, centred.
- Low-poly, flat-shaded, colour from material base colours (no image textures); emissive
  materials for things that glow at night (windows, lantern glass, wolf eyes).
- Terrain: 2 m grid, vertex colours, plus `terrain_height.bin` (int32 nx, int32 nz, float32
  minX, minZ, step, then nx*nz float32 heights, row-major by z then x).

## Palette (UI + art direction)

| Token | Hex | Use |
| --- | --- | --- |
| ink | `#231c2b` | text, outlines |
| dusk | `#3b2f4f` | panels at night |
| heather | `#7a5c8e` | accents |
| moss | `#6d8a4a` | grass, positive |
| gold | `#f2b45a` | sun, highlights, primary buttons |
| ember | `#e0703c` | warnings, wolves |
| wool | `#fbf3e4` | panels, light text |

## DECISIONS log

Newest at the bottom. Record every non-obvious choice.

- 2026-09-24: Concept chosen: sheepdog herding at sunset ("Woolgather"). Reasons: distinct from the
  two space games in the master folder, emergent flocking gives depth from simple rules, the
  sunset timer gives a natural escalation (light fades, wolves appear) and a readable win/lose.
- 2026-09-24: Fixed-yaw 3/4 camera (looking north) with screen-relative WASD. Herding needs
  stable directions; a rotating camera makes "get behind the flock" much harder to read.
- 2026-09-24: Gameplay is 2D (XZ) with circle/segment colliders; the stream is a polyline that
  sheep refuse to enter except at the bridge and the ford. Dog can wade at reduced speed.
- 2026-09-24: The Blender MCP talks to an interactive Blender shared with another session. All
  asset builds run in a background Blender subprocess spawned through the MCP so the shared scene
  is never modified. Scripts are standalone and regenerate every asset.
- 2026-09-24: Web fonts are bundled from npm (@fontsource-variable/fraunces, /nunito, SIL OFL)
  instead of fetched from Google at runtime, so the game works offline.
- 2026-09-24: Dev server port pinned to 5317 so tests never hit a sibling game's Vite server.
- 2026-09-24: Creep moved from Ctrl to C: Ctrl+W (creep + move up) would close the tab.
- 2026-09-24: Self-test runs against the dev server with the system Chrome through playwright-core
  (no browser download). Headless Chrome uses the real GPU via ANGLE/D3D11. Never edit source
  while a playtest runs: Vite HMR reloads the page and kills the run.
- 2026-09-24: The Playwright bot (tests/bot.mjs) herds with the Strombom collect/drive strategy via
  real key events. It is a proxy for an average player: if the bot cannot win Standard, the
  balance is too hard.
- 2026-09-24 (M1 r1): bot got 8/12 on Standard (needed 10). Cause: sheep stopped dead at the edge
  of the flight zone, so a walking dog could not hold a steady drive. Fix: sheep "trot on" for
  1.6 s after a scare, larger flight zone while the dog moves (12.5 m, 8.5 m standing), flee speed
  7 m/s vs dog walk 7.6 m/s. Standard is now 450 s with target 9 of 12.
- 2026-09-24 (M1 r1): dusk was nearly black. Night is now stylised moonlight (bright blue-violet
  fill, moon key light) and tone mapping switched from ACES to Neutral to stop the olive cast.
- 2026-09-24 (M1 r1): stream and path ribbons were invisible (clockwise winding, back-face
  culled). Fixed winding.
- 2026-09-24: Off-screen indicators added in M1 (fold, grabbed sheep, hunting wolves, nearest loose
  sheep when none are in view). Finding things is part of the core loop, not polish.
- 2026-09-24 (M1 critic r1): added a flight-zone ring around Pip (radius = distance at which sheep
  start to flee; shrinks when creeping, grows when sprinting), a "can lose N more" HUD line,
  labelled stamina/bark meters, brighter wolves with glowing eyes and a pulsing danger ring.
- 2026-09-24 (M1 r2-r3): west-bank flock could not be pushed onto the bridge. Driven sheep near a
  crossing (bridge or ford) now funnel onto it (lateral centring + along-axis push), bridge
  widened to 6.4 m. The bot circled inside the flight zone and scattered flocks; it now does a
  wide outrun outside the flight zone like a real collie.
- 2026-09-24 (M1 r3): with the dog idling, 6 sheep wandered into the fold on their own. The fold
  pull now only acts inside the guide-fence funnel and is a weak nudge unless sheep are driven.
  A sheep counts as home as soon as it passes the gate line.
- 2026-09-24 (M1 r4-r6): bot routing around fold walls, farmhouse and guide fences. Bot results:
  Standard 12/12 in 143 s, Hard 14/14 in 297 s; idle runs lose to wolves. The bot is now an
  expert-level herder, so Standard/Hard times for humans will be several times longer. Balance
  kept as is (Standard 450 s, target 9/12).
- 2026-09-24: Walkable height includes the bridge deck (0.55 m, 1.6 m ramps), so actors stand on it.
- 2026-09-24 (M1 critic r6): camera pulled back (offset 0/30/22.5) and now frames Pip plus the
  sheep within 26 m (focus leans 35% towards them, zoom up to 1.45x). The flight ring fades to a
  faint line unless loose sheep are near, and the tutorial hints explain it when sheep first come
  close. Off-screen markers got distinct glyphs (house = fold, wolf head = wolf, "!" = sheep in
  jaws, sheep = stray) and avoid the minimap/counter panels. Once the target is met the hint bar
  says "Press Enter to latch the gate" and a gold beacon pulses in the gateway. Wool has a small
  emissive term so sheep stay white under sunset and moonlight.
- 2026-09-24: Remaining critic items are milestone-2 art (Pip model, trees, bridge, farmhouse,
  hills) and milestone-3 mood (sky, grading). Tall trees near the camera will get an occlusion fade.
- 2026-09-24 (M1 critic r8): skilled runs finished before sunset and never met a wolf, so the
  arc is compressed: gold from frame one, sunset by mid-day, moon swap at 0.665 of the day, and
  wolves start at 0.5 / 0.36 / 0.25 (Gentle / Standard / Hard). Camera base distance up to 42.5 m
  and framing now also pulls in the nearest landmark (fold mouth, bridge, ford) within 40 m of the
  worked flock. A wolf snatch away from Pip makes the camera glance towards it (capped at 18 m so
  Pip stays in shot). End card lists when and where sheep were taken. Timer turns ember in the last
  minute and pulses in the last 20 s, with 60 s / 30 s warnings; tutorial tips stop once wolves
  are out. Minimap sheep dots are larger and outlined, trees and rocks fainter.
- 2026-09-24: Vite's watcher crashed (EBUSY) when a screenshot was copied into docs/progress while
  it was being watched. vite.config.ts now ignores docs/, test-results/, screenshots/,
  blender_scripts/, tests/, tools/ and dist/.
- 2026-09-24: Windows PowerShell 5.1 Get-Content/Set-Content mangles UTF-8 (the "·" separators
  became mojibake and a BOM was added). Edit source files with the editor tools, never with
  PowerShell text rewrites.
- 2026-09-24 (M1 critic r9): mood is now driven off the wolf clock (`moodTime`): sunset lands
  exactly when wolves come out on every difficulty. Latch call-to-action moved into a prominent
  pulsing prompt banner. Tutorial tips are situational (ring tip when sheep first come near,
  sprint tip when far from every flock, wolf tip when the first wolf hunts). End card shows
  daylight left instead of elapsed time, loss places match new minimap region labels. Markers keep
  clear of the top-centre banner.
- 2026-09-24: **M1 closed.** Nine self-test rounds. Functional state: bot wins Standard/Hard via
  real key input, idle runs lose, latch path wins, menus pass 16 assertions, zero console errors.
  The critic's remaining "major" items are all visual and are the stated job of later milestones:
  Pip/tree/bridge/farmhouse models and valley hills (M2), sky, colour grade and tree occlusion fade
  (M3). A greybox is primitive shapes by definition, so art complaints are treated as out of scope
  for M1; the critic loop continues on the same criterion from M2 onwards.
- 2026-09-24 (M2): asset families built through the MCP (Popen'd background Blender), previews
  rendered with EEVEE into docs/assets/ for visual QA before the game sees them. Outputs: collie,
  sheep, wolf, nature (17 props), structures (fold with hinged gate leaves, farmhouse, bridge,
  lantern, hay, stepping stones, signpost), terrain (+ path ribbon, water ribbon, heightfield,
  meta), fx (sky dome, rings, moon, heart, tufts). ~1.8 MB total.
- 2026-09-24 (M2): terrain exported smooth (shared vertices, 0.7 MB instead of 3.4 MB flat) and
  rendered faceted with three's flatShading. The dirt path is its own ragged-edged ribbon mesh;
  vertex-colour paths on a 2 m grid looked like a blurry smear.
- 2026-09-24 (M2): glTF multi-material parts load as groups of single-material meshes, so props
  are instanced as one InstancedMesh per material (all ~480 trees cost ~9 draw calls). Materials
  are converted to flat Lambert. Trees between the camera and Pip/sheep/wolves fade with a 4x4
  Bayer screen-door dither driven by a per-instance attribute (critic: "pines are an opaque wall").
- 2026-09-24 (M2): the flight-zone ring re-projects the Blender ring mesh onto the terrain every
  frame so it hugs hillsides. Characters render at 1.4-1.6x life size to read from the camera.
- 2026-09-24 (M2): golden-hour light rebalanced to a warm key against a cool sky fill; the
  warm-on-warm setup turned the valley olive. Grass palette made lusher.
- 2026-09-24 (M2): on a win the fold's gate leaves swing shut and the camera turns to the fold;
  the end card follows 1.2 s later (critic M1 r9: latching had no visible payoff).
- 2026-09-25 (M2 critic r2): the stream was invisible (water ribbon faces pointed down: new bmesh
  faces have no valid normal until normal_update(), so the flip check never fired). Fixed in
  Blender, water shader also double-sided; streaks replaced by stretched value-noise glints.
- 2026-09-25 (M2 critic r2): wolves only ever showed as icons and two snatches resolved 6 s apart
  at opposite ends of the valley. Now: one snatch at a time (others wait at a distance while a
  sheep is being dragged, plus an 8-12 s breather after each snatch), and a "wolf cam" inset
  (second camera, scissored viewport, only while a drag happens out of Pip's sight) shows the
  wolf and its prey with distance and direction.
- 2026-09-25 (M2 critic r2): the sun bar marks when wolves come out and turns violet after; a
  second line counts down to the wolves, then reads "the wolves are out". The warning line says
  "hurry: N more before dark" when under 90 s remain.
- 2026-09-25 (M2 critic r2): colour script via two compositor layers over the canvas
  (soft-light warmth + `color`-blend violet hue that grows through dusk), plus a vignette. Cheap
  (no extra render pass) and makes amber -> rose -> violet readable. Moonlight made near-neutral so
  grey rocks stop going navy. Heather toned down (muted, fewer, flatter clumps).
- 2026-09-25 (M2 critic r2): flight ring hidden outside play; tutorial line clears when the latch
  prompt shows; end card prints the star thresholds.
- 2026-09-25 (M2 r3): an idle Pip still got 7 sheep home. Undisturbed sheep now graze around the
  spot they last settled (a weak tether that moves with them whenever they are driven), and the
  fold only pulls sheep that are being driven. Idle runs now finish with 0 home.
- 2026-09-25 (M2 critic r5): Pip gets an unlit cream inverted-hull outline (smooth normals rebuilt
  with mergeVertices so the shell has no cracks), a white collar and a lighter back, and draws at
  1.85x. The wolf cam now picks up a wolf lining up a straggler before the grab, and during a drag
  reads "N m to the trees" as an escape timer; it moved to the upper left, away from the fold.
  Hard is a 330 s evening (wolves from 82 s) so skilled play still meets them. Sheep radius 0.8 m
  and separation 2.5 m so the flock never merges into one lump. End card sits on a panel; a
  partial win is titled "Home before dark".
- 2026-09-25 (M2 critic r6): camera now frames the whole working group (Pip, nearby flock, and
  the fold gate + interior or the bridge/ford when the flock is within 42 m), leaning 85% to the
  group's centre instead of 45%. The day's first wolf targets the flock Pip is working, and every
  wolf must spend 6 s (first wolf 10 s) inside the valley before it may charge, so wolves are seen
  approaching. Wolves get an additive eye-glow sprite (canvas radial gradient) that brightens with
  night. The night `color` grade layer is much weaker (it tinted sheep, heather and wolves the
  same lilac). One message slot: an equal-or-more urgent toast replaces the current one, only the
  latest lesser toast waits. Wolf tip only when a wolf is within 30 m of Pip. The last-seconds
  timer glows instead of fading. Opaque end/pause panels. Valley floor has rolling swells and four
  knolls; stony patches round rocks toned down (they glowed blue at night).
- 2026-09-25 (M2 critic r7): Hard re-tuned so expert play still races the dark: 16 sheep, need
  13, 300 s evening, wolves from 20% (60 s), 3 wolves, faster pack. Bot result: 14/16, 2 lost,
  1 star at 226 s. Standard stays the first-timer difficulty.
- 2026-09-25 (M2 r8): design bug found by the bot stalling for 160 s: wolves that were not allowed
  to strike (snatch in progress, cooldown, not yet seen) waited ~8 m from their prey, inside the
  sheep's 13 m wolf-fear radius, so the last flock could never be driven. Waiting wolves now lurk
  and circle at 17 m (`WOLF.lurkRange`).
- 2026-09-25 (M2 r8): the wolf cam's second render re-drew the shadow map; it now reuses the main
  view's shadows (`shadowMap.autoUpdate = false` for the inset). Headless fps back to ~155.
- 2026-09-25 (M2 critic r7): one bearing everywhere (toast, inset, marker all measure Pip -> prey),
  short compass in the inset label, no duplicate "target met" toast, darker dusk and night,
  glints washed toward white, minimap 180x144, fixed-width counter, tips on a backing pill,
  "hurry" keeps the "can lose" count, loss card explains the numbers and gives one tip.
- 2026-09-25 (M2 critic r9): far-bank snatches were decided before the player could act, and a
  later "prowling" toast could bury a snatch in progress. Now: a sticky danger alert holds the
  message slot for the whole drag with a live distance and bearing (toasts wait underneath and do
  not run down); drags start with a 1 s tussle and move at 2.7 m/s, and the sheep is only lost
  9 m past the valley edge, so a sprinting Pip (12.5 m/s, bark reaches 19 m) can answer a snatch
  from across the valley. The spawn toast names the sheep the wolf is after, not its den.
- 2026-09-25 (M2 critic r9): wolves hunting within 32 m of Pip are added to the camera's framing
  box, so the threat is seen in the valley and not only as an edge marker or in the inset.
- 2026-09-25 (M2 critic r9): wolves now arrive with a visible change of light on every difficulty.
  `moodTime` holds the golden hour until 3.5% of the day before the wolves, drops to a rose sunset
  (red-orange sun, lilac sky fill) as they come out, keeps a long afterglow, brings the moon up with
  about a quarter of the evening left and full night at nightfall. The how-to and the pitch say
  "when the sun sets" instead of "after dark".
- 2026-09-25 (M2 critic r9): HUD: the latch prompt moved under the timer (it covered the gate ring);
  the 2- and 3-star targets show on the counter line (lit when reached, struck out when the wolves
  make them impossible); the wolf cam inset shrank to 248x156 and moved above the stamina meters;
  minimap region names sit beside the grazing spots so sheep dots never print over them; the
  how-to card has a legend for the four edge-marker glyphs.
- 2026-09-25 (M2 r10): night water was vivid royal blue before the CSS grade even touched it: it
  now fades to slate with a hint of the moonlit sky. Rock and wall stone get a faint warm
  emissive scaled by night so grey stone stops going indigo. Faded trees dither down to 16%
  (a denser dither read as a dark checkered ghost). `tests/lookdev.mjs --nograde` captures each
  time with the grade hidden, to tell renderer colour from grade colour.
- 2026-09-25 (M2 critic r11): characters stopped reading once the light changed. Sheep get a dark
  ink outline (body and head only, to save draw calls) and a bigger dark face with wide ears so
  they never share a bush's silhouette. The wolf was remodelled (low-slung, heavy ruff, big
  upright ears, long muzzle, bushy dark-tipped tail, lighter grey coat), drawn at 1.5x with an
  ember outline and a thick pulsing ground ring (`thick_ring`, re-projected onto the terrain).
  Wool, Pip's white coat and the wolves' grey fur take most of the light's colour back out in
  their shader (`uWhiteKeep`, rising as the key light warms), so white stays white and grey stays
  grey under the coral sunset and the moon.
- 2026-09-25 (M2 critic r11): the CSS blend layers were replaced by a post-process grade: the
  scene renders linear HDR into a 4x multisampled half-float target and one fullscreen pass tone
  maps it (Khronos PBR Neutral, in the shader) and grades it in display space with per-phase
  targets (saturation, a shadow tint that only reaches the darkest tones, a highlight tint that
  spares whites, soft-light wash, contrast, a haze band over the top of the frame for the far
  valley, vignette). Gold: amber light, cool shadows, muted greens. Sunset: coral light, violet
  shadows. Night: blue-violet, silver highlights, saturation 0.55. The wolf cam draws into the
  same target, so the inset is graded too. The canvas itself has no MSAA now.
- 2026-09-25 (M2 critic r11): colour fixes found with the new grade: a 5-degree sunset sun barely
  lit flat ground (khaki), so the sunset sun sits at 10 degrees; greens muted in the terrain
  script; the path, rocks and wall stone moved to yellow-greys (neutral grey went purple under
  the lilac sky fill, reddish dirt went magenta and read as a UI route).
- 2026-09-25 (M2 critic r11): the title is now a low establishing shot across the valley into the
  golden-hour sun (sky, horizon pines, stream), under a radial scrim instead of a flat dark one.
- 2026-09-25 (M2 critic r11): warnings use the minimap's place names ("A wolf is after the sheep
  in the grove!") instead of compass words, which players read as either the wolf's or the
  sheep's direction. During a snatch the top banner carries the news (where, how far) and the
  hint bar the instruction; the inset label is short ("Snatch! 73 m to the trees") and keeps
  following the same wolf while it lingers. The camera leads the frame the way the flock moves
  and keeps an 8 m margin at the bottom, above the meters and hints. The latch prompt drops the
  objective toast it completes.
- 2026-09-25: repo pushed to a private GitHub repo, Samizdat-Publications/woolgather (standing
  preference recorded in the user's memory: commit at milestones and push without asking).
- 2026-09-25 (M2 critic r13): the colour arc was measured instead of eyeballed:
  `tests/colorprobe.py` reads grass, path and water (hue, luma, saturation) from lookdev shots at
  the bridge. Before: grass luma fell to 55-63% of daytime after the wolves came out and went
  mustard (hue 43, sat 0.81), the path went red, night grass was teal (hue 189), and the unlit
  stream stayed 1.4-1.5x brighter than the grass. The grade now works with a luminance-preserving
  three-point colour ramp per phase (shadow, mid, highlight colours) plus a gain: grass holds
  75-80% of its daytime luma through sunset and turns rose-orange (hue 26), then rose (17), then
  blue-violet at night (233); whites and strongly saturated signal colours (danger ring, gate
  beacon) are left out of the ramp. The sunset key is salmon rather than orange. The stream
  mirrors the sky (horizon colour by dusk, moonlit sky at night) at its own brightness and dims
  with the light on flat ground (sky fill plus key times its elevation, relative to golden hour),
  so it stays about as bright as the grass beside it.
- 2026-09-25 (M2 critic r13): characters get a rim light in their shader (faint warm by day,
  silver by moonlight) so sheep, Pip and wolves stand off the ground at night.
- 2026-09-25 (M2 critic r13): snatches use one number everywhere: seconds until the sheep is lost
  (`Sim.dragEta`), in the banner and the inset. `Sim.rescueEta` estimates Pip's time to barking
  range (sprint while stamina lasts, then walk, plus a second to wade); if he cannot make it the
  hint says "Too far to save it in time: keep the rest of the flock together" instead of asking
  for the impossible (with hysteresis so the advice does not flicker). Drags slow down the further
  Pip is (to 55% beyond 85 m). Wolves are announced when they start stalking (a wolf after Pip's
  own flock only once it is in view); a dragging wolf is pulled into the frame from up to 52 m.
  The wolf cam opens at mid-height on the side of the screen the threat is on.
- 2026-09-25 (M2 critic r13): camera lowered and narrowed (fov 34, offset 0/36/32, about 48
  degrees): less lean on trees at the edges, a three-quarter view of the animals, the same ground
  in view. Pip starts facing the nearest flock. Faded trees use alpha-to-coverage on the 4x MSAA
  target instead of a Bayer screen door (it read as a checkerboard). Counter reads "need 13 to
  win" and "3 sheep to spare"; the start objective toast is gone (the counter says it); the gate
  beacon is labelled "Enter: latch the gate"; the minimap dims at night; the wolf tip needs a wolf
  on screen.
- 2026-09-25 (M2 critic r14): recolouring the grass itself read as mud (rose phase) and a flat
  filter (night). The light now carries the colour and the grade only splits it: a strong key
  against a lower, cooler sky fill (real contrast, frame luma P5-P95 spread 72-83 instead of 60);
  a golden-peach sunset key so lit grass stays gold (hue 57, not brown 32); the grade replaces the
  colour of the darkest tones with violet (sunset) or blue (night) and of the brightest with peach
  or silver, at each pixel's own brightness, leaving midtones alone; the whole-frame ramp is only
  strong at night. Night is a strong cool-white moon over a dim fill (dark shadows, moonlit tops)
  and the fold lantern is bright enough to pool. Signal colours are judged before grading (chroma
  above ~0.5) and skip it; the wolves' danger ring and outline are pushed above white in the HDR
  target so they stay hot red-orange at night.
- 2026-09-25 (M2 critic r14): Pip's reach ring is a hairline (`thin_ring`) at about half the
  opacity. The gold ground ring at the gate is gone (Enter works from anywhere): the fold marker
  moves to the gatepost and reads "Enter: latch the gate". The ford is drawn in the water shader
  as pale turquoise shallows over gravel with ripples running across, and the minimap labels
  FORD and BRIDGE. The sun bar carries a sun (then a moon) at the end of the fill: the sky the
  herding camera cannot show.
- 2026-09-25 (M2 critic r15): dusk had near-black tree-shadow stripes across the whole valley
  and ended darker than the night. The key light's angle is now clamped to at least 26 degrees
  (the sky still shows the true low sun), shadows have a per-phase strength
  (`light.shadow.intensity`, 0.4-0.6, never black), the terrain is smooth-shaded (flat facets made a
  checkerboard under a low sun), and brightness falls steadily: grass luma about 0.36, 0.35,
  0.34, 0.31 through the evening and about 0.16 at night. The terrain gets a tint from the mood
  (kept to a whisper: a strong warm tint turned the sunset grass orange) and relief shading in
  the Blender script (crests drier and lighter, hollows lusher and darker, the floor a touch darker
  than the hills). A soft glow on the side of the frame the sun or moon lies on stands in for the
  sky. The stream keeps its glints in every light.
- 2026-09-25 (M2 critic r15): highland dressing: denser, brighter heather in patches along every
  slope near the rim, bracken (two tints) and gorse with yellow flowers (new `nature.py` props),
  and old dry-stone field walls laid along the rim from 4 m `field_wall` / `field_wall_broken`
  sections (they collide and show on the minimap); the fold floor has mud, straw and a worn track
  from the gate. The minimap moved to the bottom right so the farmhouse and gate stay in view.
- 2026-09-25 (M2 critic r15): the wolf was rebuilt for a top-down read (light buff-grey, dark
  saddle stripe, pale muzzle and chest, big dark ears splayed outwards, a bushy tail held out
  straight) and drawn at 1.7x; its danger ring is slim and wide (frames it instead of covering it)
  and stays a plain saturated red, which the grade leaves alone (an above-white HDR red was
  tone-mapped to salmon). The dragged sheep hangs crosswise further out from the jaws; the inset
  camera is closer. A reachable snatch shows the countdown in the banner and a picture labelled
  "Snatch!" in the inset; an unreachable one gets one calm line ("too far to save it") and no
  countdown or inset.
- 2026-09-25 (M2 critic r17): full night arrived while the HUD still said "Nightfall in 0:37".
  The timeline is now in seconds (`moodTime(t, wolfStart, dayLength)`): golden hour, the drop to
  sunset as the wolves come out, a rose afterglow, a deep rose-violet dusk over the last 75 s
  (long, light shadows: the key's minimum angle relaxes from 26 to 15 degrees), and night proper
  (the moon) only in the final 3 s, at nightfall. Measured grass luma falls 0.36, 0.36, 0.33,
  0.25, 0.22, 0.21, 0.18 and night is the darkest; hue runs gold (55), rose-gold (35), rose
  (328), violet (271, 256), blue at night (235). Each grade phase has its own contrast pivot (a
  daytime pivot crushed dusk frames to black).
- 2026-09-25 (M2 critic r17): grass moved to sage (warm light turns it gold, not lime or
  mustard); the sunset key is coral-pink with pink rim light on the animals; the haze stays on the
  pine line at the top of the frame. The stream is deep teal and always darker than its banks
  (luma 0.7-0.9 of the grass), taking only a touch of the evening's colour (plum at sunset,
  indigo at night), with thin glint streaks along the flow, a thin foam line and a dark wet-mud
  edge on the banks. Hay is muted straw with rounded ends and ring spirals; the fold's hay rack is
  an open slatted frame. Bushes are lighter so they are not mistaken for black sheep.
- 2026-09-25 (M2 critic r17): the wolf has a dark umber back and ruff over pale underparts (always
  darker than the sheep), broader shoulders and a wider stance; `characters.py -- --topdown`
  renders every character from the game camera's pitch in 8 directions for checking. The inset is
  a three-quarter side view from the camera's side of the wolf, shown only for wolves off screen.
  The minimap is back at the top right and fades to 22% whenever the fold, Pip or a loose sheep is
  under it. Farmhouse windows glow brighter at night; the title shot's air is thinner.
- 2026-09-25 (M2 r18): the field walls stopped wolves dragging sheep home (they walked into them
  and stalled). Field walls have their own collision tag: sheep and Pip go round, wolves leap
  them. They also sat where Pip's outrun circles the far-bank flock and slowed the herding to a
  crawl; they now run 6-8 m inside the forest edge.
- 2026-09-25 (M2 critic r19, the last major was the golden hour reading as dim olive and the
  rose act as rust): the golden hour is a brighter amber key (4.0) against a cooler, lower fill at
  exposure 1.12, on fresher yellow-green grass (between the sage and the old lime); grass luma
  0.48 and contrast 87 at the start, then a steady fall to 0.23 at night. The sunset keys are
  pink-coral and pink-magenta, the grade's highlights pink, and a haze in the sky's own colour
  (peach, rose, violet) covers the top third of the frame. The vignette is light (it read as brown
  corner blotches) and the terrain's relief shading is subtler.
- 2026-09-25 (M2 critic r19): the wolf is cool mid-grey with a charcoal back, pale underparts,
  drawn at 2.0x; its ring is toothed (`danger_ring`, 12 teeth, turning slowly) over a dark band, so
  it reads by shape and brightness as well as colour (red-blind players saw it vanish on olive
  grass). Pip has a thin dark outline (a cream one merged with his white collar) and more black
  from above (dark legs with white socks, no white neck stripe, a smaller white tail tip). Edge
  markers slide along the top edge past the timer instead of dropping into the field; a partly
  visible sheep counts as visible; the inset needs the wolf truly off screen. The minimap is tinted
  with the evening (sepia by day, dimmer and cooler into the dusk) and wolves are ringed red dots.
- 2026-09-25 (M2 critic r20, the last major was the dusk and night as a flat violet wash with
  Pip and the wolves as dark blobs): the sun now sets under the hills as the last 75 seconds
  begin and a cool moon rises in the east as the key light for the whole twilight (silver on the
  tops of things, soft shadows, a silver rim on the animals), while the western sky, haze, glow
  and water keep the rose afterglow; full night still falls only at nightfall. The dusk and night
  grades are less saturated with a lifted ground ramp. The wolf's back is a lighter slate so it
  never reads as a hole, and Pip is drawn at 2.0x; the camera's zoom-out is capped (1.4, or 1.5
  during a snatch) so Pip never shrinks below about 40 px.
- 2026-09-25 (M2 critic r20): a stalking or charging wolf within 26 m draws a dashed red line on
  the ground to the sheep it is after and a pulsing ring round that sheep, and the camera frames
  the pair, so the player sees which sheep is in danger before the snatch. The wolf-cam inset opens
  on the side of the screen away from the threat, so it never covers the ground Pip must cross.
  Trees between the camera and the action open a soft round window around Pip, the wolves and the
  nearest sheep (screen-space cut-outs through alpha-to-coverage) instead of ghosting the whole
  tree.
- 2026-09-25 (M2 critic r21, the last major was the sunset reading brown then grey instead of
  rose then violet): green grass under a pink sun is brown, and pulling green towards rose or
  violet in RGB passes through grey (opposite hues). The grade now works in OKLCH: every pixel
  keeps its lightness and its hue turns along the colour wheel towards the phase's colour for its
  tone band (shadows, midtones, highlights), with chroma eased towards the phase's own and scaled
  by lightness (dark pixels never turn neon). Measured mean colour of the play area: gold 53,
  coral 4, rose 356 and 350, mauve 330 and 318, violet 294, indigo 247, saturation 0.37-0.65
  all evening (HSV hue and saturation of the frame's mean). Non-grass hues (the stream) turn less,
  so the water stays a cool blue-violet against the rose ground; after sunset warm hues (lamp
  light) keep their colour, so the lantern pools orange against the violet night. Characters write
  alpha 0 into the scene target and the grade leaves 70% of their own colour alone: cream sheep,
  grey wolves and a black and white dog stand off the ground by colour, not only by outline.
  The terrain gets hill shading (slopes facing the sun or moon lighter, the far side darker),
  grass grows in clumps with grazed lawn between, flowers are halved into fewer drifts, scree lies
  under the rim, and there is no gorse near the wolf dens.
- 2026-09-25 (M2 critic r21): the wolf-cam inset docks on the screen edge the threat lies beyond,
  level with it, slid clear of Pip, the nearby flock and the fold gate, with an arrow on its border
  pointing at the threat and the distance in its label; it stands in for that hunt's edge marker.
  A snatch alert carries what to do on a second line in the same red banner (the hint bar stays
  clear). Pip's reach is a dashed ring over a faint dark stroke, never below about a third opacity,
  and labelled on the ring for the first 20 s of the first day; the yellow foot ring became a
  chevron in front of Pip showing where he faces. The wolf is lighter grey with pale, bigger ears
  and a longer muzzle. The camera frames a hunting wolf, its prey and Pip first (the far side of
  the flock may leave the frame when not everything fits) and centres the box for the tilted
  view (it sees 26 m away from the camera but only 15 m towards it), so a stalker south of Pip
  is no longer cut off at the bottom edge.
- 2026-09-25 (M2 critic r22, two majors: every phase one full-screen tint, "pink clay", and the
  camera pushing Pip under the top HUD): the sunset now rakes across the hills. The grade's tone
  bands sit on the valley's average brightness, so grass brighter than it (slopes facing the sun)
  turns coral-rose and grass darker than it (shade, far slopes) cool violet, the flats between
  rose; other materials (path, stone, water, trees) turn much less. Measured at the bridge: lit
  grass coral 14 to rose 343 through the sunset, shade violet (313-329). A softer pink key light
  (on green grass a strong one only makes orange) and the fleece keeps its pink: only an
  orange-gold key is taken out of white wool. After sunset the ground's own colour fades before
  it is tinted (as colour fades to the eye in low light), which stops green passing through teal
  on its way to violet; the frame darkens over the last minute (grass luma about 0.17, then 0.15
  at night). OKLCH hues are not screen hues: 288 reads indigo-blue, violet needs 305-325.
- 2026-09-25 (M2 critic r22): the camera sits a fifth further back by default (Pip's walking ring
  about half the screen's height; zoom 1.2-1.6, 1.75 during a snatch), Pip is 2.2x with a sky-blue
  outer outline around his dark one (the friendly counterpart of the wolves' ember) and a cool
  blue-black coat that no longer browns in warm light, with more white from above. Everything
  framed keeps 9 m of ground clear at the top of the view (under the timer and banners) and Pip
  6 m more; the counter, timer, banners and latch prompt fade while an animal is under them, and
  the latch prompt shrinks to a chip after 5 s. The wolf is mid-grey with a narrow charcoal saddle
  and charcoal ears splayed wide, so from above it shows a dark and a light side against any
  ground; the pines are lighter. The playtest bot now leaves a snatch the game calls too far to
  save, like a player reading the banner (it used to run 150 m after every one and lose the day).
- 2026-09-25 (M2 critic r23, two majors: the wolves not reading as wolves from above, and the
  rose phase a salmon wash over everything): the evening's colour is light, not paint. Under the
  rose-gold sun the grass stays a warm green-olive; the magenta-violet is in the shade (shadows
  take the sky's light and shed most of their own colour before the violet, so they never pass
  through red or brown) and in the sky light; the fleece, stone and path catch the pink; the
  stream mirrors the rose and lavender sky in slow streaks, lighter than its banks near the edges
  and darker down its deep middle (a flat mirror read as a painted road); the far valley's haze
  is screened on as light (rose mixed into olive is brown). The gold turns to rose over the
  wolves' first minute (from 15 s before they come out to 45 s after) instead of in seconds.
- 2026-09-25 (M2 critic r23): the herding camera uses a 20 degree lens from 1.8x further back:
  the same ground in view, but the far edge of the screen is drawn at 0.73 of the near edge (0.57
  before), so tall props no longer swell and lean at the edges and a wolf at the bottom is not
  three times Pip's size at the top; the fog, shake and tree windows are scaled to match, and it
  pulls back quickly (a new threat is seen at once) and pushes in gently. The wolf was rebuilt
  for the view from above: charcoal coat, grizzled grey saddle, white muzzle and cheek mask, big
  upright ears, a thick one-colour tail that hangs low, and legs splayed out from under a low
  body. Pip is 2.5x with a broad white ruff, blaze and tail tip and tan brows; outlines are pushed
  back from the camera so only the silhouette shows (the sky-blue one speckled his white patches).
  The reach ring is thinner and lighter; the ring tip only mentions creeping (the ring's own label
  says the rest); the gatepost label waits until the latch banner has shrunk to its chip; the
  minimap fades over the farmhouse; the results card sits on the left, opaque, with the fold and
  its flock framed beside it.
- 2026-09-25 (M2 critic r24, one major: the wolves came out in the day's brightest gold and the
  ground never turned rose): the sun now drops behind the western ridge at the red notch, over
  15 s around the wolves' arrival (a visible event: a lower, pinker, dimmer key light, longer
  shadows from a lower sun angle, darker pines), and the rose holds until 40 s before nightfall
  (the violet twilight was 75 s). The valley floor takes the rose light itself: its colour turns
  at its own brightness towards dusty rose ('#d4aab4', 58%, the path 22%), so the pink sun makes
  rose instead of khaki-brown, while grass tufts, bushes, trees, rocks, sheep and water keep
  their own colours; the shade goes violet. Measured at the bridge: grass rose 359-349, shade
  violet 319-327, water lilac, frame mean saturation 0.40-0.45. The golden hour's shade is cooler
  (it sheds half its olive before the blue), hill shading darkens far slopes only a little (strong
  darkening read as dirt with nothing casting it), the ford's edge is soft and the glints finer.
- 2026-09-25 (M2 critic r24): sheep are drawn at 1.9x (a flock, not cotton balls beside the dog)
  and Pip at 2.2x; the wolf is tawny grey-brown with buff (never white) markings, longer legs and
  a low head, so it cannot be taken for the black and white collie; a snatched sheep is dragged
  on the ground beside the wolf's shoulder. The wolf-cam inset is for snatches only and always in
  one place, under the counter at the top left (its arrow and distance point the way). The
  minimap is 240x192 with bigger labels and dots, and only goes see-through while Pip or a loose
  sheep is under it (never for the fold or the farmhouse).
- 2026-09-25 (M2 critic r25, four majors: the rose phase a pink filter over everything, the last
  minute black at the fold, the wolf reading as a fox, the snatch alert covering its own marker):
  the critics' colour advice has swung round by round (rose on the ground; no tint; olive grass;
  rose on the ground; no tint), so the fixed points are what they agree on: the lit ground and the
  shade must differ clearly in hue (light, not a filter) and the gold must get real time. The
  critic playtest now runs on Standard, the default a first-time player gets (on Hard the wolves
  come after one minute, so every critic saw a minute of gold). The sunset now deepens in the
  light: apricot as the sun touches the ridge with the wolves, coral, then rose, the floor's rose
  coming in gradually (52% by the dusk) over blue-violet shade (a hue well apart from the warm
  light), bright enough that the apricot never reads as brown. The twilight moon rides at 38
  degrees or higher (a low moon threw the fold into its walls' shadow), the twilight is a lighter
  lavender and a lantern stands on each gatepost, lit from the dusk.
- 2026-09-25 (M2 critic r25): the wolf is charcoal-grey (lighter than the collie's blue-black,
  with no white on top), pale-bellied, heavy in the chest and shoulders, with a big head and long
  muzzle, smaller ears, longer legs and a straight tail carried low, drawn at 2.3x (1.3-1.5x a
  sheep); the tawny coat with a pale muzzle read as a fox. A snatched sheep hangs crosswise from
  the jaws in front of the muzzle, rolled to show its face and legs, and the close-up camera is
  tighter. The inset sits at the left edge at mid-height with its label always at the top and the
  arrow drawn over it; the snatch banner carries a direction arrow and the distance, the stalking
  toasts an arrow, and the snatch pulses on the minimap. Sheep collide at 1.05 m (their drawn
  size) and keep 3.1 m apart, so a bunch no longer melts into one lump.
- 2026-09-25 (M2 critic r26, three majors: the ground recoloured in every phase and night
  lighter than dusk, the wolf reading as a boar, alerts pointing at things not on screen): four
  of the last five critics asked for the same thing, so the grass keeps its green (cooler and
  duller as the light goes) and the evening is told by the light: an apricot then rose key over
  a cool lavender-blue sky fill, blue-violet shade, the rose on the fleece, stone, path, haze and
  stream; the rose repaint of the valley floor is gone. Brightness now falls steadily: mean luma
  of the play area 110 at golden hour, 100 as the wolves come out, 86, 81, then 63 in the
  twilight, 59, and 44 at night (the twilight had been brighter than the dusk). Twilight and
  night are violet moonlight (the moon lavender-silver, the colour draining from the ground).
- 2026-09-25 (M2 critic r26): the wolf's silhouette is a wolf's: lean and deep-chested, a long
  narrow muzzle, two tall pointed ears, normal legs, a bushy tail carried low with a dark tip, a
  cool grey coat with a pale grey face and belly, yellow eye-shine, and no ruff (the big faceted
  ruff read as a boar). Banners name places with the minimap's own labels (by the bridge, at the
  ford, by the fold, on the far bank, or the nearest of grove, meadow, rocks and farm), and the
  map draws its labels over the moving dots; anything under the top or bottom HUD band gets an
  edge marker; markers drop below the minimap's real panel; the inset's arrow slides past its
  label.
- 2026-09-25 (M2 critic r27, one major: the wolves never read as animals in the main view, the
  red marker sitting on one at the bottom edge): markers now have three cases. Off screen: an
  edge marker. In the frame but under a HUD band (the timer and banners at the top, the meters
  and hints at the bottom): a small icon beside the animal (above it at the bottom, below it at
  the top), never over its body. In the clear: nothing, its own ring and outline show it. A
  stalking warning is taken down if its wolf stops stalking before the message ends. The wolf's
  coat is a lighter, warmer grey-brown (clearly lighter than the dusk ground) with a pale face
  and belly, and its eyes shine from the sunset on.
- 2026-09-25 (M2 critic r27): the sunset keeps the sun's light at 26 degrees or higher (lower, every
  far slope became a dark pool), a pinker key and much more lavender sky fill, violet shade; the
  lanterns are warm yellow-amber with a physical fall-off (they painted pink discs), and the grade
  keeps lamp light warm with a soft edge; the moonlight has a violet cast. Standard is now a
  six-minute evening as pitched (two minutes of calm, four of wolves); Pip and the wolves collide
  at their drawn size (Pip clipped the bridge rails); the loss card's title fits on one line.
- 2026-09-25 (M2 critic r28, two majors: the golden-hour valley a flat olive lawn, and the snatch
  close-up showing an empty field at night): the close-up followed the wolf in real time while
  the idle test run plays at 40x, so it fell far behind; it now follows in game time, snaps when
  the hunt gets more than 5 m ahead, and leaves the forest ring out of its picture (dragged into
  the pines it sat inside a tree). Trees are drawn 1.35x (next to the enlarged animals they were
  toy-sized); the terrain's relief colour and the far-slope darkening are much softer (the "dirt
  smudges" three critics named); the golden hour's shade is a cool blue-teal against the warm
  key; the track is sampled every half metre and lifted 14 cm (the rolling ground rose between
  rows and swallowed stretches of it); lamp light keeps its warmth out to the pool's edge; sheep
  keep 2.4 m apart and vary a little in size; Pip's white glows a little after dark; the wolf is a
  touch heavier in the chest with a lower head and shorter legs and ears.
- 2026-09-25 (M2 critic r29: no blockers, no majors for the first time since r13; five minors):
  nightfall warnings only show while they are true (a clock that jumps past one skips it);
  messages and the wolf-cam close-up run on game time (the 40x test run left both on screen long
  after their moment); a hunting wolf is framed with ground to spare round it, off the corners
  where the counter and minimap sit; the ground's bounce light is lighter, so the shaded faces of
  trees, bushes and rocks are no darker than the shadows they cast; night has a lower sky fill
  and crisper moon shadows; lamps are amber-orange and the grade keeps only orange-yellow lamp
  light warm (lime grass under them was kept too); the stream has a deeper centre, lighter
  shallows and a thin bright waterline, and no glints by day (a white stripe, then specks); Pip
  is drawn at 2.4x with wider-set ears and a longer white-tipped tail.
- 2026-09-25: **M2 closed.** Thirty self-test rounds. Rounds 29 and 30 both came back with no
  blocker and no major (worst remaining: minor). The loop's rule is "until the worst issue is
  cosmetic"; the decision to stop at two consecutive minor rounds is recorded here because the
  critic's advice on colour, the wolf and the camera repeatedly reversed itself between rounds
  (rose on the ground, then no tint, then olive grass, then rose on the ground, then green grass;
  a darker wolf, a lighter one, a charcoal one, a tawny one, a grey one; the camera pulled back,
  then moved in, then tilted), so a cosmetic-only verdict depends on sampling taste, not on fixing
  defects. The loop continues on the same criterion from M3, and r30's minors carry forward:
  the twilight brightens as the moon rises after the rose dusk (brightness must keep falling);
  wolf states (prowling, stalking, carrying a sheep) look alike and the carrying wolf must be the
  loudest; Pip reads as a pill when running up or down the screen (animation should help); the
  stream and ford need surface cues (animated flow, foam, a wide shallow ford); alerts stack at
  the top (the bark chip needs a ready state, the farmhouse windows read as markers at the edge).
  Functional state: 0 console errors, 18/18 playtest assertions, the bot wins Standard (all home)
  and Hard, the idle day loses, latching wins.
- 2026-09-25 (M3): the feel modules are wired. Sound: GameAudio turns sim events into
  synthesised sound placed around Pip (bark, bleats kept sparse, howls at sundown and as wolves
  leave the trees, growls, yelps, splashes, footsteps by surface, fold chimes, rescue/loss/win/lose
  stings), with ambience (wind, stream by distance, crickets at night) and adaptive music whose
  tension layer follows the wolves (stalking near Pip, a charge, a snatch) and the last minute;
  M mutes; browsers unlock audio on the first key or click. Animation: procedural gaits per
  animal (walk, trot, gallop blended by speed, stride from ground speed so feet do not skate),
  Pip's crouch when creeping, head turned to the sheep he is working, bark jerk, tail wag; sheep
  graze-nibble, startle-jump, pronk in panic and kick in the jaws; wolves skulk low, brace while
  dragging, flatten their ears to charge and tuck the tail to flee. Particles: dust behind a
  sprinting Pip, bolting sheep and charging wolves; splashes; wool tufts on a grab and a rescue;
  a heart over each sheep that makes it home; the bark's ripple; fireflies near cover at night.
  Hit-stop on a rescue (and briefly when a wolf is sent running), shake on a grab and a bark.
  The playtest checks the audio context runs and sounds play all day (20 assertions).
- 2026-09-25 (M3, r30 carry-overs): brightness now falls steadily through the handover from sun
  to moon (the key light dipped almost to nothing while they swapped, then the moon brightened
  the valley again: 76, 38, 70); the key stays low with faint shadows through the swap, the sky
  fill carries the light, the moon is capped: 110 at golden hour, 101, 83, 65, 59, 53, 46, 38 at
  nightfall. Wolf states look different: stalking a calm small ring and a faint tether, a charge
  a bigger faster ring with the prey marked, a carry the biggest fastest ring with an alarm ring
  swelling out and the red "!" floating over the sheep even on screen. The bark chip turns solid
  gold when ready; the stream shows slow lighter streaks drifting downstream.
- 2026-09-25 (M3 critic r2, two majors: the forest edge looming over the action, and the animals
  not carrying the action): trees in the bottom 30% of the frame (between the camera and the
  valley) fade to a see-through 30% (alpha-to-coverage), so the pines no longer loom; dust and
  splash spray are soft camera-facing puffs a metre or two across that swell and fade (the fx
  beads read as dotted breadcrumbs), tufts, splash drops and hearts are 2-3x bigger, fireflies are
  sized for the lens and distance; a snatched sheep sheds wool and kicks up a dust trail as it is
  dragged; wolves have a dark ink outline like the sheep and Pip (the ember outline melted into
  the amber ground; the ring says danger); Pip's ring stays white or blue (orange and red belong
  to the wolves) and is quieter; the herding camera sits a little closer (zoom 1.08).
- 2026-09-25 (M3 critic r3, one major: the evening light only a tint on a flat ground plane, the
  golden hour a hazy olive with olive-grey shade, no sky, a stream like a road, a flat grey-lavender
  night): the grade gained a bloom (the brightest things glow: sunlit fleece, glints, lamps and
  windows; a bright pass and blurs at a quarter and an eighth of the resolution, seven small
  passes), the sky's own colour glowing along the top edge of the frame (the horizon just out of
  shot, warmest on the sun's side) and soft light shafts slanting in from a low sun. The golden
  hour is a saturated amber gold: a stronger key over a lower fill, the lit grass pushed towards
  gold and brighter (OKLCH L 0.66, hue 96, chroma 0.13; it was L 0.55, hue 110, an olive), the
  shade a clear teal-blue. The zone blend moved from turning hues round the colour wheel to
  straight lines in OKLab: green grass sits almost opposite the evening's violet, so neighbouring
  pixels turned opposite ways round the wheel and drew large pink patches beside blue ones (the
  "blotches"); the shadow band is also much wider, so open ground never flips between the shade's
  colour and the light's. After sunset only strongly coloured warm light counts as lamp light
  (the beige yard by the fold was kept warm as a big pink patch), warm pixels too faint for it shed
  their colour instead of turning pink, and the ground's own colour fades further before the
  violet; the lantern pools are 15 m across instead of 26. Night: a stronger moon over a dimmer
  fill, crisper shadows, blue-silver lit ground against violet-indigo shade. The stream reflects
  the bright evening sky in its slow streaks at the sky's own brightness (from sunset on it holds
  more light than the ground, as water does), with glints from the sunset on.
- 2026-09-25 (M3 critic r3 minors): wolves are slate blue-grey with a charcoal saddle, ears, paws
  and tail tip and a pale cream muzzle, cheeks, throat and belly (a hue apart from the warm
  ground; the warm grey-brown coat sank into it), and slink belly-low with the head level when
  stalking. The message banner steps down out of the way of a wolf (or the sheep it carries) on
  screen. Pip lost the sky-blue halo by day (it read as a strategy game's selection ring) and gets
  a soft moonlit one only after dark. His reach ring is quieter at a sprint and brightest on the
  side facing the sheep inside it. Dust is one small ground-hugging puff per footfall, timed from
  the gaits, gone in under half a second, tan by day and dark by night (the big puffs read as soap
  bubbles and smoke); hearts are gold (red is the wolves' colour); fireflies are bigger with a
  bright core and halo. Edge markers that land on the same stretch of edge slide apart, and a
  snatch too far away to save turns its marker grey and still.
- 2026-09-25: the Blender MCP server was down (its Blender GUI was not running, and other Blender
  windows on the desktop belong to the user's other work), so the characters re-export ran the
  same `characters.py` in a headless Blender from the shell, exactly as `npm run assets` does,
  rather than opening a new Blender window on the user's desktop.
- 2026-09-25 (M3 critic r4: no major for the first time in M3, five minors): the heart over a
  sheep that makes it home is a drawn gold heart icon with a dark outline (the unlit heart mesh
  read as a flat pale-yellow glitch on the gatepost), two of them a beat apart, with a warm ring at
  the sheep's feet and a hop. Dust is one lumpy-edged puff per footfall, 1.1-1.6 m across, gone in
  about half a second. Particle and firefly sizes follow the drawing buffer (point sizes are in
  buffer pixels, so they shrank on high-density screens); fireflies are brighter, lit more of the
  time, and also drift over the meadows and round the fold. Pip's reach ring is hidden when no
  sheep is within 1.6 times its radius, otherwise 20% (12% at a sprint) and brightest towards the
  sheep, over a fainter dark stroke. Pip has a hairline cream rim by day (round 4's critic asked
  for one after round 3's asked the wide sky-blue halo away; a hairline reads as a rim, not a
  selection ring), widening to a moonlit halo after dark; the camera sits 10% closer (zoom 0.98).
  The golden hour keeps the gold in the light: a less orange key and a smaller push of the grass
  towards gold (a warm yellow-green, OKLCH hue 107, instead of round 4's mustard at 96), soft
  blue-violet shade instead of navy, less haze and vignette, softer relief shading. Night is deep
  indigo with darker darks (a stronger moon over a dimmer fill, crisper shadows, a stronger silver
  rim on the animals), and the lantern pools are 20 m across again (the pink patch was the grade,
  now fixed). The wolf's coat is a darker slate, so it stands off the ground by value as well as
  hue, and its eyes shine brighter from the sunset on; fleeing sheep bound and grazing heads go
  lower. The stream's body is darker with narrower sky streaks (a lavender wash read as fog);
  birch leaves are a touch deeper (a sunlit birch glowed like a flat cut-out).
- 2026-09-25 (M3 critic r5, worst: minor): three small fixes before the close. The wolves'
  eye-shine sprite was 2 m across over the head (it read as a candle on the crown): it is small and
  low on the face. Fireflies are small warm yellow-green points (big pale discs, graded towards
  lavender, read as snow or lens bokeh). Dust fades with the light (a pale puff at night read as
  smoke). Closing playtest: 0 console errors, 20/20 assertions, the bot wins Standard with all 12
  home in 150 s, the idle day loses to the wolves.
- 2026-09-25: **M3 closed.** Five critic rounds; rounds 4 and 5 both came back with the worst
  remaining issue minor, the same stop rule as M2 (two consecutive minor rounds), for the same
  reason: the critics' colour advice keeps reversing (round 3 wanted a saturated amber gold, round
  4 called the result a mustard wash and asked for green grass; round 3 asked for Pip's halo to go,
  round 4 for a rim to come back). Minors carried forward:
  UI (M4): the result card covers Pip (frame the fold and Pip in the uncovered side, with a happy
  pose); when the target is met the camera should fit Pip and the fold gate; the snatch's "!" sits
  on the carried sheep and edge markers repeat things already on screen (icons beside their
  target, markers hidden while it is in view); the minimap covers the fold's corner as sheep reach
  the gate; the reach ring could thin further after the tutorial.
  Polish (M5): Pip reads as a sliver when he runs straight up or down the screen (a top-down
  silhouette: splayed ears, a plumed tail carried out, an idle three-quarter "eye" stance towards
  the sheep); the carried sheep could hang higher with dangling legs; the golden hour's shaded
  faces of trees, bushes and rocks go near-black (more cool fill), soft dark relief blotches sit
  at the frame edges, and the stream at sunset could be the brightest, most reflective surface;
  the title shot has a dark canopy behind the buttons.
- 2026-09-25 (M4): the UI is one designed look: stitched felt panels (warm ink with a dashed wool
  stitch inside the edge) for every HUD box and card, Fraunces with its soft axis for titles and big
  numbers (a rounded, woolly serif) and Nunito for everything else, both bundled from npm (latin
  subsets, about 180 KB, no network fetch), gold for the one primary action per screen, ember and
  alarm red for danger, leaf green for good news, a 4 px spacing grid. Key names in tips and banners
  are drawn as key caps. Title: the name in ink on the golden evening sky, the choice of evening
  and the buttons on a felt card below, the keys on one line (left and right pick the evening).
  Pause: the menu beside a sound panel (volume, music and effects sliders, mute, stored in
  localStorage). Results: a kicker (day's end or nightfall, and the difficulty), the title, stars
  that pop in, a ledger with dotted leaders, a separate tip box on a loss. How to play: controls
  (keyboard and gamepad) beside how herding works, the marker legend below. Menus work from the
  keyboard (arrows or WASD move between buttons, Enter chooses, Tab outside play) and the gamepad
  (d-pad or stick, A chooses); a focused button takes Enter itself, so one key press never acts
  twice. Carried over from M3: after a win Pip trots to the mouth of the fold and stands facing the
  flock with a happy hop, and the camera frames him and the fold in the part of the screen the
  results card leaves free; once the target is met the fold gate stays in shot near it; the
  snatch's "!" floats beside the sheep, not over it; the minimap fades while the flock is at the
  gate under it; the reach ring is a finer line after the first day's opening seconds.
- 2026-09-25 (M4 critic r1, worst: minor): one alert component (the same radius, padding and width
  limit for messages, the snatch alert and the latch prompt; colour says which), 14 px below the
  timer, and the camera keeps more ground clear at the top while one is up. The bark chip is quiet
  when ready (a gold outline) and only turns solid gold, pulsing, while a wolf is within reach of a
  bark (it was the loudest thing in the HUD all day). The wolves' countdown is as big as the
  nightfall line; small text is at least 13.5 px and brighter; "change the evening" is spelled out.
  The minimap's place names are small, quiet and in sentence case; sheep dots and Pip's arrow are
  bigger; the fold has the gold home badge of its edge marker and wolves the red diamond of theirs.
  The close-up inset is smaller (224x140), its camera steeper (no hazy far hillside across the top),
  the main view's haze, sky band, shafts, sun glow and vignette stay off it, and its label no longer
  repeats the distance the banner gives. Results have one layout for every outcome (a full-width
  ledger, the same row labels, losses as a labelled list), the pause card has a themed switch and
  hides play's messages behind it, the how-to gives every key its own row. Fireflies mark the
  target's alpha where they glow, so the grade keeps their yellow-green; a few bracken clumps and
  more flowers break up the meadows; birch leaves are greener.
- 2026-09-25 (M4 critic r2, worst: minor): closing fixes. The counter led with "0 / 12 home", so
  the goal looked like 12: it now reads "0 home · need 9" over a row of pips, one per sheep (home,
  still out, lost), with the star marks after the target, the second star and the whole flock, and
  "can lose 3 more" (explained on the how-to card) instead of "3 sheep to spare". A Creep chip sits
  beside stamina and bark and lights while C is held; the opening tip mentions creeping. The sheep
  glyph has a dark face and legs (the round one read as a cloud). The latch banner is one line. A
  message steps at most 64 px out of a wolf's way (dropping into the field it covered the strip
  the player had to watch), a stalking message only carries an arrow when the wolf is out of view,
  the tip at the bottom steps back while an alert is up, and the wolf tip goes once no wolf is
  about. Minimap names are readable again (11.5 px cream on a dark halo) and the map is only lightly
  tinted at night. The loss report says how many and where ("4 (Grove x3, Rocks)").
- 2026-09-25: **M4 closed.** Two critic rounds, both minor (the same stop rule as M2 and M3).
  Carried to M5: after sunset the wool turns pink and the wolves are dark lumps that rely on their
  rings; relief shading reads as cloud-shadow blotches; the stream at sunset still reads as a
  road; the night lacks a moon direction and shadows in some frames; the play camera never shows
  sky or ridges (the pitch's valley and setting sun live in the HUD bar and the light only).
  Closing playtest: 0 console errors, 20/20 assertions, the bot wins Standard with all 12 home,
  the idle day loses to the wolves.
- 2026-09-26 (M5 perf): measured, not guessed. `tests/perf.mjs` plays the production build in
  headless Chrome on the real GPU and reports frame times per phase, standing and running, with
  draw calls, triangles, shader programs and GPU time (EXT_disjoint_timer_query_webgl2; its numbers
  include the GPU waiting on the CPU, so it is only a rough guide); `--analyze` lists the heaviest
  meshes and times the frame with shadows, bloom or MSAA off. On this machine (RTX 5070 Ti laptop)
  the frame is CPU-bound: 4.2-5.9 ms at 720p, 1080p and 4K alike, about 330-370 draw calls and
  640k triangles (ground cover is most of them). A JavaScript profile found the biggest costs in
  the HUD, not the 3D: re-measuring panel rectangles every frame after writing to the HUD forced a
  page layout each time (8% of script time) and the minimap redrew its place names with a web
  font every frame (5%). Rectangles are now measured at most five times a second, the names are
  drawn once to a layer, and the map redraws at half rate. Sheep and wolves are drawn instanced
  (each clone keeps its scene graph for the animation; one instanced draw per part, material and
  outline shell instead of about 20 draws per animal), every outline shares one shader, and every
  shader is compiled at load behind the loading screen (a wolf's first appearance and the
  fireflies at dusk stalled the game for 150-700 ms while theirs compiled). Graphics tiers (High,
  Medium, Low: render scale with a pixel-ratio cap, MSAA 4 or 2, a 2048 or 1024 shadow map, bloom)
  with Auto, which starts high and steps down while the median frame of play misses about 52 fps;
  the choice is in the pause menu and remembered. The production preview plays the self-test with
  no console output at all.
- 2026-09-26 (M5 polish): the stream at sunset read as a misty ravine; with the grade off it was
  a clear blue river, so the fault was the grade's: the sun-side glow (a screen blend up to 32% over
  the west third of the frame) washed it pale, and the zone grade turned its blue to mauve. The
  glow is narrower and at most 19%, water keeps more of its own blue after sunset (`spare`), the
  body takes less of the sky's tint, and the sky's rose and gold lie on it in moving streaks with
  glints. Pip, standing still end-on to the camera, turns a little towards his flock (a
  three-quarter profile instead of a sliver).
- 2026-09-26 (M5 critic r1, worst: minor): wolves were dark smudges at dusk that only their rings
  found. They have an ember rim light of their own (from the sunset on, stronger at night), a
  dark red-brown outline and a mid-slate coat, so they stand off the ground and read as threats,
  never as a second Pip. Dusk and night vignette and haze are about half. During a snatch the
  dragged sheep's marker is the only marker (the other wolves' and the nearest-sheep markers
  wait), and a snatch on screen no longer adds a floating "!". Over an animal the counter and the
  timer fade only their panels (the text stays solid with a shadow). The hint wraps inside the
  space between the meters and the right edge. The minimap also fades while the fold is under it
  and the flock is at the gate.
- 2026-09-26 (M5 critic r2, worst: major, the stream at sunset a blurred black chasm): the grade's
  shade step stripped three quarters of every dark pixel's own colour before tinting it, water
  included, so the darkened stream went a colourless black. Shade now sheds its colour only for the
  grass family (hues spared from the zones keep theirs), the water body is lighter with a floor of
  brightness in the evening, and the sky lies on it in long thin streaks along the flow instead of
  round smears. A warm light hangs over the fold after dark (the walls and the farmhouse threw the
  goal into black under the moon), Pip's reach ring brightens and cools as the light falls, the
  meadow bracken added in M4 is gone (from above it read as tiny palm trees) and there are fewer
  grass tufts, the hint wraps evenly, the minimap fades less over the fold, the how-to explains the
  counter's dots and stars, and the nearest-sheep marker is a side-on sheep (the last read as a
  mushroom).
- 2026-09-26 (M5 critic r3, worst: major, a snatch out of reach announced only by a grey marker
  and a short toast): every snatch now holds the message slot for its whole drag; one that Pip can
  no longer reach says so in a steady ember-framed banner ("A wolf is carrying a sheep off on the
  far bank! Too far to save it: keep the rest of the flock together") instead of the red pulsing
  one with a countdown. The jaws marker is always red and a size up (steady instead of pulsing
  when out of reach; the grey version, from M3's critic, read as a disabled badge), and edge
  markers keep clear of the counter panel's real rectangle. Only the stream's blue is spared by the
  grade (sparing every hue far from the grass left the heather neon magenta). The wolves' own rim
  is a cold silver (a warm one made them rosy-brown, the colour of the path). Pip's facing chevron
  is bigger and solid; the reach ring's band is a little wider after the opening seconds, over a
  stronger dark stroke. The counter's dots have a gold tick at the target and the star goals are
  spelled out underneath ("★ 9 ★★ 11 ★★★ 12", gold when reached, struck out when out of reach)
  instead of stars mixed into the row. The minimap takes the evening's tint again, more gently.
- 2026-09-26 (M5 critic r4, worst: major, the snatch alert piling up in the HUD band): the sticky
  alert never goes see-through (it faded to half whenever an animal was behind it, the one line
  saying what to do); the close-up goes the moment its wolf is in the main view (lingering, it
  showed the same wolf twice); while a wolf hunts, the camera keeps 4 m more ground clear at the
  top of the view. One wording for the wolf rule everywhere ("run at it or bark near it: it drops
  the sheep"; the far alert says to sprint to it first). The wolf's coat is a lighter cool grey
  with a pale muzzle and chest and brighter eye-shine; the fold's light only lifts the dark (a
  strong one read as an orange smudge with no lamp); night is a darker indigo with thinner fog and
  fewer fireflies; the how-to's marker icons sit on one baseline without the jaws marker's pulse
  or its larger in-game size (a selector clash).
- 2026-09-26 (M5 critic r5, worst: minor, "overall the game is in good shape"): the late twilight
  has a firmer moon over less fill, deeper shadows and thinner air, the far-slope relief darkening
  is fainter (it read as blotches), the counter panel has a fixed width, and a stalking wolf's
  tether shows from 38 m.
- 2026-09-26 (M5 critic r6, worst: minor): closing fixes. Edge markers slide past the timer first
  and are then kept off the counter, the minimap and (new) the meters and tip along the bottom
  (the fold marker covered the wolf tip, a wolf marker the counter). In the last minute and a half
  the counter says how many are still needed before dark instead of how many more can be lost.
- 2026-09-26: **M5 closed. The game is done.** Six critic rounds: r2, r3 and r4 found a major
  each (the stream as a black chasm, a quiet out-of-reach snatch, the snatch alert fading and the
  close-up doubling), all fixed; r5 and r6 came back minor, the same stop rule as every earlier
  milestone. Remaining minors are taste calls the critics kept reversing (the dusk colour, the
  wolf's coat, the camera distance, the counter layout). Final checks on the production build
  (`npm run build`, `npm run preview`): the full self-test with no console output at all, 20/20
  assertions, the bot wins Standard with all 12 home, the idle day loses at nightfall; 137-230
  fps at 1080p on this machine (RTX 5070 Ti laptop, CPU-bound), with Auto graphics stepping down
  on slower ones. `screenshots/` holds the six final player-view shots; README.md describes the
  game, its controls, settings, how it was made and how it is tested.
- 2026-09-26 (release): `tests/film.mjs` records the production build at 60 fps on a virtual clock:
  an init script replaces the page's requestAnimationFrame and performance.now, the script steps one
  1/60 s frame at a time, captures it over CDP and pipes it into ffmpeg-static (x264), so capture
  speed never shows. The game's events are logged with the day clock (`__WG.drain()`, test mode
  only) and saved as marks with their frame; `tests/make-media.mjs` cuts the clips, the scrub
  frames, chapters.json and the README GIFs at those marks, so a new recording re-cuts itself. The
  opening's frames come from the title shot with its mood driven from golden hour to night
  (`__WG.titleMood`).
- 2026-09-26 (release): the filmed Standard evening (seed 11) had every beat in one run: the bot
  brought 12 of 12 home in 3:33 through the sunset, a wolf stalking the flock, a snatch it broke up
  and a bridge crossing. So every clip but the nightfall comes from that one evening and the page
  can give each one its time on the evening's own clock; `--shoot wolves` (a staged snatch) is kept
  as a fallback for recordings without one. The whole evening is encoded at 960 px and 30 fps with a
  bitrate cap to stay under Cloudflare Pages' 25 MiB file limit; the clips stay at 60 fps.
- 2026-09-26 (release): the landing page (`site/`) wears the game's own look: stitched felt panels,
  Fraunces and Nunito, gold only for the one thing to do. The opening scrubs the valley from golden
  hour to night with the scroll while the game's sun bar counts down to nightfall (with the red notch
  where the wolves come out) and the name turns from ink on the golden sky to wool on the night sky.
  The one rule is taught by doing: a small canvas herding toy (ten sheep that flee the pointer as a
  flock, a fold with a gate); `tests/site-check.mjs` drives it with a scripted dog that gathers and
  drives like the game's bot, and it gets all ten home. Enter plays, as on the title screen.
- 2026-09-26 (release): version 1.0.0. Public site on Cloudflare Pages, project `woolgather`
  (https://woolgather.pages.dev): the landing page at `/`, the game built with base `/play/` at
  `/play/` (models load through `import.meta.env.BASE_URL`). Created once as a classic Pages project
  (`wrangler pages project create --force`, as for VoidWing: wrangler 4 now sends new Pages projects
  to Workers). `site/media/` is committed so the site can be rebuilt without filming again.
- 2026-10-09 (season, overnight): Stewart asked to take the game to the next level with full licence
  to change anything. Plan in `docs/NEXT-LEVEL-PLAN.md`; work on branch `season` (main and the live
  site stay on 1.0.0 until he reviews). Considered porting to Godot (offered): stayed on Three.js
  because the game ships to the web and the whole test rig (Playwright bot, virtual-clock filming,
  critics) drives the browser build; a port would have eaten the night before gameplay improved.
- 2026-10-09: critic system. A "random gamer" persona (`tests/critic/persona.md`) that sees only a
  store blurb and footage, never code or design notes, scoring look, readability, feel, fun,
  variety, progression, keep playing and wishlist 1-10. Gemini (`gemini-3.8-flash`, Stewart's pick:
  best value and newer than 3.1 Pro) watches the mp4 and reads the stills; two blind Claude
  subagents read contact-sheet filmstrips and stills. Baseline r00 on 1.0.0: means 4.6-5.5. All four
  critics agreed: gorgeous, but one valley, no progression, too little variety, dead running.
- 2026-10-09: levels are data. `level/*.json` (LevelDef) and the ground, water and tracks are generated
  at load in TypeScript (`world/terraingen.ts`, a port of `blender_scripts/terrain.py`), so a new
  place or season needs no Blender round trip. Blender still makes the props and animals (the fold,
  bridge and farmhouse models are reused, rotated and scaled). `level/valley.json` is kept only for
  the Blender scripts and the 1.0 bot; `level/hollow.json` is the same layout in the new format.
- 2026-10-09: the game is now a season of eight evenings over three places (Hollow Valley, Loch Ailsa,
  The High Pass), each adding one thing: crossings, lambs (follow their mothers; a lost lamb follows
  Pip once found), Old Angus the ram (will not be pushed: stare him down or bark; butts a crowding
  dog; the ewes follow him; wolves fear him), a night watch run backwards to dawn, mist, a storm
  (thunder scatters the flock, the ford floods), first snow. Stars plus one ribbon (optional
  challenge) per evening; charms (perks) unlocked by stars. Progress in localStorage. The 1.0 evening
  stays as "Classic evening". Evenings use fixed placement seeds so a retry starts the same way.
- 2026-10-09: visual leap: an instanced grass field coloured from the ground, with wind gusts rolling
  across it as waves of light and parted by the animals (the double-sided normal flip had to be
  removed or half the blades went black); seasonal palettes generated into the ground colours and
  recoloured props; shader snow on every upward face; mist as a grade-pass veil round Pip with the
  map only remembering what Pip has seen; overcast, rain, snowfall and autumn leaves; a starling
  murmuration over the sunset; chimney smoke; rabbits that bolt from Pip.
- 2026-10-09: sound: 32 recorded sounds generated with the ElevenLabs Sound Effects API (765
  credits; `tools/gen-sfx.mjs`, `docs/audio/SFX.md`), loaded by `audio/samples.ts`; the 1.0
  synthesis stays as the fallback and still makes the music, chimes and stings.
- 2026-10-09 (season, rounds r01-r02): the first season round lifted every critic: Gemini video
  5.5 -> 7.25, Gemini stills 4.75 -> 7.38, Claude video 5.25 -> 6.6, Claude stills 5.4 -> 6.75
  (variety 4 -> 7-8, progression 3 -> 7-8). Their common complaints then: the sunset and wolves
  rarely seen (an expert finished first), the same olive lawn in many evenings, a bridge jam, a
  dull night watch, a flat beige mist, glowing "orbs" (white rabbit tails and fireflies blooming).
  Fixed: wolves and the sunset earlier; a sunset cutaway (a three-second low shot into the western
  sky when the wolves come out); a fifth place, Crannach Corrie, so Hollow Valley no longer hosts
  four evenings; sheep trods (narrow worn tracks) and grass that thins to the water; a bridge
  funnel that keeps the flock moving along the deck (the water beside the deck no longer pushes
  sheep off it); a night watch where the flock drifts and gets spooked and wolves come often; a
  cool grey mist where bleats show where they came from; lie down (Q) from the critics' wish list.
- 2026-10-09: the Glenbrae Trial (evening 5) is a different kind of evening: no wolves, five ewes,
  three gates to take in order and a small pen, judged on points (a missed gate -15, a ewe left out
  -12, a slow round up to -10). It gives the season a skill evening with a score to beat.
- 2026-10-09 (season, round r02): scores held at about 7 (Gemini video 7.38, stills 7.0; Claude
  video 6.63, stills 7.13). Common complaints: the night watch was standing guard while a timer ran
  out; the first evening ended (expert bot, 30 s) before any wolf or sunset; the mist was a blank
  wall; the storm's flood read as cracked concrete and its heather as black lumps; the trial was a
  plain mustard field with a jammed pen; a glowing yellow "orb" kept appearing near Pip. Fixed:
  the night watch now has ewes that wander off into the dark (a marker and a warning name where; the
  wolves go for them) and, at midnight, something crashes through the bracken and scatters the flock
  three ways, so the watch is fetching and regathering, not waiting; wolves on the watch may go for a
  sheep 6 m from Pip (8 elsewhere). Evening 1's flocks are further out (rocks and knoll) and its wolf
  comes at 30 s. The mist leaves 28 m of clear air, never covers more than 80% (shapes show through)
  and takes the evening's light. Floodwater is dark peat-brown with thin foam streaks, the sky does not
  mirror in it, and autumn heather is rust instead of plum. The show field is mown in light and dark
  stripes with short grass, a gold line marches across the next gate, the pen is a little bigger
  (scale 0.74) and driven sheep bunch closer in any pen mouth, as they do on a bridge.
- 2026-10-09: the "orb" was the wolves' eye-shine sprite: drawn at 75% by day, additive on sunlit
  grass, the bloom made it a yellow ball that hid the wolf. It now fades in only as the light goes
  (and is smaller). Found by playing with the bot and probing the scene at the bright spot
  (`__WG.near`, `__WG.pick`, `__WG.uniform` test hooks). Warm ground ripples also fade in (a small ring
  at full strength bloomed the same way).
- 2026-10-09: the mouse wheel now zooms further in, and all the way in the camera tilts down from
  48 to 15 degrees: a low view across the valley with Pip in the foreground, the answer to the
  critics who wanted to see the sunset valley while playing. The herding view stays the default
  (a low camera is no good for steering a flock); the critic capture rolls the wheel in for a few
  seconds in evening 1 so the critics see it.
- 2026-10-09: the recorded score (ElevenLabs Music API, `music_v2_5`, instrumental): an evening bed
  (D major), a dusk bed (D minor) from mood 0.6 and for the whole night watch, a title piece and a
  short win phrase, looped with crossfaded seams; the synthesised tension layer plays on top. The win
  phrase replaces the synth win sting. 1,359 credits for 198 s. Check the ElevenLabs music terms for
  the account's plan before the public site ships it.
- 2026-10-09: flank commands, the critics' most wished-for feature ("whistles", "come bye and
  away"). The player is the dog, so there is no handler to whistle: holding Z or X (d-pad left or
  right) makes Pip run round the nearest flock (the sheep within 14 m of the nearest one) clockwise
  or anticlockwise as seen on screen, easing out to the flock's spread plus his moving reach plus
  2 m, so the run turns the flock's head without pushing it. Sprint still works while flanking.
  It is taught on the Far Bank's card, where the far flock needs an outrun.
- 2026-10-09: today's evening, for a reason to come back (asked for in both rounds): one evening a
  day made from the date (hashed into an Rng): a place (Hollow Valley, Loch Ailsa, the corrie, the
  pass), the real season of the calendar (spring brings lambs, December to February snow), weather
  that suits the place, two or three flocks, sometimes a ram or a black sheep, a ribbon. It sits in
  the season map's spare slot once evening 1 is won; its record is kept under `daily-YYYY-MM-DD`
  and earns no stars toward charms. The bot wins six sampled dates (spring, summer, autumn, winter).
- 2026-10-09: each place has its own ground (`ground` in the level file, over the season's
  palette): a greener machair at Loch Ailsa, a tawny moor in the corrie; the stills critic saw "the
  same olive lawn" in most daytime evenings. Old Angus has a greyer fleece and flat curled horns that
  show from above (upright, they were edge-on to the camera), and is named over his head for his
  evening's first 30 s.
- 2026-10-09 (season, round r03): Gemini video 8.13 (from 7.38), Gemini stills 7.0, Claude video
  7.0, Claude stills 6.88; mean 7.25 (1.0 was 5.22). Fixed after it: the low view dropped the camera
  into the forest edge (trees within 0.72 of the camera-to-Pip distance now vanish while it is
  tilted, `setNearCut` in world.ts); the glowing "orbs" had a second cause (any single over-bright
  pixel bloomed into a soft ball: the bloom's bright pass now clamps each tap to 6 and drops NaN;
  bot runs of 63 and 134 screenshots found none after, one or two before); stone darkens with the
  night (moonlit boulders read as sheep); a small pen pulls driven sheep in harder (the trial's pen
  stalled the flock again); the mist has a crisp clear area and banks with gaps in a cooler grey;
  any key skips the sunset cutaway; evening 1's wolf comes at 13% (39 s); Old Angus is drawn at 3.05
  (from 2.75) in a darker fleece. Final checks: self-test 32/32 with no console errors, the bot
  wins all nine evenings with three stars, 124-141 fps at 1080p High, clean production build.
- 2026-10-09: walk-on (round 2 and 3 critics: long drives behind a slow flock): a sheep driven the
  same way for a few seconds trots on up to 45% faster between pushes (`driveT`); a hard turn
  resets it. The bot still wins all nine evenings with three stars; its times are mixed (a wolf
  rescue made the storm slower), so this is a feel change for human drives, not seen by a critic yet.
- 2026-10-09 (season, round r04): Gemini video 8.13, Gemini stills 7.0, Claude video 6.63, Claude
  stills 7.0; mean 7.19 (r03 7.25): a plateau. The low view and the orb fix were confirmed (one
  critic's favourite shot was the low view). What holds the scores is structural: the places still
  look alike from the high camera, and the expert bot's tidy wins read as no pressure. After it: a
  crowd two or three deep behind the trial's bunting (instanced bodies and heads, two draw calls),
  red and white hurdle wings on the trial gates, subtler mown stripes (read as smudges), and the
  corrie turned heather moor (heather bands over most of the hill, darker moor grass).
- 2026-10-09: where a burn meets a loch, the loch's shore rule (ground within 12 m kept just above
  the loch's level) lifted the burn's channel bed above its own lowered water: a dark slab across
  the burn mouth at Loch Ailsa and an empty mud channel at the corrie lochan's outflow. Inside a
  burn's channel the shore now carves down to below the loch instead; Loch Ailsa's burn ends just
  inside the loch.
- 2026-10-09 (Run 2, plan in `docs/RUN2-PLAN.md`, resume notes in `docs/RUN2-LOG.md`): measured with
  two bot skills. HerdBot2 takes `{skill}`: the expert now goes round flocks with the flank keys;
  the average bot (a first-time player) reacts only to wolves it can see or that were announced,
  0.4 s late, goes for the nearest wolf, holds a course half a second, aims 2-3.5 m off, walks
  more, pauses, and goes round flocks late and close. On the 1.0-balanced season both bots won
  every evening, nearly all with three stars: the critics' "no pressure" in numbers.
- 2026-10-09 (Run 2): Stewart played it once and found it "kid game easy"; he plays like the expert
  bot. The balance rule is now: the expert bot has a fight (wins most evenings, not always with
  three stars), the average bot wins only some of the time. Evenings are shorter with higher
  targets and more, faster wolves; `src/game/tuning.ts` scales the whole season in one place for
  the next playtest. Trial stars moved to 90 / 75 / 55 points.
- 2026-10-09 (Run 2): wolves hunt as a pack (`Rules.pack`, from Old Angus on): a wolf that comes
  out while another stalks Pip's flock pairs with it. The bait prowls in plain view on Pip's side
  and feints; the flanker circles outside the sheep's fear radius to the far side and charges once
  Pip has committed to the bait. A feint is a flag on the stalk state, not a state of its own, so
  markers, camera, HUD and the music all treat the bait as stalking (a real `charge` would have
  fired the snatch banners). Tells keep it fair: a howl answered from the other side, a "Two
  wolves!" toast with an arrow, a growl when the flanker is in place, a pulsing ring on the
  minimap, a one-time tip. Lone wolves strongly prefer prey within 100 m of Pip (a 250 m snatch
  nobody could answer read as unfair).
- 2026-10-09 (Run 2): Wolf Moon, a harder tier of each season evening, opens at three stars: a
  shorter evening, wolves out sooner, one more wolf, a full pack, one more sheep needed (the trial
  a strictly judged championship course, the watch a longer night). Its stars, ribbon and best
  are kept in a `moon` record inside the evening's (a normal win keeps it), and count toward
  charms. Not for today's evening or classic.
- 2026-10-09 (Run 2): charms with verbs instead of more percentages: The Outrun (Z and X together:
  a wide run to the far side of the nearest loose flock, stopping behind it) and Old Fly (F: Pip's
  mother lies down where he stands and holds the spot, sheep keep 6.5 m off her, wolves 8 m; F
  again calls her back to heel, where she moves nothing; one dog per run at the trial, so never
  there). A third charm slot at 30 stars. The storm lantern idea was dropped: wolves already keep
  off sheep near Pip, so it would have been another number.
- 2026-10-09 (Run 2): sheep follow sheep: when one goes into a pen, those within 10 m are drawn
  after it for 3 s (the trial pen stall, named by three critics over two rounds). The night
  watch's unseen spooks now have a cause on screen: a hare bolts out of the grass.
- 2026-10-09 (Run 2): landmarks as level data (`landmarks` in `level/*.json`, models from the new
  `blender_scripts/landmarks.py`): crags with screes, standing stones, a stell, a shieling, a
  jetty and boat, cairns, peat hags, the judges' box. Colliding ones (crags, stell, shieling)
  are kept off the drive lines: sheep only get a short push off walls, so a dyke with a gateway
  would have made a new choke point. Loch outlines are Chaikin-rounded at load, the bed shelves
  from the waterline, and the loch shader draws a broken foam line and clear shallows from the
  true depth (the edge was a staircase of 2 m triangles). Flood foam is domain-warped clots of
  every length (even streaks read as lane markings).
- 2026-10-09 (Run 2): feel: sheep and wolves lean into turns and stand on the slope (YXZ root
  rotation), sheep squash and stretch on startles and pronks (legs counter-scaled), and turn their
  heads to watch Pip when he is near. The white-keep on wool is keyed on the key light's chroma,
  so the fleece stays white through the pink sunset. Control chips dim once used twice.
- 2026-10-09 (Run 2, r05): the herding camera's resting distance came in 12% (`BASE_ZOOM` 0.98 ->
  0.86; the framing still pulls back to fit a spread flock, a wolf or the fold). Three of four r05
  reviews called the view too far and the animals tiny; the closer view also shows the machair's
  flowers and sand. Camera advice has flip-flopped before, so the change is modest and the pitch is
  unchanged.
- 2026-10-09 (Run 2, r06 fixes): a real bug found while chasing "white boulders look like sheep at
  night": materials are cached across levels, so stone given its warm self-light by one level was
  taken for a lamp by the next and glowed under the moon. Stone is now recognised by name first.
  Also: snow only dusts bushes, gorse and heather (white-capped bushes read as a flock); the night
  watch needs 10 of 12 again (at 11 the two- and three-star goals were the same); the Gathering
  starts at the top of the pass; the storm's sky fill and exposure are up (a dim grey-violet
  soup); the wheel's low view stops at 26 degrees, not 15 (four rounds said it put the camera in
  the grass); the sunset cutaway plays once per evening per sitting; Old Fly is a blue merle (a
  red coat read from above as a fox chasing Pip); sideways motion dies away on a bridge deck.
- 2026-10-09 (Run 2, ship): today's evening was far too easy (the expert finished in a quarter of
  the day); its length is now 48 + 36 per flock (+ 30% of the place's extra, + 18 s in fog or
  snow) and it always has a gentle pack. Released as 2.0.0.
