# Woolgather: the next 24-hour run ("Run 2")

## Context

Branch `season` (Woolgather 2, "The Season") is 25 commits ahead of `main` and already pushed to
`origin/season`. `main` and the live site (woolgather.pages.dev) are still 1.0.0. The overnight run
built nine evenings over five places, new sheep kinds, weather, a recorded score and a critic system.

The critic means went from 5.22 (1.0) to 7.00, 7.03 and 7.25, then **7.19 in r04: a plateau**. The
problems holding it there are structural, and they have not changed for several rounds:

- **No pressure.** Every clip the critics see is a tidy win, because an expert bot (A*, textbook
  herding, perfect knowledge) plays all the footage. Wolves never coordinate: `sim.ts` has no pack
  logic, and one snatch at a time is the only coupling between them.
- **Charms are stat bumps** (every round): all four are multipliers (`season.ts:281-308`).
- **Dead stretches**: sheep stall at pen and fold mouths (3 critics, 2 rounds).
- **Places look alike from the herding camera** (both Claude critics, r02-r04). "Screes",
  "Shieling", "Crags" and "Bothy" are only minimap labels; nothing is built there.
- **Game feel is the lowest score** (6-7): animals move stiffly.
- Smaller complaints that keep coming back: harsh stair-stepped water edges, sheep turning pink at
  sunset, crowded HUD prompts at the start.

Stewart's calls (2026-10-09):
- Deploy at the end of the run.
- No human playtest during the run; an average-skill bot stands in.
- If time runs short, protect pressure and depth.
- ElevenLabs is on a paid plan, so the recorded audio ships, with a credit line.

Preflight already checked: `gh` is logged in as Samizdat-Publications and wrangler 4.149 is logged
in with offline access.

## Step 0: merge and push (now, before the run)

1. Add `.claude/data/` (a healthcare plugin's scratch folder, not the game) to `.gitignore`.
   Commit on `season` and push.
2. `git checkout main`, `git merge --ff-only season`, `git push origin main`, then back to
   `season`. This is a fast-forward only: main has no commits of its own. Confirm that `origin/main`
   equals `season`.
3. Nothing deploys on a push: this is a direct-upload Pages project with no CI. The README on main
   still describes 1.0 until Phase 6 updates it.
4. Review with Stewart (this plan and the r04 stills). He then sets the effort level and starts
   the run.

## Working rules for the run

- Work on `season`. Commit and push after every step (standing preference). Fast-forward `main`
  only at the end, after full verification.
- **Resume log**: keep `docs/RUN2-LOG.md` (phase, last green commit, next step), updated with every
  commit, so the run survives context compaction or a usage limit.
- **Frozen builds for every long test.** Captures, `season-run` and the self-test each run against
  their own static build folder (`--dist`, or `--url` for the self-test), so `src/` can change while
  they run.
  - `season-run` gains `--dist` and per-run `--out` names. Today it always empties
    `test-results/bot-dist` (`season-run.mjs:51,69`), so two runs at once would race.
  - Never overlap `season-run` or `perf-season` with a capture or a Blender build: GPU contention
    slows the sim and skews the results.
- Every step closes with: `npm run build` clean, the self-test with 0 console errors, and
  `season-run` on the evenings it touched.
- Blender runs only in a background subprocess. Run the one family script needed, never
  `npm run assets` (`build-assets.mjs:30` rebuilds every model).
- Log every non-obvious choice in the CLAUDE.md DECISIONS log. No em dashes anywhere.
- Spend caps:
  - Gemini: at most 3 critic rounds (video and stills each).
  - ElevenLabs: at most 400 credits, new sounds only.
  - No Meshy or Sketchfab: Blender keeps the art style consistent.
- **Bot tuning is timeboxed**: after two passes on an evening, change that evening's data (day
  length, wolf timing, target) instead of the bot.
- Critic stop rule (as in every milestone): stop after two rounds whose worst issue is minor, or
  when time is up. The critics' art advice flip-flops, so fix clear defects, not taste.

## Phase 1 (H0-H3): measure honestly

**H0, in the background while the bot work starts:**
- **Control round r04b**: re-capture today's build with the average bot as soon as it exists, and
  run the Claude critics only (free). This separates "the footage changed" from "the game changed"
  when r05 is compared with r04.
- **Blind place test, baseline.** A blind Claude subagent gets 10 unlabelled herding-camera shots
  (2 per place, same zoom and time of day; via `__WG.evening(id)` and `jumpTo`). It must group them
  by place and describe each one. This tests the landmark hypothesis before 4+ hours go into it.

**Average-skill bot** (`tests/bot2.mjs`, `HerdBot2(page, log, {skill})`, `expert` stays the default):
- How it plays:
  - It reacts to wolves 0.4 s late, and only once they are on screen or announced.
  - It aims drive points with 2-3 m of noise.
  - It walks unless the target is more than 40 m away.
  - It pauses now and then.
  - It goes for the nearest wolf, so it falls for a bait wolf.
