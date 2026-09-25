# WOOLGATHER - project guide for Claude

Third game in the `Opu5.5 Game Prompt` master folder. This folder is its own git repo.
Other games live in sibling folders and are built by other sessions: never touch files outside `woolgather/`.

## Pitch

**Woolgather** is a cosy-tense sheepdog game set in a highland valley at golden hour.
You are Pip, a border collie. The flock has scattered across the hills, the sun is going down,
and wolves come out after dark. Herd every sheep you can into the stone fold by the farmhouse
before night falls.

Sheep are a real flock: they graze, bunch together when nervous and flee from you as a group.
You steer them by *where you stand*, not by pushing them one at a time. Creep up quietly, get
behind the flock, drive it over the bridge and through the fold gate. As the sky turns from gold
to violet the wolves slip out of the pines to snatch stragglers: chase them off or bark them away.

- Win: every sheep that is still yours is in the fold (and you have at least the day's target),
  or night falls with the target met, or you latch the gate early once the target is met.
- Lose: night falls before the target is met, or wolves take so many sheep that the target is
  no longer reachable.
- One valley, one continuous sunset (about 5-6 minutes), three difficulty presets.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move (screen-relative) | WASD / Arrow keys | Left stick |
| Sprint (uses stamina) | Shift | RT / RB |
| Creep (sheep stay calm until close) | C (hold) | LT / LB |
| Bark (startles sheep, scares wolves) | Space or B | A / X |
| Latch the gate (only once target is met) | Enter | Y |
| Pause | Esc or P | Start |

Ctrl is deliberately unused: Ctrl+W closes the browser tab and cannot be intercepted.

## Tech

- Vite + TypeScript + Three.js (WebGLRenderer, PCF soft shadows, ACES tone mapping).
- All gameplay simulation is 2D on the XZ plane; Y comes from the terrain heightfield.
- DOM/CSS overlay for all UI. Fonts: Fraunces (display) and Nunito (UI), both SIL Open Font
  License, bundled from npm `@fontsource-variable/*` (no runtime network fetch).
- Audio: 100% Web Audio synthesis (no audio files). Music is a procedural folk loop.
- Assets: `blender_scripts/*.py` (one script per asset family) generate every model and export
  `.glb` to `public/assets/`. Shared helpers live in `blender_scripts/wg_lib.py`.
- Level layout: `level/valley.json` is the single source of truth, read by both the Blender
  terrain script and the game.

### Commands

- `npm install`, `npm run dev` (port 5317), `npm run build`, `npm run preview` (port 4317)
- `npm run assets` regenerates every asset through Blender (needs Blender 5.x on PATH or
  `BLENDER_PATH`). During development the scripts are run through the Blender MCP.
- `npm run playtest` runs the Playwright self-test (scripted input, screenshots, console log)
  against a running dev server. Screenshots land in `test-results/`.

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

`?test=1` exposes `window.__WG` (state snapshot, time scale, seed) for the Playwright bot.
`?seed=N` fixes the RNG. `?diff=gentle|standard|hard` preselects difficulty. `?fps=1` shows a
frame-time overlay. None of these change gameplay unless used.

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

Status: see the DECISIONS log below for where we are.

## Asset list

| Family script | Output | Contents |
| --- | --- | --- |
| `characters.py` | `collie.glb`, `sheep.glb`, `wolf.glb` | Rigid-part characters with pivots at joints (body, head, tail, 4 legs, ears) for procedural animation |
| `nature.py` | `nature.glb` | pine A/B, oak, birch, bush, 3 rocks, grass tuft, 3 flowers, reeds, log, stump |
| `structures.py` | `structures.glb` | stone fold with gate, guide fences, farmhouse, bridge, dry-stone wall segment, fence segment, lantern post, hay bale, trough, stepping stones, signpost |
| `terrain.py` | `terrain.glb`, `water.glb`, `terrain_height.bin` | valley ground mesh (vertex colours), stream surface ribbon, heightfield for gameplay |
| `fx.py` | `fx.glb` | sky dome, bark shockwave ring, moon |

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
