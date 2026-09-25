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