- What it needs from the game:
  - The runners pass drained events into `bot.step`. Today they are drained and dropped in
    `season-run.mjs:203-205` and `capture.mjs:259-261`.
  - The state snapshot exposes each wolf's role and target. `game.ts:1590` gives only id,
    position and state.
- Every delay and every noise draw uses seeded RNG and game time, so the bot behaves the same in
  `season-run` (steps every 50 ms of real time) and in a capture (steps every 1/20 s of game time).
- Calibrate it to take 2-4x the expert's time on evenings 1 and 2.
- Wire `--skill` through `tests/season-run.mjs` and `tests/critic/capture.mjs`.

**The expert bot flanks.** Replace its private `outrun()` orbit (`bot2.mjs:671-695`) with holding
Z/X, so flanking finally shows in the footage.

**Classic self-test on HerdBot2.** The old 1.0 bot has hard-coded `valley.json` coordinates
(`bot.mjs:8`, `playtest.mjs:13,203`). Any landmark in Hollow Valley would break it.

**Baseline balance table**: the average bot over all nine evenings and three daily dates. The rule
is that every normal evening must be winnable by the average bot (1 star or more); ease any it
loses.

## Phase 2 (H3-H13): pressure and depth (protected)

**2a. Wolves that hunt as a pack** (H3-H7; `src/game/sim.ts`, `rules.ts`, `config.ts`)
- New fields:
  - `Wolf.role: 'lone' | 'bait' | 'flanker'` (`sim.ts:84`).
  - An explicit per-evening `Rules.pack?: boolean` (`rules.ts:38`). It is never inferred from the
    wolf count: classic Hard and the daily evenings have up to 3 wolves.
- Pairing, in `spawnWolf()` (1309-1358): a wolf that spawns while another stalks Pip's flock pairs
  with it. It shares that wolf's target (relax the no-sharing rule at 1293 for pairs only) and
  leaves from the den on the far side (den choice at 1327-1337).
- The **bait** shows itself on Pip's side, skips the lurk retreat, howls, and makes short feints.
  A feint is its own state, `feint`. It never enters `charge`, because that would fire the charge
  event, the HUD banners and the bot's threat logic.
- The **flanker** circles outside the sheep's 13 m wolf-fear radius to the side opposite the bait.
  Its `mayCharge` (1489) opens only once Pip has committed toward the bait. The one-snatch gate
  (1489, 1508) stays.
- Tells that keep it fair:
  - A low growl panned to the flanker's side.
  - A faint red pulse on the minimap.
  - Edge markers for pack members. Camera framing does not stretch to 55 m.
  - A one-time tip: "Two wolves: one shows itself, watch the far side".
- Raise the wolf instancer's capacity from 6 (`actors.ts:411`).
- In the normal tier the pack is on gently in Night Watch and First Snow only. Wolf Moon turns it
  on fully.
- The expert bot holds the flock's far side and ignores feints, using the exposed roles.

**2b. Wolf Moon: a harder tier for every season evening** (H7-H10; `season.ts`, `game.ts`, `ui.ts`)
- **Unlock**: per evening, at 3 stars. There is no Wolf Moon for the daily evening or classic mode.
- **Rules overlay**: day x0.85, wolves out about 25% earlier, one more wolf, respawn x0.75, pack on,
  target +1.
  - The trial gets a "Championship course" instead: less time and a stricter slow-round penalty.
    The gates keep their width, because gates are level data.
  - The night watch gets a longer night and more wolves.
- **Saves**:
  - An optional `moon` record inside `woolgather.season.v1`, with its own stars, ribbon and best
    time.
  - Fix `finishEvening`, which rebuilds the record and would wipe `moon` (`game.ts:780-786`):
    spread the previous record first.
  - Keep `loadProgress` from dropping the new key (`season.ts:327`).
  - Add `progress('moon')` for tests, because `progress('all')` only gives 2 stars
    (`game.ts:1513`).
  - No migration is needed: no public season saves exist yet.
- Moon stars count toward charms.
- **UI**:
  - A moon badge on each season-map card.
  - A tier switch on the intro card (left/right).
  - Violet styling for moon cards.
  - The results card names the tier.
- **Gate**: the expert bot wins every Wolf Moon evening. The average bot's results are only
  recorded (losses are expected).

**2c. Fly, the old dog** (H10-H12; a verb charm, unlocks at 16 stars)
- Press F (gamepad d-pad down) and Fly trots to where Pip stands and lies down there. Press again
  to move her.
- Sheep will not pass near her: a repeller in the sim with a fixed 6 m radius. Wolves will not pass
  within 8 m.
- She blocks a gap, holds a gate or guards a flank.
- **Not allowed at the trial**, where one dog per run is the rule (a `helpers: false` rules flag).
  Allowed everywhere else.
- Model: a second collie rig (`collie.glb`, red and white with a grey muzzle), recoloured in code.
  Pip is the only rig that is not instanced, so Fly is a second plain instance.
- Also needs a HUD chip, a bark sound (ElevenLabs) and a self-test assertion.
- The bots play without charms, so every balance number is charm-free.

**2d. Outrun, a second verb charm** (H12, about 45 min; built on `flankDir`, `sim.ts:392-436`)
- Hold Z and X together and Pip runs a wide pear-shaped outrun to the far side of the nearest flock
  that is not being worked, then stops behind it facing the fold.
- It is a real sheepdog command, and it cuts the long walks critics called dead time.

**2e. Sheep follow sheep through gates** (H12-H13; the sheep update in `sim.ts`)
- When a sheep crosses a fold or pen gate line, flock-mates within 10 m get a pull toward the mouth
  for about 3 s, stronger when they are being driven.
- Measure the trial's pen phase and the fold finish before and after, with both bots.

**2f. A visible spook on the night watch** (about 30 min): the watch already spooks the flock every
14-22 s (`sim.ts:1634-1657`). Make the cause visible: a rabbit or hare from `world/life.ts` bolts
through the flock.

## Phase 3 (H13-H14): freeze, r05, preview deploy

- Freeze `dist-r05`. Capture `--scenario season` with the average bot, plus a Wolf Moon pack clip
  (jumped to a time when at least 2 wolves are allowed: `allowedWolves()` ramps them up,
  `sim.ts:1277-1284`) and a Fly clip.
- Gemini video and stills, the two blind Claude critics, then `report.mjs`. These run in the
  background while Phase 4 starts.
- **Deploy rehearsal**: `npm run site`, then a preview deploy to a non-production branch. Also write
  down a rollback path: list the deployments, or rebuild the `v1.0.0` tag in a worktree and
  redeploy it.

## Phase 4 (H14-H18): sense of place (signature landmarks only)

**Blender, from H3 in parallel**: a subagent writes `blender_scripts/landmarks.py`, which outputs
`public/assets/landmarks.glb`. It covers big crag rocks, a standing stone, a cairn, the shieling
ruin, a stell wall arc, a jetty, a rowing boat, a judges' box, snow poles, peat hags and cotton
grass. It also renders EEVEE previews into `docs/assets/` for QA. Only this script runs.

**4a. Landmarks as level data**
- **Schema**: `landmarks?: {kind, at, r?, angle?, scale?}[]` in `LevelDef` (`src/game/leveldef.ts`).
- **Colliders** go into the `Level` constructor next to the rocks (`level.ts:253-261`). Grass,
  trods and `scatter()`'s `clear()` already avoid them. Bot2's nav grid picks them up (check with
  `__WG.navGrid()`).
  - Sheep spawning checks rocks and trees but not walls (`sim.ts:225`), so add walls to that check.
  - Sheep only get a short push off walls with no sliding (`sim.ts:1064-1077`). So colliding
    landmarks (crags, stells) stay **off the drive lines**, with gaps of 8 m or more. No dyke with a
    gateway: it would create a new choke point.
- **Ground**: crags raise `height()` (`terraingen.ts:128`). Scree, shingle, bog and trampled mud
  are painted in the colour loop (192-265).
- **Placement**: a block in `buildWorld` after the rocks (`world.ts:~566`), plus minimap glyphs in
  `drawBase` (`minimap.ts:106`). Landmarks sit inside the play area, where the herding camera
  passes.
- **One signature set per place**:

  | Place | Landmarks |
  | --- | --- |
  | Hollow Valley | standing stones on a knoll, a stell |
  | Loch Ailsa | shingle shore with a jetty and a boat, reed beds |
  | Crannach Corrie | a crag with scree fans below it, the shieling ruin |
  | Glenbrae Show Field | the judges' box and flags, paid for by instancing the 46 bunting pennants and the hurdle rails (`world.ts:763, 806-811`) |
  | The High Pass | a cairn on the col, snow poles, peat hags |

- Re-run both bots on every evening, and the classic self-test.

**4b. Water edges (the cheap version)**
- Chaikin-smooth the loch polygons at load (Ailsa has 10 points, the lochan 8).
- Add a per-vertex depth attribute (water level minus ground) to the loch and stream meshes. The
  water shaders (`world.ts:205-326`) fade the colour, add shallows and draw a foam line by depth.
- Spread the shore carve (`terraingen.ts:146-154`) over two cells.
- The flood only gets its "lane dash" streaks broken up (domain-warped, varied lengths,
  `world.ts:250-251`). The full flood rework waits unless a critic calls it major.

**4c. Blind place test, again**: pass means the grouping is correct.

## Phase 5 (H18-H20): feel and r05 fixes

- **Animals move like animals** (`src/world/anim.ts`, `actors.ts`):
  - Sheep and wolves lean into turns (copy the dog's `prevFacing`/`turn` code, `anim.ts:94-97`).
  - Every animal tilts with the slope. This needs YXZ rotation order on the root (`actors.ts:621`).
  - Squash and stretch on hops, landings and startles, plus a damped fleece wobble. The legs and
    head are children of `body`, so counter-scale them in code.
- **Sheep watch the dog**: heads turn toward Pip inside the flight zone, clamped to about 50
  degrees.
- **Pip**: skid dust and extra lean on hard sprint turns, and a springy tail.
- **Sheep stay white at sunset**: key `whiteKeep` (`actors.ts:485-490`) on the key light's chroma
  instead of its orangeness, keeping a touch of warmth. Ease the grade's highlight push
  (`grade.ts:93-95`). Measure with `tests/lookdev.mjs` and `tests/colorprobe.py`.
- **Quieter HUD**: each control chip fades once that control has been used twice, and the opening
  tips come one at a time.
- Fix any new major from r05.

## Phase 6 (H20-H24): verify, document, ship

- **H20: code freeze.** Run r06 (same capture as r05) and the place test in the background. Fix
  only blockers after the freeze.
- **H20-H22: full verification** (table below) and docs:
  - `docs/RUN2-REPORT.md`: what changed, scores r04, r04b, r05 and r06, both bots' balance tables,
    spend, and open issues.
  - CLAUDE.md: Controls gain F (Fly) and Z+X (outrun); Status; the asset list gains
    `landmarks.py`; DECISIONS.
  - README: a "The Season" section.
  - Landing page copy for the season with stills from r06, and an ElevenLabs credit line on the
    site and in the game's credits.
- **H22-H23: ship**:
  1. `package.json` to 2.0.0 and tag `v2.0.0`.
  2. Fast-forward `main`, then push `main` and the tag.
  3. Publish a GitHub release.
  4. `npm run site -- --deploy`.
  5. `node tests/site-check.mjs --url https://woolgather.pages.dev`.
  6. If the live check fails, roll back to 1.0 by the rehearsed path.
- **H23-H24: buffer.**

## Verification (on the final commit; most of it also closes each phase)

| Check | Command | Pass |
| --- | --- | --- |
| Build | `npm run build` | clean, no type errors |
| Self-test | `npm run playtest` (frozen build) | 0 console errors; all assertions: today's 32, plus Wolf Moon, Fly, outrun, landmarks loading; the classic win check on HerdBot2 |
| Expert bot | `node tests/season-run.mjs --parallel 3` | all nine evenings 3 stars; all nine Wolf Moon won; 3 daily dates won; classic Standard and Hard won |
| Average bot | `node tests/season-run.mjs --skill average --parallel 3` | all nine normal evenings won (1+ star); Wolf Moon results recorded |
| Saves | self-test step | a normal win after a moon win keeps the moon record; an old save without `moon` loads |
| Frame rate | `node tests/perf-season.mjs --dist dist` | every evening at 110+ fps at 1080p High; draw calls under about 420; 0 errors (the r04 build: 124-141 fps, 312-377 calls) |
| Places | blind place test | correct grouping (the baseline is recorded at H0) |
| Critics | r05 and r06 against r04b | mean 7.5+; game feel 7+; no "places look alike" or "tidy wins" major from the Claude critics |
| Site | `node tests/site-check.mjs`, locally then with `--url` | passes |

## Cut order if behind schedule

**First to go, in this order**:
1. The animation extras: slope tilt, fleece wobble.
2. Outrun.
3. The night-watch rabbit.
4. The water edges beyond the polygon smoothing.
5. Landmarks beyond Corrie, Loch and Hollow.
6. Round r06 (ship on r05's fixes).

**Never cut**: the average-skill bot, the pack, Wolf Moon, Fly, sheep following through gates, the
final verification and the deploy.

**Already cut**, after review:
- The storm lantern: wolves already keep 8 m off sheep near Pip, so it would be a stat bump.
- The bell-wether, which outrun replaces.
- The camera change: it would fight the pack framing, and camera advice has flip-flopped before.
- The minimap restyle.
- Vehicles and the boathouse.
- The full flood rework.

**Stretch, only if ahead**:
- A tenth evening, "The Shed": split two raddled ewes off the flock and pen them separately.
- Pip coat colours bought with moon stars.
- The bell-wether.
- The minimap restyle.

## Effort

Recommend **high** for the run:
- It runs 24 hours unattended.
- The hard parts are judgment calls: pack tuning, balance, and which critic advice to ignore.
- The core files are large (`sim.ts` is 1,754 lines, `game.ts` 1,627).

Medium is fine for Step 0 and the review.
